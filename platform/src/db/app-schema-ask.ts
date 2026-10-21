import { pgTable, uuid, text, integer, timestamp, jsonb, index, date, primaryKey } from "drizzle-orm/pg-core";
import { appUsers } from "./app-schema";

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
  createdAt: createdAt(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_ask_threads_owner_idx").on(t.ownerId, t.updatedAt)]);

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
