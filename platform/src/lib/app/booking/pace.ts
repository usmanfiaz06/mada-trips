import "server-only";
import { inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appPace } from "@/db/app-schema-booking";

/*
 * Pace: live flight searches kept in step with flight bookings, so the app never looks far more than it books.
 *
 * Each month allows FLOOR searches plus RATIO for every flight booked. The closer the month is to that, the longer a
 * search already made is reused (10 minutes when there is room, up to 2 hours near the line). At the line, and for
 * anyone searching far more than a person does (PERSON an hour), only answers already made are shown (up to 12
 * hours old) and anything else goes to the desk, who books it by hand. The traveller never sees an error.
 *
 * The numbers are set in the environment (FLIGHTS_PACE_RATIO, FLIGHTS_PACE_FLOOR, FLIGHTS_PACE_PERSON); the
 * defaults below are only a safe fallback. FLIGHTS_PACE=off turns it off. Only live flights are counted.
 */

const num = (v: string | undefined, d: number) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : d; };
export const paceSettings = () => ({
  on: process.env.FLIGHTS_PACE?.toLowerCase() !== "off",
  ratio: num(process.env.FLIGHTS_PACE_RATIO, 50),
  floor: num(process.env.FLIGHTS_PACE_FLOOR, 200),
  person: num(process.env.FLIGHTS_PACE_PERSON, 15),
});

const MIN = 60_000;
/** The oldest answer shown once live searches are held back. */
export const PACE_STALE_MS = 12 * 60 * MIN;

const month = (now: Date) => now.toISOString().slice(0, 7);
const hour = (now: Date) => now.toISOString().slice(0, 13);
const keys = (who: string, now: Date) => ({ looks: `fl:l:${month(now)}`, books: `fl:b:${month(now)}`, mine: `fl:w:${who}:${hour(now)}` });

export type PaceCall = { freshMs: number; live: boolean; pressure: number };

/** How old a reused answer may be and whether a new search may go out, from this month's counts. */
export function paceFrom(c: { looks: number; books: number; mine: number }, guest: boolean, s = paceSettings()): PaceCall {
  const allowed = s.floor + s.ratio * c.books;
  const pressure = allowed > 0 ? c.looks / allowed : 1;
  const personCap = guest ? s.person * 5 : s.person;
  if (pressure >= 1 || c.mine >= personCap) return { freshMs: PACE_STALE_MS, live: false, pressure };
  const freshMs = pressure < 0.5 ? 10 * MIN : pressure < 0.8 ? 30 * MIN : 120 * MIN;
  return { freshMs, live: true, pressure };
}

/** The call for this person now. A database that can't answer never blocks a search: the plain 10 minutes. */
export async function paceCall(ownerId: string | null, now = new Date()): Promise<PaceCall> {
  const s = paceSettings();
  if (!s.on) return { freshMs: 10 * MIN, live: true, pressure: 0 };
  const k = keys(ownerId ?? "guest", now);
  try {
    const rows = await db.select({ key: appPace.key, n: appPace.n }).from(appPace).where(inArray(appPace.key, [k.looks, k.books, k.mine]));
    const n = (key: string) => rows.find((r) => r.key === key)?.n ?? 0;
    return paceFrom({ looks: n(k.looks), books: n(k.books), mine: n(k.mine) }, !ownerId, s);
  } catch {
    return { freshMs: 10 * MIN, live: true, pressure: 0 };
  }
}

async function bump(key: string) {
  // One statement: the counts up, and last hours' per-person rows out.
  await db.execute(sql`WITH gone AS (DELETE FROM app_pace WHERE key LIKE 'fl:w:%' AND updated_at < now() - interval '1 day')
    INSERT INTO app_pace (key, n, updated_at) VALUES (${key}, 1, now())
    ON CONFLICT (key) DO UPDATE SET n = app_pace.n + 1, updated_at = now()`).then(() => undefined, (e) => { console.warn("[pace] not counted", e instanceof Error ? e.message : ""); });
}

/** A search that reached the supplier (the month's count). Called where the supplier is asked, so nothing is missed. */
export const paceLook = (now = new Date()) => bump(keys("", now).looks);
/** The same search, on this person's hour. */
export const paceMine = (ownerId: string | null, now = new Date()) => bump(keys(ownerId ?? "guest", now).mine);
/** A flight booked (tickets issued). */
export const paceBook = (now = new Date()) => bump(keys("", now).books);
