import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { appTrips, appUsers } from "./app-schema";

/*
 * The living plan (docs/app/ASK-INTEGRATED.md §1.2, §3): one plan per trip, its items in day order, and an event per
 * change (the audit trail and the "what changed while you were away" feed for the trip's chat). The booking tables
 * stay the source of truth for anything booked: an item only points at its booking (booking_kind + booking_id) and
 * caches the status read from it.
 *
 * Migration: drizzle/0043_plans.sql.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type PlanPlaceJson = { name: string; kind: "airport" | "city" | "place"; code?: string | null; city?: string | null; country?: string | null; lat?: number | null; lng?: number | null };
export type PlanDriveJson = {
  km: number | null; minutes: number | null; tolls: boolean | null; borders: string[]; source: string | null; asOf: string | null; estimate?: boolean;
  // Written by lib/app/drive (U4): ferries, named crossings, "no road", when to ask again, and the line to show.
  ferries?: boolean | null; crossings?: { from: string | null; to: string | null; name: string | null }[]; noRoute?: boolean; expiresAt?: string | null; line?: string;
};

export const appPlans = pgTable("app_plans", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  // Every write bumps it; an edit sent with an older one is refused (PLAN_CHANGED).
  version: integer("version").notNull().default(1),
  // The trip's origin when the plan was made or last re-planned; return_to null is a one-way trip.
  origin: jsonb("origin").$type<(PlanPlaceJson & { source: string }) | null>(),
  returnTo: jsonb("return_to").$type<PlanPlaceJson | null>(),
  startDate: date("start_date").notNull(),
  endDate: date("end_date").notNull(),
  pace: text("pace").notNull().default("normal"), // easy | normal | full
  templateId: text("template_id"),
  notes: text("notes").array().notNull().default(sql`'{}'::text[]`),
  // The last computed whole-trip checks (§3.4), for lists that don't recompute them.
  checks: jsonb("checks").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  createdBy: text("created_by").notNull().default("ask"), // ask | template | desk | traveller
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("app_plans_trip_key").on(t.tripId), index("app_plans_owner_idx").on(t.ownerId, t.updatedAt)]);

export const appPlanItems = pgTable("app_plan_items", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => appPlans.id, { onDelete: "cascade" }),
  // 0-based day of the trip; null for whole-trip items (eSIM, insurance).
  day: integer("day"),
  sort: integer("sort").notNull().default(0),
  kind: text("kind").notNull(), // leg | stay | car | activity | meal | note | check
  mode: text("mode"), // legs: flight | drive | train | ferry | transfer | walk
  title: text("title").notNull(),
  note: text("note"),
  place: jsonb("place").$type<PlanPlaceJson | null>(),
  fromPlace: jsonb("from_place").$type<PlanPlaceJson | null>(),
  toPlace: jsonb("to_place").$type<PlanPlaceJson | null>(),
  // Local wall-clock "YYYY-MM-DDTHH:mm" at the place, with its zone.
  startsAt: text("starts_at"),
  endsAt: text("ends_at"),
  tz: text("tz"),
  nights: integer("nights"),
  // Cached from the booking it points at; the booking row decides (plans.ts statusOf).
  status: text("status").notNull().default("idea"),
  // Why the status is what it is, when it isn't obvious ("price needs checking again").
  statusNote: text("status_note"),
  bookingKind: text("booking_kind"), // segment | stay | pickup | esim | idea | rental | order
  bookingId: uuid("booking_id"),
  requestId: uuid("request_id"),
  offerId: uuid("offer_id"),
  // An activity from the catalogue, an experience or an event.
  ref: jsonb("ref").$type<{ kind: string; id: string } | null>(),
  // Filled only by the drive interface (lib/app/drive): km/time from a router, or a labelled estimate with no time.
  drive: jsonb("drive").$type<PlanDriveJson | null>(),
  // The first leg out and the last leg home: rebuilt when the origin changes.
  originLeg: text("origin_leg"), // out | home | null
  source: text("source").notNull().default("ask"), // ask | manual | template | desk | booking
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_plan_items_plan_idx").on(t.planId, t.day, t.sort), index("app_plan_items_booking_idx").on(t.bookingKind, t.bookingId)]);

export const appPlanEvents = pgTable("app_plan_events", {
  id: id(),
  planId: uuid("plan_id").notNull().references(() => appPlans.id, { onDelete: "cascade" }),
  itemId: uuid("item_id"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
  byKind: text("by_kind").notNull(), // ask | traveller | desk | system
  op: text("op").notNull(), // create | add | move | update | remove | status | origin
  // What changed, redacted and short (≤ 2 KB): titles, days and statuses, never documents or prices.
  diff: jsonb("diff").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  seenInThread: boolean("seen_in_thread").notNull().default(false),
}, (t) => [index("app_plan_events_plan_idx").on(t.planId, t.at)]);

/*
 * Drive figures (§4.3, lib/app/drive): one row per origin/destination (rounded to ~100 m), mode, avoid flags and
 * departure bucket, kept until expires_at (map provider 30 days, OSRM 90). Numbers only: no route line, no provider
 * text. Estimates are never stored. Migration: drizzle/0044_drive_cache.sql.
 */
export const appDriveCache = pgTable("app_drive_cache", {
  key: text("key").primaryKey(),
  mode: text("mode").notNull().default("drive"),
  // weekday | weekend × day | night: traffic-free figures today, the key is ready for typical-traffic ones.
  bucket: text("bucket").notNull(),
  // Which router answered (google | osrm | mock): for us, never shown to a traveller.
  provider: text("provider").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [index("app_drive_cache_expires_idx").on(t.expiresAt)]);

/** Router calls per UTC day, for the daily budget (DRIVE_DAILY_CALLS). */
export const appDriveBudget = pgTable("app_drive_budget", {
  day: date("day").primaryKey(),
  calls: integer("calls").notNull().default(0),
});
