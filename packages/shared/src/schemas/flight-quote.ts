import { z } from 'zod';
import { AirportCode, CarrierCode, FlightNumber, Id, IsoDay, Money } from './common';
import { Cabin } from './trips';

/*
 * Flights by request (the beta): the traveller says where and when, a person at Mada books it in Mada's own system
 * and sends fare options from the desk, the traveller pays in the app, and the desk records the PNR and ticket
 * numbers. These are the shapes of the request's extra answers, the fare options in a quote, and the contact number
 * an account without a verified phone gives at payment.
 */

/** How the app finds flights: live search (a GDS adapter answers) or a request to the desk. GET /config says which. */
export const FlightsMode = z.enum(['request', 'live']);
export type FlightsMode = z.infer<typeof FlightsMode>;

/** Bags the traveller expects to bring, each. */
export const BagsWanted = z.enum(['cabin', 'one', 'two']);
export type BagsWanted = z.infer<typeof BagsWanted>;

/** Things a traveller can ask for on a flight request, as chips. Free text goes in the note. */
export const FLIGHT_PREFS = ['direct', 'morning', 'evening', 'saudia', 'together', 'aisle'] as const;
export const FlightPref = z.enum(FLIGHT_PREFS);
export type FlightPref = z.infer<typeof FlightPref>;

const Hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM');

/** One flight in a fare option, as the airline shows it. */
export const FareLeg = z.object({
  direction: z.enum(['out', 'back']),
  carrier: CarrierCode,
  flightNumber: FlightNumber,
  from: AirportCode,
  to: AirportCode,
  date: IsoDay,
  dep: Hhmm,
  arr: Hhmm,
  /** When it lands on a later day. */
  arrDate: IsoDay.nullable(),
  durationMin: z.number().int().positive().max(2400).nullable(),
});
export type FareLeg = z.infer<typeof FareLeg>;

/** What one person pays for this fare. */
export const FarePrice = z.object({
  personId: Id.nullable(),
  name: z.string().max(80),
  type: z.enum(['adult', 'child', 'infant']),
  amount: Money,
});
export type FarePrice = z.infer<typeof FarePrice>;

/** One fare the agent found and is holding: the flights, a price per person, bags and the rules. */
export const FareOption = z.object({
  id: z.string().min(1).max(40),
  airline: z.string().min(1).max(60),
  carrier: CarrierCode,
  cabin: Cabin,
  legs: z.array(FareLeg).min(1).max(8),
  prices: z.array(FarePrice).min(1).max(12),
  total: Money,
  /** "23 kg checked and 7 kg in the cabin, each" */
  baggage: z.string().min(1).max(120),
  changeRule: z.string().min(1).max(160),
  refundRule: z.string().min(1).max(160),
  refundable: z.boolean(),
  /** The agent's own line about this one ("The quickest, and you sit together"). */
  note: z.string().max(200).nullable(),
});
export type FareOption = z.infer<typeof FareOption>;

/** The fare options in a quote for a flight request. */
export const FlightQuote = z.object({
  options: z.array(FareOption).min(1).max(4),
});
export type FlightQuote = z.infer<typeof FlightQuote>;

/** The extra answers on a flight request (all optional, so older apps still send requests). */
export const FlightRequestExtras = z.object({
  /** ± days the traveller can move: 0 exact. */
  flexDays: z.number().int().min(0).max(7).optional(),
  bags: BagsWanted.optional(),
  prefs: z.array(FlightPref).max(FLIGHT_PREFS.length).optional(),
});
export type FlightRequestExtras = z.infer<typeof FlightRequestExtras>;

/**
 * A contact number typed at payment by an account without a verified phone (APP_BOOKING_REQUIRES_PHONE=no).
 * Saudi (05…, 5…, +9665…) or international (+ and 8 to 15 digits). Never treated as verified.
 */
export function normalizeContactPhone(raw: string): string | null {
  const s = raw.replace(/[\s().-]/g, '');
  if (/^05\d{8}$/.test(s)) return `+966${s.slice(1)}`;
  if (/^5\d{8}$/.test(s)) return `+966${s}`;
  if (/^009665\d{8}$/.test(s)) return `+${s.slice(2)}`;
  if (/^\+9665\d{8}$/.test(s)) return s;
  if (/^\+966/.test(s)) return null; // a Saudi number that isn't a mobile
  if (/^00[1-9]\d{7,14}$/.test(s)) return `+${s.slice(2)}`;
  if (/^\+[1-9]\d{7,14}$/.test(s)) return s;
  return null;
}
export const ContactPhone = z.string().trim().min(6).max(24).refine((v) => normalizeContactPhone(v) !== null, { message: 'Expected a phone number' });

/** Total of a fare option in halalas, from its per-person prices. */
export const fareTotal = (o: Pick<FareOption, 'prices'>) => o.prices.reduce((a, p) => a + p.amount.amount, 0);

/** A file in a conversation (a photo or PDF the agent sent), with a short-lived signed link. */
export const ThreadAttachment = z.object({
  id: z.string().min(1).max(64),
  name: z.string().max(200),
  mime: z.string().max(100),
  size: z.number().int().nonnegative(),
  /** Opens without a sign-in header; ends after a few minutes. Null when the file can't be served. */
  url: z.string().nullable(),
});
export type ThreadAttachment = z.infer<typeof ThreadAttachment>;
