import { sql } from "drizzle-orm";
import { pgTable, uuid, text, integer, boolean, timestamp, date, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";
import { appPeople, appTrips, appUsers } from "./app-schema";

/*
 * Wallet and account tables (M1): encrypted files, documents and their time-boxed grants, household details,
 * account settings and consents, email codes, saved cards, data exports and support threads.
 * The SQL lives in drizzle/pending/wallet.sql until the lead folds it into one generated migration.
 *
 * Files are never stored in the clear and never get a public URL: each file has its own random key, sealed with
 * APP_DATA_KEY (src/lib/app/crypto.ts) and bound to the file's row.
 */

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () => timestamp("updated_at", { withTimezone: true }).notNull().defaultNow();

/** One uploaded file: a document page, a support attachment, a profile photo, a data export. */
export const appFiles = pgTable("app_files", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  purpose: text("purpose").notNull(), // document | support | photo | export
  name: text("name").notNull(),
  mime: text("mime").notNull(),
  size: integer("size").notNull(),
  sha256: text("sha256").notNull(),
  storage: text("storage").notNull(), // local | s3
  storageKey: text("storage_key").notNull(),
  // The file's own AES-256-GCM key, sealed with APP_DATA_KEY and bound to this row.
  keyEnc: text("key_enc").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_files_owner_idx").on(t.ownerId, t.purpose)]);

export const appDocuments = pgTable("app_documents", {
  id: id(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  personId: uuid("person_id").notNull().references(() => appPeople.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(),
  title: text("title").notNull(),
  detail: text("detail").notNull().default(""),
  validUntil: date("valid_until"),
  fields: jsonb("fields").$type<Record<string, string>>().notNull().default({}),
  fileId: uuid("file_id").references(() => appFiles.id, { onDelete: "set null" }),
  source: text("source").notNull().default("upload"), // scan | upload | setup | manual
  removable: boolean("removable").notNull().default(true),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_documents_owner_idx").on(t.ownerId, t.personId)]);

/** Faisal may see a document for one trip, read-only, until the grant ends. Every view is audited. */
export const appDocumentGrants = pgTable("app_document_grants", {
  id: id(),
  documentId: uuid("document_id").notNull().references(() => appDocuments.id, { onDelete: "cascade" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  revokedAt: timestamp("revoked_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_document_grants_doc_idx").on(t.documentId)]);

/** What the household screen keeps beyond the passport: the word for the relation, meal, iqama, exit visa. */
export const appPersonDetails = pgTable("app_person_details", {
  personId: uuid("person_id").primaryKey().references(() => appPeople.id, { onDelete: "cascade" }),
  relationLabel: text("relation_label"),
  meal: text("meal"),
  iqamaEnc: text("iqama_enc"),
  iqamaMasked: text("iqama_masked"),
  iqamaAt: timestamp("iqama_at", { withTimezone: true }),
  exitKind: text("exit_kind").notNull().default("none"),
  exitUntil: date("exit_until"),
  updatedAt: updatedAt(),
});

/** Account settings, one row per user, created on first read. */
export const appAccounts = pgTable("app_accounts", {
  userId: uuid("user_id").primaryKey().references(() => appUsers.id, { onDelete: "cascade" }),
  preferredName: text("preferred_name"),
  preferredAt: timestamp("preferred_at", { withTimezone: true }),
  home: text("home").notNull().default("RUH"),
  homeAt: timestamp("home_at", { withTimezone: true }),
  currency: text("currency").notNull().default("SAR"),
  arabicNotify: boolean("arabic_notify").notNull().default(false),
  prefs: jsonb("prefs").$type<Record<string, unknown>>().notNull().default({}),
  faceId: boolean("face_id").notNull().default(true),
  marketing: boolean("marketing").notNull().default(false),
  analytics: boolean("analytics").notNull().default(true),
  photoFileId: uuid("photo_file_id").references(() => appFiles.id, { onDelete: "set null" }),
  photoAt: timestamp("photo_at", { withTimezone: true }),
  emailVerifiedAt: timestamp("email_verified_at", { withTimezone: true }),
  phoneVerifiedAt: timestamp("phone_verified_at", { withTimezone: true }),
  defaultCard: text("default_card").notNull().default("applepay"),
  deleteAt: timestamp("delete_at", { withTimezone: true }),
  exportRequestedAt: timestamp("export_requested_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: updatedAt(),
}, (t) => [index("app_accounts_delete_idx").on(t.deleteAt).where(sql`${t.deleteAt} IS NOT NULL`)]);

/** Every consent change, as PDPL proof. Append-only (trigger in the SQL). */
export const appConsentEvents = pgTable("app_consent_events", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  consent: text("consent").notNull(),
  granted: boolean("granted").notNull(),
  ipHash: text("ip_hash"),
  createdAt: createdAt(),
}, (t) => [index("app_consent_events_user_idx").on(t.userId, t.createdAt)]);

/** Codes that prove an email address is yours. Only a keyed hash is kept. */
export const appEmailCodes = pgTable("app_email_codes", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  codeHash: text("code_hash").notNull(),
  attempts: integer("attempts").notNull().default(0),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  consumedAt: timestamp("consumed_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_email_codes_user_idx").on(t.userId, t.createdAt)]);

/** Saved cards: the payment provider's token (encrypted) and what's printed on the front. Never a card number. */
export const appCards = pgTable("app_cards", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  brand: text("brand").notNull(),
  last4: text("last4").notNull(),
  exp: text("exp").notNull(),
  provider: text("provider").notNull(),
  tokenEnc: text("token_enc").notNull(),
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_cards_user_idx").on(t.userId)]);

/** "Download everything": one request at a time, emailed as a link that works for 7 days. */
export const appDataExports = pgTable("app_data_exports", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  email: text("email").notNull(),
  status: text("status").notNull().default("pending"), // pending | ready | sent | expired
  fileId: uuid("file_id").references(() => appFiles.id, { onDelete: "set null" }),
  requestedAt: timestamp("requested_at", { withTimezone: true }).notNull().defaultNow(),
  readyAt: timestamp("ready_at", { withTimezone: true }),
  expiresAt: timestamp("expires_at", { withTimezone: true }),
}, (t) => [index("app_data_exports_user_idx").on(t.userId, t.requestedAt)]);

/** One conversation with Mada per traveller, and one per trip. Messages are app_messages (thread_kind 'support'). */
export const appSupportThreads = pgTable("app_support_threads", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  about: text("about").notNull(),
  status: text("status").notNull().default("open"),
  userReadAt: timestamp("user_read_at", { withTimezone: true }),
  agentReadAt: timestamp("agent_read_at", { withTimezone: true }),
  assignedOpsUserId: uuid("assigned_ops_user_id"),
  lastMessageAt: timestamp("last_message_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [
  uniqueIndex("app_support_threads_user_key").on(t.userId).where(sql`${t.tripId} IS NULL`),
  uniqueIndex("app_support_threads_trip_key").on(t.userId, t.tripId).where(sql`${t.tripId} IS NOT NULL`),
  index("app_support_threads_last_idx").on(t.status, t.lastMessageAt),
]);
