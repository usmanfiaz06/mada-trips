import { sql } from "drizzle-orm";
import {
  pgTable, uuid, text, integer, bigint, boolean, timestamp, date, jsonb, index, uniqueIndex, primaryKey,
} from "drizzle-orm/pg-core";
import { users as opsUsers, clients as opsClients, bookings as opsBookings, payments as opsPayments } from "./schema";

/*
 * Mada Trips app (the Core API). Every table is prefixed app_ and lives beside the Ops tables in the same database.
 * Ops tables are never changed from here; app rows point at them through nullable foreign keys (an app user is an
 * Ops client, an app booking becomes an Ops booking) so the two can be joined once the Ops inbox exists.
 *
 * Conventions, as in Ops: money in halalas (bigint), times as timestamptz, enums as text checked by the shared zod
 * schemas. Passport numbers are never stored in the clear (see src/lib/app/crypto.ts).
 */

const money = (name: string) => bigint(name, { mode: "number" });
const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/* ───────────── accounts ───────────── */

export const appUsers = pgTable("app_users", {
  id: id(),
  phone: text("phone"), // E.164, verified by code
  name: text("name").notNull().default(""),
  email: text("email"),
  emailRelay: boolean("email_relay").notNull().default(false),
  appleSub: text("apple_sub"),
  googleSub: text("google_sub"),
  locale: text("locale").notNull().default("en"),
  alerts: text("alerts").notNull().default("quiet"), // quiet | everything
  notifications: text("notifications").notNull().default("unknown"), // allowed | declined | unknown
  onboardedAt: timestamp("onboarded_at", { withTimezone: true }),
  // Every app user is a retail client in Ops once linked.
  opsClientId: uuid("ops_client_id").references(() => opsClients.id, { onDelete: "set null" }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("app_users_phone_key").on(t.phone).where(sql`${t.phone} IS NOT NULL`),
  uniqueIndex("app_users_apple_key").on(t.appleSub).where(sql`${t.appleSub} IS NOT NULL`),
  uniqueIndex("app_users_google_key").on(t.googleSub).where(sql`${t.googleSub} IS NOT NULL`),
]);

/** One row per signed-in device. The refresh token is stored only as a hash and rotates on every use. */
export const appSessions = pgTable("app_sessions", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  refreshHash: text("refresh_hash").notNull(),
  // The hash of the token this one replaced: if it is ever presented again, the token was stolen and the session dies.
  previousHash: text("previous_hash"),
  platform: text("platform"),
  deviceName: text("device_name"),
  appVersion: text("app_version"),
  ip: text("ip"),
  userAgent: text("user_agent"),
  createdAt: createdAt(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }).notNull().defaultNow(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  revokedReason: text("revoked_reason"),
}, (t) => [
  uniqueIndex("app_sessions_refresh_key").on(t.refreshHash),
  index("app_sessions_previous_idx").on(t.previousHash),
  index("app_sessions_user_idx").on(t.userId),
]);

/** Sign-in codes. Only a keyed hash of the code is kept; send and verify limits are counted from these rows. */
export const appOtp = pgTable("app_otp", {
  id: id(),
  phone: text("phone").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  ipHash: text("ip_hash"),
  channel: text("channel").notNull().default("sms"), // sms | whatsapp
  createdAt: createdAt(),
}, (t) => [
  index("app_otp_phone_idx").on(t.phone, t.createdAt),
  index("app_otp_ip_idx").on(t.ipHash, t.createdAt),
]);

export const appDevices = pgTable("app_devices", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  sessionId: uuid("session_id").references(() => appSessions.id, { onDelete: "set null" }),
  platform: text("platform").notNull(),
  name: text("name"),
  pushToken: text("push_token"),
  appVersion: text("app_version"),
  lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  disabledAt: timestamp("disabled_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("app_devices_push_key").on(t.pushToken).where(sql`${t.pushToken} IS NOT NULL`),
  index("app_devices_user_idx").on(t.userId),
]);

/* ───────────── household ───────────── */

/** Travellers an account books for, including the account holder (is_self). */
export const appPeople = pgTable("app_people", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  isSelf: boolean("is_self").notNull().default(false),
  givenNames: text("given_names").notNull().default(""),
  surname: text("surname").notNull().default(""),
  relation: text("relation").notNull(),
  dateOfBirth: date("date_of_birth"),
  sex: text("sex"),
  nationality: text("nationality"),
  // AES-256-GCM ciphertext ("v1.<iv>.<tag>.<data>", base64url), keyed by APP_DATA_KEY. Never the raw number.
  passportNumberEnc: text("passport_number_enc"),
  passportNumberMasked: text("passport_number_masked"),
  passportIssuingCountry: text("passport_issuing_country"),
  passportNationality: text("passport_nationality"),
  passportExpiry: date("passport_expiry"),
  passportSource: text("passport_source"),
  passportUpdatedAt: timestamp("passport_updated_at", { withTimezone: true }),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  index("app_people_owner_idx").on(t.ownerId),
  uniqueIndex("app_people_one_self").on(t.ownerId).where(sql`${t.isSelf} AND ${t.deletedAt} IS NULL`),
]);

/* ───────────── trips ───────────── */

export const appTrips = pgTable("app_trips", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  city: text("city").notNull(),
  country: text("country"),
  imageUrl: text("image_url"),
  startDate: date("start_date").notNull(),
  endDate: date("end_date"),
  travellerIds: uuid("traveller_ids").array().notNull().default(sql`'{}'::uuid[]`),
  status: text("status").notNull().default("planning"),
  bookingRef: text("booking_ref"),
  // Only set when that named person really confirmed it (COPY.md §1).
  confirmedByName: text("confirmed_by_name"),
  confirmedByOpsUserId: uuid("confirmed_by_ops_user_id").references(() => opsUsers.id, { onDelete: "set null" }),
  opsBookingId: uuid("ops_booking_id").references(() => opsBookings.id, { onDelete: "set null" }),
  imported: boolean("imported").notNull().default(false),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_trips_owner_idx").on(t.ownerId, t.startDate)]);

export const appSegments = pgTable("app_segments", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // out | back | connection
  sort: integer("sort").notNull().default(0),
  carrier: text("carrier").notNull(),
  carrierName: text("carrier_name").notNull(),
  flightNumber: text("flight_number").notNull(),
  fromAirport: text("from_airport").notNull(),
  toAirport: text("to_airport").notNull(),
  // Wall-clock times at each airport, with that airport's zone.
  departLocal: timestamp("depart_local", { withTimezone: false, mode: "string" }).notNull(),
  departTz: text("depart_tz").notNull(),
  arriveLocal: timestamp("arrive_local", { withTimezone: false, mode: "string" }).notNull(),
  arriveTz: text("arrive_tz").notNull(),
  durationMin: integer("duration_min").notNull(),
  cabin: text("cabin").notNull().default("economy"),
  terminal: text("terminal"),
  gate: text("gate"),
  seats: text("seats").array().notNull().default(sql`'{}'::text[]`),
  baggage: text("baggage"),
  status: text("status").notNull().default("scheduled"),
  statusSource: text("status_source"),
  pnr: text("pnr"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_segments_trip_idx").on(t.tripId, t.sort), index("app_segments_flight_idx").on(t.flightNumber, t.departLocal)]);

export const appStays = pgTable("app_stays", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  area: text("area"),
  address: text("address"),
  checkIn: date("check_in").notNull(),
  nights: integer("nights").notNull(),
  rooms: integer("rooms").notNull().default(1),
  price: money("price").notNull(),
  cancellation: text("cancellation"),
  status: text("status").notNull().default("held"),
  confirmation: text("confirmation"),
  supplier: text("supplier"),
  supplierRef: text("supplier_ref"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_stays_trip_idx").on(t.tripId)]);

export const appPickups = pgTable("app_pickups", {
  id: id(),
  tripId: uuid("trip_id").notNull().references(() => appTrips.id, { onDelete: "cascade" }),
  direction: text("direction").notNull(), // to_airport | from_airport
  at: timestamp("at", { withTimezone: true }).notNull(),
  driverName: text("driver_name"),
  car: text("car"),
  plate: text("plate"),
  meetingPoint: text("meeting_point"),
  phone: text("phone"),
  price: money("price").notNull().default(0),
  status: text("status").notNull().default("held"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_pickups_trip_idx").on(t.tripId)]);

/* ───────────── requests, quotes and money ───────────── */

/** The one pipe for everything a person completes: bookings, changes, cancellations, refunds, visas, Umrah. */
export const appRequests = pgTable("app_requests", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  status: text("status").notNull().default("sent"),
  summary: text("summary").notNull(),
  travellerIds: uuid("traveller_ids").array().notNull().default(sql`'{}'::uuid[]`),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  agentOpsUserId: uuid("agent_ops_user_id").references(() => opsUsers.id, { onDelete: "set null" }),
  agentName: text("agent_name"),
  promisedBy: timestamp("promised_by", { withTimezone: true }),
  // What the traveller asked for and the offer they saw, for the agent in the Ops inbox.
  details: jsonb("details").$type<Record<string, unknown>>().notNull().default({}),
  opsBookingId: uuid("ops_booking_id").references(() => opsBookings.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_requests_owner_idx").on(t.ownerId, t.createdAt), index("app_requests_status_idx").on(t.status, t.promisedBy)]);

export const appQuotes = pgTable("app_quotes", {
  id: id(),
  requestId: uuid("request_id").notNull().references(() => appRequests.id, { onDelete: "cascade" }),
  lines: jsonb("lines").$type<{ label: string; amount: number; kind: string }[]>().notNull().default([]),
  total: money("total").notNull(),
  cancellation: text("cancellation"),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
  status: text("status").notNull().default("open"),
  // The supplier response the prices came from. Prices are never written by the model.
  offerSnapshot: jsonb("offer_snapshot").$type<Record<string, unknown>>(),
  createdByOpsUserId: uuid("created_by_ops_user_id").references(() => opsUsers.id, { onDelete: "set null" }),
  createdAt: createdAt(),
}, (t) => [index("app_quotes_request_idx").on(t.requestId)]);

/** Authorised on request, captured on issue, voided if issuing fails. Provider confirmations are idempotent. */
export const appPayments = pgTable("app_payments", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  requestId: uuid("request_id").references(() => appRequests.id, { onDelete: "set null" }),
  quoteId: uuid("quote_id").references(() => appQuotes.id, { onDelete: "set null" }),
  method: text("method").notNull(),
  status: text("status").notNull().default("initiated"),
  amount: money("amount").notNull(),
  label: text("label"),
  instalments: integer("instalments").notNull().default(1),
  provider: text("provider").notNull(),
  providerRef: text("provider_ref"),
  idempotencyKey: text("idempotency_key").notNull(),
  opsPaymentId: uuid("ops_payment_id").references(() => opsPayments.id, { onDelete: "set null" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [
  uniqueIndex("app_payments_idem_key").on(t.idempotencyKey),
  uniqueIndex("app_payments_provider_ref_key").on(t.provider, t.providerRef).where(sql`${t.providerRef} IS NOT NULL`),
  index("app_payments_owner_idx").on(t.ownerId),
]);

export const appRefunds = pgTable("app_refunds", {
  id: id(),
  paymentId: uuid("payment_id").notNull().references(() => appPayments.id, { onDelete: "restrict" }),
  amount: money("amount").notNull(),
  stage: text("stage").notNull().default("requested"),
  destination: text("destination").notNull().default("original"),
  reason: text("reason"),
  expectedBy: timestamp("expected_by", { withTimezone: true }),
  providerRef: text("provider_ref"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_refunds_payment_idx").on(t.paymentId)]);

export const appInvoices = pgTable("app_invoices", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  number: text("number").notNull(),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  paymentId: uuid("payment_id").references(() => appPayments.id, { onDelete: "set null" }),
  total: money("total").notNull(),
  vat: money("vat").notNull(),
  issuedAt: timestamp("issued_at", { withTimezone: true }).notNull().defaultNow(),
  zatcaStatus: text("zatca_status").notNull().default("pending"),
  pdfPath: text("pdf_path"),
  createdAt: createdAt(),
}, (t) => [uniqueIndex("app_invoices_number_key").on(t.number), index("app_invoices_owner_idx").on(t.ownerId)]);

/** Mada credit as a ledger: the balance is the sum. Append-only (trigger in the migration). */
export const appCreditLedger = pgTable("app_credit_ledger", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "restrict" }),
  amount: money("amount").notNull(), // + credited, − spent
  kind: text("kind").notNull(), // refund | goodwill | spend | expiry | adjustment
  note: text("note"),
  refundId: uuid("refund_id").references(() => appRefunds.id, { onDelete: "restrict" }),
  paymentId: uuid("payment_id").references(() => appPayments.id, { onDelete: "restrict" }),
  createdAt: createdAt(),
}, (t) => [index("app_credit_user_idx").on(t.userId, t.createdAt)]);

/* ───────────── circles and messages ───────────── */

export const appCircles = pgTable("app_circles", {
  id: id(),
  name: text("name").notNull(),
  imageUrl: text("image_url"),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  createdBy: uuid("created_by").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
});

export const appCircleMembers = pgTable("app_circle_members", {
  circleId: uuid("circle_id").notNull().references(() => appCircles.id, { onDelete: "cascade" }),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  role: text("role").notNull().default("member"),
  shareDue: money("share_due").notNull().default(0),
  muted: boolean("muted").notNull().default(false),
  lastReadAt: timestamp("last_read_at", { withTimezone: true }),
  joinedAt: timestamp("joined_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [primaryKey({ columns: [t.circleId, t.userId] }), index("app_circle_members_user_idx").on(t.userId)]);

/** Request threads, circle chats and support. Software never passes as a person: author_kind says who wrote it. */
export const appMessages = pgTable("app_messages", {
  id: id(),
  threadKind: text("thread_kind").notNull(), // request | circle | support
  threadId: uuid("thread_id").notNull(),
  authorKind: text("author_kind").notNull(), // mada | agent | user
  authorUserId: uuid("author_user_id").references(() => appUsers.id, { onDelete: "set null" }),
  authorOpsUserId: uuid("author_ops_user_id").references(() => opsUsers.id, { onDelete: "set null" }),
  authorName: text("author_name"),
  body: text("body").notNull(),
  card: jsonb("card").$type<Record<string, unknown>>(),
  createdAt: createdAt(),
}, (t) => [index("app_messages_thread_idx").on(t.threadKind, t.threadId, t.createdAt)]);

/* ───────────── alerts ───────────── */

export const appNotifications = pgTable("app_notifications", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  level: text("level").notNull(), // time_sensitive | active | passive
  title: text("title").notNull(),
  body: text("body").notNull(),
  href: text("href"),
  data: jsonb("data").$type<Record<string, unknown>>(),
  pushedAt: timestamp("pushed_at", { withTimezone: true }),
  readAt: timestamp("read_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_notifications_user_idx").on(t.userId, t.createdAt)]);

export const appTrackedFlights = pgTable("app_tracked_flights", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  flightNumber: text("flight_number").notNull(),
  date: date("date").notNull(),
  carrierName: text("carrier_name"),
  fromAirport: text("from_airport"),
  toAirport: text("to_airport"),
  departLocal: timestamp("depart_local", { withTimezone: false, mode: "string" }),
  arriveLocal: timestamp("arrive_local", { withTimezone: false, mode: "string" }),
  status: text("status").notNull().default("scheduled"),
  gate: text("gate"),
  terminal: text("terminal"),
  source: text("source"),
  providerRef: text("provider_ref"),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [uniqueIndex("app_tracked_flights_key").on(t.userId, t.flightNumber, t.date)]);

/* ───────────── audit ───────────── */

/** Who did what in the app and its API. Append-only (trigger in the migration), like Ops' audit_events. */
export const appAudit = pgTable("app_audit", {
  id: id(),
  actorKind: text("actor_kind").notNull(), // user | agent | system
  actorId: text("actor_id"),
  action: text("action").notNull(), // e.g. auth.otp_sent, person.created, passport.updated
  entityType: text("entity_type").notNull(),
  entityId: text("entity_id"),
  summary: text("summary").notNull(),
  data: jsonb("data").$type<Record<string, unknown>>(),
  ipHash: text("ip_hash"),
  createdAt: createdAt(),
}, (t) => [index("app_audit_entity_idx").on(t.entityType, t.entityId), index("app_audit_created_idx").on(t.createdAt)]);
