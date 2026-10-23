import "server-only";
import { and, between, eq, or } from "drizzle-orm";
import { CATALOGUE_HOTELS, DESTINATIONS } from "@mada/shared";
import { db } from "@/db";
import { appHotelbedsHotels } from "@/db/app-schema-hotelbeds";
import { HB_PLACES } from "../suppliers/hotelbeds/hotels";
import { hotelVendor } from "../suppliers/hotelbeds/app";

/*
 * A hotel the traveller named ("Four Seasons London"): which hotels we hold under that name in the destination, so
 * the search asks for those hotels only and never passes other hotels off as the one asked for (Ask's search_stays).
 * Names are compared word by word, case, accents and a plural "s" aside: "four season" finds "Four Seasons Hotel
 * London at Park Lane". Hotel content comes from app_hotelbeds_hotels (the content job); the catalogue matches its own.
 */

/** At most this many hotels of one name are searched (two Four Seasons in London, a chain's few in a city). */
export const MAX_NAMED = 5;

/** Words that say nothing about which hotel it is. */
const FILLER = new Set(["the", "hotel", "hotels", "at", "by", "and", "a", "an", "of", "in", "on", "de", "la", "le", "el", "al", "resort", "resorts", "spa", "suites", "rooms"]);
const stem = (w: string) => (w.length > 3 && w.endsWith("s") && !w.endsWith("ss") ? w.slice(0, -1) : w);

export function nameWords(s: string): string[] {
  return s.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/['’]/g, "").replace(/[^a-z0-9]+/g, " ").trim().split(" ").filter(Boolean).map(stem);
}

/** The words that pick the hotel out: no filler, no words of the city's own name ("london"). Empty: no usable name. */
export function nameQuery(name: string, destination: string): string[] {
  const d = DESTINATIONS[destination];
  const city = new Set([...nameWords(d?.name ?? ""), ...nameWords(destination)]);
  return [...new Set(nameWords(name).filter((w) => !FILLER.has(w) && !city.has(w)))];
}

/** A word of the query is the hotel's word, or its start ("intercon" for InterContinental); never the other way round ("lanesborough" isn't "Lane"). */
const wordMatch = (q: string, h: string) => q === h || (q.length >= 4 && h.startsWith(q));

/** How well a hotel's name answers the query: 0 when a query word is missing, else the share of its own words matched. */
export function nameScore(query: string[], hotelName: string): number {
  if (!query.length) return 0;
  const words = nameWords(hotelName).filter((w) => !FILLER.has(w));
  if (!query.every((q) => words.some((h) => wordMatch(q, h)))) return 0;
  return words.filter((h) => query.some((q) => wordMatch(q, h))).length / Math.max(1, words.length);
}

export type NamedHotel = { code: number | null; name: string };

/** The best matches first, at most MAX_NAMED. */
export function bestNamed<T extends { name: string }>(query: string[], hotels: readonly T[]): T[] {
  return hotels.map((h) => ({ h, s: nameScore(query, h.name) })).filter((x) => x.s > 0)
    .sort((a, b) => b.s - a.s || a.h.name.length - b.h.name.length).slice(0, MAX_NAMED).map((x) => x.h);
}

/**
 * The hotels we hold under this name in the destination: Hotelbeds content (stays from Hotelbeds), else the
 * catalogue's own hotels. `known: false` when we can't tell beforehand (a source with no stored content): the search
 * then runs as usual and its results are matched by name.
 */
export async function namedHotels(destination: string | { lat: number; lng: number; radiusKm: number }, query: string[]): Promise<{ known: boolean; hotels: NamedHotel[] }> {
  const vendor = hotelVendor();
  const key = typeof destination === "string" ? destination : null;
  if (vendor === "catalogue") return { known: true, hotels: bestNamed(query, (CATALOGUE_HOTELS[key ?? ""] ?? []).map((h) => ({ code: null, name: h.name }))) };
  if (vendor === "ratehawk") return { known: false, hotels: [] };
  // A place without a key (anywhere in the world, stay-place.ts) is looked up around its point.
  const place: { lat: number; lng: number; radiusKm: number; code?: string } | undefined = key ? HB_PLACES[key] : (destination as { lat: number; lng: number; radiusKm: number });
  if (!place) return { known: true, hotels: [] };
  // A named hotel can sit a little outside the search circle (Canary Wharf, a resort out of town): twice the radius.
  const dLat = (place.radiusKm * 2) / 111;
  const dLng = dLat / Math.max(0.2, Math.cos((place.lat * Math.PI) / 180));
  const near = and(between(appHotelbedsHotels.latitude, place.lat - dLat, place.lat + dLat), between(appHotelbedsHotels.longitude, place.lng - dLng, place.lng + dLng));
  try {
    const rows = await db.select({ code: appHotelbedsHotels.code, name: appHotelbedsHotels.name }).from(appHotelbedsHotels)
      .where(place.code ? or(near, eq(appHotelbedsHotels.destinationCode, place.code)) : near).limit(20_000);
    // Anywhere else we may hold no hotel content at all: then we can't tell, and the search's own names are matched.
    if (!key && !rows.length) return { known: false, hotels: [] };
    return { known: true, hotels: bestNamed(query, rows) };
  } catch {
    // The content table isn't there yet: match the search's own names instead.
    return { known: false, hotels: [] };
  }
}

/** "FOUR SEASONS HOTEL LONDON AT PARK LANE" → "Four Seasons Hotel London At Park Lane", as a reply would say it. */
export const hotelTitle = (s: string) => (s === s.toUpperCase() ? s.toLowerCase().replace(/(^|[\s'(-])(\p{L})/gu, (_, a: string, b: string) => a + b.toUpperCase()) : s);
