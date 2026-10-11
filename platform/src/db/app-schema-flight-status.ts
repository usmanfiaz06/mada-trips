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
