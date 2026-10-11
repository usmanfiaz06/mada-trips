import { DESTINATIONS, HotelSearch as HotelSearchSchema, addDays, roomsFor, shortDay, t, type HotelSearch } from "@mada/shared";
import type { BookingHotelOffer, BookingHotelSupplier } from "../booking-types";
import { HotelbedsClient, HotelbedsError, type HotelbedsClientOptions } from "./client";
import { costHalalas, feeHalalas, pricingRules, sellHalalas, type PricingRules } from "./money";

/*
 * Hotels on Hotelbeds (APItude Booking API 1.0 + Content API 1.0). docs/app/HOTELBEDS.md lists what is confirmed from
 * developer.hotelbeds.com and what is assumed.
 *
 *   availability   POST /hotel-api/1.0/hotels        (stay, occupancies, destination | geolocation | hotels, filter, boards)
 *   checkrates     POST /hotel-api/1.0/checkrates    (rooms[].rateKey; required when rateType is RECHECK)
 *   book           POST /hotel-api/1.0/bookings      (holder, rooms[].rateKey + paxes, clientReference, remark)
 *   detail         GET  /hotel-api/1.0/bookings/{reference}
 *   cancel         DELETE /hotel-api/1.0/bookings/{reference}?cancellationFlag=SIMULATION|CANCELLATION
 *   content        GET  /hotel-content-api/1.0/hotels?codes=…&fields=all&language=ENG  (batch only: never per search)
 *
 * Only AT_WEB rates are sold (we pay Hotelbeds; the traveller pays us). Prices come back in the contract currency and
 * are turned into riyals with our FX and markup (money.ts).
 */

/* ───────────── Hotelbeds shapes (the fields we read) ───────────── */

export type HbCancellationPolicy = { amount: string; from: string };
export type HbTax = { included: boolean; amount?: string; currency?: string; clientAmount?: string; clientCurrency?: string; type?: string };
export type HbRate = {
  rateKey: string; rateClass?: string; rateType: "BOOKABLE" | "RECHECK"; net: string; sellingRate?: string; hotelMandatory?: boolean;
  allotment?: number; paymentType?: string; boardCode?: string; boardName?: string; rooms: number; adults: number; children: number; childrenAges?: string;
  cancellationPolicies?: HbCancellationPolicy[]; taxes?: { taxes?: HbTax[]; allIncluded?: boolean }; rateComments?: string; rateCommentsId?: string;
  packaging?: boolean; promotions?: { code: string; name?: string; remark?: string }[]; offers?: { code: string; name?: string; amount?: string }[];
};
export type HbRoom = { code: string; name: string; rates: HbRate[] };
export type HbHotel = {
  code: number; name: string; categoryCode?: string; categoryName?: string; destinationCode?: string; destinationName?: string; zoneCode?: number; zoneName?: string;
  latitude?: string; longitude?: string; rooms: HbRoom[]; minRate?: string; maxRate?: string; currency: string;
};
export type HbAvailabilityResponse = { auditData?: { token?: string }; hotels?: { hotels?: HbHotel[]; checkIn?: string; checkOut?: string; total?: number } };
export type HbCheckRateResponse = { auditData?: { token?: string }; hotel?: HbHotel & { checkIn: string; checkOut: string; totalNet?: string } };
export type HbPax = { roomId: number; type: "AD" | "CH"; age?: number; name: string; surname: string };
export type HbBooking = {
  reference: string; clientReference?: string; creationDate?: string; status: string; remark?: string; totalNet?: number | string; pendingAmount?: number | string; currency?: string;
  holder?: { name: string; surname: string };
  hotel?: HbHotel & { checkIn: string; checkOut: string; totalNet?: string; cancellationAmount?: number | string; supplier?: { name?: string; vatNumber?: string } };
  cancellationReference?: string;
  modificationPolicies?: { cancellation?: boolean; modification?: boolean };
};
export type HbBookingResponse = { auditData?: { token?: string }; booking: HbBooking };

/** Content API: the static facts we keep in app_hotelbeds_hotels (content.ts). */
export type HbContentHotel = {
  code: number; name?: { content?: string }; description?: { content?: string }; categoryCode?: string; destinationCode?: string; zoneCode?: number;
  coordinates?: { latitude?: number; longitude?: number }; address?: { content?: string }; postalCode?: string; city?: { content?: string };
  phones?: { phoneNumber?: string; phoneType?: string }[]; images?: { path: string; imageTypeCode?: string; order?: number; visualOrder?: number }[];
  facilities?: { facilityCode: number; facilityGroupCode: number; indLogic?: boolean; indYesOrNo?: boolean; number?: number }[]; lastUpdate?: string; web?: string;
};
export type HbContentResponse = { auditData?: unknown; from?: number; to?: number; total?: number; hotels?: HbContentHotel[] };

/** Static facts the offers use when we have them (content.ts reads them from our database). */
export type HotelFacts = { code: number; name: string; address: string | null; imageUrl: string | null; phone: string | null; latitude: number | null; longitude: number | null };
export type FactsLookup = (codes: number[]) => Promise<Map<number, HotelFacts>>;

/* ───────────── where to search ───────────── */

/**
 * Our cities as Hotelbeds searches. Geolocation (city centre + radius) works without knowing their destination codes;
 * a code here is used when HOTELBEDS_USE_DESTINATION_CODES=yes (codes from the Content API's /locations/destinations,
 * to be confirmed on the account before turning on).
 */
export const HB_PLACES: Record<string, { lat: number; lng: number; radiusKm: number; code?: string }> = {
  istanbul: { lat: 41.0256, lng: 28.9744, radiusKm: 8, code: "IST" },
  dubai: { lat: 25.1972, lng: 55.2744, radiusKm: 15, code: "DXB" },
  cairo: { lat: 30.0444, lng: 31.2357, radiusKm: 12, code: "CAI" },
  london: { lat: 51.5072, lng: -0.1276, radiusKm: 8, code: "LON" },
  baku: { lat: 40.3777, lng: 49.892, radiusKm: 8 },
  jeddah: { lat: 21.5433, lng: 39.1728, radiusKm: 15 },
  alula: { lat: 26.6084, lng: 37.9232, radiusKm: 30 },
  abha: { lat: 18.2164, lng: 42.5053, radiusKm: 20 },
  tbilisi: { lat: 41.6938, lng: 44.8015, radiusKm: 8 },
  paris: { lat: 48.8566, lng: 2.3522, radiusKm: 8, code: "PAR" },
  bali: { lat: -8.65, lng: 115.1667, radiusKm: 25 },
  maldives: { lat: 4.1755, lng: 73.5093, radiusKm: 60 },
};

export type StayRoomAsk = { adults: number; childAges: number[] };
export type HotelbedsStayQuery = {
  checkIn: string;
  checkOut: string;
  rooms: StayRoomAsk[];
  destination?: string;
  geolocation?: { latitude: number; longitude: number; radius: number; unit: "km" };
  hotelCodes?: number[];
  boards?: string[];
  /** In the contract currency (Hotelbeds filters before our FX). */
  maxRate?: number;
  minCategory?: number;
  maxCategory?: number;
  maxHotels?: number;
};

/** Hotelbeds occupancies: identical rooms are grouped (rooms: n); children carry their ages as CH paxes. */
export function occupanciesOf(rooms: StayRoomAsk[]) {
  const groups = new Map<string, { rooms: number; adults: number; children: number; paxes?: { type: "CH"; age: number }[] }>();
  for (const r of rooms) {
    const ages = [...r.childAges].sort((a, b) => a - b);
    const k = `${r.adults}|${ages.join(",")}`;
    const g = groups.get(k);
    if (g) g.rooms += 1;
    else groups.set(k, { rooms: 1, adults: r.adults, children: ages.length, ...(ages.length ? { paxes: ages.map((age) => ({ type: "CH" as const, age })) } : {}) });
  }
  return [...groups.values()];
}

/** Split a party across n rooms: adults spread evenly, each child with the room that has fewest people. */
export function splitParty(adults: number, childAges: number[], rooms: number): StayRoomAsk[] {
  const n = Math.max(1, Math.min(rooms, adults));
  const out: StayRoomAsk[] = Array.from({ length: n }, (_, i) => ({ adults: Math.floor(adults / n) + (i < adults % n ? 1 : 0), childAges: [] }));
  for (const age of childAges) out.reduce((a, b) => (b.adults + b.childAges.length < a.adults + a.childAges.length ? b : a)).childAges.push(age);
  return out;
}

export function availabilityBody(q: HotelbedsStayQuery) {
  const body: Record<string, unknown> = {
    stay: { checkIn: q.checkIn, checkOut: q.checkOut },
    occupancies: occupanciesOf(q.rooms),
    filter: {
      paymentType: "AT_WEB",
      // Certification 2.3: as many hotels as possible per call (up to 2000); we choose what to show afterwards.
      maxHotels: q.maxHotels ?? 2000,
      maxRatesPerRoom: 3,
      ...(q.maxRate ? { maxRate: q.maxRate } : {}),
      ...(q.minCategory ? { minCategory: q.minCategory } : {}),
      ...(q.maxCategory ? { maxCategory: q.maxCategory } : {}),
    },
  };
  if (q.hotelCodes?.length) body.hotels = { hotel: q.hotelCodes };
  else if (q.destination) body.destination = { code: q.destination };
  else if (q.geolocation) body.geolocation = q.geolocation;
  else throw new HotelbedsError("INVALID_REQUEST", "Availability needs a destination, a geolocation or hotel codes");
  if (q.boards?.length) body.boards = { board: q.boards, included: true };
  return body;
}

/* ───────────── the rate key ───────────── */

/**
 * What a rate key carries, by position: checkIn|checkOut|…|…|hotelCode|roomCode|…|boardCode||rooms~adults~children|…
 * Not a documented contract, so only used to search the same hotel again when the party changes; a key that doesn't
 * look like this is simply searched afresh.
 */
export function parseRateKey(rateKey: string): { checkIn: string; checkOut: string; hotelCode: number; roomCode: string; boardCode: string } | null {
  const p = rateKey.split("|");
  const day = (s: string | undefined) => (s && /^\d{8}$/.test(s) ? `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}` : null);
  const checkIn = day(p[0]), checkOut = day(p[1]);
  const hotelCode = Number(p[4]);
  if (!checkIn || !checkOut || !Number.isInteger(hotelCode) || hotelCode <= 0) return null;
  return { checkIn, checkOut, hotelCode, roomCode: p[5] ?? "", boardCode: p[7] ?? "" };
}

/**
 * Our offer id for a Hotelbeds rate: `hb~<B|R>~<rateKey>~.<party>`. The trailing `.<party>` is how the booking
 * service asks for the same room for a different number of people (search.ts repriceOffer).
 */
export const encodeOfferId = (rateKey: string, rateType: string, party: number) => `hb~${rateType === "RECHECK" ? "R" : "B"}~${rateKey}~.${party}`;
export function decodeOfferId(id: string): { rateKey: string; recheck: boolean; party: number } | null {
  const m = /^hb~([BR])~(.+)~\.(\d+)$/s.exec(id);
  return m ? { recheck: m[1] === "R", rateKey: m[2]!, party: Number(m[3]) } : null;
}
export const isHotelbedsOfferId = (id: string) => id.startsWith("hb~");

/* ───────────── cancellation rules ───────────── */

export type StayRule = { cancellation: string; freeCancelUntil: string | null; cancelFee: number | null; refundable: boolean; deadline: string | null };

/** Days before the supplier's deadline that we stop offering free cancellation, so the desk has time to cancel. */
const bufferDays = () => { const n = Number(process.env.APP_CANCEL_BUFFER_DAYS ?? 0); return Number.isInteger(n) && n >= 0 && n <= 7 ? n : 0; };

/** "14 Nov, 23:59": the deadline as the hotel's clock shows it (the offset in `from` is the destination's, cert. 3.8). */
export function hotelTime(from: string): { day: string; time: string } {
  return { day: from.slice(0, 10), time: /T(\d{2}:\d{2})/.exec(from)?.[1] ?? "00:00" };
}

/**
 * Hotelbeds policies ("from this moment, this amount is charged", amounts in the contract currency, `from` with the
 * hotel's offset) become our rule: free until a day (one day of margin before their deadline), then a fee in riyals
 * in proportion to what the traveller paid. A non-refundable rate or a deadline already passed is "not refundable".
 */
export function stayRule(rate: Pick<HbRate, "cancellationPolicies" | "rateClass" | "net">, total: number, now = new Date()): StayRule {
  const policies = [...(rate.cancellationPolicies ?? [])].filter((p) => p.from && Number(p.amount) > 0).sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
  const net = Number(rate.net);
  const first = policies[0];
  const worst = policies.reduce((m, p) => Math.max(m, Number(p.amount)), 0);
  if (rate.rateClass === "NRF" || (first && Date.parse(first.from) <= now.getTime())) {
    return { cancellation: t("hb.cancel.none"), freeCancelUntil: null, cancelFee: total, refundable: false, deadline: first?.from ?? null };
  }
  if (!first) return { cancellation: t("hb.cancel.freeAny"), freeCancelUntil: null, cancelFee: 0, refundable: true, deadline: null };
  // Their deadline on the hotel's own clock (cert. 3.8), less any margin we choose to keep (APP_CANCEL_BUFFER_DAYS, default none).
  const ht = hotelTime(first.from);
  const buffer = bufferDays();
  let freeUntil = addDays(ht.day, -buffer);
  const today = now.toISOString().slice(0, 10);
  if (freeUntil < today) freeUntil = today;
  const fee = feeHalalas(worst, net, total);
  const feeText = fee >= total ? t("hb.cancel.feeAll") : t("hb.cancel.feeSar", { amount: Math.round(fee / 100).toLocaleString("en-US") });
  const steps = policies.length > 1 ? ` ${policies.slice(1).map((p) => { const h = hotelTime(p.from); return t("hb.cancel.then", { date: shortDay(h.day), time: h.time, fee: t("hb.cancel.feeSar", { amount: Math.round(feeHalalas(Number(p.amount), net, total) / 100).toLocaleString("en-US") }) }); }).join(" ")}` : "";
  const text = buffer ? t("hb.cancel.free", { date: shortDay(freeUntil), fee: feeText }) : t("hb.cancel.freeTime", { date: shortDay(ht.day), time: ht.time, fee: policies.length > 1 ? t("hb.cancel.feeSar", { amount: Math.round(feeHalalas(Number(first.amount), net, total) / 100).toLocaleString("en-US") }) : feeText });
  return { cancellation: `${text}${steps}`, freeCancelUntil: freeUntil, cancelFee: fee, refundable: true, deadline: first.from };
}

/* ───────────── availability → offers ───────────── */

const BOARD_KEYS: Record<string, string> = { RO: "hb.board.RO", BB: "hb.board.BB", HB: "hb.board.HB", FB: "hb.board.FB", AI: "hb.board.AI" };
const boardNote = (r: HbRate) => (r.boardCode && BOARD_KEYS[r.boardCode] ? t(BOARD_KEYS[r.boardCode] as never) : r.boardName ? t("hb.board.other", { board: r.boardName.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }) : "");

/** Taxes Hotelbeds lists as not included are paid at the hotel (city tax): we say so, in riyals. */
function payAtHotel(r: HbRate, rules: PricingRules): number {
  let sum = 0;
  for (const tx of r.taxes?.taxes ?? []) {
    if (tx.included) continue;
    const amount = Number(tx.clientAmount ?? tx.amount);
    const cur = tx.clientCurrency ?? tx.currency;
    if (amount > 0 && cur) { try { sum += costHalalas(amount, cur, rules); } catch { /* unknown currency: the desk sees it in the rate */ } }
  }
  return sum;
}

const photoUrl = (path: string, size: "bigger" | "xl" = "bigger") => `https://photos.hotelbeds.com/giata/${size}/${path.replace(/^\//, "")}`;

export type MapOptions = { nights: number; party: number; rooms: number; checkIn: string; facts?: Map<number, HotelFacts>; rules?: PricingRules; now?: Date; expiresInMs?: number };

/** The rate we'd sell for one hotel: AT_WEB, the requested number of rooms, the cheapest. */
export function bestRate(h: HbHotel, rooms: number): { room: HbRoom; rate: HbRate } | null {
  let best: { room: HbRoom; rate: HbRate } | null = null;
  for (const room of h.rooms ?? []) {
    for (const rate of room.rates ?? []) {
      if (rate.paymentType && rate.paymentType !== "AT_WEB") continue;
      // Opaque (packaging) rates only inside a package with flights or transfers (cert. 3.5): never on their own.
      if (rate.packaging) continue;
      if (rate.rooms && rate.rooms !== rooms) continue;
      if (!best || Number(rate.net) < Number(best.rate.net)) best = { room, rate };
    }
  }
  return best;
}

export function offerOf(h: HbHotel, room: HbRoom, rate: HbRate, o: MapOptions): BookingHotelOffer {
  const rules = o.rules ?? pricingRules();
  const floor = rate.hotelMandatory && rate.sellingRate ? Number(rate.sellingRate) : null;
  const total = sellHalalas(Number(rate.net), h.currency, "stay", { floor, rules });
  const rule = stayRule(rate, total, o.now);
  const f = o.facts?.get(h.code);
  const cityTax = payAtHotel(rate, rules);
  const stars = Number((h.categoryCode ?? "").match(/^(\d)/)?.[1] ?? 0);
  // Promotions can carry extras (cert. 2.7): their names go on the card.
  const promos = [...(rate.promotions ?? []).map((p) => p.name ?? p.code), ...(rate.offers ?? []).map((p) => p.name ?? p.code)].filter(Boolean);
  const note = [room.name ? room.name.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) + "." : "", boardNote(rate), promos.length ? t("hb.note.promo", { names: promos.join(", ") }) : "", cityTax ? t("hb.note.cityTax", { amount: Math.ceil(cityTax / 100).toLocaleString("en-US") }) : ""].filter(Boolean).join(" ");
  return {
    id: encodeOfferId(rate.rateKey, rate.rateType, o.party), supplier: "hotelbeds", label: "best",
    name: f?.name || h.name, area: [h.zoneName, stars ? t("hb.stars", { n: stars }) : null].filter(Boolean).join(" · "),
    address: f?.address || [h.zoneName, h.destinationName].filter(Boolean).join(", "), note, rating: null,
    nightly: { amount: Math.round(total / o.nights), currency: "SAR" }, total: { amount: total, currency: "SAR" }, nights: o.nights, rooms: o.rooms,
    cancellation: rule.cancellation, freeCancelUntil: rule.freeCancelUntil, cancelFee: rule.cancelFee, imageUrl: f?.imageUrl ?? null,
    expiresAt: new Date((o.now ?? new Date()).getTime() + (o.expiresInMs ?? 20 * 60_000)).toISOString(),
    meta: { photo: "hotel-room", focal: "50% 50%", noteOne: note, noteTwo: note, label: "best", hotelCode: h.code, imageUrl: f?.imageUrl ?? null, category: h.categoryName ?? null, rateCommentsId: rate.rateCommentsId ?? null, room: room.name, board: rate.boardName ?? rate.boardCode ?? null },
  };
}

/** The offers the app shows: one rate per hotel, cheapest first, the best-rated of the rest labelled "best". */
/** How many hotels the app lists (HOTELBEDS_MAX_RESULTS; a certification staging shows them all, e.g. 200). */
export const maxResults = () => { const n = Number(process.env.HOTELBEDS_MAX_RESULTS ?? 8); return Number.isInteger(n) && n > 0 ? Math.min(n, 500) : 8; };

export function offersFromAvailability(res: HbAvailabilityResponse, o: MapOptions & { limit?: number }): BookingHotelOffer[] {
  const picked: { offer: BookingHotelOffer; stars: number }[] = [];
  for (const h of res.hotels?.hotels ?? []) {
    const b = bestRate(h, o.rooms);
    if (!b) continue;
    try {
      picked.push({ offer: offerOf(h, b.room, b.rate, o), stars: Number((h.categoryCode ?? "").match(/^(\d)/)?.[1] ?? 0) });
    } catch { /* a currency we can't price: skip that hotel rather than guess */ }
  }
  picked.sort((a, b) => a.offer.total.amount - b.offer.total.amount);
  const list = picked.slice(0, o.limit ?? maxResults());
  if (!list.length) return [];
  // "lowest" is the cheapest; "best" is the highest category among the rest (ties: cheaper first).
  const lowest = list[0]!;
  const rest = list.slice(1);
  const best = [...rest].sort((a, b) => b.stars - a.stars || a.offer.total.amount - b.offer.total.amount)[0];
  const ordered = best ? [best, lowest, ...rest.filter((x) => x !== best)] : [lowest];
  return ordered.map((x) => {
    const label = x === lowest && best ? "lowest" : "best";
    return { ...x.offer, label, meta: { ...x.offer.meta!, label } };
  });
}

/* ───────────── the adapter ───────────── */

export type StayQueryExtras = { childAges?: number[] };

export type BookStayInput = {
  rateKey: string;
  holder: { name: string; surname: string };
  /** Everyone staying, by room (roomId from 1). Children carry their age. */
  paxes: HbPax[];
  /** Our order id: Hotelbeds shows it on the voucher and in their extranet. Max 20 characters on their side. */
  clientReference: string;
  remark?: string | null;
  tolerancePct?: number;
};

export type CancelResult = { reference: string; status: string; simulated: boolean; amount: number; currency: string | null; cancellationReference: string | null };

export class HotelbedsHotels implements BookingHotelSupplier {
  readonly name = "hotelbeds";
  constructor(readonly client: HotelbedsClient, private readonly facts?: FactsLookup) {}

  static create(opts: Partial<HotelbedsClientOptions> = {}, facts?: FactsLookup) {
    return new HotelbedsHotels(new HotelbedsClient({ product: "hotels", ...opts }), facts);
  }

  availability(q: HotelbedsStayQuery) {
    return this.client.request<HbAvailabilityResponse>({ method: "POST", path: "/hotel-api/1.0/hotels", body: availabilityBody(q), safe: true });
  }

  /** Up to 10 rate keys per call (cert. 2.6). Only for RECHECK rates (cert. 2.5). */
  checkRate(rateKeys: string[]) {
    if (rateKeys.length < 1 || rateKeys.length > 10) throw new HotelbedsError("INVALID_REQUEST", "checkrates takes 1 to 10 rate keys");
    return this.client.request<HbCheckRateResponse>({ method: "POST", path: "/hotel-api/1.0/checkrates", body: { rooms: rateKeys.map((rateKey) => ({ rateKey })) }, safe: true });
  }

  /** Never retried by us: a booking that timed out is looked up by clientReference before trying again (desk). */
  book(b: BookStayInput) {
    return this.client.request<HbBookingResponse>({
      // Certification 3.11: wait at least 60 seconds for a confirmation.
      method: "POST", path: "/hotel-api/1.0/bookings", safe: false, timeoutMs: 65_000,
      body: {
        holder: b.holder,
        rooms: [{ rateKey: b.rateKey, paxes: b.paxes }],
        clientReference: b.clientReference.replace(/[^A-Za-z0-9-]/g, "").slice(0, 20),
        ...(b.remark ? { remark: b.remark.slice(0, 500) } : {}),
        ...(b.tolerancePct ? { tolerance: Number(b.tolerancePct.toFixed(2)) } : {}),
      },
    });
  }

  bookingDetail(reference: string) {
    return this.client.request<HbBookingResponse>({ method: "GET", path: `/hotel-api/1.0/bookings/${encodeURIComponent(reference)}` });
  }

  /** SIMULATION first to see the fee, then CANCELLATION. */
  async cancel(reference: string, simulate: boolean): Promise<CancelResult> {
    const r = await this.client.request<HbBookingResponse>({
      method: "DELETE", path: `/hotel-api/1.0/bookings/${encodeURIComponent(reference)}`, query: { cancellationFlag: simulate ? "SIMULATION" : "CANCELLATION", language: "ENG" }, safe: simulate,
    });
    const b = r.booking;
    const amount = Number(b.hotel?.cancellationAmount ?? (simulate ? 0 : b.totalNet ?? 0)) || 0;
    return { reference: b.reference, status: b.status, simulated: simulate, amount, currency: b.currency ?? b.hotel?.currency ?? null, cancellationReference: b.cancellationReference ?? null };
  }

  /** Content API, in pages of up to 1000. Batch only (content.ts); never on a traveller's request. */
  content(q: { codes?: number[]; from?: number; to?: number; lastUpdateTime?: string; language?: string }) {
    return this.client.request<HbContentResponse>({
      method: "GET", path: "/hotel-content-api/1.0/hotels",
      query: { fields: "all", language: q.language ?? "ENG", from: q.from ?? 1, to: q.to ?? 100, codes: q.codes?.join(","), lastUpdateTime: q.lastUpdateTime, useSecondaryLanguage: false },
    });
  }

  /**
   * A rate's comments ("essential information") for one check-in day, by its rateCommentsId (incoming|code|rateCodes).
   * Content API rateCommentDetails, the online way the docs give; cached by the caller.
   */
  async rateCommentDetails(rateCommentsId: string, checkIn: string, language = "ENG"): Promise<string | null> {
    const [incoming, code, rateCodes] = rateCommentsId.split("|");
    if (!code) return null;
    const r = await this.client.request<{ rateComments?: { description?: string }[]; description?: string }>({
      method: "GET", path: "/hotel-content-api/1.0/types/ratecommentdetails", query: { date: checkIn, code: rateCommentsId, incoming, rateCodes, language, fields: "all" },
    });
    const text = (r.rateComments ?? []).map((c) => c.description).filter(Boolean).join(" ") || r.description || "";
    return text.trim() || null;
  }

  /* BookingHotelSupplier: the booking service's search and re-price. */

  async search(input: HotelSearch & StayQueryExtras) {
    const q = HotelSearchSchema.parse(input);
    const dest = Object.values(DESTINATIONS).find((d) => d.words.test(q.city.toLowerCase()) || d.key === q.city.toLowerCase());
    const place = dest ? HB_PLACES[dest.key] : undefined;
    if (!place) return [];
    const childAges = (input.childAges ?? []).slice(0, q.children || (input.childAges?.length ?? 0));
    const adults = Math.max(1, q.adults - childAges.length);
    const rooms = q.rooms || roomsFor(q.adults);
    const checkOut = addDays(q.checkIn, q.nights);
    const useCode = process.env.HOTELBEDS_USE_DESTINATION_CODES === "yes" && place.code;
    const res = await this.availability({
      checkIn: q.checkIn, checkOut, rooms: splitParty(adults, childAges, rooms),
      ...(useCode ? { destination: place.code } : { geolocation: { latitude: place.lat, longitude: place.lng, radius: place.radiusKm, unit: "km" as const } }),
    });
    const codes = (res.hotels?.hotels ?? []).map((h) => h.code);
    const facts = this.facts && codes.length ? await this.facts(codes).catch(() => undefined) : undefined;
    return offersFromAvailability(res, { nights: q.nights, party: q.adults, rooms, checkIn: q.checkIn, facts });
  }

  /**
   * Today's price for one offer. A RECHECK rate goes through checkrates (Hotelbeds requires it); a bookable rate is
   * re-checked too, so the order sheet never shows a stale total. A different party size searches the same hotel again.
   */
  async price(offerId: string, stored?: BookingHotelOffer | null) {
    const d = decodeOfferId(offerId);
    if (!d) throw new HotelbedsError("NOT_FOUND", "Not a Hotelbeds offer");
    const key = parseRateKey(d.rateKey);
    const sameParty = (() => {
      const occ = d.rateKey.split("|")[9]; // rooms~adults~children
      const m = occ ? /^(\d+)~(\d+)~(\d+)$/.exec(occ) : null;
      return !m || Number(m[2]) + Number(m[3]) === d.party;
    })();
    if (!sameParty && key) {
      const rooms = roomsFor(d.party);
      const res = await this.availability({ checkIn: key.checkIn, checkOut: key.checkOut, rooms: splitParty(d.party, [], rooms), hotelCodes: [key.hotelCode] });
      const h = res.hotels?.hotels?.[0];
      if (!h) throw new HotelbedsError("NO_AVAILABILITY", "That hotel has nothing for this party now");
      const same = h.rooms.flatMap((room) => room.rates.map((rate) => ({ room, rate }))).find((x) => x.room.code === key.roomCode && x.rate.boardCode === key.boardCode && (!x.rate.paymentType || x.rate.paymentType === "AT_WEB"));
      const pick = same ?? bestRate(h, rooms);
      if (!pick) throw new HotelbedsError("NO_AVAILABILITY", "That hotel has nothing for this party now");
      const facts = this.facts ? await this.facts([h.code]).catch(() => undefined) : undefined;
      const nights = Math.max(1, Math.round((Date.parse(key.checkOut) - Date.parse(key.checkIn)) / 86_400_000));
      return offerOf(h, pick.room, pick.rate, { nights, party: d.party, rooms, checkIn: key.checkIn, facts });
    }
    // A BOOKABLE rate is booked as it is (cert. 2.5: checkrates only for RECHECK): the offer we showed stands.
    if (!d.recheck && stored) return { ...stored, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString() };
    const res = await this.checkRate([d.rateKey]);
    const h = res.hotel;
    const room = h?.rooms?.[0];
    const rate = room?.rates?.[0];
    if (!h || !room || !rate) throw new HotelbedsError("NO_AVAILABILITY", "The rate is no longer available");
    const facts = this.facts ? await this.facts([h.code]).catch(() => undefined) : undefined;
    const checkIn = h.checkIn ?? key?.checkIn;
    const nights = Math.max(1, Math.round((Date.parse(h.checkOut ?? key?.checkOut ?? checkIn) - Date.parse(checkIn)) / 86_400_000));
    // After checkrates the rate is BOOKABLE: keep the (possibly new) key with the party size.
    const offer = offerOf(h, room, { ...rate, rateType: "BOOKABLE" }, { nights, party: d.party, rooms: rate.rooms || roomsFor(d.party), checkIn, facts });
    return { ...offer, meta: { ...offer.meta!, rateComments: rate.rateComments ?? null } };
  }
}
