import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";
import { users as opsUsers } from "./schema";
import { appUsers } from "./app-schema";

/*
 * Account recovery (docs/app/AUTH.md): someone who can no longer use the number or email they signed in with asks,
 * signed out, for the account to be moved to a new contact. A person on the desk checks it's them (passport details on
 * file, their last booking) and approves or declines. The app's answer never says whether an account matched.
 *
 * Migration: drizzle/0019_account_recovery.sql.
 */
export const appRecoveryRequests = pgTable("app_recovery_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  // phone | email. Phones are E.164, emails lower case.
  oldKind: text("old_kind").notNull(),
  oldValue: text("old_value").notNull(),
  newKind: text("new_kind").notNull(),
  newValue: text("new_value").notNull(),
  note: text("note"),
  locale: text("locale").notNull().default("en"),
  // The account the old contact belonged to when the request came in. Only the desk ever sees this.
  matchedUserId: uuid("matched_user_id").references(() => appUsers.id, { onDelete: "set null" }),
  // open | approved | declined
  status: text("status").notNull().default("open"),
  decidedBy: uuid("decided_by").references(() => opsUsers.id, { onDelete: "set null" }),
  decidedAt: timestamp("decided_at", { withTimezone: true }),
  decisionNote: text("decision_note"),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("app_recovery_requests_kinds", sql`${t.oldKind} IN ('phone', 'email') AND ${t.newKind} IN ('phone', 'email')`),
  check("app_recovery_requests_status", sql`${t.status} IN ('open', 'approved', 'declined')`),
  index("app_recovery_requests_status_idx").on(t.status, t.createdAt),
  index("app_recovery_requests_old_idx").on(t.oldValue, t.createdAt),
  index("app_recovery_requests_ip_idx").on(t.ipHash, t.createdAt),
]);
