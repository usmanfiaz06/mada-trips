import { CATALOGUE_HOTELS, DESTINATIONS, HotelSearch as HotelSearchSchema, addDays, sarToHalalas, staySar } from "@mada/shared";
import type { BookingHotelOffer, BookingHotelSupplier } from "../booking-types";

/*
 * The catalogue hotel supplier: the RateHawk stand-in for booking (M2). Istanbul returns the prototype's three stays
 * (rooms near Galata Tower, the Sultanahmet garden hotel, Bosphorus rooms), priced for the party the way the prototype
 * does: two people or fewer share one room at 55% of the family price. Free to cancel until 7 days before.
 */

type Decoded = { key: string; city: string; checkIn: string; nights: number; adults: number };
const encode = (d: Decoded) => `cat.${d.city}.${d.key}.${d.checkIn}.${d.nights}.${d.adults}`;
function decode(id: string): Decoded | null {
  const m = /^cat\.([a-z]+)\.([a-z]+)\.(\d{4}-\d{2}-\d{2})\.(\d+)\.(\d+)$/.exec(id);
  return m ? { city: m[1]!, key: m[2]!, checkIn: m[3]!, nights: Number(m[4]), adults: Number(m[5]) } : null;
}

function offer(d: Decoded): BookingHotelOffer {
  const h = CATALOGUE_HOTELS[d.city]!.find((x) => x.key === d.key)!;
  const total = sarToHalalas(staySar(h.nightSar, d.nights, d.adults));
  const rooms = d.adults > 2 ? 2 : 1;
  return {
    id: encode(d), supplier: "catalogue", label: h.label === "best" ? "best" : h.label === "quiet" ? "quiet" : "water", name: h.name, area: h.area, address: h.address,
    note: h.note, rating: h.rating, nightly: { amount: Math.round(total / d.nights), currency: "SAR" }, total: { amount: total, currency: "SAR" },
    nights: d.nights, rooms, cancellation: "Free to cancel until 7 days before. After that, the first night.", freeCancelUntil: addDays(d.checkIn, -7),
    cancelFee: sarToHalalas(staySar(h.nightSar, 1, d.adults)), imageUrl: null, expiresAt: new Date(Date.now() + 20 * 60_000).toISOString(),
    meta: { photo: h.photo, focal: h.focal, noteOne: h.noteSmall.one, noteTwo: h.noteSmall.two, label: h.label === "best" ? "best" : h.label === "quiet" ? "quiet" : "water" },
  };
}

export const catalogueHotels: BookingHotelSupplier = {
  name: "catalogue-hotels",
  async search(input) {
    const q = HotelSearchSchema.parse(input);
    const dest = Object.values(DESTINATIONS).find((d) => d.words.test(q.city.toLowerCase()) || d.key === q.city.toLowerCase());
    const list = dest ? CATALOGUE_HOTELS[dest.key] : undefined;
    if (!dest || !list) return [];
    return list.map((h) => offer({ key: h.key, city: dest.key, checkIn: q.checkIn, nights: q.nights, adults: q.adults + q.children }));
  },
  async price(offerId) {
    const d = decode(offerId);
    if (!d || !CATALOGUE_HOTELS[d.city]?.some((h) => h.key === d.key)) throw new Error(`Unknown catalogue offer ${offerId}`);
    return offer(d);
  },
};
