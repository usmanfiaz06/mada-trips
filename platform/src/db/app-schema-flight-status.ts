import { pgTable, text, integer, timestamp, jsonb, date, boolean, primaryKey } from "drizzle-orm/pg-core";

/*
 * Flight status from paid suppliers (AeroDataBox, aviationstack) is cached here and its quota counted here, so every
 * server instance shares one cache and one budget (lib/app/flight-status/*). Mock status never touches these.
 */

/** The last answer for one flight on one day from one supplier. `info` is null when the supplier didn't know it. */
export const appFlightStatusCache = pgTable("app_flight_status_cache", {
  vendor: text("vendor").notNull(),
  flightNumber: text("flight_number").notNull(),
  day: date("day").notNull(),
  found: boolean("found").notNull(),
  info: jsonb("info").$type<Record<string, unknown>>(),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.vendor, t.flightNumber, t.day] })]);

/** Units spent per supplier per calendar month (UTC), against a hard budget. */
export const appSupplierUsage = pgTable("app_supplier_usage", {
  vendor: text("vendor").notNull(),
  month: text("month").notNull(), // YYYY-MM
  used: integer("used").notNull().default(0),
  calls: integer("calls").notNull().default(0),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.vendor, t.month] })]);

/**
 * AeroDataBox flight-alert webhook subscriptions, by flight NUMBER only (never by airport: an airport subscription
 * bills a credit per flight per update). One row per flight number; a subscription covers every date of that number,
 * so it's created when one of our flights on that number is within the alert window and removed once none is.
 * status: active | removed | failed (the plan or balance refused it: we poll that flight instead).
 */
export const appFlightSubscriptions = pgTable("app_flight_subscriptions", {
  vendor: text("vendor").notNull(),
  flightNumber: text("flight_number").notNull(),
  subscriptionId: text("subscription_id"),
  status: text("status").notNull(),
  error: text("error"),
  lastEventAt: timestamp("last_event_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.vendor, t.flightNumber] })]);
