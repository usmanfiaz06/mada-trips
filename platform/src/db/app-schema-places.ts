import { sql } from "drizzle-orm";
import { pgTable, integer, bigint, text, boolean, doublePrecision, timestamp, jsonb, index, primaryKey, uuid } from "drizzle-orm/pg-core";
import { appRequests, appUsers } from "./app-schema";

/*
 * Places: every city of 15,000 people or more (GeoNames, CC BY 4.0), airports with an IATA code (OurAirports, public
 * domain), the names search matches (English, other Latin spellings, Arabic, airport names and codes), and each
 * city's guide as assembled from Wikipedia, Wikivoyage and Wikimedia Commons (CC BY-SA), cached for 30 days.
 * Loaded by scripts/places/ingest.ts. CREATE statements: drizzle/pending/places.sql (needs pg_trgm and unaccent).
 */

export type NearAirportJson = { iata: string; name: string; km: number; size: "large" | "medium" };

export const appPlaceCountries = pgTable("app_place_countries", {
  code: text("code").primaryKey(), // ISO 3166-1 alpha-2
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  capital: text("capital"),
  continent: text("continent"),
  currencyCode: text("currency_code"),
  currencyName: text("currency_name"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

export const appPlaces = pgTable("app_places", {
  id: integer("id").primaryKey(), // GeoNames id
  slug: text("slug").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  region: text("region"),
  countryCode: text("country_code").notNull().references(() => appPlaceCountries.code),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  timezone: text("timezone").notNull(),
  population: bigint("population", { mode: "number" }).notNull().default(0),
  featureCode: text("feature_code").notNull(),
  isCapital: boolean("is_capital").notNull().default(false),
  /** Up to three airports within 150 km, nearest useful first. */
  airports: jsonb("airports").$type<NearAirportJson[]>().notNull().default([]),
  iata: text("iata"),
  curation: text("curation").notNull().default("basic"), // curated | guide | basic
  served: boolean("served").notNull().default(false),
  photo: text("photo"),
  bookingKey: text("booking_key"),
  wikipediaTitle: text("wikipedia_title"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_places_slug_idx").on(t.slug), index("app_places_country_idx").on(t.countryCode, t.population)]);

/** One row per name a city answers to. `norm` is normPlace() then app_places_norm() (unaccent) in the database. */
export const appPlaceNames = pgTable("app_place_names", {
  placeId: integer("place_id").notNull().references(() => appPlaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // name | ascii | alt | ar | iata | airport
  name: text("name").notNull(),
  norm: text("norm").notNull(),
  label: text("label"),
  rank: integer("rank").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.placeId, t.kind, t.norm] })]);

export const appPlaceAirports = pgTable("app_place_airports", {
  iata: text("iata").primaryKey(),
  icao: text("icao"),
  name: text("name").notNull(),
  municipality: text("municipality"),
  countryCode: text("country_code").notNull(),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  size: text("size").notNull(), // large | medium
  cityId: integer("city_id").references(() => appPlaces.id, { onDelete: "set null" }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_place_airports_city_idx").on(t.cityId)]);

/** The assembled guide (CityGuide's open-data part), fresh for 30 days, then served stale while it refreshes. */
export const appPlaceGuides = pgTable("app_place_guides", {
  placeId: integer("place_id").primaryKey().references(() => appPlaces.id, { onDelete: "cascade" }),
  guide: jsonb("guide").$type<Record<string, unknown>>().notNull(),
  status: text("status").notNull(), // ok | partial | none
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  refreshingAt: timestamp("refreshing_at", { withTimezone: true }),
  lastProblem: text("last_problem"),
}, (t) => [index("app_place_guides_expires_idx").on(t.expiresAt)]);

/** "Plan it with Mada" requests by city: which places people ask for that we don't sell yet. */
export const appPlacePlans = pgTable("app_place_plans", {
  requestId: uuid("request_id").primaryKey().references(() => appRequests.id, { onDelete: "cascade" }),
  placeId: integer("place_id").notNull().references(() => appPlaces.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_place_plans_place_idx").on(t.placeId, t.createdAt), index("app_place_plans_owner_idx").on(t.ownerId, t.createdAt)]);

export const placesNormSql = (v: unknown) => sql`app_places_norm(${v})`;
