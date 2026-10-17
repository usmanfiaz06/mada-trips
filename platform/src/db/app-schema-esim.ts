import { pgTable, uuid, text, integer, timestamp, jsonb, boolean, real, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { appPeople, appTrips, appUsers } from "./app-schema";
import { appOrders } from "./app-schema-booking";

/*
 * eSIMs bought through the app (lib/app/esim). One row per eSIM: the order that paid for it, who it is for, the
 * supplier's ICCID and install codes, the last usage read, top-ups. Migrations: drizzle/0030_esims.sql and
 * 0033_esim_access.sql (the supplier's own eSIM id, the time Mada promised, the catalogue, price holds, webhook ids).
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
  supplier: text("supplier").notNull(), // esimaccess | airalo | mock
  packageId: text("package_id").notNull(),
  // The plan as sold (schemas/esim.ts EsimPlan without the price), and the net cost in USD cents.
  plan: jsonb("plan").$type<Record<string, unknown>>().notNull(),
  netUsdCents: integer("net_usd_cents").notNull().default(0),
  // ordering | ready | installed | active | used_up | expired | refunded | stuck
  status: text("status").notNull(),
  supplierOrderId: text("supplier_order_id"),
  iccid: text("iccid"),
  // The supplier's id for this one eSIM (eSIM Access esimTranNo: ICCIDs are reused there).
  supplierRef: text("supplier_ref"),
  // Paid and not delivered yet for a reason that is ours (low supplier balance): the time Mada promised it by.
  dueAt: timestamp("due_at", { withTimezone: true }),
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


/*
 * The supplier's catalogue, synced daily (esim/catalogue.ts): one row per package with its cost in USD × 10,000 (eSIM
 * Access's own unit), the cost before the last change, and when it changed, so the desk sees "cost went up on 12 plans".
 * What we sell it for is never stored: it is worked out from the owner's rules (esim-pricing.ts) each time.
 */
export const appEsimCatalogue = pgTable("app_esim_catalogue", {
  packageId: text("package_id").primaryKey(),
  supplier: text("supplier").notNull(),
  // The package in our words (EsimPackage).
  pkg: jsonb("pkg").$type<Record<string, unknown>>().notNull(),
  coverageCode: text("coverage_code").notNull(),
  gb: real("gb"),
  days: integer("days").notNull(),
  daily: boolean("daily").notNull().default(false),
  costE4: integer("cost_e4").notNull(),
  retailE4: integer("retail_e4"),
  prevCostE4: integer("prev_cost_e4"),
  costChangedAt: timestamp("cost_changed_at", { withTimezone: true }),
  seenAt: timestamp("seen_at", { withTimezone: true }).notNull().defaultNow(),
  goneAt: timestamp("gone_at", { withTimezone: true }),
}, (t) => [index("app_esim_catalogue_code_idx").on(t.coverageCode)]);

/** The price a traveller was shown, kept for them until expires_at (the owner's hold window). */
export const appEsimPriceHolds = pgTable("app_esim_price_holds", {
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  packageId: text("package_id").notNull(),
  price: integer("price").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
}, (t) => [primaryKey({ columns: [t.ownerId, t.packageId] })]);

/** Webhook deliveries already handled (eSIM Access may send one twice: its notifyId tells). */
export const appEsimWebhooks = pgTable("app_esim_webhooks", {
  notifyId: text("notify_id").primaryKey(),
  type: text("type").notNull(),
  receivedAt: createdAt(),
});
