import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import type { FlightPassenger } from "../flight-ticketing";
import { parseOffers, offerOf, type DuffelOffer, type Party } from "./parse";
import { sameFlights } from "./merge";
import type { DuffelFlights, DuffelOrder } from "./types";

/*
 * Duffel Flights API (duffel.com/docs/api, version v2): Bearer DUFFEL_ACCESS_TOKEN (duffel_test_… on test mode, which
 * books nothing real; duffel_live_… after activation), header Duffel-Version: v2.
 *   POST /air/offer_requests?return_offers=true     search (slices, passengers, cabin_class)
 *   GET  /air/offers/{id}                           the offer at today's price (offers last ~30 minutes)
 *   POST /air/orders                                order: instant (paid from the Duffel balance) or hold
 *   GET  /air/orders/{id}                           PNR, tickets (documents), status
 *   POST /air/order_cancellations + /{id}/actions/confirm   cancel: the quote, then confirm
 * Duffel has no idempotency key: book only once per order id (the caller keeps `known`, the order id, and passes it
 * back so a retry reads the order instead of booking again).
 */

const HOST = "https://api.duffel.com";
const partyKey = (p: Party) => `${p.adults}-${p.children}-${p.infants}`;

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const { DUFFEL_ACCESS_TOKEN: token } = requireEnv("flights (Duffel)", ["DUFFEL_ACCESS_TOKEN"]);
  const res = await fetch(`${HOST}${path}`, {
    method, signal: AbortSignal.timeout(28_000),
    headers: { Authorization: `Bearer ${token}`, "Duffel-Version": "v2", Accept: "application/json", "Content-Type": "application/json" },
    body: body ? JSON.stringify({ data: body }) : undefined,
  });
  const text = await res.text();
  if (res.status >= 500) throw new Error(`duffel answered ${res.status}`);
  if (res.status === 404) throw new AppError("NOT_FOUND");
  if (!res.ok) {
    const err = (() => { try { return (JSON.parse(text) as { errors?: { code?: string; message?: string }[] }).errors?.[0]; } catch { return undefined; } })();
    if (err?.code === "offer_no_longer_available" || err?.code === "offer_expired") throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    throw new AppError("VALIDATION", { message: `Duffel refused: ${err?.message ?? text.slice(0, 160)}` });
  }
  return (JSON.parse(text) as { data: T }).data;
}

export function offerRequestBody(q: { from: string; to: string; depart: string; return: string | null; cabin: string } & Party) {
  const passengers = [
    ...Array.from({ length: q.adults }, () => ({ type: "adult" })),
    // Children 2–11 by age (Duffel prices by age), babies on a lap as infant_without_seat.
    ...Array.from({ length: q.children }, () => ({ age: 8 })),
    ...Array.from({ length: q.infants }, () => ({ type: "infant_without_seat" })),
  ];
  return {
    slices: [{ origin: q.from, destination: q.to, departure_date: q.depart }, ...(q.return ? [{ origin: q.to, destination: q.from, departure_date: q.return }] : [])],
    passengers, cabin_class: q.cabin === "premium" ? "premium_economy" : q.cabin, max_connections: 1,
  };
}

/** Our id carries the party, so price() can tell when the travellers changed (a Duffel offer is for one party). */
const encode = (offerId: string, p: Party) => `${offerId}~${partyKey(p)}`;
export function decode(id: string): { offer: string; party: Party } | null {
  const m = /^duffel\.(off_[\w]+)~(\d+)-(\d+)-(\d+)$/.exec(id);
  return m ? { offer: m[1]!, party: { adults: Number(m[2]), children: Number(m[3]), infants: Number(m[4]) } } : null;
}
const withParty = <T extends { id: string }>(o: T, p: Party): T => ({ ...o, id: encode(o.id, p) });

type DOrder = { id?: string; booking_reference?: string | null; cancelled_at?: string | null; documents?: { type?: string; unique_identifier?: string }[]; total_amount?: string; total_currency?: string; payment_status?: { payment_required_by?: string | null; awaiting_payment?: boolean }; metadata?: { reference?: string } | null };

export function orderOf(o: DOrder): DuffelOrder {
  if (!o?.id) throw new Error("duffel answered an order without an id");
  const tickets = (o.documents ?? []).filter((d) => d.type === "electronic_ticket" && d.unique_identifier).map((d) => d.unique_identifier!);
  return {
    id: o.id, bookingReference: o.booking_reference ?? null, status: o.cancelled_at ? "cancelled" : tickets.length || !o.payment_status?.awaiting_payment ? "ticketed" : "held",
    tickets, total: { amount: Math.round(Number(o.total_amount ?? 0) * 100), currency: o.total_currency ?? "SAR" }, paymentRequiredBy: o.payment_status?.payment_required_by ?? null, reference: o.metadata?.reference ?? null,
  };
}

const TITLES = { M: "mr", F: "ms" } as const;
function passengerOf(p: FlightPassenger, duffelId: string) {
  if (!p.dateOfBirth || !p.sex) throw new AppError("VALIDATION", { message: `${p.givenNames} ${p.surname}: date of birth and sex are needed for the airline.` });
  return {
    id: duffelId, given_name: p.givenNames, family_name: p.surname, born_on: p.dateOfBirth, gender: p.sex === "M" ? "m" : "f", title: TITLES[p.sex],
    email: p.email ?? undefined, phone_number: p.phone ?? undefined,
    ...(p.passportNumber && p.passportExpiry && p.passportCountry ? { identity_documents: [{ type: "passport", unique_identifier: p.passportNumber, expires_on: p.passportExpiry, issuing_country_code: p.passportCountry }] } : {}),
  };
}

export const duffel: DuffelFlights = {
  name: "duffel",
  async search(q) {
    const party = { adults: q.adults, children: q.children ?? 0, infants: q.infants ?? 0 };
    const r = await call<{ offers?: DuffelOffer[] }>("POST", "/air/offer_requests?return_offers=true&supplier_timeout=20000", offerRequestBody({ from: q.from, to: q.to, depart: q.depart, return: q.return, cabin: q.cabin ?? "economy", ...party }));
    return parseOffers(r.offers ?? [], party).map((o) => withParty(o, party));
  },
  async price(offerId, travellers, children) {
    const k = decode(offerId);
    if (!k) throw new AppError("NOT_FOUND");
    const kids = Math.min(children ?? k.party.children, travellers);
    const want = { adults: Math.max(1, travellers - kids), children: kids, infants: k.party.infants };
    const o = await call<DuffelOffer>("GET", `/air/offers/${encodeURIComponent(k.offer)}`);
    const same = offerOf(o, k.party);
    if (!same) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    if (partyKey(want) === partyKey(k.party)) return withParty(same, k.party);
    // A different party is a different Duffel offer: search the same day again and take the same flights.
    const again = await this.search({ from: same.out[0]!.from, to: same.out.at(-1)!.to, depart: same.out[0]!.departLocal.slice(0, 10), return: same.back[0]?.departLocal.slice(0, 10) ?? null, cabin: same.cabin, ...want });
    const match = again.find((x) => sameFlights(x, same));
    if (!match) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    return match;
  },
  async hold() {
    throw new AppError("VALIDATION", { message: "Duffel orders go through createOrder() with full passenger details" });
  },
  async createOrder({ offerId, passengers, type, reference, known }) {
    if (known) return this.getOrder(known);
    const k = decode(offerId);
    if (!k) throw new AppError("NOT_FOUND");
    const offer = await call<DuffelOffer & { passengers?: { id?: string; type?: string; age?: number | null }[] }>("GET", `/air/offers/${encodeURIComponent(k.offer)}`);
    const slots = offer.passengers ?? [];
    const byType = (t: FlightPassenger["type"]) => slots.filter((s) => (t === "infant" ? s.type === "infant_without_seat" : t === "child" ? s.type === "child" || (s.age != null && s.age < 12 && s.type !== "infant_without_seat") : s.type === "adult"));
    const used = new Set<string>();
    const pax = passengers.map((p) => {
      const slot = byType(p.type).find((s) => s.id && !used.has(s.id));
      if (!slot?.id) throw new AppError("VALIDATION", { message: "The travellers don't match the offer. Price it again." });
      used.add(slot.id);
      return passengerOf(p, slot.id);
    });
    const body = {
      type, selected_offers: [k.offer], passengers: pax, metadata: { reference },
      ...(type === "instant" ? { payments: [{ type: "balance", amount: offer.total_amount, currency: offer.total_currency }] } : {}),
    };
    return orderOf(await call<DOrder>("POST", "/air/orders", body));
  },
  async getOrder(orderId) { return orderOf(await call<DOrder>("GET", `/air/orders/${encodeURIComponent(orderId)}`)); },
  async cancelOrder(orderId) {
    const q = await call<{ id?: string; refund_amount?: string | null; refund_currency?: string | null }>("POST", "/air/order_cancellations", { order_id: orderId });
    if (!q.id) throw new Error("duffel answered a cancellation without an id");
    const c = await call<{ confirmed_at?: string | null; refund_amount?: string | null; refund_currency?: string | null }>("POST", `/air/order_cancellations/${encodeURIComponent(q.id)}/actions/confirm`);
    const amount = c.refund_amount ?? q.refund_amount;
    const cur = c.refund_currency ?? q.refund_currency;
    return { cancelled: !!c.confirmed_at, refund: amount != null && cur ? { amount: Math.round(Number(amount) * 100), currency: cur } : null };
  },
};
