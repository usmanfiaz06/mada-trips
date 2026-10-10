import { addDays, sarToHalalas, times, HotelSearch as HotelSearchSchema, type HotelOffer } from "@mada/shared";
import type { HotelSupplier } from "../types";
import { ISTANBUL_HOTELS } from "./data";

/* Mock hotels: Istanbul returns the prototype's three stays. Free cancellation until 6 days before check-in, then SAR 400. */

function offer(h: (typeof ISTANBUL_HOTELS)[number], checkIn: string, nights: number, rooms: number): HotelOffer {
  const nightly = sarToHalalas(h.nightSar);
  const freeUntil = addDays(checkIn, -6);
  return {
    id: `mock-${h.key}-${checkIn}-${nights}-${rooms}`, supplier: "mock", label: h.label, name: h.name, area: h.area, address: h.address,
    note: h.note, rating: h.rating, nightly: { amount: nightly, currency: "SAR" }, total: { amount: times(times(nightly, nights), rooms), currency: "SAR" },
    nights, rooms, cancellation: "Free to cancel until 6 days before. After that, SAR 400.", freeCancelUntil: freeUntil, cancelFee: 40000,
    imageUrl: null, expiresAt: new Date(Date.now() + 15 * 60_000).toISOString(),
  };
}

export const mockHotels: HotelSupplier = {
  name: "mock-hotels",
  async search(input) {
    const q = HotelSearchSchema.parse(input);
    if (!/istanbul|İstanbul/i.test(q.city)) return [];
    return ISTANBUL_HOTELS.map((h) => offer(h, q.checkIn, q.nights, q.rooms));
  },
  async price(offerId) {
    const m = /^mock-([a-z]+)-(\d{4}-\d{2}-\d{2})-(\d+)-(\d+)$/.exec(offerId);
    const h = m && ISTANBUL_HOTELS.find((x) => x.key === m[1]);
    if (!m || !h) throw new Error(`Unknown mock offer ${offerId}`);
    return offer(h, m[2]!, Number(m[3]), Number(m[4]));
  },
};
