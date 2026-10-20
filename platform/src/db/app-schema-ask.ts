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
