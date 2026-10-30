import { AppError } from "../../http";
import { requireEnv } from "../live/not-configured";
import type { OpeningPeriod, PlacePhoto, PlaceRecord, PlaceSearch, PlacesSupplier } from "./types";

/*
 * Google Places API (New) (developers.google.com/maps/documentation/places/web-service/op-overview).
 *   Text Search    POST https://places.googleapis.com/v1/places:searchText
 *   Place Details  GET  https://places.googleapis.com/v1/places/{id}
 *   Place Photo    GET  https://places.googleapis.com/v1/{photo name}/media?maxWidthPx=…&skipHttpRedirect=true
 * X-Goog-Api-Key: GOOGLE_PLACES_API_KEY, sent as a header only (never in a URL, never logged, never to the app).
 * X-Goog-FieldMask: exactly the fields the cards show. The mask decides the SKU: rating and opening hours put Text
 * Search and Place Details on their Enterprise tier, the cheapest that has them (CONNECT.md §32 has the cost). No
 * reviews, no "serves…" fields (Atmosphere), no currentOpeningHours: open now is worked out from the weekly hours
 * (hours.ts), so a cached answer never says "open" when it isn't.
 */

const BASE = "https://places.googleapis.com/v1";
const TIMEOUT_MS = 5000;

const FIELDS = ["id", "displayName", "formattedAddress", "location", "rating", "userRatingCount", "priceLevel", "primaryTypeDisplayName", "regularOpeningHours.periods", "regularOpeningHours.weekdayDescriptions", "utcOffsetMinutes", "photos"];
/** Search: the list card's fields. */
export const SEARCH_FIELD_MASK = FIELDS.map((f) => `places.${f}`).join(",");
/** Details: the same, plus what the one-place card's buttons need. */
export const DETAILS_FIELD_MASK = [...FIELDS, "internationalPhoneNumber", "websiteUri", "googleMapsUri"].join(",");

type GText = { text?: string };
type GPhoto = { name?: string; authorAttributions?: { displayName?: string; uri?: string }[] };
type GPeriod = { open?: { day?: number; hour?: number; minute?: number }; close?: { day?: number; hour?: number; minute?: number } };
type GPlace = {
  id?: string; displayName?: GText; formattedAddress?: string; location?: { latitude?: number; longitude?: number };
  rating?: number; userRatingCount?: number; priceLevel?: string; primaryTypeDisplayName?: GText;
  regularOpeningHours?: { periods?: GPeriod[]; weekdayDescriptions?: string[] }; utcOffsetMinutes?: number;
  internationalPhoneNumber?: string; websiteUri?: string; googleMapsUri?: string; photos?: GPhoto[];
};

const PRICE: Record<string, number> = { PRICE_LEVEL_FREE: 0, PRICE_LEVEL_INEXPENSIVE: 1, PRICE_LEVEL_MODERATE: 2, PRICE_LEVEL_EXPENSIVE: 3, PRICE_LEVEL_VERY_EXPENSIVE: 4 };
const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
const str = (v: unknown, max = 500) => (typeof v === "string" && v.trim() ? v.trim().slice(0, max) : null);
const https = (v: unknown) => { const s = str(v); return s && /^https:\/\//i.test(s) ? s : null; };

const point = (p: GPeriod["open"]) => (p && Number.isInteger(p.day) ? { day: p.day!, hour: p.hour ?? 0, minute: p.minute ?? 0 } : null);
function periodsOf(list: GPeriod[] | undefined): OpeningPeriod[] | null {
  const out = (list ?? []).flatMap((p) => { const open = point(p.open); return open ? [{ open, close: point(p.close) }] : []; });
  return out.length ? out : null;
}

/** The first 3 photos and their authors' credit. */
const photosOf = (list: GPhoto[] | undefined): PlacePhoto[] => (list ?? []).filter((p) => typeof p.name === "string" && /^places\/[\w-]+\/photos\/[\w-]+$/.test(p.name)).slice(0, 3)
  .map((p) => ({ name: p.name!, authors: (p.authorAttributions ?? []).flatMap((a) => (str(a.displayName, 120) ? [{ name: str(a.displayName, 120)!, uri: https(a.uri) }] : [])).slice(0, 3) }));

/** One of Google's places as ours; null without an id or a name. */
export function parsePlace(g: GPlace | undefined): PlaceRecord | null {
  const id = str(g?.id, 300);
  const name = str(g?.displayName?.text, 160);
  if (!g || !id || !name) return null;
  const week = Array.isArray(g.regularOpeningHours?.weekdayDescriptions) ? g.regularOpeningHours.weekdayDescriptions.filter((x) => typeof x === "string").slice(0, 7) : null;
  return {
    id, name, type: str(g.primaryTypeDisplayName?.text, 80), address: str(g.formattedAddress, 300),
    lat: num(g.location?.latitude), lng: num(g.location?.longitude),
    rating: num(g.rating), ratings: num(g.userRatingCount), price: g.priceLevel && g.priceLevel in PRICE ? PRICE[g.priceLevel]! : null,
    periods: periodsOf(g.regularOpeningHours?.periods), week: week?.length ? week : null, utcOffsetMinutes: num(g.utcOffsetMinutes),
    phone: str(g.internationalPhoneNumber, 40), website: https(g.websiteUri), mapsUrl: https(g.googleMapsUri), photos: photosOf(g.photos),
  };
}

/** The Text Search body: the words, the language, at most 5, optionally only open places and biased to a circle. */
export const searchBody = (q: PlaceSearch) => ({
  textQuery: q.query.slice(0, 200),
  languageCode: q.lang,
  pageSize: Math.max(1, Math.min(5, q.max)),
  ...(q.openNow ? { openNow: true } : {}),
  ...(q.near ? { locationBias: { circle: { center: { latitude: q.near.lat, longitude: q.near.lng }, radius: Math.max(100, Math.min(50_000, q.near.radiusM)) } } } : {}),
});

/** A place id as Google makes them; anything else is never put in a URL. */
export const isPlaceId = (id: string) => /^[\w-]{10,300}$/.test(id);

type Fetch = typeof fetch;

/** Google's answer: 5xx and 429 are outages for the breaker; any other 4xx (a bad id, the API off for the key) is an answer. */
async function call(f: Fetch, url: string, init: RequestInit, mask: string | null): Promise<unknown | null> {
  const { GOOGLE_PLACES_API_KEY: key } = requireEnv("places (Google)", ["GOOGLE_PLACES_API_KEY"]);
  const res = await f(url, { ...init, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), headers: { ...(init.headers as Record<string, string>), "X-Goog-Api-Key": key, ...(mask ? { "X-Goog-FieldMask": mask } : {}) } });
  if (res.status >= 500 || res.status === 429) throw new AppError("SUPPLIER_UNAVAILABLE", { details: { status: res.status } });
  if (!res.ok) {
    // Google's message names the problem, never the key; the status alone goes to the log.
    console.warn("[places] Google refused", res.status);
    return null;
  }
  return res.json();
}

export function googlePlaces(f: Fetch = (u, i) => fetch(u, i)): PlacesSupplier {
  return {
    name: "google",
    async search(q) {
      const data = await call(f, `${BASE}/places:searchText`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(searchBody(q)) }, SEARCH_FIELD_MASK);
      const list = (data as { places?: GPlace[] } | null)?.places ?? [];
      return list.map(parsePlace).filter((p): p is PlaceRecord => !!p).slice(0, 5);
    },
    async details(id, lang) {
      if (!isPlaceId(id)) return null;
      const data = await call(f, `${BASE}/places/${encodeURIComponent(id)}?languageCode=${lang}`, { method: "GET" }, DETAILS_FIELD_MASK);
      return parsePlace((data ?? undefined) as GPlace | undefined);
    },
    async photoUri(name, maxWidthPx) {
      if (!/^places\/[\w-]+\/photos\/[\w-]+$/.test(name)) return null;
      const w = Math.max(100, Math.min(1600, Math.round(maxWidthPx)));
      const data = await call(f, `${BASE}/${name}/media?maxWidthPx=${w}&skipHttpRedirect=true`, { method: "GET" }, null);
      return https((data as { photoUri?: string } | null)?.photoUri);
    },
  };
}
