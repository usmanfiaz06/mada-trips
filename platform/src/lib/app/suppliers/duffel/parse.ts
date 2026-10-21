import type { Cabin, FlightLeg } from "@mada/shared";
import type { BookingFlightOffer } from "../booking-types";
import { markedUp } from "../sell";

/*
 * Duffel's offers as ours. Duffel prices the whole party (total_amount); we split it so our per-person lines add up
 * to the same total: adults and children pay the same seat price, a baby on a lap 10% of it. Mada's margin is
 * APP_DUFFEL_MARKUP_BPS (default 300 = 3%) on top of Duffel's total (which includes taxes).
 */

export const DUFFEL_MARKUP_ENV = "APP_DUFFEL_MARKUP_BPS";

type Place = { iata_code?: string; time_zone?: string; city_name?: string };
type Seg = {
  marketing_carrier?: { iata_code?: string; name?: string }; marketing_carrier_flight_number?: string; operating_carrier?: { iata_code?: string; name?: string };
  origin?: Place; destination?: Place; departing_at?: string; arriving_at?: string; duration?: string | null;
  passengers?: { baggages?: { type?: string; quantity?: number }[]; cabin_class?: string }[];
};
type Slice = { segments?: Seg[] };
type Cond = { allowed?: boolean; penalty_amount?: string | null; penalty_currency?: string | null } | null;
export type DuffelOffer = {
  id?: string; total_amount?: string; total_currency?: string; expires_at?: string; owner?: { iata_code?: string; name?: string };
  slices?: Slice[]; passengers?: { id?: string; type?: string; age?: number | null }[];
  conditions?: { refund_before_departure?: Cond; change_before_departure?: Cond };
};

export type Party = { adults: number; children: number; infants: number };

/** "PT4H15M" → 255. */
export function isoMinutes(d: string | null | undefined): number | null {
  const m = /^P(?:(\d+)D)?T?(?:(\d+)H)?(?:(\d+)M)?$/.exec(d ?? "");
  if (!m) return null;
  return (Number(m[1] ?? 0) * 24 + Number(m[2] ?? 0)) * 60 + Number(m[3] ?? 0);
}
const local = (s: string | undefined) => (s && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/.test(s) ? s.slice(0, 16) : null);

function legOf(s: Seg): FlightLeg | null {
  const c = s.marketing_carrier?.iata_code;
  const n = s.marketing_carrier_flight_number;
  const from = s.origin?.iata_code, to = s.destination?.iata_code;
  const dep = local(s.departing_at), arr = local(s.arriving_at);
  if (!c || !n || !from || !to || !dep || !arr || !/^([A-Z][A-Z0-9]|[0-9][A-Z])$/.test(c) || !/^\d{1,4}$/.test(n)) return null;
  const dur = isoMinutes(s.duration) ?? Math.max(1, Math.round((Date.parse(`${arr}Z`) - Date.parse(`${dep}Z`)) / 60_000));
  return {
    carrier: c, carrierName: s.marketing_carrier?.name ?? c, flightNumber: `${c}${n}`, from, to, departLocal: dep, departTz: s.origin?.time_zone ?? "UTC",
    arriveLocal: arr, arriveTz: s.destination?.time_zone ?? "UTC", durationMin: Math.max(1, dur),
  };
}

const money = (amount: string | null | undefined, cur: string | null | undefined) => (amount != null && cur ? `${cur} ${Number(amount).toFixed(0)}` : null);

function rule(c: Cond, what: "change" | "refund"): string {
  if (!c) return what === "change" ? "Ask Mada" : "Ask Mada";
  if (c.allowed === false) return what === "change" ? "No changes" : "Not refundable";
  const fee = money(c.penalty_amount, c.penalty_currency);
  if (!fee || Number(c.penalty_amount) === 0) return what === "change" ? "Free" : "Full refund";
  return what === "change" ? `${fee} per change` : `Refund minus ${fee}`;
}

function bags(o: DuffelOffer): string {
  const b = o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.baggages ?? [];
  const checked = b.filter((x) => x.type === "checked").reduce((s, x) => s + (x.quantity ?? 0), 0);
  return checked ? `${checked} checked bag${checked > 1 ? "s" : ""}` : "Cabin bag only";
}

const CABINS: Record<string, Cabin> = { economy: "economy", premium_economy: "premium", business: "business", first: "first" };

/** One Duffel offer → ours (id "duffel.<offer id>"), or null when it can't be read. */
export function offerOf(o: DuffelOffer, party: Party): BookingFlightOffer | null {
  const total = Number(o.total_amount);
  if (!o.id || !Number.isFinite(total) || total <= 0 || !o.total_currency) return null;
  const legs = (o.slices ?? []).map((s) => (s.segments ?? []).map(legOf));
  if (!legs.length || legs.some((l) => !l.length || l.some((x) => !x))) return null;
  const [out, back] = [legs[0] as FlightLeg[], (legs[1] ?? []) as FlightLeg[]];
  let sell: number;
  try { sell = markedUp(total, o.total_currency, DUFFEL_MARKUP_ENV, 300); } catch { return null; }
  const shares = party.adults + party.children + party.infants * 0.1;
  const seat = Math.ceil(sell / shares);
  const infant = Math.ceil(seat / 10);
  const stop = out.length > 1 ? `One stop in ${out[0]!.to}` : null;
  const cabin = CABINS[o.slices?.[0]?.segments?.[0]?.passengers?.[0]?.cabin_class ?? "economy"] ?? "economy";
  const refundRule = rule(o.conditions?.refund_before_departure ?? null, "refund");
  return {
    id: `duffel.${o.id}`, supplier: "duffel", label: "best", reason: stop ? `${stop}.` : "Direct.", out, back, cabin,
    pricePerPerson: { amount: seat, currency: "SAR" }, childPrice: { amount: seat, currency: "SAR" }, infantPrice: { amount: infant, currency: "SAR" },
    total: { amount: seat * (party.adults + party.children) + infant * party.infants, currency: "SAR" },
    baggage: bags(o), changeRule: rule(o.conditions?.change_before_departure ?? null, "change"), refundRule, seatsLeft: null,
    expiresAt: o.expires_at && !Number.isNaN(Date.parse(o.expires_at)) ? new Date(o.expires_at).toISOString() : new Date(Date.now() + 20 * 60_000).toISOString(),
    meta: { label: "best", stop, refundable: refundRule !== "Not refundable" },
  };
}

export const parseOffers = (offers: DuffelOffer[], party: Party) => offers.map((o) => offerOf(o, party)).filter((o): o is BookingFlightOffer => !!o);
