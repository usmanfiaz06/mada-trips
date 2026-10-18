/*
 * Where a car right now goes from and to, read from what was typed ("I just landed at Istanbul airport, I need a car
 * right now to Taksim", «وصلت مطار إسطنبول أبغى سيارة الحين لتقسيم»), and how far that is and what it costs. The app
 * fills the ride's city, meeting point and destination from it, so nothing said is asked again; the Core API and the
 * app's mock price the ride from the same table. Pure, no I/O.
 */
import { normalizeArabic } from './ask-arabic';
import { travelEstimate } from './directions';
import { LANDMARKS } from './landmarks';
import { AIRPORT_GEO } from './positions';

/** The airport a ride from "the airport" leaves from, by ride city. */
const CITY_AIRPORT: Readonly<Record<string, string>> = {
  Riyadh: 'RUH', Jeddah: 'JED', Makkah: 'JED', Madinah: 'MED', Dammam: 'DMM', Khobar: 'DMM', AlUla: 'ULH', Dubai: 'DXB', Istanbul: 'IST', Baku: 'GYD',
  Cairo: 'CAI', London: 'LHR', Paris: 'CDG', Tbilisi: 'TBS',
};
const AIRPORT_NAME: Readonly<Record<string, [string, string]>> = {
  RUH: ['Riyadh Airport', 'مطار الرياض'], JED: ['Jeddah Airport', 'مطار جدة'], MED: ['Madinah Airport', 'مطار المدينة'], DMM: ['Dammam Airport', 'مطار الدمام'],
  ULH: ['AlUla Airport', 'مطار العلا'], DXB: ['Dubai Airport', 'مطار دبي'], IST: ['Istanbul Airport', 'مطار إسطنبول'], GYD: ['Baku Airport', 'مطار باكو'],
  CAI: ['Cairo Airport', 'مطار القاهرة'], LHR: ['Heathrow Airport', 'مطار هيثرو'], CDG: ['Charles de Gaulle Airport', 'مطار شارل ديغول'], TBS: ['Tbilisi Airport', 'مطار تبليسي'],
};
/** Ride cities by the words people type, English and Arabic (normalized). */
const CITY_WORDS: readonly [RegExp, RegExp, string][] = [
  [/\briyadh\b/, /الرياض/, 'Riyadh'], [/\bjeddah\b|\bjiddah\b/, /جده/, 'Jeddah'], [/\bmakkah\b|\bmecca\b/, /مكه/, 'Makkah'], [/\bmadinah\b|\bmedina\b/, /المدينه/, 'Madinah'],
  [/\bdammam\b/, /الدمام/, 'Dammam'], [/\bkhobar\b/, /الخبر/, 'Khobar'], [/\bal[- ]?ula\b/, /العلا/, 'AlUla'], [/\bdubai\b/, /دبي/, 'Dubai'],
  [/\bistanbul\b/, /اسطنبول|اسطمبول/, 'Istanbul'], [/\bbaku\b/, /باكو/, 'Baku'], [/\bcairo\b/, /القاهره/, 'Cairo'], [/\blondon\b|heathrow/, /لندن|هيثرو/, 'London'],
  [/\bparis\b/, /باريس/, 'Paris'], [/\btbilisi\b/, /تبليسي/, 'Tbilisi'],
];
/** A landmark's city key (landmarks.ts) as a ride city. */
const LANDMARK_CITY: Readonly<Record<string, string>> = {
  dubai: 'Dubai', makkah: 'Makkah', madinah: 'Madinah', istanbul: 'Istanbul', london: 'London', riyadh: 'Riyadh', jeddah: 'Jeddah', alula: 'AlUla', cairo: 'Cairo',
};

/** What a ride costs per road kilometre (riyals), on top of half the city's minimum fare; the minimum fare is never undercut. */
const PER_KM: Readonly<Record<string, number>> = {
  Riyadh: 2.2, Jeddah: 2.2, Makkah: 2.4, Madinah: 2.2, Dammam: 2, Khobar: 2, AlUla: 2.6, Dubai: 3, Istanbul: 3.5, Baku: 1.2, Cairo: 0.8, London: 9, Paris: 8, Tbilisi: 1,
};

export type RidePlace = { name: string; nameAr: string | null; lat: number; lng: number; kind: 'airport' | 'landmark' };
export type RideSaid = {
  /** The ride city said (or the city of the place said). */
  city: string | null;
  /** Where to meet: the airport when it says "landed", "at the airport", «المطار». */
  from: RidePlace | null;
  /** Where to: a place Mada knows (with a point), or just the words after "to" (no point, so no distance). */
  to: RidePlace | null;
  toText: string | null;
};

const AIRPORT_WORDS = /\bairport\b|\blanded\b|\barrivals?\b|المطار|مطار|وصلت|نزلت/;

function airportOf(city: string | null): RidePlace | null {
  const code = city ? CITY_AIRPORT[city] : null;
  const geo = code ? AIRPORT_GEO[code] : null;
  if (!code || !geo) return null;
  const [name, nameAr] = AIRPORT_NAME[code] ?? [`${city} Airport`, null];
  return { name, nameAr, lat: geo[0], lng: geo[1], kind: 'airport' };
}

/** The ride city named in the words, English or Arabic. */
export function rideCityIn(text: string): string | null {
  const s = text.toLowerCase();
  const ar = normalizeArabic(text);
  return CITY_WORDS.find(([en, a]) => en.test(s) || a.test(ar))?.[2] ?? null;
}

/** A landmark named in the words (the destination part when there is one). */
function landmarkIn(part: string, city: string | null): RidePlace | null {
  const s = part.toLowerCase();
  const ar = normalizeArabic(part);
  const hit = LANDMARKS.find((l) => (!city || LANDMARK_CITY[l.city] === city) && l.id !== 'dxb' && (l.en.test(s) || l.ar.test(ar)));
  return hit ? { name: hit.name, nameAr: hit.nameAr, lat: hit.lat, lng: hit.lng, kind: 'landmark' } : null;
}

/** Where from and where to, as said. */
export function rideSaid(text: string): RideSaid {
  const raw = text.trim();
  // The part after "to" / «إلى» / «لين» is where they are going; what comes before it is where they are.
  const toMatch = raw.match(/\b(?:to|towards)\s+(?:the\s+)?([^,.!?]+?)\s*(?:[,.!?]|$)/i) ?? raw.match(/(?:^|\s)(?:الى|إلى|لين)\s+([^،,.!؟]{2,40})/);
  const afterTo = toMatch?.[1]?.trim() ?? null;
  const before = toMatch ? raw.slice(0, toMatch.index) : raw;
  const isAirport = (x: string) => AIRPORT_WORDS.test(x.toLowerCase()) || AIRPORT_WORDS.test(normalizeArabic(x));
  let city = rideCityIn(before) ?? rideCityIn(raw);
  // "to the airport": the airport is where they go, and a place before it is where they are.
  if (afterTo && isAirport(afterTo)) {
    if (!city) city = rideCityIn(afterTo);
    return { city, from: landmarkIn(raw, city), to: airportOf(city), toText: airportOf(city)?.name ?? null };
  }
  // A place Mada knows: after "to" first, else anywhere but where they are (Arabic glues «لـ» on: «لتقسيم»).
  const to = (afterTo ? landmarkIn(afterTo, city) : null) ?? landmarkIn(raw, city);
  if (to && !city) city = LANDMARK_CITY[LANDMARKS.find((l) => l.name === to.name)?.city ?? ''] ?? null;
  const from = isAirport(before) || (!toMatch && isAirport(raw)) ? airportOf(city) : null;
  // The words after "to" that name no place we know ("to my cousin's house") stay as typed; a city alone isn't a destination.
  const loose = afterTo && !rideCityIn(afterTo) && !/\b(?:now|right now|asap)\b|الحين/.test(afterTo) && afterTo.length <= 60 ? afterTo.replace(/\s+(?:right now|now|please|asap)$/i, '') : null;
  return { city, from, to, toText: to ? to.name : loose };
}

/** A place typed in a ride field ("Istanbul Airport", "Taksim"), as a point, in that city. */
export function ridePlaceIn(text: string | null | undefined, city: string | null): RidePlace | null {
  if (!text?.trim()) return null;
  if (AIRPORT_WORDS.test(text.toLowerCase()) || AIRPORT_WORDS.test(normalizeArabic(text))) return airportOf(city ?? rideCityIn(text));
  return landmarkIn(text, city);
}

export type RideEstimate = { km: number; min: number; fareSar: number };

/** How far by road, how long, and the fixed fare, for two points in a ride city. */
export function rideEstimate(city: string, from: RidePlace, to: RidePlace, minimumSar: number): RideEstimate {
  const e = travelEstimate({ lat: from.lat, lon: from.lng }, { lat: to.lat, lon: to.lng });
  const road = Math.max(1, Math.round(e.km * 1.35));
  const fare = Math.max(minimumSar, Math.round(minimumSar / 2 + road * (PER_KM[city] ?? 2.2)));
  return { km: road, min: e.driveMin, fareSar: fare };
}

/** The ride's estimate from what's in its fields (the meeting point and where to), or null when either isn't a known place. */
export function rideRouteEstimate(city: string, meetingPoint: string | null | undefined, destination: string | null | undefined, minimumSar: number): RideEstimate | null {
  const from = ridePlaceIn(meetingPoint, city);
  const to = ridePlaceIn(destination, city);
  return from && to ? rideEstimate(city, from, to, minimumSar) : null;
}
