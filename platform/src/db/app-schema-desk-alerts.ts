import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, jsonb, index, uniqueIndex } from "drizzle-orm/pg-core";

/*
 * Desk alerts (DESK-PLAN.md U8): what the lead's bell says about the desk, and the dedupe behind "fires once". A row is
 * written the first time a condition is seen (an SLA breach, a supplier balance below its threshold, a spike in drop-offs
 * or failed payments, nobody on duty with urgent work) and cleared when it stops being true. While a key has an open
 * row nothing fires again for it; the next breach or dip is a new row. Migration: drizzle/0041_desk_alerts.sql.
 */

export const deskAlerts = pgTable("desk_alerts", {
  id: uuid("id").primaryKey().defaultRandom(),
  /** sla:<ticket id>:<clock start ms> · balance:<supplier> · spike:dropoffs · spike:payments · noduty */
  key: text("key").notNull(),
  kind: text("kind").notNull(), // sla | balance | dropoffs | payments | noduty
  tone: text("tone").notNull(), // urgent | warn
  href: text("href").notNull(),
  /** What the bell's line is built from (ref, subject, supplier, counts): English and Arabic are made at read time. */
  data: jsonb("data").$type<Record<string, string | number | null>>().notNull(),
  firedAt: timestamp("fired_at", { withTimezone: true }).notNull().defaultNow(),
  clearedAt: timestamp("cleared_at", { withTimezone: true }),
  /** On-call paging for this alert (noduty): sms, push, sms+push, failed or unconfigured. Null when it doesn't page. */
  paged: text("paged"),
}, (t) => [
  uniqueIndex("desk_alerts_open_key").on(t.key).where(sql`${t.clearedAt} IS NULL`),
  index("desk_alerts_fired_idx").on(t.firedAt),
]);
