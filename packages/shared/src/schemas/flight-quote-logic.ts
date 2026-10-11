import { addDays, rangeLabel } from '../dates';
import { t, tn, type CopyKey } from '../copy';
import { sarToHalalas } from '../money';
import { AIRPORT_NAMES, CATALOGUE_FLIGHTS, CARRIERS, DESTINATIONS } from './booking-data';
import { ageOn, personName } from './booking-logic';
import type { FlightOption } from './booking';
import type { FareLeg, FareOption, FarePrice } from './flight-quote';
import type { Person } from './people';
import type { Cabin } from './trips';

/*
 * Flights by request, the pure parts the server, the mock API and the desk share: who pays which fare type, the
 * shape the booking engine keeps (a FlightOption) for fares an agent quoted, and the mock desk's fares.
 */

/** Adult 12+, child 2–11, infant under 2 on the day of travel (IATA). Unknown birthdays are adults. */
export function fareType(p: Pick<Person, 'dateOfBirth'>, travelDay: string): FarePrice['type'] {
  const age = ageOn(p, travelDay);
  if (age === null) return 'adult';
  return age < 2 ? 'infant' : age < 12 ? 'child' : 'adult';
}

const money = (amount: number) => ({ amount, currency: 'SAR' as const });

/** "13:55" + minutes. */
function addMinutes(hhmm: string, minutes: number): { time: string; days: number } {
  const [h, m] = hhmm.split(':').map(Number) as [number, number];
  const total = h * 60 + m + minutes;
  const days = Math.floor(total / 1440);
  const r = ((total % 1440) + 1440) % 1440;
  return { time: `${String(Math.floor(r / 60)).padStart(2, '0')}:${String(r % 60).padStart(2, '0')}`, days };
}

/** Minutes between two wall-clock times (ignores zones: a leg's duration is what the airline prints). */
export function legMinutes(l: Pick<FareLeg, 'date' | 'dep' | 'arr' | 'arrDate' | 'durationMin'>): number {
  if (l.durationMin) return l.durationMin;
  const a = Date.parse(`${l.date}T${l.dep}:00Z`);
  const b = Date.parse(`${l.arrDate ?? l.date}T${l.arr}:00Z`);
  const d = Math.round((b - a) / 60_000);
  return d > 0 ? d : d + 1440;
}

/**
 * The booking engine keeps a FlightOption on an order (the waiting screen and the trip read it). For a fare an
 * agent quoted: the first and last legs each way, stops counted from the legs in between.
 */
export function fareToFlightOption(o: FareOption, expiresAt: string, quoteId: string): FlightOption {
  const out = o.legs.filter((l) => l.direction === 'out');
  const back = o.legs.filter((l) => l.direction === 'back');
  const way = (legs: FareLeg[]) => {
    const a = legs[0]!, z = legs[legs.length - 1]!;
    const start = Date.parse(`${a.date}T${a.dep}:00Z`), end = Date.parse(`${z.arrDate ?? z.date}T${z.arr}:00Z`);
    const span = legs.length === 1 ? legMinutes(a) : Math.max(1, Math.round((end - start) / 60_000));
    return { flightNumber: a.flightNumber, from: a.from, to: z.to, date: a.date, dep: a.dep, arr: z.arr, durationMin: span };
  };
  const adults = o.prices.filter((p) => p.type !== 'infant');
  const infants = o.prices.filter((p) => p.type === 'infant');
  const stops = Math.max(0, out.length - 1);
  return {
    id: quoteId, label: 'best', carrier: o.carrier, airline: o.airline, brand: CARRIERS[o.carrier]?.brand ?? '#1e352d',
    out: way(out.length ? out : o.legs), back: back.length ? way(back) : null, stop: stops ? out.slice(0, -1).map((l) => l.to).join(', ') : null,
    reason: o.note ?? '', bags: o.baggage, changeRule: o.changeRule, refundRule: o.refundRule, refundable: o.refundable, cabin: o.cabin,
    adults: adults.length, infants: infants.length,
    pricePerPerson: money(adults.length ? Math.round(adults.reduce((a, p) => a + p.amount.amount, 0) / adults.length) : 0),
    infantPrice: money(infants[0]?.amount.amount ?? 0), total: money(o.prices.reduce((a, p) => a + p.amount.amount, 0)), expiresAt,
  };
}

export type MockFareInput = {
  destination: string | null; destinationName?: string | null; from: string | null; depart: string; return: string | null; cabin: Cabin | null;
  travellers: Pick<Person, 'id' | 'firstName' | 'isSelf' | 'dateOfBirth'>[]; selfName?: string; bags?: 'cabin' | 'one' | 'two' | null;
};

const CABIN_FACTOR: Record<Cabin, number> = { economy: 1, premium: 1.6, business: 3.2, first: 4.5 };

/**
 * The mock desk's fares for a flight request (mock mode only): two options from the catalogue, held for 24 hours,
 * priced per person by fare type. Real fares come from the agent's quote builder on the desk.
 */
export function mockFareOptions(input: MockFareInput): FareOption[] {
  const dest = input.destination ? DESTINATIONS[input.destination] ?? null : null;
  const from = input.from ?? 'RUH';
  const to = dest?.code ?? 'IST';
  const list = (dest && CATALOGUE_FLIGHTS[dest.key]) || CATALOGUE_FLIGHTS.istanbul!;
  const cabin: Cabin = input.cabin ?? 'economy';
  return list.slice(0, 2).map((c, i) => {
    const landing = addMinutes(c.dep, c.durationMin);
    const legs: FareLeg[] = [{ direction: 'out', carrier: c.carrier, flightNumber: c.number, from, to: c.to ?? to, date: input.depart, dep: c.dep, arr: landing.time, arrDate: landing.days ? addDays(input.depart, landing.days) : null, durationMin: c.durationMin }];
    if (input.return) {
      const dep = i === 0 ? '15:10' : '12:30';
      const back = addMinutes(dep, c.durationMin);
      legs.push({ direction: 'back', carrier: c.carrier, flightNumber: c.backNumber, from: c.to ?? to, to: from, date: input.return, dep, arr: back.time, arrDate: back.days ? addDays(input.return, back.days) : null, durationMin: c.durationMin });
    }
    const pp = sarToHalalas(Math.round(c.ppSar * CABIN_FACTOR[cabin] * (input.return ? 1 : 0.6)));
    const prices: FarePrice[] = input.travellers.map((p) => {
      const type = fareType(p, input.depart);
      return { personId: p.id, name: personName(p, input.selfName), type, amount: money(type === 'infant' ? Math.round(pp * 0.1 / 100) * 100 : type === 'child' ? Math.round(pp * 0.75 / 100) * 100 : pp) };
    });
    return {
      id: `opt${i + 1}`, airline: CARRIERS[c.carrier]?.name ?? c.carrier, carrier: c.carrier, cabin, legs, prices, total: money(prices.reduce((a, p) => a + p.amount.amount, 0)),
      baggage: c.bags, changeRule: c.change, refundRule: c.refund, refundable: !/^Not refundable/.test(c.refund), note: c.reason,
    };
  });
}

/** Stops on one way of a fare: the legs that way, less one. */
export const fareStops = (o: Pick<FareOption, 'legs'>, direction: 'out' | 'back') => Math.max(0, o.legs.filter((l) => l.direction === direction).length - 1);

/* ───────────── a flight request's own words (server and mock alike, in the reader's language) ───────────── */

export type FlightRequestSearch = {
  destination: string | null; destinationName: string | null; from: string | null; depart: string | null; return: string | null;
  cabin: Cabin | null; carrier: string | null; flexDays?: number; bags?: 'cabin' | 'one' | 'two'; prefs?: string[];
};

export const flightRequestCity = (s: Pick<FlightRequestSearch, 'destination' | 'destinationName'>) => (s.destination && DESTINATIONS[s.destination]?.name) || s.destinationName || '';

/** "Flights to Istanbul · 10–14 Mar", or "· 9 Mar, one way". */
export function flightRequestTitle(s: FlightRequestSearch): string {
  const dates = s.depart ? (s.return ? rangeLabel(s.depart, s.return) : t('beta.fr.oneWay', { date: rangeLabel(s.depart) })) : t('request.datesLater');
  const city = flightRequestCity(s);
  return s.carrier ? t('request.title.airlineByHand', { airline: s.carrier === 'SV' ? 'Saudia' : s.carrier, city, dates }) : t('request.title.flightsTo', { city, dates });
}

/** "Riyadh to Istanbul · 3 travellers · Economy · ±3 days · One checked bag · Direct only". */
export function flightRequestSummary(s: FlightRequestSearch, travellers: number): string {
  const parts = [t('beta.fr.route', { from: AIRPORT_NAMES[s.from ?? 'RUH'] ?? s.from ?? 'RUH', to: flightRequestCity(s) || s.destination || '' })];
  if (travellers) parts.push(tn('beta.fr.travellers', travellers));
  if (s.cabin) parts.push(t(`cal.cabin.${s.cabin}` as CopyKey));
  if (s.flexDays !== undefined) parts.push(s.flexDays ? t('beta.fr.sum.flex', { count: s.flexDays }) : t('beta.fr.sum.exact'));
  if (s.bags) parts.push(t(`beta.fr.bags.${s.bags}` as CopyKey));
  for (const p of s.prefs ?? []) parts.push(t(`beta.fr.pref.${p}` as CopyKey));
  return parts.join(' · ');
}
