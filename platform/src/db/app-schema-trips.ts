import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, date, jsonb, index, uniqueIndex, primaryKey } from "drizzle-orm/pg-core";
import { appInvoices, appPayments, appRefunds, appRequests, appTrackedFlights, appTrips, appUsers } from "./app-schema";

/*
 * The trip companion (M3): what the trip screens need beyond the M0 trip tables, the money side per charge (payments,
 * instalments, invoices and credit notes), refunds as the traveller sees them, and idempotency for actions a phone may
 * send twice (offline queue). Trips, segments, stays, pickups, requests, payments, refunds, invoices, notifications,
 * devices and tracked flights themselves stay in the M0 tables.
 *
 * Migration: drizzle/0017_app_features.sql.
 */

const money = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

export type StayFacts = { phone?: string | null; addressShort?: string | null; walk?: string | null; fromAirport?: string | null; roomType?: string | null; plan?: "full" | "tabby" | "tamara" };
export type PickupFacts = { room?: string | null; waits?: string | null; offsetMin?: number | null; city?: string | null };
export type SegmentFacts = { bookedGate?: string | null; delayMin?: number | null; predictedDelay?: boolean; statusAt?: string | null };

/** One row per trip: the facts the companion keeps (no-hotel address, company, rating, vouchers) and per-row extras. */
export const appTripFacts = pgTable("app_trip_facts", {
  tripId: uuid("trip_id").primaryKey().references(() => appTrips.id, { onDelete: "cascade" }),
  // The agent on duty for this trip (COPY.md §1), and anyone covering tonight.
  agentName: text("agent_name").notNull().default("Faisal"),
  coveringName: text("covering_name"),
  noStay: jsonb("no_stay").$type<{ label: string; address: string } | null>(),
  company: jsonb("company").$type<{ name: string; vat: string; cr: string; address: string } | null>(),
  rating: jsonb("rating").$type<{ hotel: string | null; driver: string | null; agent: string | null; note: string | null; sentAt: string | null } | null>(),
  vouchers: jsonb("vouchers").$type<{ id: string; kind: "hotel" | "meal"; title: string; body: string; code: string }[]>().notNull().default([]),
  bagReport: text("bag_report"),
  rebooked: boolean("rebooked").notNull().default(false),
  picks: text("picks").array().notNull().default(sql`'{}'::text[]`),
  weather: jsonb("weather").$type<{ tempC: number; summary: string; tip: string; rain: boolean } | null>(),
  // The disruption the traveller is in, and what they chose.
  disruption: jsonb("disruption").$type<{ kind: "delay" | "cancel" | "night"; segmentId: string; cause: string | null; source: string; decided: string | null } | null>(),
  stays: jsonb("stays").$type<Record<string, StayFacts>>().notNull().default({}),
  pickups: jsonb("pickups").$type<Record<string, PickupFacts>>().notNull().default({}),
  segments: jsonb("segments").$type<Record<string, SegmentFacts>>().notNull().default({}),
  discount: money("discount").notNull().default(0),
  bookedAt: timestamp("booked_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: updatedAt(),
});

export type InstalmentRow = { seq: number; dueOn: string; amount: number; paidAt: string | null };
export type InvoiceLineRow = { text: string; note: string | null; gross: number; vatRateBps: number; net: number; vat: number };

/** A charge on a trip: the flight, the stay, the pickups, a change or an extra. Each has its own invoice. */
export const appTripCharges = pgTable("app_trip_charges", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => appPayments.id, { onDelete: "set null" }),
  requestId: uuid("request_id").references(() => appRequests.id, { onDelete: "set null" }),
  item: text("item").notNull(), // flight | stay | pickup | change | extra
  title: text("title").notNull(),
  sub: text("sub").notNull().default(""),
  amount: money("amount").notNull(),
  method: text("method").notNull(), // card | mada | applepay | tabby | tamara | credit …
  label: text("label"),
  plan: text("plan").notNull().default("full"),
  instalments: jsonb("instalments").$type<InstalmentRow[] | null>(),
  creditUsed: money("credit_used").notNull().default(0),
  discount: money("discount").notNull().default(0),
  lines: jsonb("lines").$type<InvoiceLineRow[]>().notNull().default([]),
  invoiceId: uuid("invoice_id").references(() => appInvoices.id, { onDelete: "set null" }),
  paidAt: timestamp("paid_at", { withTimezone: true }).notNull().defaultNow(),
  createdAt: createdAt(),
}, (t) => [index("app_trip_charges_trip_idx").on(t.tripId, t.paidAt), index("app_trip_charges_owner_idx").on(t.ownerId)]);

/** The document behind an app_invoices row: its kind, lines, buyer, and what it cancels or replaces. */
export const appInvoiceDetails = pgTable("app_invoice_details", {
  invoiceId: uuid("invoice_id").primaryKey().references(() => appInvoices.id, { onDelete: "cascade" }),
  chargeId: uuid("charge_id").references(() => appTripCharges.id, { onDelete: "set null" }),
  kind: text("kind").notNull(), // simplified | tax | credit_note
  status: text("status").notNull().default("issued"), // draft | issued
  customer: text("customer").notNull(),
  company: jsonb("company").$type<{ name: string; vat: string; cr: string; address: string } | null>(),
  againstInvoiceId: uuid("against_invoice_id").references(() => appInvoices.id, { onDelete: "set null" }),
  paidWith: text("paid_with"),
  lines: jsonb("lines").$type<InvoiceLineRow[]>().notNull(),
  createdAt: createdAt(),
}, (t) => [index("app_invoice_details_charge_idx").on(t.chargeId)]);

/** Invoice numbering: one gapless sequence per series and year (MT-26, TI-26, CN-26). */
export const appInvoiceCounters = pgTable("app_invoice_counters", {
  series: text("series").primaryKey(),
  next: integer("next").notNull().default(1),
});

/** A refund as the traveller asked for it (one or more charges); app_refunds holds one row per payment refunded. */
export const appRefundGroups = pgTable("app_refund_groups", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  title: text("title").notNull(),
  amount: money("amount").notNull(),
  stage: text("stage").notNull().default("requested"), // requested | approved | sent | rejected
  destination: text("destination").notNull(), // original | credit | instalments
  provider: text("provider"),
  card: text("card").notNull(),
  reason: text("reason"),
  anyway: boolean("anyway").notNull().default(false),
  reject: text("reject"),
  alt: text("alt"),
  law: boolean("law").notNull().default(false),
  airline: text("airline"),
  cancelledCount: integer("cancelled_count").notNull().default(0),
  cancelledAmount: money("cancelled_amount").notNull().default(0),
  expectedBy: timestamp("expected_by", { withTimezone: true }),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  clientKey: text("client_key").notNull(),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("app_refund_groups_key").on(t.ownerId, t.clientKey), index("app_refund_groups_owner_idx").on(t.ownerId, t.createdAt)]);

export const appRefundItems = pgTable("app_refund_items", {
  refundId: uuid("refund_id").primaryKey().references(() => appRefunds.id, { onDelete: "cascade" }),
  groupId: uuid("group_id").notNull().references(() => appRefundGroups.id, { onDelete: "cascade" }),
  chargeId: uuid("charge_id").notNull().references(() => appTripCharges.id, { onDelete: "restrict" }),
  credited: money("credited").notNull(),
  creditNoteId: uuid("credit_note_id").references(() => appInvoices.id, { onDelete: "set null" }),
}, (t) => [index("app_refund_items_group_idx").on(t.groupId), index("app_refund_items_charge_idx").on(t.chargeId)]);

/** Actions a phone may send twice (it queued them offline): the first result is kept and returned again. */
export const appTripIdempotency = pgTable("app_trip_idempotency", {
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  scope: text("scope").notNull(), // ask | change | disruption
  key: text("key").notNull(),
  result: jsonb("result").$type<Record<string, unknown>>().notNull(),
  createdAt: createdAt(),
}, (t) => [primaryKey({ name: "app_trip_idempotency_pk", columns: [t.ownerId, t.scope, t.key] })]);

/** What a tracked flight needs beyond the M0 row: whether to alert, and what the schedule said. */
export const appTrackedExtras = pgTable("app_tracked_extras", {
  trackedId: uuid("tracked_id").primaryKey().references(() => appTrackedFlights.id, { onDelete: "cascade" }),
  alerts: boolean("alerts").notNull().default(false),
  known: boolean("known").notNull().default(false),
  durationMin: integer("duration_min"),
  brand: text("brand"),
  lastAlertAt: timestamp("last_alert_at", { withTimezone: true }),
});

/** Gate changes and delays already told to the traveller, so a repeated webhook never pushes twice. */
export const appFlightEvents = pgTable("app_flight_events", {
  id: id(),
  flightNumber: text("flight_number").notNull(),
  day: date("day").notNull(),
  kind: text("kind").notNull(), // gate | delay | cancelled | time
  value: text("value"),
  source: text("source").notNull(),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_flight_events_key").on(t.flightNumber, t.day, t.kind, t.value)]);
