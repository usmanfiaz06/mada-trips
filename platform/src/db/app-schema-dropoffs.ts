import { pgTable, uuid, text, integer, bigint, timestamp, index } from "drizzle-orm/pg-core";
import { users as opsUsers } from "./schema";
import { appUsers } from "./app-schema";

/*
 * Drop-offs on the desk (DESK-PLAN.md U4): the per-traveller search log behind "searched and left", and what the desk
 * decided about each drop-off. Migration: drizzle/0036_desk_dropoffs.sql.
 */

const id = () => uuid("id").primaryKey().defaultRandom();

/**
 * One booking search or pay sheet a signed-in traveller opened (booking/search-log.ts). Only what the desk needs to
 * follow up: a one-line summary ("RUH → Istanbul · 14–18 Nov · 2 travellers"), the lowest price seen, how many results.
 * Never a message body or anything from a passport. Guests aren't logged. A repeat of the same search within a few
 * minutes moves `at` on instead of adding a row.
 */
export const appSearchLog = pgTable("app_search_log", {
  id: id(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  kind: text("kind").notNull(), // flight | stay | pay_sheet
  summary: text("summary").notNull(),
  value: bigint("value", { mode: "number" }), // halalas: the cheapest option, or the pay sheet's total
  results: integer("results"),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_search_log_user_idx").on(t.userId, t.at), index("app_search_log_at_idx").on(t.at)]);

/**
 * The desk's marks on a drop-off, append-only: the latest one per key is where it stands. key names the drop-off
 * (search:<log id>, sheet:<log id>, pay:<payment id>, order:<order id>, quote:<request id>). status: nudged | recovered |
 * ignored. Every mark is also in the audit trails.
 */
export const appDropoffMarks = pgTable("app_dropoff_marks", {
  id: id(),
  key: text("key").notNull(),
  userId: uuid("user_id").notNull().references(() => appUsers.id, { onDelete: "cascade" }),
  status: text("status").notNull(),
  note: text("note"),
  byOpsUserId: uuid("by_ops_user_id").references(() => opsUsers.id, { onDelete: "set null" }),
  at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [index("app_dropoff_marks_key_idx").on(t.key, t.at), index("app_dropoff_marks_user_idx").on(t.userId)]);
