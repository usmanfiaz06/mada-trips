import "server-only";
import { createHash } from "node:crypto";
import { eq } from "drizzle-orm";
import { fareRulesFor, sarToHalalas, type Cabin, type FlightLeg } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { isProductionDeploy } from "../../config";
import { AppError } from "../../http";
import type { BookingFlightOffer } from "../booking-types";
import type {
  FlightBookingDetails, FlightBookingPart, FlightBookingRef, FlightCancelResult, FlightFareRules, FlightOutcome, FlightPassenger, TicketingFlightSupplier, WriteOpts,
} from "../flight-ticketing";
import { costHalalas, UnknownCurrency } from "../hotelbeds/money";
import { AIRPORT_TZ } from "../mock/data";
import { notConfigured, requireEnv } from "./not-configured";

/*
 * Flights through TBO Air (TBO Holidays' air API, "Travel Boutique Online"): search, fare rules, price check, hold
 * (full-service airlines), ticket, booking details, release and refund request. docs/app/TBO.md has the setup.
 *
 * Confirmed from TBO's public API pages (dealint.tboair.com/APIDocument, read 2026-10-19: APIGuide, Pathway,
 * Authentication, Search, FareQuote, Book, Ticket, GetBookingDetails, SendChangeRequest, FlightFAQ, Certification):
 *   - the methods and their order: Authenticate → Search → FareRule → FareQuote → SSR (optional) → Book (non-LCC only)
 *     → Ticket → GetBookingDetails; ReleasePNRRequest (a hold) and SendChangeRequest (a refund) to cancel;
 *   - low-cost airlines (IsLCC true) have no Book: Ticket straight away with the passengers; full-service airlines are
 *     held with Book, then ticketed by PNR + BookingId. SSR goes in Ticket for LCC, in Book for non-LCC. No baggage or
 *     seat SSR for infants (meals are fine). Wallet deduction happens at Ticket;
 *   - one TokenId a day (valid 00:00–23:59, every API and server), sent back on every call with EndUserIp; a TraceId
 *     from Search, valid 15 minutes, sent back with the ResultIndex;
 *   - PassengerType 1 adult, 2 child, 3 infant; JourneyType 1 one way, 2 return; FlightCabinClass 1 all, 2 economy,
 *     3 premium economy, 4 business, 5 premium business; ResponseStatus 0 NotSet, 1 Successful, 2 Failed,
 *     3 InValidRequest, 4 InValidSession, 5 InValidCredentials; Error { ErrorCode (0 = none), ErrorMessage };
 *   - Search result fields: ResultIndex, Source, IsLCC, IsRefundable, Fare { Currency, BaseFare, Tax, YQTax,
 *     OtherCharges, PublishedFare, OfferedFare, ServiceFee, … }, FareBreakdown [{ PassengerType, PassengerCount,
 *     BaseFare, Tax, YQTax }] (totals for that many passengers: divide by the count), Segments (TripIndicator 1 out,
 *     2 in; Airline { AirlineCode, AirlineName, FlightNumber, FareClass }; Origin/Destination { Airport { AirportCode,
 *     Terminal, CityCode, CountryCode }, DepTime / ArrTime }; Duration, GroundTime, Baggage "30 KG", CabinBaggage,
 *     NoOfSeatAvailable), LastTicketDate, Penalty { ReissueCharge, CancellationCharge }; fare rules only from FareRule;
 *   - international return: one result covers both ways; domestic return: separate outbound and inbound results;
 *   - FareQuote answers IsPriceChanged; Book and Ticket answer IsPriceChanged / IsTimeChanged: compare and send again
 *     with the new fare (IsPriceChangeAccepted on a non-LCC Ticket). LCC fare changes at Ticket are failures;
 *   - TicketStatus 0 Failed, 1 Successful, 2 NotSaved, 3 NotCreated, 4 NotAllowed, 5 InProgress, 6 already created,
 *     8 PriceChanged, 9 OtherError, 10 Released, 12 Cancelled. For 0/2/3/5 call GetBookingDetails before anything
 *     else, and never book again while one is in progress (it settles in 10–15 minutes);
 *   - a duplicate booking for the same passengers is refused for 5 days; certification is 11 test cases on the
 *     sandbox; live access comes after sign-off, and TBO allows requests only from the static IP you give them.
 *
 * Assumed (TBO's pages above mix two API generations; these follow the long-standing "TBO Air API" JSON integration
 * that most agencies use, and are the first things to check against the documents TBO sends with the credentials):
 *   - URLs: Authenticate at TBO_AUTH_URL (test default http://api.tektravels.com/SharedServices/SharedData.svc/rest/
 *     Authenticate, live https://api.travelboutiqueonline.com/SharedAPI/SharedData.svc/rest/Authenticate), the air
 *     methods at TBO_AIR_BASE_URL/<Method>/ and Book/Ticket/GetBookingDetails at TBO_AIR_BOOKING_URL (default: the base);
 *   - Authenticate takes { ClientId, UserName, Password, EndUserIp } and answers { Status: 1, TokenId, Error, Member };
 *   - air answers come wrapped in { Response: { … } }; Search Results and Segments are arrays of arrays (one per
 *     direction); FareQuote Results is one result; Book/Ticket put { PNR, BookingId, Status | TicketStatus,
 *     IsPriceChanged, IsTimeChanged, SSRDenied, FlightItinerary { Passenger [{ Ticket { TicketId, TicketNumber } }] } }
 *     under Response.Response;
 *   - an expired token answers ErrorCode 6 or ResponseStatus 4 (we authenticate again once);
 *   - GetBookingDetails finds a booking with no BookingId yet by TraceId + the lead passenger's first and last name;
 *   - SendChangeRequest { BookingId, RequestType 1 (full cancellation), CancellationType 3 (other), TicketId [], Remarks }
 *     answers TicketCRInfo [{ ChangeRequestId }]; ReleasePNRRequest { BookingId, Source };
 *   - Passenger { Title, FirstName, LastName, PaxType, DateOfBirth, Gender 1 male / 2 female, PassportNo,
 *     PassportExpiry, AddressLine1, City, CountryCode, CountryName, Nationality, ContactNo, Email, IsLeadPax, Fare,
 *     Meal/Seat { Code, Description } (non-LCC), Baggage/MealDynamic/SeatDynamic [] (LCC) }; seat preference codes
 *     W / A; the fare per passenger is that type's breakdown divided by its count, OtherCharges shared equally;
 *   - the token's day ends at midnight India time (TBO's servers); fare-rule text is free text, read for fees as
 *     well as we can (the Penalty block wins when it's there).
 *
 * Money: we sell at PublishedFare (what the airline publishes; the commission, PublishedFare − OfferedFare, is Mada's),
 * converted to riyals at our rates (APP_FX_RATES, hotelbeds/money.ts) and rounded up to a riyal per person, plus
 * TBO_AIR_MARKUP_BPS (default 0).
 *
 * Environment:
 *   TBO_AIR_BASE_URL         the air service base (…/AirService.svc/rest). Required.
 *   TBO_CLIENT_ID, TBO_USERNAME, TBO_PASSWORD   from TBO. Required.
 *   TBO_END_USER_IP          the IP TBO knows us by (the whitelisted egress IP). Unset: looked up once from
 *                            TBO_IP_ECHO_URL (default https://api.ipify.org?format=json).
 *   TBO_ENV                  test | live (default test). Test tickets aren't real, so a production deployment refuses
 *                            to book on test; live booking outside production needs TBO_ALLOW_LIVE_BOOKING_OUTSIDE_PRODUCTION=yes.
 *   TBO_AUTH_URL, TBO_AIR_BOOKING_URL   overrides (see above).
 *   TBO_AIR_MARKUP_BPS       Mada's margin over the published fare (default 0).
 *   TBO_ADDRESS_LINE, TBO_ADDRESS_CITY, TBO_CONTACT_EMAIL   the address and email on bookings (default Mada's office).
 */

export const TBO_ENV_REQUIRED = ["TBO_AIR_BASE_URL", "TBO_CLIENT_ID", "TBO_USERNAME", "TBO_PASSWORD"] as const;
export const tboAirConfigured = () => TBO_ENV_REQUIRED.every((n) => !!process.env[n]);

const DEFAULT_AUTH = {
  test: "http://api.tektravels.com/SharedServices/SharedData.svc/rest/Authenticate",
  live: "https://api.travelboutiqueonline.com/SharedAPI/SharedData.svc/rest/Authenticate",
} as const;

/** How long we wait per call. The breaker (resilience/breaker.ts) waits a little longer than the longest. */
export const TBO_TIMEOUTS = { auth: 10_000, search: 30_000, quote: 15_000, book: 40_000, ticket: 40_000, details: 15_000 } as const;
/** A search's TraceId lives 15 minutes; we stop using it a minute early. */
const TRACE_MS = 14 * 60_000;
const OFFER_TTL_MS = 14 * 60_000;
const TOKEN_KEY = "tbo_air_token";

type Env = { base: string; booking: string; auth: string; clientId: string; user: string; password: string; live: boolean };

function env(): Env {
  const e = requireEnv("flights (TBO Air)", [...TBO_ENV_REQUIRED]);
  const live = (process.env.TBO_ENV ?? "test").trim().toLowerCase() === "live";
  const trim = (u: string) => u.trim().replace(/\/+$/, "");
  const base = trim(e.TBO_AIR_BASE_URL!);
  return {
    base, booking: trim(process.env.TBO_AIR_BOOKING_URL || base), auth: trim(process.env.TBO_AUTH_URL || DEFAULT_AUTH[live ? "live" : "test"]),
    clientId: e.TBO_CLIENT_ID!, user: e.TBO_USERNAME!, password: e.TBO_PASSWORD!, live,
  };
}

/** Booking and ticketing spend real money (live) or make tickets nobody can fly on (test): refuse the wrong pairing. */
function assertMayBook(e: Env) {
  if (isProductionDeploy() && !e.live) notConfigured("flights (TBO Air) booking", ["TBO_ENV=live (test tickets aren't real)"]);
  if (!isProductionDeploy() && e.live && process.env.TBO_ALLOW_LIVE_BOOKING_OUTSIDE_PRODUCTION !== "yes") {
    notConfigured("flights (TBO Air) booking", ["TBO_ALLOW_LIVE_BOOKING_OUTSIDE_PRODUCTION=yes (live tickets from a non-production deployment)"]);
  }
}

/* ───────────── transport ───────────── */

type TboError = { ErrorCode?: number; ErrorMessage?: string };
type Wrapped<T> = { Response?: T } & T;

async function post<T>(url: string, body: unknown, timeoutMs: number): Promise<T> {
  const res = await fetch(url, {
    method: "POST", headers: { "Content-Type": "application/json", Accept: "application/json" }, body: JSON.stringify(body), signal: AbortSignal.timeout(timeoutMs),
  });
  const text = await res.text().catch(() => "");
  // 5xx: transport trouble, which the circuit breaker counts.
  if (res.status >= 500) throw new Error(`TBO answered ${res.status}`);
  let data: unknown = null;
  try { data = text ? JSON.parse(text) : null; } catch { /* below */ }
  if (!data || typeof data !== "object") throw new Error(`TBO answered ${res.status} without JSON`);
  return data as T;
}

let endUserIp: string | null = null;
async function ip(): Promise<string> {
  const set = process.env.TBO_END_USER_IP?.trim();
  if (set) return set;
  if (endUserIp) return endUserIp;
  const res = await fetch(process.env.TBO_IP_ECHO_URL || "https://api.ipify.org?format=json", { signal: AbortSignal.timeout(4_000) });
  const j = (await res.json().catch(() => null)) as { ip?: string } | null;
  if (!j?.ip || !/^[0-9a-f.:]+$/i.test(j.ip)) notConfigured("flights (TBO Air)", ["TBO_END_USER_IP (couldn't work out this server's address)"]);
  endUserIp = j.ip;
  return j.ip;
}

/* ───────────── the day's token, shared by every server instance ───────────── */

type Token = { id: string; until: number; who: string };
let memo: Token | null = null;
let authing: Promise<Token> | null = null;

/** Who the token belongs to (a changed username or client id must not reuse it). Never the password. */
const whoOf = (e: Env) => createHash("sha256").update(`${e.auth}|${e.clientId}|${e.user}`).digest("hex").slice(0, 16);

/** The end of today in India (UTC+5:30, no daylight saving), ten minutes early. */
export function tokenUntil(now = Date.now()): number {
  const ist = 5.5 * 3600_000;
  const day = Math.floor((now + ist) / 86_400_000);
  return (day + 1) * 86_400_000 - ist - 10 * 60_000;
}

async function sharedToken(who: string): Promise<Token | null> {
  try {
    const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, TOKEN_KEY));
    const v = row?.value as Partial<Token> | undefined;
    if (v?.id && v.who === who && typeof v.until === "number" && v.until > Date.now()) return v as Token;
  } catch { /* no database: this instance authenticates for itself */ }
  return null;
}

async function saveToken(t: Token) {
  try {
    await db.insert(appRuntime).values({ key: TOKEN_KEY, value: t }).onConflictDoUpdate({ target: appRuntime.key, set: { value: t, updatedAt: new Date() } });
  } catch { /* advisory */ }
}

async function authenticate(e: Env): Promise<Token> {
  const who = whoOf(e);
  const shared = await sharedToken(who);
  if (shared) return shared;
  const r = await post<{ Status?: number; TokenId?: string; Error?: TboError }>(e.auth, { ClientId: e.clientId, UserName: e.user, Password: e.password, EndUserIp: await ip() }, TBO_TIMEOUTS.auth);
  if (!r.TokenId || (r.Error?.ErrorCode ?? 0) !== 0 || (r.Status !== undefined && r.Status !== 1)) {
    // Wrong credentials, API access not switched on for the user, or the IP isn't whitelisted: ours to fix, not an outage.
    console.warn(`[tbo-air] Authenticate refused: ${safe(r.Error?.ErrorCode)} ${safe(r.Error?.ErrorMessage, 120)}`);
    throw new AppError("NOT_CONFIGURED");
  }
  const t: Token = { id: r.TokenId, until: tokenUntil(), who };
  await saveToken(t);
  return t;
}

async function token(e: Env): Promise<string> {
  if (memo && memo.who === whoOf(e) && memo.until > Date.now()) return memo.id;
  authing ??= authenticate(e).finally(() => { authing = null; });
  memo = await authing;
  return memo.id;
}

async function forgetToken() {
  memo = null;
  try { await db.delete(appRuntime).where(eq(appRuntime.key, TOKEN_KEY)); } catch { /* advisory */ }
}

/** Tests only. */
export async function resetTboAir() { memo = null; authing = null; endUserIp = null; inflight.clear(); await forgetToken(); }

const sessionGone = (r: { ResponseStatus?: number; Error?: TboError }) => r.ResponseStatus === 4 || r.Error?.ErrorCode === 6;

/** One air method. An expired token is renewed once and the call repeated (TBO didn't act on it). */
async function air<T extends { ResponseStatus?: number; Error?: TboError }>(method: string, body: Record<string, unknown>, opts: { booking?: boolean; timeout: number }): Promise<T> {
  const e = env();
  for (let attempt = 0; ; attempt++) {
    const tok = await token(e);
    const raw = await post<Wrapped<T>>(`${opts.booking ? e.booking : e.base}/${method}/`, { EndUserIp: await ip(), TokenId: tok, ...body }, opts.timeout);
    const r = (raw.Response ?? raw) as T;
    if (sessionGone(r) && attempt === 0) { await forgetToken(); continue; }
    if (r.ResponseStatus === 5) { console.warn(`[tbo-air] ${method}: invalid credentials`); throw new AppError("NOT_CONFIGURED"); }
    return r;
  }
}

/** Codes and short text only in logs and reasons: never passenger data. */
const safe = (s: unknown, n = 60) => String(s ?? "").replace(/[^\w .,:/()-]/g, "").slice(0, n);
const failed = (r: { ResponseStatus?: number; Error?: TboError }) => (r.Error?.ErrorCode ?? 0) !== 0 || (r.ResponseStatus !== undefined && r.ResponseStatus !== 1);
const SOLD_OUT = /sold ?out|no (more )?seats?|seats? (are )?not available|not available|class (is )?closed|unable to sell|no fare/i;
const isSoldOut = (r: { Error?: TboError }) => SOLD_OUT.test(r.Error?.ErrorMessage ?? "");

/* ───────────── TBO shapes (only what we read) ───────────── */

type TboAirport = { AirportCode?: string; Terminal?: string; CityCode?: string; CountryCode?: string };
export type TboSegment = {
  TripIndicator?: number; SegmentIndicator?: number; Baggage?: string; CabinBaggage?: string; NoOfSeatAvailable?: number; Duration?: number; GroundTime?: number;
  Airline: { AirlineCode: string; AirlineName?: string; FlightNumber: string; FareClass?: string };
  Origin: { Airport: TboAirport; DepTime: string }; Destination: { Airport: TboAirport; ArrTime: string };
};
type TboFare = { Currency?: string; BaseFare?: number; Tax?: number; YQTax?: number; OtherCharges?: number; PublishedFare?: number; OfferedFare?: number; ServiceFee?: number; AdditionalTxnFeePub?: number; AdditionalTxnFeeOfrd?: number; Discount?: number };
type TboBreakdown = { Currency?: string; PassengerType: number; PassengerCount: number; BaseFare: number; Tax: number; YQTax?: number; AdditionalTxnFeePub?: number; AdditionalTxnFeeOfrd?: number };
export type TboResult = {
  ResultIndex: string; Source?: number; IsLCC?: boolean; IsRefundable?: boolean; Fare: TboFare; FareBreakdown?: TboBreakdown[];
  Segments: TboSegment[][] | TboSegment[]; LastTicketDate?: string | null; Penalty?: { ReissueCharge?: string | number | null; CancellationCharge?: string | number | null } | null;
  IsPassportRequiredAtBook?: boolean; IsPassportRequiredAtTicket?: boolean;
};
type SearchResponse = { ResponseStatus?: number; Error?: TboError; TraceId?: string; Results?: TboResult[][] | TboResult[] };
type QuoteResponse = { ResponseStatus?: number; Error?: TboError; TraceId?: string; IsPriceChanged?: boolean; Results?: TboResult | TboResult[] };
type RuleResponse = { ResponseStatus?: number; Error?: TboError; FareRules?: { FareRuleDetail?: string; FareRestriction?: string; Airline?: string }[] };
type TboTicket = { TicketId?: number; TicketNumber?: string; ValidatingAirline?: string };
type TboItinerary = { BookingId?: number; PNR?: string; Status?: number; LastTicketDate?: string | null; Fare?: TboFare; Passenger?: { FirstName?: string; LastName?: string; PaxType?: number; Ticket?: TboTicket | null }[] };
type BookAnswer = { PNR?: string; BookingId?: number; Status?: number; TicketStatus?: number; IsPriceChanged?: boolean; IsTimeChanged?: boolean; SSRDenied?: boolean; SSRMessage?: string; FlightItinerary?: TboItinerary };
type BookResponse = { ResponseStatus?: number; Error?: TboError; TraceId?: string; Response?: BookAnswer };
type DetailsResponse = { ResponseStatus?: number; Error?: TboError; FlightItinerary?: TboItinerary };
type ChangeResponse = { ResponseStatus?: number; Error?: TboError; TicketCRInfo?: { ChangeRequestId?: number; Status?: number; Remarks?: string }[] };

/* ───────────── offers ───────────── */

type Party = { adults: number; children: number; infants: number };
type Query = { from: string; to: string; depart: string; ret: string | null; cabin: Cabin } & Party;
/** Everything price() needs to find the same flights again after the TraceId has gone. */
type OfferKey = { v: 1; t: string; at: number; r: string[]; l: boolean[]; s: (number | null)[]; q: Query; k: string };

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64url");
export const encodeOffer = (k: OfferKey) => `tbo.${b64(JSON.stringify(k))}`;
export function decodeOffer(id: string): OfferKey | null {
  if (!id.startsWith("tbo.")) return null;
  try {
    const k = JSON.parse(Buffer.from(id.slice(4), "base64url").toString("utf8")) as OfferKey;
    return k?.v === 1 && typeof k.t === "string" && Array.isArray(k.r) ? k : null;
  } catch { return null; }
}

const CABIN: Record<Cabin, number> = { economy: 2, premium: 3, business: 4, first: 6 };
const segsOf = (r: TboResult): TboSegment[][] => (Array.isArray(r.Segments[0]) ? (r.Segments as TboSegment[][]) : [r.Segments as TboSegment[]]);
const groupsOf = (res: SearchResponse["Results"]): TboResult[][] => (!res?.length ? [] : Array.isArray(res[0]) ? (res as TboResult[][]) : [res as TboResult[]]);

function legOf(s: TboSegment): FlightLeg {
  const from = s.Origin.Airport.AirportCode ?? "";
  const to = s.Destination.Airport.AirportCode ?? "";
  const code = s.Airline.AirlineCode.toUpperCase();
  const num = String(s.Airline.FlightNumber).replace(/\D/g, "").replace(/^0+(?=\d)/, "").slice(0, 4);
  const dep = s.Origin.DepTime.slice(0, 16);
  const arr = s.Destination.ArrTime.slice(0, 16);
  const dur = s.Duration && s.Duration > 0 ? s.Duration : Math.max(1, Math.round((Date.parse(`${arr}:00Z`) - Date.parse(`${dep}:00Z`)) / 60_000));
  return {
    carrier: code, carrierName: s.Airline.AirlineName || code, flightNumber: `${code}${num}`, from, to,
    departLocal: dep, departTz: AIRPORT_TZ[from] ?? "Asia/Riyadh", arriveLocal: arr, arriveTz: AIRPORT_TZ[to] ?? "Asia/Riyadh", durationMin: dur,
  };
}

/** "SV263@2026-03-10T09:40|SV264@…": the same flights on the same days, whatever the TraceId. */
const fingerprint = (legs: FlightLeg[]) => legs.map((l) => `${l.flightNumber}@${l.departLocal}`).join("|");

/** "30 KG" → 1 × 30 kg; "2 PC" → 2 × 23 kg; nothing → cabin bag only. */
export function baggageOf(raw: string | null | undefined): { text: string; kg: number } {
  const s = (raw ?? "").trim().toUpperCase();
  const kg = /(\d+)\s*(KG|KILO)/.exec(s);
  if (kg && Number(kg[1]) > 0) return { text: `1 × ${Number(kg[1])} kg`, kg: Number(kg[1]) };
  const pc = /(\d+)\s*(PC|PIECE)/.exec(s);
  if (pc && Number(pc[1]) > 0) return { text: `${Number(pc[1])} × 23 kg`, kg: 23 };
  return { text: "Cabin bag only", kg: 0 };
}

const markupBps = () => { const n = Number(process.env.TBO_AIR_MARKUP_BPS ?? 0); return Number.isFinite(n) && n >= 0 && n <= 5000 ? n : 0; };
/** A TBO amount in halalas, rounded up to a riyal, with Mada's markup. */
function sell(amount: number, currency: string): number {
  if (!(amount > 0)) return 0;
  const h = costHalalas(amount, currency) * (1 + markupBps() / 10_000);
  return Math.ceil(Math.round(h) / 100) * 100;
}

/** Per person, per passenger type, in halalas: that type's breakdown with its share of the charges on top. */
export function fareOf(results: TboResult[], party: Party): { adult: number; child: number; infant: number; total: number; tax: number } {
  let adult = 0, child = 0, infant = 0, tax = 0;
  for (const r of results) {
    const cur = r.Fare.Currency || r.FareBreakdown?.[0]?.Currency || "SAR";
    const bd = r.FareBreakdown ?? [];
    const sum = bd.reduce((a, b) => a + (b.BaseFare ?? 0) + (b.Tax ?? 0), 0);
    const published = r.Fare.PublishedFare ?? sum;
    const factor = sum > 0 ? Math.max(1, published / sum) : 1;
    const per = (type: number) => {
      const b = bd.find((x) => x.PassengerType === type) ?? (type === 2 ? bd.find((x) => x.PassengerType === 1) : undefined);
      if (!b || !b.PassengerCount) return 0;
      return ((b.BaseFare + b.Tax) / b.PassengerCount) * factor;
    };
    const a = per(1);
    // One passenger of every kind, if the breakdown is missing: the published fare shared by the seats.
    adult += sell(a || published / Math.max(1, party.adults + party.children), cur);
    child += sell(per(2) || a, cur);
    infant += party.infants ? sell(per(3), cur) : 0;
    const ab = bd.find((x) => x.PassengerType === 1);
    tax += ab && ab.PassengerCount ? sell(ab.Tax / ab.PassengerCount, cur) : 0;
  }
  return { adult, child, infant, tax, total: adult * party.adults + child * party.children + infant * party.infants };
}

function offerOf(results: TboResult[], q: Query, traceId: string, now = Date.now()): BookingFlightOffer {
  const ways = results.flatMap((r) => segsOf(r));
  const out = ways[0]!.map(legOf);
  const back = (ways[1] ?? []).map(legOf);
  const first = ways[0]![0]!;
  const bag = baggageOf(first.Baggage);
  const p = fareOf(results, q);
  const refundable = results.every((r) => !!r.IsRefundable);
  const seats = ways.flat().map((s) => s.NoOfSeatAvailable).filter((n): n is number => typeof n === "number" && n > 0);
  const stop = out.length > 1 ? `One stop in ${out[0]!.to}` : null;
  const key: OfferKey = { v: 1, t: traceId, at: now, r: results.map((r) => r.ResultIndex), l: results.map((r) => !!r.IsLCC), s: results.map((r) => r.Source ?? null), q, k: fingerprint([...out, ...back]) };
  return {
    id: encodeOffer(key), supplier: "tbo", label: "best", reason: stop ? `${stop}.` : "Direct.", out, back, cabin: q.cabin,
    pricePerPerson: { amount: p.adult, currency: "SAR" }, childPrice: { amount: p.child, currency: "SAR" }, infantPrice: { amount: p.infant, currency: "SAR" },
    total: { amount: p.total, currency: "SAR" }, baggage: bag.text,
    changeRule: "As the airline's rules", refundRule: refundable ? "Refundable, minus the airline's fee" : "Not refundable",
    seatsLeft: seats.length ? Math.min(...seats) : null, expiresAt: new Date(now + OFFER_TTL_MS).toISOString(),
    meta: { label: "best", stop, refundable },
  };
}

/** The usual three: best for most people (direct, then price, then time), the lowest price, the earliest, plus the fastest. */
function pick(offers: BookingFlightOffer[]): BookingFlightOffer[] {
  if (!offers.length) return [];
  const mins = (o: BookingFlightOffer) => o.out.reduce((a, l) => a + l.durationMin, 0);
  const cheapest = Math.min(...offers.map((o) => o.total.amount));
  const score = (o: BookingFlightOffer) => o.total.amount / Math.max(1, cheapest) + (o.out.length - 1) * 0.25 + mins(o) / 2400;
  const by = (f: (o: BookingFlightOffer) => number) => [...offers].sort((a, b) => f(a) - f(b) || a.total.amount - b.total.amount)[0]!;
  const chosen: BookingFlightOffer[] = [];
  const add = (o: BookingFlightOffer, label: "best" | "lowest" | "earliest" | "fastest", reason: string | null) => {
    if (chosen.some((c) => c.id === o.id)) return;
    chosen.push({ ...o, label: label === "best" ? "best" : label, reason: reason ? `${o.meta?.stop ? `${o.meta.stop}. ` : "Direct. "}${reason}` : o.reason, meta: { ...o.meta!, label } });
  };
  add(by(score), "best", null);
  add(by((o) => o.total.amount), "lowest", "The lowest price.");
  add(by((o) => Date.parse(`${o.out[0]!.departLocal}:00Z`)), "earliest", "The first one out.");
  add(by(mins), "fastest", "The shortest journey.");
  return chosen;
}

/** Domestic return: the outbound and inbound results come apart; each outbound goes with the cheapest way back on the same airline. */
function combine(groups: TboResult[][]): TboResult[][] {
  if (groups.length < 2) return (groups[0] ?? []).map((r) => [r]);
  const [obs, ibs] = [groups[0]!, groups[1]!];
  const price = (r: TboResult) => r.Fare.PublishedFare ?? 0;
  return obs.flatMap((ob) => {
    const airline = segsOf(ob)[0]?.[0]?.Airline.AirlineCode;
    const same = ibs.filter((ib) => segsOf(ib)[0]?.[0]?.Airline.AirlineCode === airline);
    const back = [...(same.length ? same : ibs)].sort((a, b) => price(a) - price(b))[0];
    return back ? [[ob, back]] : [];
  });
}

async function searchRaw(q: Query): Promise<{ traceId: string; combos: TboResult[][] }> {
  const at = (d: string) => `${d}T00:00:00`;
  const seg = (o: string, d: string, day: string) => ({ Origin: o, Destination: d, FlightCabinClass: CABIN[q.cabin], PreferredDepartureTime: at(day), PreferredArrivalTime: at(day) });
  const r = await air<SearchResponse>("Search", {
    AdultCount: q.adults, ChildCount: q.children, InfantCount: q.infants, DirectFlight: false, OneStopFlight: false, JourneyType: q.ret ? 2 : 1, PreferredAirlines: null,
    Segments: [seg(q.from, q.to, q.depart), ...(q.ret ? [seg(q.to, q.from, q.ret)] : [])], Sources: null,
  }, { timeout: TBO_TIMEOUTS.search });
  if (failed(r)) {
    // "No result found" is an answer (no flights), not an outage.
    if (/no (result|flight)/i.test(r.Error?.ErrorMessage ?? "")) return { traceId: r.TraceId ?? "", combos: [] };
    throw new Error(`TBO Search refused: ${safe(r.Error?.ErrorCode)} ${safe(r.Error?.ErrorMessage)}`);
  }
  return { traceId: r.TraceId ?? "", combos: combine(groupsOf(r.Results)) };
}

async function search(q: Query): Promise<BookingFlightOffer[]> {
  const { traceId, combos } = await searchRaw(q);
  const offers: BookingFlightOffer[] = [];
  for (const c of combos) {
    try { offers.push(offerOf(c, q, traceId)); } catch (e) {
      // One result we can't read (an unknown currency, a missing segment) never hides the others.
      if (!(e instanceof UnknownCurrency)) console.warn("[tbo-air] skipped a result", e instanceof Error ? e.message : "");
      else throw e;
    }
  }
  return pick(offers);
}

/** The same flights, found again with a fresh TraceId (and, if asked, for a different party). */
async function findAgain(k: OfferKey, party: Party): Promise<{ traceId: string; results: TboResult[] } | null> {
  const q = { ...k.q, ...party };
  const { traceId, combos } = await searchRaw(q);
  for (const c of combos) {
    const ways = c.flatMap((r) => segsOf(r));
    if (fingerprint(ways.flat().map(legOf)) === k.k) return { traceId, results: c };
  }
  return null;
}

const asOne = (r: QuoteResponse["Results"]): TboResult | null => (Array.isArray(r) ? r[0] ?? null : r ?? null);

type Quoted = { k: OfferKey; traceId: string; results: TboResult[]; changed: boolean; offer: BookingFlightOffer };

/** FareQuote every part (a fresh search first when the TraceId has gone or the party changed). Null: those flights are gone. */
async function quote(offerId: string, party?: Party): Promise<Quoted | null> {
  const k = decodeOffer(offerId);
  if (!k) throw new AppError("NOT_FOUND");
  const want = party ?? { adults: k.q.adults, children: k.q.children, infants: k.q.infants };
  let traceId = k.t;
  let indexes = k.r;
  const same = want.adults === k.q.adults && want.children === k.q.children && want.infants === k.q.infants;
  if (!same || Date.now() - k.at > TRACE_MS) {
    const again = await findAgain(k, want);
    if (!again) return null;
    traceId = again.traceId;
    indexes = again.results.map((r) => r.ResultIndex);
  }
  const answers = await Promise.all(indexes.map((ResultIndex) => air<QuoteResponse>("FareQuote", { TraceId: traceId, ResultIndex }, { timeout: TBO_TIMEOUTS.quote })));
  const results: TboResult[] = [];
  let changed = false;
  for (const a of answers) {
    const res = asOne(a.Results);
    if (failed(a) || !res) {
      if (isSoldOut(a) || !res) return null;
      throw new Error(`TBO FareQuote refused: ${safe(a.Error?.ErrorCode)} ${safe(a.Error?.ErrorMessage)}`);
    }
    changed ||= !!a.IsPriceChanged;
    results.push(res);
  }
  const q = { ...k.q, ...want };
  const offer = offerOf(results, q, traceId);
  return { k: decodeOffer(offer.id)!, traceId, results, changed, offer };
}

/* ───────────── fare rules ───────────── */

/** "SAR 200", "200.00", 200 → an amount and its currency (the fare's when it doesn't say). */
function amountOf(v: unknown, cur: string): { amount: number; currency: string } | null {
  if (typeof v === "number") return v >= 0 ? { amount: v, currency: cur } : null;
  const m = /([A-Z]{3})?\s*([0-9][0-9,]*(?:\.[0-9]+)?)/.exec(String(v ?? "").toUpperCase());
  return m ? { amount: Number(m[2]!.replace(/,/g, "")), currency: m[1] ?? cur } : null;
}

/** The first amount near any of these words in the airline's rule text. */
function feeNear(text: string, words: RegExp, cur: string): { amount: number; currency: string } | null {
  for (const line of text.split(/\n|\r|<br\s*\/?>|\.\s/i)) {
    if (!words.test(line)) continue;
    const m = /(?:([A-Z]{3})\s*([0-9][0-9,]*(?:\.[0-9]+)?))|(?:([0-9][0-9,]*(?:\.[0-9]+)?)\s*([A-Z]{3}))/.exec(line.toUpperCase());
    if (m) return { amount: Number((m[2] ?? m[3])!.replace(/,/g, "")), currency: (m[1] ?? m[4] ?? cur) };
  }
  return null;
}

/** TBO's fare (Penalty block, baggage, IsRefundable) and rule text → our fare-rules sheet, per person in halalas. */
export function rulesOf(results: TboResult[], text: string | null, carrier: string, party: Party): FlightFareRules {
  const r = results[0]!;
  const cur = r.Fare.Currency || "SAR";
  const plain = (text ?? "").replace(/<[^>]+>/g, "\n").replace(/&nbsp;/g, " ");
  const upper = plain.toUpperCase();
  const base = fareRulesFor(carrier);
  const bag = baggageOf(segsOf(r)[0]?.[0]?.Baggage);
  const noRefund = !r.IsRefundable || /NON[- ]?REFUNDABLE|NOT REFUNDABLE|NO REFUND/.test(upper);
  const noChange = /CHANGES? (ARE )?NOT PERMITTED|NO CHANGES?|CHANGES? NOT ALLOWED|NON[- ]?CHANGEABLE/.test(upper);
  const change = amountOf(r.Penalty?.ReissueCharge, cur) ?? feeNear(plain, /CHANG|REISSUE|REBOOK|DATE CHANGE/i, cur);
  const cancel = amountOf(r.Penalty?.CancellationCharge, cur) ?? feeNear(plain, /CANCEL|REFUND/i, cur);
  const h = (a: { amount: number; currency: string } | null) => (a ? sell(a.amount, a.currency) : null);
  const changeFee = noChange ? 0 : h(change) ?? base.changeFee;
  const refundFee = noRefund ? null : h(cancel) ?? base.refundFee;
  const sar = (n: number) => `SAR ${Math.round(n / 100).toLocaleString("en-US")}`;
  const p = fareOf(results, party);
  return {
    carrier, changeFee, refundable: !noRefund, refundFee, bagFee: base.bagFee, bagKg: bag.kg, bags: bag.text, taxPerPerson: p.tax || base.taxPerPerson,
    changeAllowed: !noChange,
    changeRule: noChange ? "Changes not allowed" : changeFee === 0 ? "Free" : `${sar(changeFee)} per person`,
    refundRule: noRefund ? "Not refundable" : refundFee ? `Refund minus ${sar(refundFee)} per person` : "Refundable",
    text: plain.trim() ? plain.trim().slice(0, 4000) : null,
  };
}

async function fareRuleText(traceId: string, indexes: string[]): Promise<string | null> {
  const answers = await Promise.all(indexes.map((ResultIndex) => air<RuleResponse>("FareRule", { TraceId: traceId, ResultIndex }, { timeout: TBO_TIMEOUTS.quote }).catch(() => null)));
  const text = answers.flatMap((a) => (a && !failed(a) ? a.FareRules ?? [] : [])).map((f) => [f.FareRuleDetail, f.FareRestriction].filter(Boolean).join("\n")).join("\n\n");
  return text.trim() || null;
}

/* ───────────── passengers ───────────── */

const PAX: Record<FlightPassenger["type"], number> = { adult: 1, child: 2, infant: 3 };
const day = (d: string | null) => (d ? `${d.slice(0, 10)}T00:00:00` : null);
const titleOf = (p: FlightPassenger) => (p.type === "adult" ? (p.sex === "F" ? "Ms" : "Mr") : p.sex === "F" ? "Miss" : "Mstr");
/** TBO wants latin letters and spaces only in names. */
const latin = (s: string) => s.normalize("NFKD").replace(/[^A-Za-z ]/g, "").replace(/\s+/g, " ").trim();

/** What's missing for this passenger before the airline can take them (international: the passport too). */
export function missingDetails(p: FlightPassenger, international: boolean): string[] {
  const out: string[] = [];
  if (!latin(p.givenNames) || !latin(p.surname)) out.push("name");
  if (p.sex !== "M" && p.sex !== "F") out.push("sex");
  if (!p.dateOfBirth) out.push("date of birth");
  if (international && (!p.passportNumber || !p.passportExpiry)) out.push("passport");
  if (international && !p.nationality) out.push("nationality");
  return out;
}

function fareFor(r: TboResult, type: number, pax: number) {
  const b = r.FareBreakdown?.find((x) => x.PassengerType === type);
  const n = Math.max(1, b?.PassengerCount ?? 1);
  return {
    Currency: r.Fare.Currency ?? b?.Currency, BaseFare: (b?.BaseFare ?? 0) / n, Tax: (b?.Tax ?? 0) / n, YQTax: (b?.YQTax ?? 0) / n,
    AdditionalTxnFeePub: (b?.AdditionalTxnFeePub ?? 0) / n, AdditionalTxnFeeOfrd: (b?.AdditionalTxnFeeOfrd ?? 0) / n, OtherCharges: (r.Fare.OtherCharges ?? 0) / Math.max(1, pax),
  };
}

function passengersFor(r: TboResult, people: FlightPassenger[], lead: FlightPassenger) {
  return people.map((p) => {
    const lcc = !!r.IsLCC;
    const meal = p.meal ? { Code: p.meal, Description: p.meal } : null;
    return {
      Title: titleOf(p), FirstName: latin(p.givenNames), LastName: latin(p.surname), PaxType: PAX[p.type], DateOfBirth: day(p.dateOfBirth), Gender: p.sex === "F" ? 2 : 1,
      PassportNo: p.passportNumber ?? "", PassportExpiry: day(p.passportExpiry) ?? "",
      AddressLine1: process.env.TBO_ADDRESS_LINE || "Mada Trips", AddressLine2: "", City: process.env.TBO_ADDRESS_CITY || "Riyadh", CountryCode: "SA", CountryName: "Saudi Arabia",
      Nationality: p.nationality ?? "SA", ContactNo: (lead.phone ?? "").replace(/[^\d+]/g, ""), Email: lead.email || process.env.TBO_CONTACT_EMAIL || "",
      IsLeadPax: p === lead, FFAirlineCode: null, FFNumber: "", Fare: fareFor(r, PAX[p.type], people.length),
      ...(lcc
        // Low-cost airlines sell bags, meals and seats: nothing paid is added that the traveller didn't buy (the arrays mustn't be null).
        ? { Baggage: [], MealDynamic: [], SeatDynamic: [] }
        : { ...(meal ? { Meal: meal } : {}), ...(p.seat && p.type !== "infant" ? { Seat: { Code: p.seat === "window" ? "W" : "A", Description: p.seat === "window" ? "Window" : "Aisle" } } : {}) }),
    };
  });
}

/** The SSRs that won't reach the airline through TBO: the desk adds them by hand. */
function ssrForDesk(lcc: boolean, people: FlightPassenger[], extra: string[]): string[] {
  const out = new Set(extra.filter((c) => c !== "CHML" || lcc));
  if (lcc) for (const p of people) if (p.meal) out.add(p.meal);
  return [...out];
}

/* ───────────── book, ticket, look up, cancel ───────────── */

/** A call already running for the same key on this server: the second caller gets the first one's answer. */
const inflight = new Map<string, Promise<FlightOutcome>>();
function once(key: string, fn: () => Promise<FlightOutcome>): Promise<FlightOutcome> {
  const running = inflight.get(key);
  if (running) return running;
  const p = fn().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

const leadOf = (people: FlightPassenger[]) => people.find((p) => p.lead && p.type === "adult") ?? people.find((p) => p.type === "adult") ?? people[0]!;
const partyOf = (people: FlightPassenger[]): Party => ({
  adults: people.filter((p) => p.type === "adult").length, children: people.filter((p) => p.type === "child").length, infants: people.filter((p) => p.type === "infant").length,
});
const international = (k: OfferKey) => !(AIRPORT_TZ[k.q.from] === "Asia/Riyadh" && AIRPORT_TZ[k.q.to] === "Asia/Riyadh");
const transport = (e: unknown) => !(e instanceof AppError);

/** A ticket number as the airline prints it: 13 digits (the airline's 3 in front when TBO sends 10). */
function ticketNo(t: TboTicket | null | undefined, validating: string | null): string | null {
  const n = (t?.TicketNumber ?? "").replace(/\D/g, "");
  if (!n) return null;
  if (n.length === 10 && validating && /^\d{3}$/.test(validating)) return `${validating}${n}`;
  return n;
}

function ticketsOf(it: TboItinerary | undefined, people: FlightPassenger[]): { numbers: string[]; ids: number[] } | null {
  const pax = it?.Passenger ?? [];
  if (!pax.length || pax.some((p) => !p.Ticket?.TicketNumber)) return null;
  // In our passengers' order: matched by name, else by position.
  const order = people.length ? people.map((p, i) => pax.find((x) => latin(x.FirstName ?? "").toUpperCase() === latin(p.givenNames).toUpperCase() && latin(x.LastName ?? "").toUpperCase() === latin(p.surname).toUpperCase()) ?? pax[i]!) : pax;
  return { numbers: order.map((x) => ticketNo(x.Ticket, x.Ticket?.ValidatingAirline ?? null) ?? ""), ids: order.map((x) => x.Ticket?.TicketId ?? 0) };
}

const refOf = (k: OfferKey, traceId: string, results: TboResult[], extra: string[], people: FlightPassenger[]): FlightBookingRef => ({
  supplier: "tbo", offerId: encodeOffer(k), traceId,
  parts: results.map((r) => ({ resultIndex: r.ResultIndex, lcc: !!r.IsLCC, source: r.Source ?? null, bookSent: false, bookingId: null, pnr: null, lastTicketDate: r.LastTicketDate ?? null, ticketSent: false, tickets: [], ticketIds: [] })),
  ssrForDesk: ssrForDesk(results.some((r) => !!r.IsLCC), people, extra),
});

async function details(ref: FlightBookingRef, part: FlightBookingPart, lead?: { givenNames: string; surname: string }): Promise<DetailsResponse | null> {
  let body: Record<string, unknown>;
  if (part.bookingId || part.pnr) body = { BookingId: part.bookingId ?? 0, PNR: part.pnr ?? "", TraceId: ref.traceId };
  else if (lead) body = { BookingId: 0, PNR: "", TraceId: ref.traceId, FirstName: latin(lead.givenNames), LastName: latin(lead.surname) };
  else return null;
  const r = await air<DetailsResponse>("GetBookingDetails", body, { booking: true, timeout: TBO_TIMEOUTS.details });
  return failed(r) || !r.FlightItinerary ? null : r;
}

async function book(offerId: string, people: FlightPassenger[], opts: WriteOpts & { known?: FlightBookingRef | null; ssr?: string[] }): Promise<FlightOutcome> {
  const e = env();
  assertMayBook(e);
  return once(`book:${opts.key}`, async () => {
    const k = decodeOffer(offerId);
    if (!k) throw new AppError("NOT_FOUND");
    const lead = leadOf(people);
    const intl = international(k);
    const missing = people.flatMap((p) => missingDetails(p, intl).map((m) => `${m} (${p.type})`));
    if (missing.length) return { outcome: "failed", ref: opts.known ?? null, reason: `Missing for the airline: ${[...new Set(missing)].join(", ")}` };

    // Already held (a retry, another server): nothing more to send.
    const known = opts.known;
    if (known?.parts.length && known.parts.every((p) => p.lcc || p.bookingId)) return { outcome: known.parts.every((p) => p.lcc) ? "ticket_now" : "held", ref: known };
    if (known?.parts.some((p) => p.bookSent && !p.bookingId)) {
      // A hold was sent and its answer lost: look it up; never book again on a guess.
      for (const part of known.parts.filter((p) => p.bookSent && !p.bookingId)) {
        const d = await details(known, part, lead).catch(() => null);
        if (!d?.FlightItinerary?.BookingId) return { outcome: "pending", ref: known, why: "A hold was sent and TBO hasn't confirmed it yet. Check with TBO before booking again." };
        part.bookingId = d.FlightItinerary.BookingId; part.pnr = d.FlightItinerary.PNR ?? part.pnr; part.lastTicketDate = d.FlightItinerary.LastTicketDate ?? part.lastTicketDate;
      }
      await opts.persist?.(known);
      return { outcome: "held", ref: known };
    }

    // The fare now, for these passengers.
    let q: Quoted | null;
    try { q = await quote(offerId, partyOf(people)); } catch (err) {
      if (transport(err)) return { outcome: "failed", ref: null, reason: "TBO didn't answer the price check" };
      throw err;
    }
    if (!q) return { outcome: "sold_out", ref: null };
    if (q.offer.total.amount > opts.paidTotal) return { outcome: "price_changed", ref: null, total: q.offer.total.amount, offer: q.offer };
    const ref = refOf(q.k, q.traceId, q.results, opts.ssr ?? [], people);
    if (ref.parts.every((p) => p.lcc)) { await opts.persist?.(ref); return { outcome: "ticket_now", ref }; }

    for (const [i, part] of ref.parts.entries()) {
      if (part.lcc) continue;
      part.bookSent = true;
      await opts.persist?.(ref);
      let r: BookResponse;
      try {
        r = await air<BookResponse>("Book", { TraceId: ref.traceId, ResultIndex: part.resultIndex, Passengers: passengersFor(q.results[i]!, people, lead) }, { booking: true, timeout: TBO_TIMEOUTS.book });
      } catch (err) {
        if (transport(err)) return { outcome: "pending", ref, why: "TBO didn't answer the hold in time. Check with TBO before booking again." };
        throw err;
      }
      const b = r.Response;
      if (b?.IsPriceChanged) return { outcome: "price_changed", ref: null, total: totalOf(b.FlightItinerary?.Fare, q, people) ?? q.offer.total.amount, offer: q.offer };
      if (b?.IsTimeChanged) return { outcome: "schedule_changed", ref: null, offer: q.offer };
      if (failed(r) || !b?.BookingId) {
        if (isSoldOut(r)) return { outcome: "sold_out", ref: null };
        part.bookSent = false;
        await opts.persist?.(ref);
        return { outcome: "failed", ref: null, reason: `TBO didn't hold it: ${safe(r.Error?.ErrorCode)} ${safe(r.Error?.ErrorMessage, 140)}`.trim() };
      }
      part.bookingId = b.BookingId; part.pnr = b.PNR ?? null; part.lastTicketDate = b.FlightItinerary?.LastTicketDate ?? part.lastTicketDate;
      if (b.SSRDenied) ref.ssrForDesk = [...new Set([...ref.ssrForDesk, ...people.map((p) => p.meal).filter((m): m is string => !!m)])];
      await opts.persist?.(ref);
    }
    return { outcome: ref.parts.some((p) => p.lcc) ? "ticket_now" : "held", ref };
  });
}

/** A new all-in total TBO sent (its own currency), in our halalas for these passengers. */
function totalOf(f: TboFare | undefined, q: Quoted, people: FlightPassenger[]): number | null {
  if (!f?.PublishedFare || !q.offer.total.amount) return null;
  const was = q.results.reduce((a, r) => a + (r.Fare.PublishedFare ?? 0), 0);
  if (!was) return null;
  return Math.ceil((q.offer.total.amount * (f.PublishedFare / was)) / 100 / Math.max(1, people.length)) * 100 * Math.max(1, people.length);
}

async function ticket(ref: FlightBookingRef, people: FlightPassenger[], opts: WriteOpts): Promise<FlightOutcome> {
  const e = env();
  assertMayBook(e);
  return once(`ticket:${opts.key}`, async () => {
    const lead = leadOf(people);
    for (const [i, part] of ref.parts.entries()) {
      if (part.tickets.length) continue;
      if (part.ticketSent && !part.priceChangeAccepted) {
        // Sent before: ask, never send again.
        const d = await details(ref, part, lead).catch(() => null);
        const t = ticketsOf(d?.FlightItinerary, people);
        if (t) { part.tickets = t.numbers; part.ticketIds = t.ids; part.pnr = d?.FlightItinerary?.PNR ?? part.pnr; part.bookingId = d?.FlightItinerary?.BookingId ?? part.bookingId; await opts.persist?.(ref); continue; }
        const st = d?.FlightItinerary?.Status;
        if (st === 2) return { outcome: "failed", ref, reason: "TBO says the ticket wasn't issued" };
        if (st === 9) return { outcome: "failed", ref, reason: "TBO says the booking was cancelled" };
        return { outcome: "pending", ref, why: "Tickets were asked for and aren't issued yet. TBO settles these within 15 minutes; check again." };
      }

      let body: Record<string, unknown>;
      if (part.lcc) {
        // Low-cost airlines ticket from the search itself: the fare again just before (a fresh TraceId if ours has gone).
        let q: Quoted | null;
        try { q = await quote(ref.offerId, partyOf(people)); } catch (err) {
          if (transport(err)) return { outcome: "failed", ref, reason: "TBO didn't answer the price check before ticketing" };
          throw err;
        }
        if (!q) return { outcome: "sold_out", ref };
        if (q.offer.total.amount > opts.paidTotal) return { outcome: "price_changed", ref, total: q.offer.total.amount, offer: q.offer };
        ref.traceId = q.traceId;
        ref.offerId = q.offer.id;
        q.results.forEach((r, j) => { if (ref.parts[j]) ref.parts[j]!.resultIndex = r.ResultIndex; });
        body = { TraceId: ref.traceId, ResultIndex: part.resultIndex, Passengers: passengersFor(q.results[i]!, people, lead) };
      } else {
        if (!part.bookingId || !part.pnr) return { outcome: "failed", ref, reason: "Nothing is held at TBO for this booking yet" };
        body = { TraceId: ref.traceId, PNR: part.pnr, BookingId: part.bookingId, ...(part.priceChangeAccepted ? { IsPriceChangeAccepted: true } : {}) };
      }

      part.ticketSent = true;
      part.priceChangeAccepted = false;
      await opts.persist?.(ref);
      let r: BookResponse;
      try { r = await air<BookResponse>("Ticket", body, { booking: true, timeout: TBO_TIMEOUTS.ticket }); } catch (err) {
        if (transport(err)) return { outcome: "pending", ref, why: "TBO didn't answer the ticket request in time. It may still issue: check again in a few minutes." };
        throw err;
      }
      const b = r.Response;
      if (b?.PNR) part.pnr = b.PNR;
      if (b?.BookingId) part.bookingId = b.BookingId;
      const status = b?.TicketStatus;
      if (b?.IsPriceChanged || status === 8) {
        // Nothing was issued: the traveller sees the new fare first. A full-service ticket goes again with the change accepted.
        part.ticketSent = false;
        await opts.persist?.(ref);
        const was = decodeOffer(ref.offerId);
        const published = b?.FlightItinerary?.Fare?.PublishedFare;
        const total = published && was ? Math.max(opts.paidTotal, sell(published, b?.FlightItinerary?.Fare?.Currency ?? "SAR")) : opts.paidTotal;
        return { outcome: "price_changed", ref, total, offer: null };
      }
      if (b?.IsTimeChanged) return { outcome: "schedule_changed", ref, offer: null };
      const t = ticketsOf(b?.FlightItinerary, people);
      if (t && (status === 1 || status === 6 || status === undefined)) { part.tickets = t.numbers; part.ticketIds = t.ids; await opts.persist?.(ref); continue; }
      if (status === 1 || status === 6 || status === 5 || status === 0 || status === 2 || status === 3) {
        // Issued without numbers, in progress, or "failed / not saved / not created": TBO says to look it up first.
        const d = await details(ref, part, lead).catch(() => null);
        const found = ticketsOf(d?.FlightItinerary, people);
        if (found) { part.tickets = found.numbers; part.ticketIds = found.ids; await opts.persist?.(ref); continue; }
        if (status === 0 || status === 2 || status === 3) {
          if (d?.FlightItinerary?.Status === 7 || d?.FlightItinerary?.Status === 8) return { outcome: "pending", ref, why: "TBO is still working on the tickets. Check again in a few minutes." };
          return { outcome: "failed", ref, reason: `Tickets didn't issue at TBO (status ${status}${r.Error?.ErrorMessage ? `: ${safe(r.Error.ErrorMessage, 120)}` : ""})` };
        }
        return { outcome: "pending", ref, why: "TBO is still working on the tickets. Check again in a few minutes." };
      }
      if (isSoldOut(r)) return { outcome: "sold_out", ref };
      return { outcome: "failed", ref, reason: `Tickets didn't issue at TBO (${status ?? safe(r.Error?.ErrorCode)}${r.Error?.ErrorMessage ? `: ${safe(r.Error.ErrorMessage, 120)}` : ""})` };
    }
    const tickets = ref.parts.flatMap((p) => p.tickets);
    return { outcome: "ticketed", ref, tickets };
  });
}

async function bookingDetails(ref: FlightBookingRef, lead?: { givenNames: string; surname: string }): Promise<FlightBookingDetails> {
  let status: FlightBookingDetails["status"] = "ticketed";
  for (const part of ref.parts) {
    const d = await details(ref, part, lead);
    const it = d?.FlightItinerary;
    if (!it) { if (!part.tickets.length) status = "unknown"; continue; }
    part.bookingId = it.BookingId ?? part.bookingId; part.pnr = it.PNR ?? part.pnr; part.lastTicketDate = it.LastTicketDate ?? part.lastTicketDate;
    const t = ticketsOf(it, []);
    if (t) { part.tickets = t.numbers; part.ticketIds = t.ids; continue; }
    status = it.Status === 9 ? "cancelled" : it.Status === 2 ? "failed" : it.Status === 7 || it.Status === 8 ? "pending" : status === "ticketed" ? "held" : status;
  }
  return { ref, status, tickets: ref.parts.flatMap((p) => p.tickets) };
}

async function cancel(ref: FlightBookingRef, remarks: string): Promise<FlightCancelResult> {
  assertMayBook(env());
  const ids: number[] = [];
  let released = false;
  for (const part of ref.parts) {
    if (!part.bookingId) continue;
    if (!part.tickets.length) {
      const r = await air<{ ResponseStatus?: number; Error?: TboError }>("ReleasePNRRequest", { BookingId: part.bookingId, Source: part.source ?? 0 }, { booking: true, timeout: TBO_TIMEOUTS.details });
      if (failed(r)) throw new Error(`TBO didn't release the hold: ${safe(r.Error?.ErrorCode)} ${safe(r.Error?.ErrorMessage)}`);
      released = true;
      continue;
    }
    const r = await air<ChangeResponse>("SendChangeRequest", { BookingId: part.bookingId, RequestType: 1, CancellationType: 3, Sectors: null, TicketId: part.ticketIds.filter(Boolean), Remarks: remarks.slice(0, 200) }, { booking: true, timeout: TBO_TIMEOUTS.details });
    if (failed(r)) throw new Error(`TBO refused the refund request: ${safe(r.Error?.ErrorCode)} ${safe(r.Error?.ErrorMessage)}`);
    ids.push(...(r.TicketCRInfo ?? []).map((c) => c.ChangeRequestId ?? 0).filter(Boolean));
  }
  return { released, changeRequestIds: ids, note: ids.length ? "Refund asked of TBO; the airline's rules decide the amount." : released ? "Hold released at TBO." : "Nothing held at TBO." };
}

export const tboAir: TicketingFlightSupplier = {
  name: "tbo",

  async search(input) {
    const q: Query = {
      from: input.from, to: input.to, depart: input.depart, ret: input.return ?? null, cabin: input.cabin ?? "economy",
      adults: input.adults, children: input.children ?? 0, infants: input.infants ?? 0,
    };
    return search(q);
  },

  /** The fare now (FareQuote), with the airline's rules read into the card's words. Gone: NOT_FOUND (sold out). */
  async price(offerId, travellers, children) {
    const k = decodeOffer(offerId);
    if (!k) throw new AppError("NOT_FOUND");
    const kids = Math.min(children ?? k.q.children, travellers);
    const q = await quote(offerId, { adults: Math.max(1, travellers - kids), children: kids, infants: k.q.infants });
    if (!q) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const text = await fareRuleText(q.traceId, q.results.map((r) => r.ResultIndex)).catch(() => null);
    const rules = rulesOf(q.results, text, q.offer.out[0]!.carrier, { adults: Math.max(1, travellers - kids), children: kids, infants: k.q.infants });
    return { ...q.offer, baggage: rules.bags, changeRule: rules.changeRule, refundRule: rules.refundRule, meta: { label: "best", stop: q.offer.meta?.stop ?? null, refundable: rules.refundable } };
  },

  /** The old interface's hold carries names only; TBO needs every passport detail, so the desk books through book(). */
  async hold() {
    throw new AppError("VALIDATION", { message: "TBO holds go through book() with full passenger details" });
  },

  async fareRules(offerId) {
    const k = decodeOffer(offerId);
    if (!k) throw new AppError("NOT_FOUND");
    const q = await quote(offerId);
    if (!q) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const text = await fareRuleText(q.traceId, q.results.map((r) => r.ResultIndex));
    return rulesOf(q.results, text, q.offer.out[0]!.carrier, k.q);
  },

  book, ticket, bookingDetails, cancel,
};
