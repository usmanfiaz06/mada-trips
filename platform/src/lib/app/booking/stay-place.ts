import "server-only";
import { sql } from "drizzle-orm";
import { DESTINATIONS, normPlace, type BookingDestination } from "@mada/shared";
import { db } from "@/db";
import { geocode } from "../activities/trips";
import { findPlace, type PlaceRowSql } from "../places/search";

/*
 * Stays anywhere in the world: a place without a destination key ("Lahore, Pakistan", a plan's night in Hunza) becomes a
 * point and a radius the hotel search can use (Hotelbeds by geolocation). First our own GeoNames cities (app_places, the
 * city search's table: free, in our database, with the population that sizes the radius), then OpenStreetMap
 * Nominatim through the cached geocoder (one request a second at most, each query once; only with open data live).
 * Nothing found: null, and the search says so; no point is ever guessed.
 */

export type StayWhere = {
  name: string;
  nameAr: string | null;
  country: string | null;
  lat: number;
  lng: number;
  /** How far from the centre hotels are searched: a big city spreads, a town doesn't. */
  radiusKm: number;
};

/** A city of millions spreads over 20 km of hotels; a town's are within a few. */
export function radiusFor(population: number): number {
  if (population >= 5_000_000) return 20;
  if (population >= 1_000_000) return 12;
  if (population >= 200_000) return 8;
  return 5;
}

const titled = (s: string) => s.trim().replace(/\s+/g, " ").replace(/(^|[\s-])(\p{Ll})/gu, (_m, a: string, b: string) => a + b.toUpperCase());

/** "Lahore, Pakistan" → the city and the country said with it. */
export function splitPlace(name: string): { city: string; country: string | null } {
  const parts = name.split(",").map((x) => x.trim()).filter(Boolean);
  return { city: parts[0] ?? name.trim(), country: parts.length > 1 ? parts[parts.length - 1]! : null };
}

/** A place said in words that is one of our destination keys ("Dubai, UAE"): the city part only, so "Antalya, Turkey" stays Antalya. */
export function destinationIn(name: string): BookingDestination | null {
  const city = splitPlace(name).city.toLowerCase();
  if (!city) return null;
  return Object.values(DESTINATIONS).find((d) => d.key === city || d.name.toLowerCase() === city || d.words.test(city)) ?? null;
}

const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

/** The city by its name in the country said ("London, Canada" is London, Ontario), else the best-known of that name. */
async function cityRow(city: string, country: string | null): Promise<PlaceRowSql | null> {
  const slug = normPlace(city).replace(/ /g, "-");
  if (country && slug) {
    const c = normPlace(country);
    const [hit] = await rows<PlaceRowSql>(sql`SELECT p.*, co.name AS country FROM app_places p JOIN app_place_countries co ON co.code = p.country_code
      WHERE p.slug = ${slug} AND (lower(co.name) = ${c} OR lower(p.country_code) = ${c}) ORDER BY p.population DESC LIMIT 1`);
    if (hit) return hit;
  }
  return findPlace(city);
}

export async function resolveStayPlace(input: { name: string; lat?: number | null; lng?: number | null }, f: Parameters<typeof geocode>[1] = (url, init) => fetch(url, init)): Promise<StayWhere | null> {
  const { city, country } = splitPlace(input.name);
  if (city.length < 2) return null;
  // "PK" (a plan's country code) is looked up, never shown.
  const countryName = country && country.length > 2 ? titled(country) : null;
  const row = await cityRow(city, country).catch(() => null);
  // The caller's own point (a plan's place) wins over a name's; the city row still names it and sizes the radius.
  if (input.lat != null && input.lng != null) {
    return { name: row?.name ?? titled(city), nameAr: row?.name_ar ?? null, country: row?.country ?? countryName, lat: input.lat, lng: input.lng, radiusKm: row ? radiusFor(Number(row.population)) : 8 };
  }
  if (row) return { name: row.name, nameAr: row.name_ar, country: row.country ?? null, lat: row.lat, lng: row.lon, radiusKm: radiusFor(Number(row.population)) };
  const p = await geocode(input.name, f).catch(() => null);
  return p ? { name: titled(city), nameAr: null, country: countryName, lat: p.lat, lng: p.lon, radiusKm: 8 } : null;
}
