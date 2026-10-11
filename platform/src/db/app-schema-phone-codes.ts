import { sql } from "drizzle-orm";
import { pgTable, uuid, text, timestamp, index, check } from "drizzle-orm/pg-core";

/*
 * Phone codes by WhatsApp or SMS (docs/app/AUTH.md, "Phone codes on WhatsApp"). Supabase Auth makes the code and calls
 * our Send SMS hook, but it doesn't tell the hook which channel the app asked for. So, just before asking Supabase,
 * the app leaves a hint here (POST /auth/phone-channel); the hook reads the newest one for the number and writes down
 * how the code actually went, which the app reads back with the ticket (the row id).
 *
 * The number is kept only as a keyed hash. Rows are useful for 10 minutes; the retention job may delete older ones.
 * Migration: drizzle/0020_phone_code_channel.sql.
 */
export const appPhoneCodeHints = pgTable("app_phone_code_hints", {
  /** The ticket the app holds. */
  id: uuid("id").primaryKey().defaultRandom(),
  /** HMAC of the E.164 number (pepper), never the number. */
  phoneHash: text("phone_hash").notNull(),
  /** whatsapp | sms, or null for the usual channel. */
  wanted: text("wanted"),
  /** whatsapp | sms once the hook has sent a code for it. */
  sentVia: text("sent_via"),
  sentAt: timestamp("sent_at", { withTimezone: true }),
  ipHash: text("ip_hash"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  check("app_phone_code_hints_wanted", sql`${t.wanted} IS NULL OR ${t.wanted} IN ('whatsapp', 'sms')`),
  check("app_phone_code_hints_sent_via", sql`${t.sentVia} IS NULL OR ${t.sentVia} IN ('whatsapp', 'sms')`),
  index("app_phone_code_hints_phone_idx").on(t.phoneHash, t.createdAt),
  index("app_phone_code_hints_ip_idx").on(t.ipHash, t.createdAt),
]);
