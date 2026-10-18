import { z } from 'zod';
import { Id, IsoDateTime, Money } from './common';
import { rideRouteEstimate } from './ride-route';

/*
 * The now path (critique 4 and 10): a car right now, urgent help at any hour, and a disruption screen that tells
 * the truth. Pure, so the Core API, the app's mock and the tests read the same clock.
 *
 *   POST /rides { when, city, meetingPoint, tripId?, clientKey } → 201 { ride }
 *   GET  /rides/{id}                                              → { ride }   (state worked out when read)
 *   POST /rides/{id}/cancel                                       → { ride }
 *
 * A ride is honest at every step: requesting → a driver with name, car, plate, meeting point and price → here.
 * When no car can be found it says so, and the next step is Mada finding one by hand (an urgent call-back).
 */

/* ───────────── a car right now ───────────── */

export const RideWhen = z.enum(['now', 'in15']);
export type RideWhen = z.infer<typeof RideWhen>;

export const RideStatus = z.enum(['requesting', 'assigned', 'arrived', 'none', 'cancelled']);
export type RideStatus = z.infer<typeof RideStatus>;

export const RideDriver = z.object({
  name: z.string(),
  /** E.164, for call and message. */
  phone: z.string(),
  /** "Toyota Camry, white" */
  car: z.string(),
  plate: z.string(),
});
export type RideDriver = z.infer<typeof RideDriver>;

export const Ride = z.object({
  id: Id,
  when: RideWhen,
  status: RideStatus,
  city: z.string(),
  meetingPoint: z.string(),
  /** Where to, as typed or filled from the words ("Taksim"); null when not said. */
  destination: z.string().nullable().optional(),
  /** By road, and minutes, when both ends are places Mada knows. */
  km: z.number().nullable().optional(),
  minutes: z.number().nullable().optional(),
  requestedAt: IsoDateTime,
  /** When the car is at the meeting point (null while requesting, or when none was found). */
  pickupAt: IsoDateTime.nullable(),
  driver: RideDriver.nullable(),
  /** The supplier's fixed price, paid to the driver. */
  price: Money.nullable(),
  /** `mock` in demo and staging: no real car comes. `none`: no supplier connected, Mada finds one by hand. */
  supplier: z.enum(['mock', 'none']),
  cancellable: z.boolean(),
  tripId: Id.nullable(),
});
export type Ride = z.infer<typeof Ride>;

export const RequestRideBody = z.object({
  when: RideWhen,
  city: z.string().trim().min(2).max(60),
  meetingPoint: z.string().trim().min(2).max(160),
  destination: z.string().trim().min(2).max(160).nullable().optional(),
  tripId: Id.nullable().optional(),
  clientKey: z.string().min(8).max(64),
});
export type RequestRideBody = z.infer<typeof RequestRideBody>;

export const RideResponse = z.object({ ride: Ride });
export type RideResponse = z.infer<typeof RideResponse>;

export const RIDE_ROUTES = {
  rides: '/rides',
  ride: (id: string) => `/rides/${id}`,
  cancel: (id: string) => `/rides/${id}/cancel`,
} as const;

/** How long the mock supplier takes to find a driver, and how far away the driver is once found. */
export const RIDE_MATCH_MS = 6000;
export const RIDE_NOW_MIN = 8;
export const RIDE_LATER_MIN = 15;

/** Cities the mock supplier has cars in, with its fixed fare in riyals. Anywhere else: no car free. */
export const RIDE_CITIES: Readonly<Record<string, number>> = {
  Riyadh: 38, Jeddah: 34, Makkah: 42, Madinah: 32, Dammam: 30, Khobar: 30, AlUla: 65, Dubai: 48, Istanbul: 44, Baku: 30, Cairo: 22, London: 95, Paris: 90, Tbilisi: 25,
};

const DRIVERS: readonly RideDriver[] = [
  { name: 'Abdullah', phone: '+966551204417', car: 'Toyota Camry, white', plate: '4821 BHD' },
  { name: 'Mohammed', phone: '+966559830021', car: 'Hyundai Sonata, silver', plate: '7314 KSR' },
  { name: 'Saad', phone: '+966554471902', car: 'GMC Yukon, black', plate: '2290 RNA' },
  { name: 'Khalid', phone: '+966558112370', car: 'Lexus ES, grey', plate: '5506 TLA' },
];

/** The stored side of a ride: what was asked and what the supplier said. Status is worked out when read. */
export type StoredRide = {
  id: string; when: RideWhen; city: string; meetingPoint: string; destination?: string | null; tripId: string | null;
  requestedAt: string; cancelledAt: string | null; supplier: 'mock' | 'none';
  match: { driver: RideDriver; priceSar: number } | null;
};

/** A city the mock supplier serves, by name in English or Arabic ("riyadh", "الرياض"); null when it has no cars there. */
export function rideCity(name: string): string | null {
  const s = name.trim().toLowerCase().replace(/^al[\s-]?/, 'al');
  const ar: Record<string, string> = { 'الرياض': 'Riyadh', 'جدة': 'Jeddah', 'مكة': 'Makkah', 'المدينة': 'Madinah', 'الدمام': 'Dammam', 'الخبر': 'Khobar', 'العلا': 'AlUla', 'دبي': 'Dubai', 'إسطنبول': 'Istanbul', 'اسطنبول': 'Istanbul' };
  for (const [k, v] of Object.entries(ar)) if (name.includes(k)) return v;
  return Object.keys(RIDE_CITIES).find((c) => c.toLowerCase() === s || s.startsWith(c.toLowerCase())) ?? null;
}

/**
 * The mock supplier: a driver from the ride id (the same id, the same driver), or null where it has no cars. The fare
 * is for this ride when both ends are places Mada knows (the meeting point and where to), else the city's minimum.
 */
export function mockRideMatch(id: string, city: string, route?: { meetingPoint?: string | null; destination?: string | null }): StoredRide['match'] {
  const served = rideCity(city);
  if (!served) return null;
  let h = 0;
  for (const ch of id) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  const est = route ? rideRouteEstimate(served, route.meetingPoint, route.destination, RIDE_CITIES[served]!) : null;
  return { driver: DRIVERS[h % DRIVERS.length]!, priceSar: est?.fareSar ?? RIDE_CITIES[served]! };
}

/** Where a ride stands at `now`: requesting for a few seconds, then a driver (or none), then the car is here. */
export function rideView(s: StoredRide, now: number): Ride {
  const asked = Date.parse(s.requestedAt);
  const served = rideCity(s.city);
  const est = served && s.destination ? rideRouteEstimate(served, s.meetingPoint, s.destination, RIDE_CITIES[served]!) : null;
  const base = { id: s.id, when: s.when, city: s.city, meetingPoint: s.meetingPoint, destination: s.destination ?? null, km: est?.km ?? null, minutes: est?.min ?? null, requestedAt: s.requestedAt, supplier: s.supplier, tripId: s.tripId };
  const pickupMs = asked + (s.when === 'now' ? RIDE_NOW_MIN : RIDE_LATER_MIN) * 60_000;
  const found = s.supplier === 'mock' && !!s.match && now - asked >= RIDE_MATCH_MS;
  const price = found ? { amount: s.match!.priceSar * 100, currency: 'SAR' as const } : null;
  if (s.cancelledAt) return { ...base, status: 'cancelled', pickupAt: null, driver: found ? s.match!.driver : null, price, cancellable: false };
  if (s.supplier === 'none') return { ...base, status: 'none', pickupAt: null, driver: null, price: null, cancellable: false };
  if (now - asked < RIDE_MATCH_MS) return { ...base, status: 'requesting', pickupAt: null, driver: null, price: null, cancellable: true };
  if (!s.match) return { ...base, status: 'none', pickupAt: null, driver: null, price: null, cancellable: false };
  return { ...base, status: now >= pickupMs ? 'arrived' : 'assigned', pickupAt: new Date(pickupMs).toISOString(), driver: s.match.driver, price, cancellable: true };
}

/* ───────────── what was asked ───────────── */

/** "Now", "right now", "asap", "الحين": the traveller wants it this minute, so nobody offers tomorrow. */
export function wantsNow(text: string): boolean {
  const s = text.toLowerCase();
  return /\b(now|right away|asap|immediately|straight away|this minute|in 15|in fifteen)\b/.test(s) || /الحين|الآن|الان|حالا|حالًا|فورا|فورًا|بسرعة|ضروري|عاجل/.test(text);
}

/** A car right now (a taxi, a ride, a driver), as opposed to a car hired by the day. */
export function carNowAsk(kind: string, text: string): boolean {
  const s = text.toLowerCase();
  if (/\b(rent|rental|hire|self[- ]drive)\b|استئجار|تأجير|إيجار/.test(text.toLowerCase())) return false;
  const car = kind === 'car' || /\b(taxi|cab|ride|uber|careem|driver|pick me up|lift)\b/.test(s) || /تاكسي|سيارة|توصيلة|كريم|أوبر|سواق|يوصلني/.test(text);
  return car && wantsNow(text);
}

/* ───────────── urgent at any hour ───────────── */

/**
 * A trip that is happening now: mid-trip, or the first flight leaves within 24 hours. `firstDepartUtc` is the first
 * flight's departure as an instant; without one, a trip starting today or tomorrow counts.
 */
export function tripIsNow(trip: { startDate: string; endDate: string; firstDepartUtc?: string | null }, now: number): boolean {
  const today = new Date(now).toISOString().slice(0, 10);
  if (trip.startDate <= today && today <= trip.endDate) return true;
  if (trip.firstDepartUtc) {
    const left = Date.parse(trip.firstDepartUtc) - now;
    return left >= -6 * 3_600_000 && left <= 24 * 3_600_000;
  }
  const tomorrow = new Date(now + 86_400_000).toISOString().slice(0, 10);
  return trip.startDate >= today && trip.startDate <= tomorrow;
}

/** What can go wrong on a trip, as the disruption card offers it. `emergency` is the only one that shows 997. */
export const DISRUPTION_PROBLEMS = ['delayed', 'cancelled', 'connection', 'hotel', 'docs', 'emergency', 'other'] as const;
export type DisruptionProblem = (typeof DISRUPTION_PROBLEMS)[number];
export const problemKey = (p: DisruptionProblem) => `dx-${p}`;
export function problemOf(choice: string): DisruptionProblem | null {
  const p = choice.startsWith('dx-') ? choice.slice(3) : '';
  return (DISRUPTION_PROBLEMS as readonly string[]).includes(p) ? (p as DisruptionProblem) : null;
}

/** Mada calls back within this many minutes, any hour. The desk sees the call-back at the top of its inbox. */
export const CALLBACK_MINUTES = 10;
export const callbackBy = (now: number) => new Date(now + CALLBACK_MINUTES * 60_000).toISOString();

/** A problem named in what was typed ("my flight is cancelled", "lost my passport"), so the card isn't asked again. */
export function problemIn(text: string): DisruptionProblem | null {
  const s = text.toLowerCase();
  if (/ambulance|hospital|medical|doctor|injur|hurt|bleeding|collapsed|chest pain|unconscious|police|unsafe|attacked|robbed|إسعاف|مستشفى|طبيب|نزيف|إصابة|مصاب|شرطة|خطر/.test(s)) return 'emergency';
  if (/missed (my |the |our )?connection|connecting flight|فاتتني الرحلة|فاتني الربط|ترانزيت/.test(s)) return 'connection';
  if (/cancell?ed|ملغية|انلغت|ألغيت/.test(s)) return 'cancelled';
  if (/delay|late flight|متأخرة|تأخرت|تأخير/.test(s)) return 'delayed';
  if (/hotel|room|check[- ]?in at the hotel|فندق|الغرفة|السكن/.test(s)) return 'hotel';
  if (/passport|documents?|visa|id card|جواز|الجواز|أوراق|هوية|تأشيرة/.test(s)) return 'docs';
  return null;
}

/* ───────────── the disruption screen, honestly ───────────── */

export type FlightTruth = { state: 'on_time' | 'delayed' | 'cancelled' | 'diverted' | 'landed' | 'none'; flight: string | null; delayMin: number; checkedAt: string | null };

/**
 * What is true about the trip's flights right now: the first one still to fly (or the last, once all have landed).
 * A delay under 15 minutes is on time, as airlines count it.
 */
export function flightTruth(segments: readonly { carrier: string; flightNumber: string; status: string; delayMin: number | null; statusAt: string | null }[]): FlightTruth {
  if (!segments.length) return { state: 'none', flight: null, delayMin: 0, checkedAt: null };
  const seg = segments.find((s) => s.status !== 'landed') ?? segments[segments.length - 1]!;
  const flight = /^[A-Z0-9]{2}\s?\d/.test(seg.flightNumber) ? seg.flightNumber : `${seg.carrier} ${seg.flightNumber}`;
  const delay = seg.delayMin ?? 0;
  const state: FlightTruth['state'] = seg.status === 'cancelled' ? 'cancelled' : seg.status === 'diverted' ? 'diverted' : seg.status === 'landed' ? 'landed'
    : seg.status === 'delayed' || delay >= 15 ? 'delayed' : 'on_time';
  return { state, flight, delayMin: delay, checkedAt: seg.statusAt };
}
