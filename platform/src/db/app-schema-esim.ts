import { pgTable, uuid, text, integer, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appPeople, appTrips, appUsers } from "./app-schema";
import { appOrders } from "./app-schema-booking";

/*
 * eSIMs bought through the app (lib/app/esim). One row per eSIM: the order that paid for it, who it is for, the
 * supplier's ICCID and install codes, the last usage read, top-ups. Migration: drizzle/0030_esims.sql.
 *
 * Idempotency: (order_id, idx) is unique, and the supplier order carries our order id as its description, so a retry
 * looks the order up at the supplier before it ever buys again (esim/service.ts fulfil).
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export const appEsims = pgTable("app_esims", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => appOrders.id, { onDelete: "restrict" }),
  idx: integer("idx").notNull(),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  travellerId: uuid("traveller_id").references(() => appPeople.id, { onDelete: "set null" }),
  supplier: text("supplier").notNull(), // airalo | mock
  packageId: text("package_id").notNull(),
  // The plan as sold (schemas/esim.ts EsimPlan without the price), and the net cost in USD cents.
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  netUsdCents: integer("net_usd_cents").notNull().default(0),
  // ordering | ready | installed | active | used_up | expired | refunded | stuck
  status: text("status").notNull(),
  supplierOrderId: text("supplier_order_id"),
  iccid: text("iccid"),
  // { lpa, smdp, matchingId, iosLink, apn, roaming }
  install: jsonb("install").$type<Record<string, unknown>>(),
  usage: jsonb("usage").$type<Record<string, unknown>>(),
  usageCheckedAt: timestamp("usage_checked_at", { withTimezone: true }),
  topups: jsonb("topups").$type<Record<string, unknown>[]>().notNull().default(sql`'[]'::jsonb`),
  // The outcome when the supplier couldn't deliver (a refund), schemas/outcomes.ts RequestResult.
  result: jsonb("result").$type<Record<string, unknown>>(),
  problem: text("problem"),
  installedAt: timestamp("installed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("app_esims_order_idx_key").on(t.orderId, t.idx),
  uniqueIndex("app_esims_iccid_key").on(t.iccid).where(sql`${t.iccid} IS NOT NULL`),
  index("app_esims_owner_idx").on(t.ownerId, t.createdAt),
  index("app_esims_trip_idx").on(t.tripId),
]);
