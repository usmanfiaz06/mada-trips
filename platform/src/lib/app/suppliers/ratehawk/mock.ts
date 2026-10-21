import { HotelSearch as HotelSearchSchema } from "@mada/shared";
import { AppError } from "../../http";
import fixtures from "./fixtures.json";
import { cheapestRate, decodeRh, offerOf, type RhHotel, type RhInfo, type RhQuery } from "./parse";
import type { RateHawkBooking, RateHawkHotels } from "./types";

/*
 * Mock RateHawk: the fixture regions and hotels as ETG-shaped answers through the same parser as the live ones,
 * priced per night and per pair of guests. Bookings in memory: confirmed at once; a guest surnamed "Soldout" gets
 * the rate gone at prebook.
 */

type Fx = (typeof fixtures.hotels)[keyof typeof fixtures.hotels][number];
const HOTELS = fixtures.hotels as Record<string, Fx[]>;

function serp(f: Fx, q: RhQuery): RhHotel {
  const pairs = Math.max(1, Math.ceil((q.adults + q.childAges.length * 0.5) / 2));
  const amount = (f.night * q.nights * pairs).toFixed(2);
  const free = f.freeDays === null ? null : new Date(Date.parse(`${q.checkIn}T00:00:00Z`) - f.freeDays * 86_400_000).toISOString();
  return { id: f.id, rates: [{ match_hash: `m-${f.id}`, book_hash: `h-${f.id}-${q.checkIn}-${q.nights}-${q.adults}`, room_name: f.room_name, meal: f.meal, payment_options: { payment_types: [{ type: "deposit", amount, currency_code: "SAR", cancellation_penalties: { free_cancellation_before: free } }] } }] };
}

const g = globalThis as unknown as { __madaMockRh?: Map<string, RateHawkBooking> };
const bookings: Map<string, RateHawkBooking> = (g.__madaMockRh ??= new Map());
export const clearMockRateHawk = () => bookings.clear();

export const mockRateHawk: RateHawkHotels = {
  name: "ratehawk",
  async search(input) {
    const s = HotelSearchSchema.parse(input);
    const childAges = ((input as { childAges?: number[] }).childAges ?? []).slice(0, 4);
    const region = fixtures.regions.find((r) => r.name.toLowerCase() === s.city.trim().toLowerCase());
    if (!region) return [];
    const q: RhQuery = { regionId: region.id, city: s.city, checkIn: s.checkIn, nights: s.nights, adults: Math.max(1, s.adults - childAges.length), childAges, rooms: s.rooms };
    return (HOTELS[String(region.id)] ?? []).map((f) => {
      const h = serp(f, q);
      const best = cheapestRate(h)!;
      return offerOf(h, best.rate, best.pay, f.info as RhInfo, q);
    }).filter((o) => !!o).sort((a, b) => a.total.amount - b.total.amount);
  },
  async price(id) {
    const dec = decodeRh(id);
    const f = dec && Object.values(HOTELS).flat().find((x) => x.id === dec.key.h);
    if (!dec || !f) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const kids = dec.key.q.childAges.slice(0, dec.party);
    const q = { ...dec.key.q, adults: Math.max(1, dec.party - kids.length), childAges: kids };
    const h = serp(f, q);
    const best = cheapestRate(h)!;
    const o = offerOf(h, best.rate, best.pay, f.info as RhInfo, q)!;
    return { ...o, id: o.id.replace(/\.(\d+)$/, `~${Buffer.from(best.rate.book_hash!).toString("base64url")}.$1`) };
  },
  async book({ offerId, reference, guests }) {
    const had = bookings.get(reference);
    if (had && had.status !== "failed") return had;
    if (!/~[\w-]+\.\d+$/.test(offerId)) throw new AppError("VALIDATION", { message: "Price the room again before booking." });
    if (guests.flat().some((p) => p.lastName.toLowerCase() === "soldout")) throw new AppError("NOT_FOUND", { details: { reason: "sold_out" } });
    const b: RateHawkBooking = { reference, orderId: 90_000_000 + bookings.size + 1, status: "confirmed", offer: await this.price(offerId) };
    bookings.set(reference, b);
    return b;
  },
  async status(reference) {
    const b = bookings.get(reference);
    if (!b) throw new AppError("NOT_FOUND");
    return b;
  },
  async cancel(reference) {
    const b = bookings.get(reference);
    if (!b) throw new AppError("NOT_FOUND");
    bookings.set(reference, { ...b, status: "cancelled" });
    return { cancelled: true };
  },
};
