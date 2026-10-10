import { z } from 'zod';
import { Id, IsoDateTime, IsoDay } from './common';
import { BookingRequestView } from './booking';

/*
 * Places: every city in the world with 15,000 people or more (GeoNames), its airports (OurAirports), and a city guide
 * assembled from open sources (Wikipedia, Wikivoyage, Wikimedia Commons, Wikidata) with their attribution.
 * Licences and attribution rules: platform/src/lib/app/places/README.md.
 *
 * How much we know about a city (never shown as a word in the app):
 *  - curated: our own content and photos (Istanbul, AlUla, Riyadh, Dubai…)
 *  - guide:   an open-data guide was found for it
 *  - basic:   name, country, map and airports only
 */
export const PlaceCuration = z.enum(['curated', 'guide', 'basic']);
export type PlaceCuration = z.infer<typeof PlaceCuration>;

/** GeoNames id as a string ("611717"), or a city slug ("tbilisi") that resolves to the best-known city of that name. */
export const PlaceId = z.string().trim().min(1).max(80).regex(/^[\p{L}\p{N} '’.-]+$/u);

export const PlaceAirport = z.object({
  iata: z.string().regex(/^[A-Z0-9]{3}$/),
  name: z.string(),
  /** Straight-line distance from the city centre, rounded. */
  km: z.number().int().nonnegative(),
  size: z.enum(['large', 'medium']),
});
export type PlaceAirport = z.infer<typeof PlaceAirport>;

export const PlaceMatch = z.enum(['name', 'arabic', 'alt', 'airport', 'code']);

export const PlaceHit = z.object({
  id: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  /** State, province or emirate, when it helps tell two cities apart. */
  region: z.string().nullable(),
  country: z.string(),
  countryCode: z.string().length(2),
  population: z.number().int().nonnegative(),
  /** We sell it in the app (flights and rooms on screen). Everything else is planned by hand. */
  served: z.boolean(),
  curation: PlaceCuration,
  /** Our own photo (apps/mobile/assets/photos key), curated cities only. */
  photo: z.string().nullable(),
  /** The main airport code ("TBS"), if the city has one within reach. */
  iata: z.string().nullable(),
  /** What the search matched, when it wasn't the city's own name: "Heathrow (LHR)". */
  matched: z.object({ kind: PlaceMatch, label: z.string() }).nullable(),
  timezone: z.string(),
});
export type PlaceHit = z.infer<typeof PlaceHit>;

export const PlaceSearchQuery = z.object({
  q: z.string().trim().min(1).max(80),
  limit: z.coerce.number().int().min(1).max(8).default(8),
});
export const PlaceSearchResponse = z.object({
  query: z.string(),
  results: z.array(PlaceHit).max(8),
  /** Only when nothing matched: the closest names we know ("sd" → Sydney, San Diego). */
  suggestions: z.array(PlaceHit).max(5),
});
export type PlaceSearchResponse = z.infer<typeof PlaceSearchResponse>;

export const PlaceAttribution = z.object({
  source: z.enum(['wikipedia', 'wikivoyage', 'wikimedia', 'geonames', 'ourairports', 'wikidata', 'mada']),
  /** "From Wikivoyage, CC BY-SA" */
  text: z.string(),
  url: z.url(),
  licence: z.string(),
  licenceUrl: z.url().nullable(),
});
export type PlaceAttribution = z.infer<typeof PlaceAttribution>;

export const PlaceImage = z.object({
  url: z.url(),
  width: z.number().int().positive().nullable(),
  height: z.number().int().positive().nullable(),
  source: z.enum(['wikimedia', 'mada']),
  /** Plain text, no markup. */
  author: z.string().nullable(),
  licence: z.string().nullable(),
  licenceUrl: z.url().nullable(),
  /** The file's page (Commons), for the credit link. */
  pageUrl: z.url().nullable(),
});
export type PlaceImage = z.infer<typeof PlaceImage>;

export const GuideSectionKey = z.enum(['understand', 'getIn', 'see', 'do', 'eat', 'staySafe']);
export type GuideSectionKey = z.infer<typeof GuideSectionKey>;
export const GuideSection = z.object({
  key: GuideSectionKey,
  title: z.string(),
  /** A trimmed extract of the Wikivoyage section, word for word up to the cut. */
  text: z.string(),
  trimmed: z.boolean(),
  url: z.url(),
});
export type GuideSection = z.infer<typeof GuideSection>;

export const CityGuide = z.object({
  id: z.string(),
  name: z.string(),
  nameAr: z.string().nullable(),
  region: z.string().nullable(),
  country: z.string(),
  countryCode: z.string().length(2),
  lat: z.number(),
  lon: z.number(),
  timezone: z.string(),
  population: z.number().int().nonnegative(),
  served: z.boolean(),
  curation: PlaceCuration,
  /** Our own photo key (curated cities); wins over the Wikimedia image. */
  photo: z.string().nullable(),
  /** The key Ask and search use (booking DESTINATIONS), for cities we sell. */
  bookingKey: z.string().nullable(),
  image: PlaceImage.nullable(),
  /** Wikipedia's lead, unmodified. */
  summary: z.object({ text: z.string(), url: z.url() }).nullable(),
  sections: z.array(GuideSection),
  airports: z.array(PlaceAirport).max(4),
  currency: z.object({ code: z.string().length(3), name: z.string() }).nullable(),
  attributions: z.array(PlaceAttribution),
  /** When the open-data part was fetched; null when we haven't reached the sources yet. */
  fetchedAt: IsoDateTime.nullable(),
});
export type CityGuide = z.infer<typeof CityGuide>;
export const PlaceResponse = z.object({ place: CityGuide });
export type PlaceResponse = z.infer<typeof PlaceResponse>;

/** "Plan it with Mada" for any city: the team puts it together by hand. */
export const PlanPlaceRequest = z.object({
  depart: IsoDay.optional(),
  return: IsoDay.optional(),
  /** "2027-05" when they only know the month. */
  month: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/).optional(),
  /** How many are going, when they haven't picked people. */
  travellers: z.number().int().min(1).max(30).optional(),
  travellerIds: z.array(Id).max(30).default([]),
  /** Their words, sent into the chat as the first message. Built by the app when they don't write one. */
  message: z.string().trim().min(1).max(600).optional(),
  from: z.string().regex(/^[A-Z]{3}$/).optional(),
  clientId: z.string().min(8).max(80).optional(),
}).refine((v) => !v.return || !v.depart || v.return >= v.depart, { message: 'Return is before departure', path: ['return'] });
export type PlanPlaceRequest = z.input<typeof PlanPlaceRequest>;
export const PlanPlaceResponse = z.object({
  request: BookingRequestView,
  /** The message that opened the chat. */
  message: z.string(),
});
export type PlanPlaceResponse = z.infer<typeof PlanPlaceResponse>;

export const PopularPlacesQuery = z.object({ from: z.string().regex(/^[A-Z]{3}$/).default('RUH') });
export const PopularPlacesResponse = z.object({ from: z.string(), places: z.array(PlaceHit) });
export type PopularPlacesResponse = z.infer<typeof PopularPlacesResponse>;

/* ───────────── matching names: one rule for the server, the app's mock and the prototype ───────────── */

const SPECIAL: Record<string, string> = { ı: 'i', ø: 'o', ß: 'ss', æ: 'ae', œ: 'oe', đ: 'd', ł: 'l', þ: 'th', ð: 'd', ħ: 'h', ŧ: 't' };

/**
 * A city name as search compares it: lower case, no accents ("Zürich" → "zurich", "İstanbul" → "istanbul"),
 * Arabic without diacritics and with one alef, ta marbuta and ya ("مكّة المكرّمة" → "مكه المكرمه"),
 * apostrophes dropped ("Ta’if" → "taif"), other punctuation as spaces.
 */
export function normPlace(s: string): string {
  return s
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[ıøßæœđłþðħŧ]/g, (c) => SPECIAL[c] ?? c)
    .replace(/[ٱأإآ]/g, 'ا').replace(/ة/g, 'ه').replace(/ى/g, 'ي').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي').replace(/ـ/g, '')
    .replace(/['’‘`ʻʿʾ´]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** "Tbilisi, 4 of us, sometime in May": the first message of a plan, in the traveller's words. */
export function planMessage(v: { city: string; travellers?: number | null; depart?: string | null; ret?: string | null; month?: string | null }): string {
  const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  const day = (d: string) => { const [, m, dd] = d.split('-').map(Number); return `${dd} ${MONTHS[(m ?? 1) - 1]!.slice(0, 3)}`; };
  const who = !v.travellers ? null : v.travellers === 1 ? 'just me' : `${v.travellers} of us`;
  const when = v.depart ? (v.ret ? `${day(v.depart)} to ${day(v.ret)}` : `from ${day(v.depart)}`) : v.month ? `sometime in ${MONTHS[Number(v.month.slice(5, 7)) - 1]}` : 'dates to decide';
  return [v.city, who, when].filter(Boolean).join(', ');
}
