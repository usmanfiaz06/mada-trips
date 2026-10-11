import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, jsonb, doublePrecision, index, uniqueIndex } from "drizzle-orm/pg-core";
import { appUsers } from "./app-schema";

/*
 * Hotelbeds (docs/app/HOTELBEDS.md):
 *   app_hotelbeds_hotels     static hotel content from the Content API, refreshed daily by a batch job (Hotelbeds asks
 *                            partners to keep content in their own database and never call the Content API per search)
 *   app_supplier_bookings    every booking we make (or try to make) on a supplier from an order or a desk request: the
 *                            rate key, our clientReference, their reference, status and the cancellation. One live
 *                            booking per source (the partial unique index), so a double click never books twice.
 */

export const appHotelbedsHotels = pgTable("app_hotelbeds_hotels", {
  code: integer("code").primaryKey(),
  name: text("name").notNull(),
  category: text("category"),
  destinationCode: text("destination_code"),
  zoneCode: integer("zone_code"),
  address: text("address"),
  postalCode: text("postal_code"),
  city: text("city"),
  latitude: doublePrecision("latitude"),
  longitude: doublePrecision("longitude"),
  phone: text("phone"),
  description: text("description"),
  // Image paths under https://photos.hotelbeds.com/giata/{size}/, in Hotelbeds' visual order.
  images: jsonb("images").$type<{ path: string; type: string | null }[]>().notNull().default(sql`'[]'::jsonb`),
  facilities: jsonb("facilities").$type<{ code: number; group: number }[]>().notNull().default(sql`'[]'::jsonb`),
  lastUpdate: text("last_update"),
  fetchedAt: timestamp("fetched_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_hotelbeds_hotels_dest_idx").on(t.destinationCode)]);

export const appSupplierBookings = pgTable("app_supplier_bookings", {
  id: uuid("id").primaryKey().defaultRandom(),
  supplier: text("supplier").notNull(), // hotelbeds
  product: text("product").notNull(), // stay | transfer
  sourceKind: text("source_kind").notNull(), // order | request
  sourceId: uuid("source_id").notNull(),
  ownerId: uuid("owner_id").references(() => appUsers.id, { onDelete: "set null" }),
  rateKey: text("rate_key").notNull(),
  clientReference: text("client_reference").notNull(),
  // booking (sent, no answer yet) | confirmed | failed | cancelled | unknown (timed out: look it up before trying again)
  status: text("status").notNull(),
  supplierRef: text("supplier_ref"),
  // What the supplier charges us, in their currency, and what the traveller pays (halalas).
  net: text("net"),
  currency: text("currency"),
  sell: bigint("sell", { mode: "number" }),
  // test | live (Hotelbeds environment) and mock | live (our supplier mode) at the time of booking.
  environment: text("environment").notNull(),
  mode: text("mode").notNull(),
  problem: text("problem"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default(sql`'{}'::jsonb`),
  bookedBy: text("booked_by"),
  cancelFee: text("cancel_fee"),
  cancelledAt: timestamp("cancelled_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("app_supplier_bookings_source_idx").on(t.sourceKind, t.sourceId),
  uniqueIndex("app_supplier_bookings_live_uq").on(t.supplier, t.sourceKind, t.sourceId).where(sql`status in ('booking','confirmed','unknown')`),
]);
