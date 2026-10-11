import "server-only";
import { sql } from "drizzle-orm";
import { db } from "@/db";
import { AppError } from "../http";

/*
 * Limits keyed by something other than a signed-in person: how often one network may look up invite codes, and how
 * many wrong codes it may try. Fixed windows in app_rate_counters (one upsert per hit); old windows are swept now and
 * then. Codes carry an HMAC, so guessing one is already hopeless; these limits make trying expensive too.
 */

export const INVITE_LIMITS = {
  /** Invite previews (the link opened in the app or on the web) per network per minute. */
  previewsPerMinute: 60,
  /** The web page and its preview image per network per minute (link previewers share addresses). */
  webPreviewsPerMinute: 600,
  /** Codes that don't exist or were forged, per network per 10 minutes. Then every lookup waits. */
  badCodesPer10Min: 20,
  /** Joins by link per person per hour. */
  acceptsPerHour: 30,
} as const;

/** Count one hit against `key` in a window of `windowSeconds`; RATE_LIMITED (with Retry-After) past `limit`. */
export async function hit(key: string, limit: number, windowSeconds: number): Promise<number> {
  const windowMs = windowSeconds * 1000;
  const start = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await db.execute<{ n: number }>(sql`
    INSERT INTO app_rate_counters (key, window_start, n) VALUES (${key}, ${start.toISOString()}, 1)
    ON CONFLICT (key, window_start) DO UPDATE SET n = app_rate_counters.n + 1
    RETURNING n`);
  if (Math.random() < 0.01) void db.execute(sql`DELETE FROM app_rate_counters WHERE window_start < now() - interval '1 day'`).catch(() => {});
  const n = Number(rows[0]?.n ?? 1);
  if (n > limit) {
    const retryAfter = Math.max(1, Math.ceil((start.getTime() + windowMs - Date.now()) / 1000));
    throw new AppError("RATE_LIMITED", { vars: { seconds: retryAfter }, retryAfter });
  }
  return n;
}

/** How many hits `key` has in the current window, without counting one. */
export async function peek(key: string, windowSeconds: number): Promise<number> {
  const windowMs = windowSeconds * 1000;
  const start = new Date(Math.floor(Date.now() / windowMs) * windowMs);
  const rows = await db.execute<{ n: number }>(sql`SELECT n FROM app_rate_counters WHERE key = ${key} AND window_start = ${start.toISOString()}`);
  return Number(rows[0]?.n ?? 0);
}
