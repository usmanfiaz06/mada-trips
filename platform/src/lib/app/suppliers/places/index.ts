import "server-only";
import type { ChatPlace } from "@mada/shared";
import { isProductionDeploy } from "../../config";
import { guarded } from "../../resilience/breaker";
import { crowKm } from "../routes/estimate";
import { googlePlaces } from "./google";
import { openState, todayHours } from "./hours";
import { mockPlaces } from "./mock";
import type { PlacePoint, PlaceRecord, PlaceSearch, PlacesSupplier } from "./types";

export type * from "./types";
export { openState, todayHours } from "./hours";

/*
 * Places in Ask (docs/app/CONNECT.md §32): Google Places API (New) behind the "places" breaker, 5 s a call.
 *
 *   SUPPLIER_MODE_PLACES  google (or live) | mock | off. Unset: google when GOOGLE_PLACES_API_KEY is set, else off.
 *                         Never mock by itself (the global SUPPLIER_MODE doesn't turn it on): sample restaurants must
 *                         never answer a traveller on a copy that simply has no key. Off: Ask isn't given the tools.
 *
 * Cached on this instance to cut the bill: a search for an hour, a place's details for a day, by language. Only Google's
 * weekly hours are kept: open now and today's hours are worked out when a card is made (hours.ts).
 */

export type PlacesMode = "google" | "mock" | "off";

export function placesMode(): PlacesMode {
  const raw = (process.env.SUPPLIER_MODE_PLACES ?? "").trim().toLowerCase();
  if (raw === "off") return "off";
  if (raw === "mock") return !isProductionDeploy() || process.env.APP_ALLOW_MOCKS === "yes" ? "mock" : "off";
  return process.env.GOOGLE_PLACES_API_KEY?.trim() ? "google" : "off";
}
export const placesOn = () => placesMode() !== "off";

let override: PlacesSupplier | null = null;
/** Tests only: answer with this supplier (a Google adapter on a fake fetch). */
export const setPlacesSupplier = (s: PlacesSupplier | null) => { override = s; };

export function placesSupplier(): PlacesSupplier | null {
  if (override) return guarded("places", override);
  const m = placesMode();
  return m === "google" ? guarded("places", googlePlaces()) : m === "mock" ? mockPlaces : null;
}

const SEARCH_TTL = 60 * 60_000;
const DETAILS_TTL = 24 * 60 * 60_000;
const MAX_ENTRIES = 2000;
const g = globalThis as unknown as { __madaPlaces?: Map<string, { at: number; v: unknown }> };
const memo = (g.__madaPlaces ??= new Map());
export const clearPlacesCache = () => memo.clear();

async function cached<T>(key: string, ttl: number, load: () => Promise<T>): Promise<T> {
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < ttl) return hit.v as T;
  const v = await load();
  memo.set(key, { at: Date.now(), v });
  if (memo.size > MAX_ENTRIES) for (const [k, x] of memo) if (Date.now() - x.at > DETAILS_TTL || memo.size > MAX_ENTRIES) memo.delete(k);
  return v;
}

/** About 100 m: the same hotel door is the same search. */
const pt = (p: PlaceSearch["near"]) => (p ? `${p.lat.toFixed(3)},${p.lng.toFixed(3)},${p.radiusM}` : "-");
export const searchKey = (s: string, q: PlaceSearch) => `s|${s}|${q.lang}|${q.openNow ? 1 : 0}|${q.max}|${pt(q.near)}|${q.query.trim().toLowerCase().replace(/\s+/g, " ")}`;

/** Up to 5 places for the words, cached for an hour. Throws when the supplier is off or down (the tool says so). */
export async function searchPlaces(q: PlaceSearch): Promise<PlaceRecord[]> {
  const s = placesSupplier();
  if (!s) throw new Error("places off");
  return cached(searchKey(s.name, q), SEARCH_TTL, () => s.search(q));
}

/** One place in full, cached for a day. Null when Google doesn't know the id. */
export async function placeDetails(id: string, lang: "en" | "ar"): Promise<PlaceRecord | null> {
  const s = placesSupplier();
  if (!s) throw new Error("places off");
  return cached(`d|${s.name}|${lang}|${id}`, DETAILS_TTL, () => s.details(id, lang));
}

/* ───────────── photos ───────────── */

/**
 * The photo as a key-free address the image route knows (image-proxy.ts): Google's media URL without any key. The
 * answer's scrub (shield.ts) turns it into our own /img/{token} link; the route adds the key on the server.
 */
export const photoUrl = (name: string, maxWidthPx = 640) => `https://places.googleapis.com/v1/${name}/media?maxWidthPx=${maxWidthPx}`;
const PHOTO = /^https:\/\/places\.googleapis\.com\/v1\/(places\/[\w-]+\/photos\/[\w-]+)\/media\?maxWidthPx=(\d{2,4})$/;
export const isPlacesPhotoUrl = (u: string) => PHOTO.test(u);

/** The image behind a Places photo URL (the route fetches it): short-lived, on Google's image host, key-free. */
export async function placesPhotoSource(url: string): Promise<string | null> {
  const m = PHOTO.exec(url);
  const s = placesSupplier();
  if (!m || !s) return null;
  return s.photoUri(m[1]!, Number(m[2]));
}

/* ───────────── cards ───────────── */

/** Metres between two points, rounded to 10 m. */
export const metresBetween = (a: PlacePoint, b: PlacePoint) => Math.round((crowKm(a, b) * 1000) / 10) * 10;

/** A place as the app draws it: open now and today's hours as of `now`, the distance from `from`, the first photo. */
export function chatPlace(p: PlaceRecord, opts: { from?: PlacePoint | null; now?: Date; full?: boolean } = {}): ChatPlace {
  const now = opts.now ?? new Date();
  const photo = p.photos[0];
  return {
    id: p.id, name: p.name, type: p.type, rating: p.rating, ratings: p.ratings, price: p.price,
    open: openState(p.periods, p.utcOffsetMinutes, now), today: todayHours(p.week, p.utcOffsetMinutes, now),
    address: p.address, lat: p.lat, lng: p.lng,
    distanceM: opts.from && p.lat != null && p.lng != null ? metresBetween(opts.from, { lat: p.lat, lng: p.lng }) : null,
    photo: photo ? { url: photoUrl(photo.name), credit: photo.authors.map((a) => ({ name: a.name, url: a.uri })) } : null,
    ...(opts.full ? { week: p.week ?? [], phone: p.phone, website: p.website, mapsUrl: p.mapsUrl } : {}),
  };
}
