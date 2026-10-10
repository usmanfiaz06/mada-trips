import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { appPayments, appRequests, appTrips, appUsers } from "./app-schema";

/*
 * Booking (M2): offers held for a traveller, orders and their timeline, the money side of a booked trip, and
 * payment-provider webhooks. Requests, quotes, payments, messages and trips themselves live in the M0 tables
 * (app_requests, app_quotes, app_payments, app_messages, app_trips, app_segments, app_stays, app_pickups).
 *
 * The matching SQL is in drizzle/pending/booking.sql until the lead folds it into one generated migration.
 */

const money = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** A supplier offer shown to one traveller: our id, the supplier's id, the snapshot the price came from, its hold. */
export const appOffers = pgTable("app_offers", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // flight | stay
  supplier: text("supplier").notNull(),
  supplierOfferId: text("supplier_offer_id").notNull(),
  // The search it answered (destination, dates, travellers, cabin) and the option as the app saw it.
  search: jsonb("search").$type<Record<string, unknown>>().notNull(),
  payload: jsonb("payload").$type<Record<string, unknown>>().notNull(),
  total: money("total").notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("app_offers_owner_idx").on(t.ownerId, t.createdAt)]);

/**
 * One booking from the order sheet to confirmed. The card is authorised when the order is made, captured when the
 * desk issues, voided if issuing fails. status: requires_action | pending_agent | held | price_locked | issuing |
 * needs_answer | fare_changed | ticketing_failed | confirmed | cancelled | declined.
 */
export const appOrders = pgTable("app_orders", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  kind: text("kind").notNull(), // trip | stay | package | quote | esim
  status: text("status").notNull(),
  step: integer("step").notNull().default(0),
  idempotencyKey: text("idempotency_key").notNull(),
  // What was booked: the draft, the offers' snapshots, the preview the traveller accepted.
  draft: jsonb("draft").$type<Record<string, unknown>>().notNull(),
  snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
  lines: jsonb("lines").$type<{ key: string; icon: string; text: string; amount: number }[]>().notNull(),
  travellerIds: uuid("traveller_ids").array().notNull().default(sql`'{}'::uuid[]`),
  subtotal: money("subtotal").notNull(),
  discount: money("discount").notNull().default(0),
  promo: text("promo"),
  creditUsed: money("credit_used").notNull().default(0),
  total: money("total").notNull(),
  // The fare went up while the desk held the seats and the traveller accepted it.
  extra: money("extra").notNull().default(0),
  plan: text("plan").notNull().default("full"),
  paymentLabel: text("payment_label").notNull(),
  // The method as chosen (card id, applepay, credit, new card); the provider token is only ever in app_payments' provider.
  paymentMethod: jsonb("payment_method").$type<Record<string, unknown>>().notNull(),
  paymentId: uuid("payment_id").references(() => appPayments.id, { onDelete: "set null" }),
  requestId: uuid("request_id").references(() => appRequests.id, { onDelete: "set null" }),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  ref: text("ref"),
  supplierRef: text("supplier_ref"),
  // The person on duty, from the desk, and the one who confirmed (only set when they did, COPY.md §1).
  agentName: text("agent_name"),
  confirmedByName: text("confirmed_by_name"),
  question: jsonb("question").$type<{ text: string; options: string[]; calling?: boolean; answer?: string | null } | null>(),
  fareChange: jsonb("fare_change").$type<{ perPerson: number; total: number } | null>(),
  problem: text("problem"),
  otpTries: integer("otp_tries").notNull().default(0),
  // Mock desk: demo switches the order was made with, and when it next moves on its own.
  demo: text("demo").array().notNull().default(sql`'{}'::text[]`),
  autopilotAt: timestamp("autopilot_at", { withTimezone: true }),
  autopilotDone: text("autopilot_done").array().notNull().default(sql`'{}'::text[]`),
  confirmedAt: timestamp("confirmed_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("app_orders_idem_key").on(t.ownerId, t.idempotencyKey),
  index("app_orders_owner_idx").on(t.ownerId, t.createdAt),
  index("app_orders_status_idx").on(t.status, t.createdAt),
]);

/** Everything that happened to an order, for the desk's timeline. */
export const appOrderEvents = pgTable("app_order_events", {
  id: id(),
  orderId: uuid("order_id").notNull().references(() => appOrders.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // created | authorised | held | price_locked | question | answered | fare_changed | issuing | captured | confirmed | ticketing_failed | voided | cancelled
  actorKind: text("actor_kind").notNull(), // user | agent | system
  actorName: text("actor_name"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("app_order_events_order_idx").on(t.orderId, t.createdAt)]);

/**
 * The money side of a booked trip (lines, what was paid and how, the reference, when) and the details the trip
 * screens need beyond the M0 columns: fare rules, hotel phone and walk, pickup waits.
 */
export const appTripBookings = pgTable("app_trip_bookings", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  orderId: uuid("order_id").notNull().references(() => appOrders.id, { onDelete: "restrict" }),
  ref: text("ref").notNull(),
  lines: jsonb("lines").$type<{ key: string; icon: string; text: string; amount: number }[]>().notNull(),
  paid: jsonb("paid").$type<{ subtotal: number; discount: number; promo: string | null; creditUsed: number; charged: number; card: string }>().notNull(),
  payPlan: text("pay_plan").notNull().default("full"),
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  bookedAt: timestamp("booked_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [index("app_trip_bookings_trip_idx").on(t.tripId), uniqueIndex("app_trip_bookings_order_key").on(t.orderId)]);

/** Payment-provider webhooks, once each: a repeated event can never move money twice. */
export const appPaymentWebhooks = pgTable("app_payment_webhooks", {
  id: id(),
  provider: text("provider").notNull(),
  eventId: text("event_id").notNull(),
  type: text("type").notNull(),
  providerRef: text("provider_ref").notNull(),
  payloadSha256: text("payload_sha256").notNull(),
  result: text("result").notNull(), // applied | ignored | unknown_payment
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_payment_webhooks_event_key").on(t.provider, t.eventId)]);
