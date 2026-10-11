import { pgTable, integer, text, boolean, doublePrecision, timestamp, jsonb, index, uuid, date, real, uniqueIndex } from "drizzle-orm/pg-core";
import { appTrips, appUsers } from "./app-schema";
import { appPlaces } from "./app-schema-places";

/*
 * Things to do (platform/src/lib/app/activities/README.md).
 *  - app_activities: places worth a visit per city, from OpenStreetMap (ODbL) + Wikidata (CC0) + Commons, ranked by
 *    Wikipedia pageviews and sitelinks. Replaced per city by each refresh (scripts/activities/refresh.ts, or the cron).
 *  - app_activity_cities: per city, when the open data was last loaded, and short-lived caches (weather, events,
 *    bookable experiences) so one city's page costs each upstream API at most one call per TTL.
 *  - app_whats_on: the desk's curated "What's on" list (Saudi events have no open API).
 *  - app_trip_ideas: "Add to my plan": ideas on a trip's days.
 *  - app_geocodes: hotel addresses → points (Nominatim, ODbL), so "near the hotel" works; cached for good.
 */

export const appActivities = pgTable("app_activities", {
  id: text("id").primaryKey(), // osm:n123
  placeId: integer("place_id").notNull().references(() => appPlaces.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  name: text("name").notNull(),
  nameAr: text("name_ar"),
  lat: doublePrecision("lat").notNull(),
  lon: doublePrecision("lon").notNull(),
  wikidata: text("wikidata"),
  wikipediaTitle: text("wikipedia_title"),
  summary: text("summary"),
  summaryAr: text("summary_ar"),
  /** PlaceImage (Commons, free licence only). */
  image: jsonb("image").$type<Record<string, unknown> | null>(),
  hours: text("hours"),
  indoor: boolean("indoor").notNull().default(false),
  family: boolean("family").notNull().default(false),
  free: boolean("free"),
  website: text("website"),
  sitelinks: integer("sitelinks").notNull().default(0),
  pageviews: integer("pageviews").notNull().default(0),
  score: real("score").notNull().default(0),
  popularity: integer("popularity").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_activities_place_idx").on(t.placeId, t.popularity)]);

export const appActivityCities = pgTable("app_activity_cities", {
  placeId: integer("place_id").primaryKey().references(() => appPlaces.id, { onDelete: "cascade" }),
  status: text("status").notNull().default("none"), // ok | partial | none
  count: integer("count").notNull().default(0),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  refreshingAt: timestamp("refreshing_at", { withTimezone: true }),
  lastProblem: text("last_problem"),
  weather: jsonb("weather").$type<Record<string, unknown> | null>(),
  weatherAt: timestamp("weather_at", { withTimezone: true }),
  events: jsonb("events").$type<Record<string, unknown>[] | null>(),
  eventsAt: timestamp("events_at", { withTimezone: true }),
  experiences: jsonb("experiences").$type<Record<string, unknown>[] | null>(),
  experiencesAt: timestamp("experiences_at", { withTimezone: true }),
}, (t) => [index("app_activity_cities_expires_idx").on(t.expiresAt)]);

export const appWhatsOn = pgTable("app_whats_on", {
  id: uuid("id").primaryKey().defaultRandom(),
  placeId: integer("place_id").notNull().references(() => appPlaces.id, { onDelete: "cascade" }),
  title: text("title").notNull(),
  titleAr: text("title_ar"),
  body: text("body"),
  bodyAr: text("body_ar"),
  startsOn: date("starts_on").notNull(),
  endsOn: date("ends_on").notNull(),
  time: text("time"),
  venue: text("venue"),
  imageUrl: text("image_url"),
  imageCredit: text("image_credit"),
  link: text("link"),
  family: boolean("family").notNull().default(false),
  active: boolean("active").notNull().default(true),
  createdBy: text("created_by"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_whats_on_place_idx").on(t.placeId, t.endsOn)]);

export const appTripIdeas = pgTable("app_trip_ideas", {
  id: uuid("id").primaryKey().defaultRandom(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  refKind: text("ref_kind").notNull(), // activity | experience | event
  refId: text("ref_id").notNull(),
  day: date("day"),
  title: text("title").notNull(),
  sub: text("sub"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [uniqueIndex("app_trip_ideas_once_idx").on(t.tripId, t.refId), index("app_trip_ideas_owner_idx").on(t.ownerId)]);

export const appGeocodes = pgTable("app_geocodes", {
  query: text("query").primaryKey(),
  lat: doublePrecision("lat"),
  lon: doublePrecision("lon"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
});
