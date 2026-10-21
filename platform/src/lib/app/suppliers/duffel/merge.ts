import { AppError } from "../../http";
import type { BookingFlightOffer, BookingFlightSupplier } from "../booking-types";

/*
 * Two flight sources as one: TBO (or whatever the first source is) and Duffel. Both are searched at once; the same
 * flights (every leg's flight number and departure time) appear once, at the lower price; then cheapest first. Price
 * and hold go to the source the offer came from (Duffel's ids start "duffel."); everything else — the desk's TBO
 * booking and ticketing — stays the first source's. If one source fails the other answers alone; if both fail, the
 * first source's error stands (so "the desk books it" still happens as before).
 */

export const flightsKey = (o: Pick<BookingFlightOffer, "out" | "back">) =>
  [...o.out, ...o.back].map((l) => `${l.flightNumber}@${l.departLocal}`).join("|");
export const sameFlights = (a: Pick<BookingFlightOffer, "out" | "back">, b: Pick<BookingFlightOffer, "out" | "back">) => flightsKey(a) === flightsKey(b);

export function mergeFlightOffers(first: BookingFlightOffer[], second: BookingFlightOffer[]): BookingFlightOffer[] {
  const best = new Map<string, BookingFlightOffer>();
  for (const o of [...first, ...second]) {
    const k = flightsKey(o);
    const had = best.get(k);
    if (!had || o.total.amount < had.total.amount) best.set(k, o);
  }
  return [...best.values()].sort((a, b) => a.total.amount - b.total.amount);
}

export function withSecondSource<T extends BookingFlightSupplier>(first: T, second: BookingFlightSupplier, prefix = "duffel."): T {
  const own = (id: string) => id.startsWith(prefix);
  return {
    ...first,
    name: first.name,
    async search(q) {
      const [a, b] = await Promise.allSettled([first.search(q), second.search(q)]);
      if (b.status === "rejected") console.warn(`[flights] ${second.name} didn't answer`, b.reason instanceof Error ? b.reason.message.slice(0, 120) : "");
      if (a.status === "rejected") {
        if (b.status === "fulfilled" && !(a.reason instanceof AppError && a.reason.code === "VALIDATION")) return b.value;
        throw a.reason;
      }
      return b.status === "fulfilled" ? mergeFlightOffers(a.value, b.value) : a.value;
    },
    price(offerId, travellers, children) { return own(offerId) ? second.price(offerId, travellers, children) : first.price(offerId, travellers, children); },
    hold(offerId, travellers) { return own(offerId) ? second.hold(offerId, travellers) : first.hold(offerId, travellers); },
  };
}
