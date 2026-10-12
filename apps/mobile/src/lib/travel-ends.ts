import type { QueryClient } from '@tanstack/react-query';
import type { BookingRequestView, OrderDraft } from '@mada/shared';

/*
 * The day a booking brings the travellers home, for "6 months left after you're back". The order preview doesn't
 * carry dates, so it's read from what the phone already has: the flight offer the traveller picked (still in the
 * search results' cache), or the fare in the agent's quote. Null when it isn't known; the check then counts from today.
 */

/** A leg as Ask shows it ({ date }) or as a supplier offer has it ({ departLocal, arriveLocal }). */
type Leg = { date?: string; arriveLocal?: string; departLocal?: string };
type Offer = { id?: unknown; out?: Leg | Leg[] | null; back?: Leg | Leg[] | null };

const legsOf = (x: Leg | Leg[] | null | undefined): Leg[] => (Array.isArray(x) ? x : x ? [x] : []);
function lastDay(legs: Leg[]): string | null {
  const days = legs.map((l) => (l.arriveLocal ?? l.departLocal ?? l.date ?? '').slice(0, 10)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d));
  return days.sort().at(-1) ?? null;
}

/** Find a flight offer by id anywhere in the cached query data (search results, a plan). */
function findOffer(data: unknown, id: string, depth = 0): Offer | null {
  if (!data || typeof data !== 'object' || depth > 6) return null;
  if (Array.isArray(data)) {
    for (const x of data) { const hit = findOffer(x, id, depth + 1); if (hit) return hit; }
    return null;
  }
  const o = data as Offer & Record<string, unknown>;
  if (o.id === id && o.out && typeof o.out === 'object') return o;
  for (const v of Object.values(o)) { const hit = findOffer(v, id, depth + 1); if (hit) return hit; }
  return null;
}

const found = new Map<string, string | null>();

export function travelEnds(qc: QueryClient, draft: OrderDraft | null | undefined, request?: BookingRequestView | null): string | null {
  if (!draft) return null;
  if (draft.kind === 'trip') {
    // An offer's dates never change: once found, remembered (the order sheet re-renders every second for its clock).
    if (found.has(draft.flightOfferId)) return found.get(draft.flightOfferId)!;
    for (const q of qc.getQueryCache().getAll()) {
      if (q.queryKey[0] !== 'booking') continue;
      const offer = findOffer(q.state.data, draft.flightOfferId);
      if (offer) { const day = lastDay([...legsOf(offer.out), ...legsOf(offer.back)]); found.set(draft.flightOfferId, day); return day; }
    }
    return null;
  }
  if (draft.kind === 'quote' && request?.quote?.flight) {
    const options = request.quote.flight.options;
    const fare = options.find((o) => o.id === draft.optionId) ?? options[0];
    const days = (fare?.legs ?? []).map((l) => l.arrDate ?? l.date).sort();
    return days.at(-1) ?? null;
  }
  return null;
}
