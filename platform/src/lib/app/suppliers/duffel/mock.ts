import { createHash } from "node:crypto";
import { zonedToInstant } from "@mada/shared";
import { AppError } from "../../http";
import { AIRPORT_TZ } from "../mock/data";
import fixtures from "./fixtures.json";
import { decode, offerRequestBody } from "./duffel";
import { sameFlights } from "./merge";
import { offerOf, parseOffers, type DuffelOffer, type Party } from "./parse";
import type { DuffelFlights, DuffelOrder } from "./types";

/*
 * Mock Duffel: the fixture routes on any day, as Duffel-shaped offers through the same parser as the live answers.
 * Orders live in memory: instant is ticketed, hold is held until tomorrow; cancelling refunds what the fare allows.
 * A passenger surnamed "Soldout" gets offer_no_longer_available.
 */

type Route = (typeof fixtures.routes)[number];
const tz = (a: string) => AIRPORT_TZ[a] ?? "Asia/Riyadh";
const at = (day: string, hhmm: string) => `${day}T${hhmm}:00`;
function plus(day: string, hhmm: string, fromTz: string, toTz: string, min: number) {
  const t = new Date(zonedToInstant(`${day}T${hhmm}`, fromTz).getTime() + min * 60_000);
  const p = new Intl.DateTimeFormat("en-CA", { timeZone: toTz, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(t)
    .reduce<Record<string, string>>((a, x) => ({ ...a, [x.type]: x.value }), {});
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:00`;
}
const seg = (carrier: string, name: string, num: string, from: string, to: string, day: string, dep: string, min: number, bags: number) => ({
  marketing_carrier: { iata_code: carrier, name }, marketing_carrier_flight_number: num, origin: { iata_code: from, time_zone: tz(from) }, destination: { iata_code: to, time_zone: tz(to) },
  departing_at: at(day, dep), arriving_at: plus(day, dep, tz(from), tz(to), min), duration: `PT${Math.floor(min / 60)}H${min % 60}M`,
  passengers: [{ cabin_class: "economy", baggages: bags ? [{ type: "checked", quantity: bags }] : [] }],
});

type Body = ReturnType<typeof offerRequestBody>;
const g = globalThis as unknown as { __madaMockDuffel?: { offers: Map<string, DuffelOffer>; orders: Map<string, DuffelOrder & { refundable: boolean }> } };
const store: NonNullable<typeof g.__madaMockDuffel> = (g.__madaMockDuffel ??= { offers: new Map(), orders: new Map() });
export const clearMockDuffel = () => { store.offers.clear(); store.orders.clear(); };

function offersFor(body: Body, party: Party): DuffelOffer[] {
  const [out, back] = body.slices;
  const seats = party.adults + party.children;
  return fixtures.routes.filter((r: Route) => r.from === out!.origin && r.to === out!.destination).map((r) => {
    const id = `off_mock${createHash("sha256").update(JSON.stringify([r.carrier, r.number, body, party])).digest("hex").slice(0, 20)}`;
    const total = r.usdPerSeat * seats * (back ? 1.85 : 1) + r.usdPerSeat * 0.1 * party.infants;
    const o: DuffelOffer = {
      id, total_amount: total.toFixed(2), total_currency: "USD", expires_at: new Date(Date.now() + 30 * 60_000).toISOString(), owner: { iata_code: r.carrier, name: r.name },
      slices: [{ segments: [seg(r.carrier, r.name, r.number, r.from, r.to, out!.departure_date, r.dep, r.minutes, r.bags)] }, ...(back ? [{ segments: [seg(r.carrier, r.name, r.back, r.to, r.from, back.departure_date, r.backDep, r.backMinutes, r.bags)] }] : [])],
      passengers: [...Array.from({ length: party.adults }, (_, i) => ({ id: `pas_a${i}`, type: "adult" })), ...Array.from({ length: party.children }, (_, i) => ({ id: `pas_c${i}`, type: "child", age: 8 })), ...Array.from({ length: party.infants }, (_, i) => ({ id: `pas_i${i}`, type: "infant_without_seat" }))],
      conditions: { refund_before_departure: r.refund, change_before_departure: r.change },
    };
    store.offers.set(id, o);
    return o;
  });
}

export const mockDuffel: DuffelFlights = {
  name: "duffel",
  async search(q) {
    const party = { adults: q.adults, children: q.children ?? 0, infants: q.infants ?? 0 };
    const body = offerRequestBody({ from: q.from, to: q.to, depart: q.depart, return: q.return, cabin: q.cabin ?? "economy", ...party });
    return parseOffers(offersFor(body, party), party).map((o) => ({ ...o, id: `${o.id}~${party.adults}-${party.children}-${party.infants}` }));
  },
  async price(offerId, travellers, children) {
    const k = decode(offerId);
    const o = k && store.offers.get(k.offer);
    if (!k || !o) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const same = offerOf(o, k.party)!;
    const kids = Math.min(children ?? k.party.children, travellers);
    const want = { adults: Math.max(1, travellers - kids), children: kids, infants: k.party.infants };
    if (want.adults === k.party.adults && want.children === k.party.children) return { ...same, id: offerId };
    const again = await this.search({ from: same.out[0]!.from, to: same.out.at(-1)!.to, depart: same.out[0]!.departLocal.slice(0, 10), return: same.back[0]?.departLocal.slice(0, 10) ?? null, cabin: same.cabin, ...want });
    const match = again.find((x) => sameFlights(x, same));
    if (!match) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    return match;
  },
  async hold() { throw new AppError("VALIDATION", { message: "Duffel orders go through createOrder() with full passenger details" }); },
  async createOrder({ offerId, passengers, type, reference, known }) {
    if (known) return this.getOrder(known);
    const k = decode(offerId);
    const o = k && store.offers.get(k.offer);
    if (!k || !o) throw new AppError("NOT_FOUND");
    if (passengers.some((p) => p.surname.toLowerCase() === "soldout")) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const n = store.orders.size + 1;
    const order = {
      id: `ord_mock${n}`, bookingReference: `MK${String(1000 + n)}X`, status: type === "instant" ? "ticketed" as const : "held" as const,
      tickets: type === "instant" ? passengers.filter((p) => p.type !== "infant").map((_, i) => `065${String(2_000_000_000 + n * 10 + i)}`) : [],
      total: { amount: Math.round(Number(o.total_amount) * 100), currency: o.total_currency! }, paymentRequiredBy: type === "hold" ? new Date(Date.now() + 86_400_000).toISOString() : null, reference,
      refundable: o.conditions?.refund_before_departure?.allowed !== false,
    };
    store.orders.set(order.id, order);
    const { refundable: _r, ...out } = order;
    return out;
  },
  async getOrder(orderId) {
    const o = store.orders.get(orderId);
    if (!o) throw new AppError("NOT_FOUND");
    const { refundable: _r, ...out } = o;
    return out;
  },
  async cancelOrder(orderId) {
    const o = store.orders.get(orderId);
    if (!o) throw new AppError("NOT_FOUND");
    store.orders.set(orderId, { ...o, status: "cancelled" });
    const refund = o.status === "held" ? null : o.refundable ? { amount: Math.round(o.total.amount * 0.8), currency: o.total.currency } : { amount: 0, currency: o.total.currency };
    return { cancelled: true, refund };
  },
};
