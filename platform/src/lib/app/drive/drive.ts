import "server-only";
import { eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appDriveBudget, appDriveCache, type PlanDriveJson } from "@/db/app-schema-plans";
import { bordersOf, countryOf } from "./borders";
import { routesProvider } from "./google";
import { osrmProvider } from "./osrm";

/*
 * Drives (docs/app/ASK-INTEGRATED.md §4): km, time, tolls, ferries and border crossings between two points, for the
 * drive legs of a living plan. The map provider (Google Routes via suppliers/routes) first, self-hosted OSRM as the
 * fallback (or first, DRIVE_PROVIDER=osrm), then the straight-line estimate, which never carries a time.
 *
 *   cache   app_drive_cache, keyed by both ends rounded to ~100 m, mode, avoid flags and departure bucket; a hit makes
 *           no call. Map answers kept 30 days (DRIVE_CACHE_DAYS_MAP), OSRM 90; "no road" is an answer and is kept too.
 *   budget  DRIVE_DAILY_CALLS router calls per UTC day in total (default 2,000); past it, the estimate.
 *   source  what a traveller sees is "map" or "estimate", never who answered.
 *
 * The agent may quote km and time only from these values (the leg's drive, or `driveLine`).
 */

export type DrivePoint = { lat: number; lng: number; country?: string | null; name?: string | null };

export type DriveQuery = {
  from: DrivePoint;
  to: DrivePoint;
  /** The day of the drive (YYYY-MM-DD), for the departure bucket. */
  date?: string | null;
  /** Local "HH:mm" when the leg has one: night (20:00–05:59) or day. */
  at?: string | null;
  avoidTolls?: boolean;
  avoidFerries?: boolean;
  language?: "en" | "ar";
};

/** One border on the way: ISO country codes (null when unknown) and the crossing's name when we can tell it. */
export type DriveCrossing = { from: string | null; to: string | null; name: string | null };

export type DriveResult = {
  km: number | null;
  /** Without traffic. Null on an estimate or no road: never a time no router returned. */
  minutes: number | null;
  /** True when the route uses them; null when unknown (never a guessed "no"). */
  tolls: boolean | null;
  ferries: boolean | null;
  crossings: DriveCrossing[];
  /** "map": a router answered · "estimate": straight line × 1.25, no time. */
  source: "map" | "estimate";
  /** No road between the two (an island, a closed border): offer a flight or a ferry instead. */
  noRoute: boolean;
  asOf: string;
  /** When the figure should be fetched again (null for an estimate: on the next open). */
  expiresAt: string | null;
};

/** What a router hands back; null from route() is "no road", a throw is "down". */
export type ProviderRoute = { km: number; minutes: number; tolls: boolean | null; ferries: boolean | null; line: [number, number][] | null; routerSaysBorder: boolean };
export interface DriveProvider {
  readonly name: "google" | "osrm" | "mock";
  route(q: DriveQuery): Promise<ProviderRoute | null>;
}

const DAY_MS = 86_400_000;
const ttlDays = (p: DriveProvider["name"]) =>
  p === "osrm" ? 90 : p === "mock" ? 1 : Math.max(1, Number(process.env.DRIVE_CACHE_DAYS_MAP) || 30);
export const dailyBudget = () => {
  const n = Number(process.env.DRIVE_DAILY_CALLS);
  return Number.isFinite(n) && process.env.DRIVE_DAILY_CALLS?.trim() ? Math.max(0, Math.floor(n)) : 2000;
};

/** Providers in the order to try: the map provider then OSRM, or OSRM first when DRIVE_PROVIDER=osrm. */
export function driveProviders(): DriveProvider[] {
  const map = routesProvider();
  const osrm = osrmProvider();
  const order = process.env.DRIVE_PROVIDER?.trim().toLowerCase() === "osrm" ? [osrm, map] : [map, osrm];
  return order.filter((p): p is DriveProvider => !!p);
}

/* ───────────── key ───────────── */

const r3 = (n: number) => n.toFixed(3);
const WEEKEND_FRI_SAT = new Set(["SA", "AE", "QA", "BH", "KW", "OM", "JO"]);

export function departureBucket(q: Pick<DriveQuery, "from" | "date" | "at">): string {
  const wd = q.date && /^\d{4}-\d{2}-\d{2}$/.test(q.date) ? new Date(`${q.date}T12:00:00Z`).getUTCDay() : null;
  const friSat = WEEKEND_FRI_SAT.has(countryOf(q.from) ?? "");
  const weekend = wd === null ? false : friSat ? wd === 5 || wd === 6 : wd === 0 || wd === 6;
  const h = q.at && /^\d{2}:\d{2}/.test(q.at) ? Number(q.at.slice(0, 2)) : 12;
  return `${weekend ? "weekend" : "weekday"}-${h >= 20 || h < 6 ? "night" : "day"}`;
}

export function driveKey(q: DriveQuery): string {
  const avoid = `${q.avoidTolls ? "t" : ""}${q.avoidFerries ? "f" : ""}` || "-";
  return `drive|${r3(q.from.lat)},${r3(q.from.lng)}|${r3(q.to.lat)},${r3(q.to.lng)}|${avoid}|${departureBucket(q)}`;
}

/* ───────────── estimate ───────────── */

export function crowKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** §4.4: great circle × 1.25, rounded to tens (hundreds past 500 km), no time. */
export function estimateDrive(q: DriveQuery, now = new Date()): DriveResult {
  const raw = crowKm(q.from, q.to) * 1.25;
  const km = raw >= 500 ? Math.round(raw / 100) * 100 : Math.max(1, Math.round(raw / 10) * 10);
  return { km, minutes: null, tolls: null, ferries: null, crossings: bordersOf(q.from, q.to, null), source: "estimate", noRoute: false, asOf: now.toISOString(), expiresAt: null };
}

/* ───────────── budget ───────────── */

/** Takes one call from today's budget; false when it's spent (the call isn't made). */
export async function spendBudget(now = new Date()): Promise<boolean> {
  const limit = dailyBudget();
  if (limit <= 0) return false;
  const day = now.toISOString().slice(0, 10);
  const [row] = await db.insert(appDriveBudget).values({ day, calls: 1 })
    .onConflictDoUpdate({ target: appDriveBudget.day, set: { calls: sql`${appDriveBudget.calls} + 1` }, where: sql`${appDriveBudget.calls} < ${limit}` })
    .returning({ calls: appDriveBudget.calls });
  return !!row;
}

/* ───────────── the drive ───────────── */

type Stored = Pick<DriveResult, "km" | "minutes" | "tolls" | "ferries" | "crossings" | "noRoute">;

/** One drive: the cache, else a router within today's budget, else the estimate. */
export async function getDrive(q: DriveQuery, now = new Date()): Promise<DriveResult> {
  const key = driveKey(q);
  const [hit] = await db.select().from(appDriveCache).where(eq(appDriveCache.key, key));
  if (hit && hit.expiresAt > now) {
    return { ...(hit.result as Stored), source: "map", asOf: hit.fetchedAt.toISOString(), expiresAt: hit.expiresAt.toISOString() };
  }
  for (const p of driveProviders()) {
    if (!(await spendBudget(now))) return estimateDrive(q, now);
    let route: ProviderRoute | null;
    try {
      route = await p.route(q);
    } catch (e) {
      console.warn(`[drive] ${p.name} gave no answer`, e instanceof Error ? e.message.slice(0, 120) : "");
      continue;
    }
    const stored: Stored = route
      ? { km: route.km, minutes: route.minutes, tolls: route.tolls, ferries: route.ferries, crossings: bordersOf(q.from, q.to, route.line, route.routerSaysBorder), noRoute: false }
      : { km: null, minutes: null, tolls: null, ferries: null, crossings: [], noRoute: true };
    const expiresAt = new Date(now.getTime() + ttlDays(p.name) * DAY_MS);
    const row = { key, mode: "drive", bucket: departureBucket(q), provider: p.name, result: stored, fetchedAt: now, expiresAt };
    await db.insert(appDriveCache).values(row).onConflictDoUpdate({ target: appDriveCache.key, set: row });
    return { ...stored, source: "map", asOf: now.toISOString(), expiresAt: expiresAt.toISOString() };
  }
  return estimateDrive(q, now);
}

/* ───────────── words ───────────── */

const COUNTRY: Record<string, string> = {
  SA: "Saudi Arabia", BH: "Bahrain", QA: "Qatar", AE: "the UAE", OM: "Oman", KW: "Kuwait", JO: "Jordan", SG: "Singapore", MY: "Malaysia", TH: "Thailand", TR: "Türkiye",
};
const fmtKm = (km: number) => `${Math.round(km).toLocaleString("en-US")} km`;
export const fmtMinutes = (m: number) => (m < 60 ? `${m} min` : m % 60 ? `${Math.floor(m / 60)} h ${m % 60} min` : `${m / 60} h`);

/** "Crosses into Malaysia via Woodlands Causeway" per crossing. */
export const crossingLines = (cs: DriveCrossing[]) =>
  cs.map((c) => (c.to ? `Crosses into ${COUNTRY[c.to] ?? c.to}` : "Crosses a border") + (c.name ? ` via ${c.name}` : ""));

/** The one line a leg shows and the agent may quote. */
export function driveLine(r: Pick<DriveResult, "km" | "minutes" | "source" | "noRoute" | "crossings" | "tolls" | "ferries">): string {
  if (r.noRoute) return "No road route found. A flight or ferry instead?";
  if (r.km === null) return "Distance not known yet";
  const parts = r.source === "estimate" || r.minutes === null
    ? [`About ${fmtKm(r.km)}`, "estimate, straight-line"]
    : [fmtKm(r.km), `about ${fmtMinutes(r.minutes)}`];
  if (r.tolls) parts.push("tolls");
  if (r.ferries) parts.push("ferry");
  return [...parts, ...crossingLines(r.crossings)].join(" · ");
}

/** The leg's stored drive (app_plan_items.drive): numbers, "map" or "estimate", and the line. */
export function toPlanDrive(r: DriveResult): PlanDriveJson {
  return {
    km: r.km, minutes: r.minutes, tolls: r.tolls, ferries: r.ferries,
    borders: r.crossings.map((c) => `${c.from ?? "?"}→${c.to ?? "?"}`), crossings: r.crossings,
    source: r.source, asOf: r.asOf, expiresAt: r.expiresAt, noRoute: r.noRoute, line: driveLine(r),
    ...(r.source === "estimate" ? { estimate: true } : {}),
  };
}

/** A leg's drive should be asked again: none yet, an estimate (re-fetched on the next write), or past its expiry. */
export function driveStale(d: PlanDriveJson | null | undefined, now = new Date()): boolean {
  if (!d) return true;
  if (d.estimate || d.source === "estimate") return true;
  return !!d.expiresAt && new Date(d.expiresAt) <= now;
}
