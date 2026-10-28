import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, bigint, boolean, timestamp, date, jsonb, index, uniqueIndex, primaryKey, check } from "drizzle-orm/pg-core";
import { appInvoices, appPayments, appPeople, appRefunds, appRequests, appTrackedFlights, appTrips, appUsers } from "./app-schema";
import { appCircleInvites } from "./app-schema-circles";
import { appPlans } from "./app-schema-plans";
import { appAskThreads } from "./app-schema-ask";

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

export type StayFacts = { phone?: string | null; addressShort?: string | null; walk?: string | null; fromAirport?: string | null; roomType?: string | null; plan?: "full" | "tabby" | "tamara"; hotelCode?: number | null; requests?: { chips: string[]; note: string } | null };
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
  // drizzle/0049_refund_wallet.sql: the bank's reference shown on the tracker, and approved by the rules at once.
  bankReference: text("bank_reference"),
  auto: boolean("auto").notNull().default(false),
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

/*
 * Companions (ASK-INTEGRATED §5, U5; migration drizzle/0045_trip_travellers.sql). Who goes on a trip: a household
 * person, a Mada user from the circle (with a household row linked to him, `person_id`, so the plan and the pay sheet
 * count him), or a pending invite. The owner's role is `owner`; everyone else's is what the owner set: view, suggest
 * (default) or edit (§5.5). `app_trips.traveller_ids` stays as a cache of the household people going.
 */
export const appTripTravellers = pgTable("app_trip_travellers", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  personId: uuid("person_id").references(() => appPeople.id, { onDelete: "cascade" }),
  userId: uuid("user_id").references(() => appUsers.id, { onDelete: "cascade" }),
  inviteId: uuid("invite_id").references(() => appCircleInvites.id, { onDelete: "set null" }),
  // The first name as the owner said it, for an invitee who has no row of his own yet.
  name: text("name"),
  role: text("role").notNull().default("suggest"), // owner | view | suggest | edit
  status: text("status").notNull().default("going"), // going | invited | declined
  addedByKind: text("added_by_kind").notNull().default("traveller"), // ask | traveller | system
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  check("app_trip_travellers_who", sql`${t.personId} IS NOT NULL OR ${t.userId} IS NOT NULL OR ${t.inviteId} IS NOT NULL`),
  check("app_trip_travellers_role", sql`${t.role} IN ('owner', 'view', 'suggest', 'edit')`),
  check("app_trip_travellers_status", sql`${t.status} IN ('going', 'invited', 'declined')`),
  uniqueIndex("app_trip_travellers_person_key").on(t.tripId, t.personId).where(sql`${t.personId} IS NOT NULL`),
  uniqueIndex("app_trip_travellers_user_key").on(t.tripId, t.userId).where(sql`${t.userId} IS NOT NULL`),
  index("app_trip_travellers_user_idx").on(t.userId, t.status),
  index("app_trip_travellers_invite_idx").on(t.inviteId),
]);

/** Per trip: whether companions who can edit see prices (§5.5). Off unless the owner turns it on. */
export const appTripSharing = pgTable("app_trip_sharing", {
  tripId: uuid("trip_id").primaryKey().references(() => appTrips.id, { onDelete: "cascade" }),
  sharePrices: boolean("share_prices").notNull().default(false),
  updatedAt: updatedAt(),
});

export type ChangeLineRow = { op: "add" | "update" | "move" | "remove" | "skip" | "unskip"; title: string; day: number | null; field: "nights" | "day" | "title" | "other" | null; from: string | null; to: string | null; text: string };

/**
 * A change a companion asked for (§5.5): the plan ops against the version he read, the lines both chats show, and
 * the owner's decision. Open for 48 hours with a reminder at 24 (the quotes job). `costs`: it needs booking, so the
 * payer decides and it goes to the payer's pay sheet. The chats it was asked and answered in, so both update.
 */
export const appPlanChangeRequests = pgTable("app_plan_change_requests", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  planId: uuid("plan_id").notNull().references(() => appPlans.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  byUserId: uuid("by_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  byThreadId: uuid("by_thread_id").references(() => appAskThreads.id, { onDelete: "set null" }),
  ownerThreadId: uuid("owner_thread_id").references(() => appAskThreads.id, { onDelete: "set null" }),
  summary: text("summary").notNull(),
  ops: jsonb("ops").$type<unknown[]>().notNull(),
  lines: jsonb("lines").$type<ChangeLineRow[]>().notNull().default([]),
  baseVersion: integer("base_version").notNull(),
  costs: boolean("costs").notNull().default(false),
  status: text("status").notNull().default("pending"), // pending | approved | declined | expired | cancelled
  reason: text("reason"),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  remindedAt: timestamp("reminded_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: createdAt(),
}, (t) => [
  check("app_plan_change_requests_status", sql`${t.status} IN ('pending', 'approved', 'declined', 'expired', 'cancelled')`),
  index("app_plan_change_requests_trip_idx").on(t.tripId, t.status),
  index("app_plan_change_requests_by_idx").on(t.byUserId, t.createdAt),
  index("app_plan_change_requests_open_idx").on(t.expiresAt).where(sql`${t.status} = 'pending'`),
]);
