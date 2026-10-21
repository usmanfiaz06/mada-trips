import { AppError } from "../../http";
import type { BookingHotelOffer, BookingHotelSupplier } from "../booking-types";

/*
 * Two hotel sources as one (Hotelbeds or the catalogue first, RateHawk second): the same hotel from both is shown
 * once, at the lower price. The same hotel: names that agree (most of their words, accents and "hotel" aside) and,
 * when both sources say where it is, within 300 m; a source without coordinates needs the very same name. Price and
 * rooms go to the source the offer came from (RateHawk ids start "ratehawk.").
 */

const STOP = new Set(["hotel", "hotels", "the", "and", "by", "a", "an", "&", "-", "otel", "فندق"]);
export const nameWords = (n: string) => new Set(n.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N} ]/gu, " ").split(/\s+/).filter((w) => w && !STOP.has(w)));

export function metres(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6_371_000 * Math.asin(Math.sqrt(h));
}

const geo = (o: BookingHotelOffer) => {
  const f = o.meta?.facts;
  return f && typeof f.lat === "number" && typeof f.lng === "number" ? { lat: f.lat, lng: f.lng } : null;
};

export function sameHotel(a: BookingHotelOffer, b: BookingHotelOffer): boolean {
  const x = nameWords(a.name), y = nameWords(b.name);
  if (!x.size || !y.size) return false;
  const both = [...x].filter((w) => y.has(w)).length;
  const overlap = both / Math.min(x.size, y.size);
  const exact = both === x.size && both === y.size;
  const ga = geo(a), gb = geo(b);
  if (ga && gb) return overlap >= 0.75 && metres(ga, gb) <= 300;
  return exact;
}

/** One offer per hotel, the cheaper; the first source's order is kept for the rest (the ranking runs after). */
export function mergeHotelOffers(first: BookingHotelOffer[], second: BookingHotelOffer[]): BookingHotelOffer[] {
  const out = [...first];
  for (const o of second) {
    const i = out.findIndex((x) => x.supplier !== o.supplier && sameHotel(x, o));
    if (i < 0) out.push(o);
    else if (o.total.amount < out[i]!.total.amount) out[i] = o;
  }
  return out;
}

export function withSecondHotelSource(first: BookingHotelSupplier, second: BookingHotelSupplier, prefix = "ratehawk."): BookingHotelSupplier {
  const own = (id: string) => id.startsWith(prefix);
  return {
    ...first,
    name: first.name,
    async search(q) {
      const [a, b] = await Promise.allSettled([first.search(q), second.search(q)]);
      if (b.status === "rejected") console.warn(`[hotels] ${second.name} didn't answer`, b.reason instanceof Error ? b.reason.message.slice(0, 120) : "");
      if (a.status === "rejected") {
        if (b.status === "fulfilled" && !(a.reason instanceof AppError && a.reason.code === "VALIDATION")) return b.value;
        throw a.reason;
      }
      return b.status === "fulfilled" ? mergeHotelOffers(a.value, b.value) : a.value;
    },
    price(id) { return own(id) ? second.price(id) : first.price(id); },
    ...(first.rooms || second.rooms ? {
      async rooms(id: string) {
        const s = own(id) ? second : first;
        return s.rooms ? s.rooms(id) : [await s.price(id)];
      },
    } : {}),
  };
}
