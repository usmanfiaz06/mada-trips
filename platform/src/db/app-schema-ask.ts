import { pgTable, uuid, text, integer, timestamp, jsonb, index, date, primaryKey } from "drizzle-orm/pg-core";
import { appPeople, appTrips, appUsers } from "./app-schema";
import { appDocuments, appFiles } from "./app-schema-wallet";
import { users as opsUsers } from "./schema";

/*
 * Ask Mada as a conversation (lib/app/ask-chat, docs/app/ASK-CHAT.md). One row per thread: the model-facing history,
 * append-only and kept exactly as the API returned it (thinking blocks included, so preserved thinking stays valid),
 * already redacted (no passport or card numbers ever reach it). Token counts and cost per thread for the cost log;
 * the daily spend per person and in total for the cap. Migration: drizzle/0034_ask_chat.sql.
 */

const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();

export const appAskThreads = pgTable("app_ask_threads", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  /** Anthropic.Beta.BetaMessageParam[]: user, system (the turn's context) and assistant turns, never edited. */
  messages: jsonb("messages").$type<unknown[]>().notNull().default([]),
  /** What the traveller and Mada said, for the app to show again (text and cards only). */
  transcript: jsonb("transcript").$type<unknown[]>().notNull().default([]),
  lang: text("lang").notNull().default("en"),
  turns: integer("turns").notNull().default(0),
  inputTokens: integer("input_tokens").notNull().default(0),
  outputTokens: integer("output_tokens").notNull().default(0),
  cacheReadTokens: integer("cache_read_tokens").notNull().default(0),
  cacheWriteTokens: integer("cache_write_tokens").notNull().default(0),
  /** US dollars × 1,000,000. */
  costMicros: integer("cost_micros").notNull().default(0),
  /**
   * Older turns folded into a few lines by the fast model once the thread passed its token budget (ask-chat/fold.ts):
   * `messages` then holds only the recent turns, and this summary is read in front of them. Migration 0035.
   */
  summary: text("summary"),
  /** How many turns the summary stands for (turns - folded_turns are still in `messages` word for word). */
  foldedTurns: integer("folded_turns").notNull().default(0),
  /**
   * Who answers (desk/ask, DESK-PLAN.md U5): "ai", or "agent" while a person on the desk has taken the thread over.
   * While taken over the model never runs: the traveller's messages are kept in the transcript and the agent replies
   * from the desk. Migration 0038.
   */
  mode: text("mode").notNull().default("ai"),
  /** The Ops user who took it over (null in "ai" mode). */
  takenBy: uuid("taken_by").references(() => opsUsers.id, { onDelete: "set null" }),
  takenAt: timestamp("taken_at", { withTimezone: true }),
  /** When the model handed it to the desk (talk_to_human). */
  handedOffAt: timestamp("handed_off_at", { withTimezone: true }),
  /** What happened while a person had it, for the model's next turn after Hand back; cleared once read. */
  deskNote: text("desk_note"),
  /**
   * The conversations list (docs/app/ASK-INTEGRATED.md §2, migration 0042). title: "Riyadh → AlUla · 20–22 Nov", written
   * on the server after each turn until the traveller renames it. titled_by: traveller (renamed, never touched again),
   * or how the automatic title was made, weakest first: words (the first words) → place ("eSIM for Pakistan") →
   * route (start and destination) → trip (the attached trip). A later turn only ever makes it stronger.
   */
  title: text("title"),
  titledBy: text("titled_by"),
  /** The trip this chat is about (at most one); the oldest unarchived chat of a trip is its primary. */
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "set null" }),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** The last line said, by anyone: the list's order. */
  lastAt: timestamp("last_at", { withTimezone: true }).notNull().defaultNow(),
  /** That last line, redacted, ≤ 140 characters. From the transcript, never from `messages`. */
  preview: text("preview"),
  /** The thread reached MAX_TURNS: the list says "Continue in a new one", and the new one carries the trip. */
  endedAt: timestamp("ended_at", { withTimezone: true }),
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("app_ask_threads_owner_idx").on(t.ownerId, t.updatedAt), index("app_ask_threads_updated_idx").on(t.updatedAt),
  index("app_ask_threads_list_idx").on(t.ownerId, t.archivedAt, t.lastAt.desc()), index("app_ask_threads_trip_idx").on(t.ownerId, t.tripId),
]);

/** Spend per day, per person and for everyone (owner_key "all"), for ASK_CHAT_DAILY_USD and ASK_CHAT_USER_DAILY_USD. */
export const appAskSpend = pgTable("app_ask_spend", {
  day: date("day").notNull(),
  ownerKey: text("owner_key").notNull(),
  costMicros: integer("cost_micros").notNull().default(0),
  turns: integer("turns").notNull().default(0),
}, (t) => [primaryKey({ columns: [t.day, t.ownerKey] })]);

/**
 * What Mada remembers about a traveller across conversations (ask-chat/memory.ts, docs/app/ASK-CHAT.md §7): small
 * lasting facts the traveller said ("aisle seat", "flies from Jeddah", "mother uses a wheelchair"), saved by the
 * `remember` tool, sensitive ones only after a yes. Never a passport, card or anything redaction removes. Shown and
 * deletable in Account → What Mada remembers; removed with the account. Migration: drizzle/0035_ask_memory.sql.
 */
export const appAskMemory = pgTable("app_ask_memory", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  /** home_airport | airline | cabin | seat | budget | food | mobility | health | family | contact | other */
  kind: text("kind").notNull(),
  text: text("text").notNull(),
  /** chat (said in a conversation) | booking (read from a booking) */
  source: text("source").notNull().default("chat"),
  createdAt: createdAt(),
  /** The last turn it was put in front of the model (for "most relevant first"). */
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
}, (t) => [index("app_ask_memory_owner_idx").on(t.ownerId, t.createdAt)]);

/**
 * Documents sent in a chat (ask-chat/attachments.ts, docs/app/ASK-INTEGRATED.md §6, migration 0046). One row per photo
 * or file: what its lines were read as, kept redacted in `result` for the transcript (first name, the last two
 * characters, the expiry), and the full fields sealed in `fields_enc` only until the traveller taps the card (then
 * saved where they belong, or dropped). The file, when the phone sent one, is deleted on the tap or after 24 hours
 * (the documents job), whichever comes first.
 */
export const appAskAttachments = pgTable("app_ask_attachments", {
  id: uuid("id").primaryKey().defaultRandom(),
  threadId: uuid("thread_id").references(() => appAskThreads.id, { onDelete: "set null" }),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  fileId: uuid("file_id").references(() => appFiles.id, { onDelete: "set null" }),
  /** passport | visa | id | ticket | booking | photo | other */
  kindGuess: text("kind_guess").notNull(),
  /** The card's case and what it may say (ChatDocCard without the people list). Never the number. */
  result: jsonb("result").$type<Record<string, unknown>>().notNull().default({}),
  /** The read fields (names, number, dates), AES-GCM under APP_DATA_KEY, bound to this row. Cleared on the tap. */
  fieldsEnc: text("fields_enc"),
  fingerprint: text("fingerprint"),
  personId: uuid("person_id").references(() => appPeople.id, { onDelete: "set null" }),
  documentId: uuid("document_id").references(() => appDocuments.id, { onDelete: "set null" }),
  /** read (waiting for the tap) | confirmed | booking_only | discarded | wiped */
  status: text("status").notNull().default("read"),
  /** "This booking only": when the full number is wiped from the person (the last two characters and expiry stay). */
  wipeAt: timestamp("wipe_at", { withTimezone: true }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_ask_attachments_owner_idx").on(t.ownerId, t.createdAt), index("app_ask_attachments_thread_idx").on(t.threadId), index("app_ask_attachments_status_idx").on(t.status, t.createdAt)]);

/**
 * "Share your passport for this trip?" (ASK-INTEGRATED.md §5.4): the trip owner asks a companion with their own account;
 * the companion answers with a tap in their app. Shared, the owner reads the passport only as its mask and expiry,
 * until the trip ends + 7 days. draft (the card, before the owner's tap) | sent | shared | declined | expired.
 */
export const appDocShareRequests = pgTable("app_doc_share_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: uuid("owner_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  toUserId: uuid("to_user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  tripId: uuid("trip_id").references(() => appTrips.id, { onDelete: "cascade" }),
  threadId: uuid("thread_id").references(() => appAskThreads.id, { onDelete: "set null" }),
  kind: text("kind").notNull().default("passport"),
  status: text("status").notNull().default("draft"),
  /** The companion's own household row that holds the passport (theirs, never copied to the owner). */
  personId: uuid("person_id").references(() => appPeople.id, { onDelete: "set null" }),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  answeredAt: timestamp("answered_at", { withTimezone: true }),
  createdAt: createdAt(),
}, (t) => [index("app_doc_share_owner_idx").on(t.ownerId, t.tripId), index("app_doc_share_to_idx").on(t.toUserId, t.status)]);
