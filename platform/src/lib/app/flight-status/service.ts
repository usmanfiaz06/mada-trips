import "server-only";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { appFlightStatusCache } from "@/db/app-schema-flight-status";
import { suppliers, flightStatusVendor, type FlightStatusInfo } from "../suppliers";
import { isDue, planFor } from "./cadence";

/*
 * Flight status through a shared cache (app_flight_status_cache), so the paid supplier is asked at most as often as
 * the cadence allows (cadence.ts), however many screens, travellers and server instances want the same flight.
 * When the supplier can't answer (budget spent, circuit open, an error) the last answer stands; with none, null:
 * the app keeps the booked times and says status isn't available. Mock and "none" skip the cache: they cost nothing.
 */

export type CachedStatus = { info: FlightStatusInfo | null; fetchedAt: Date | null; fresh: boolean; vendor: string };

const paid = (v: string) => v === "aerodatabox" || v === "aviationstack" || v === "flightaware";

export async function readCache(vendor: string, flightNumber: string, day: string) {
  const [row] = await db.select().from(appFlightStatusCache)
    .where(and(eq(appFlightStatusCache.vendor, vendor), eq(appFlightStatusCache.flightNumber, flightNumber), eq(appFlightStatusCache.day, day)));
  return row ?? null;
}

export async function writeCache(vendor: string, flightNumber: string, day: string, info: FlightStatusInfo | null, at = new Date()) {
  const values = { vendor, flightNumber, day, found: !!info, info: (info as unknown as Record<string, unknown>) ?? null, fetchedAt: at };
  await db.insert(appFlightStatusCache).values(values)
    .onConflictDoUpdate({ target: [appFlightStatusCache.vendor, appFlightStatusCache.flightNumber, appFlightStatusCache.day], set: { found: values.found, info: values.info, fetchedAt: at } });
}

/**
 * Status for one flight on one day. `departAt` (ms) helps the cadence before we know the supplier's own times
 * (a booked segment knows its departure). `force` asks regardless of the cadence (still within the budget).
 */
export async function flightStatusNow(flightNumber: string, day: string, opts: { now?: number; departAt?: number | null; arriveAt?: number | null; force?: boolean } = {}): Promise<CachedStatus> {
  const vendor = flightStatusVendor();
  if (!paid(vendor)) {
    const info = await suppliers.flightStatus().lookup(flightNumber, day).catch(() => null);
    return { info, fetchedAt: new Date(), fresh: true, vendor };
  }
  const now = opts.now ?? Date.now();
  const row = await readCache(vendor, flightNumber, day).catch(() => null);
  const cached = (row?.found ? (row.info as unknown as FlightStatusInfo) : null) ?? null;
  const departAt = (cached?.departUtc ? Date.parse(cached.departUtc) : null) ?? opts.departAt ?? Date.parse(`${day}T12:00:00Z`);
  const arriveAt = (cached?.arriveUtc ? Date.parse(cached.arriveUtc) : null) ?? opts.arriveAt ?? null;
  const due = opts.force || isDue({ now, departAt, arriveAt, status: cached?.status ?? null, plan: planFor(vendor), fetchedAt: row ? row.fetchedAt.getTime() : null });
  if (!due) return { info: cached, fetchedAt: row?.fetchedAt ?? null, fresh: false, vendor };
  try {
    const info = await suppliers.flightStatus().lookup(flightNumber, day);
    const at = new Date(now);
    await writeCache(vendor, flightNumber, day, info, at).catch(() => {});
    return { info, fetchedAt: at, fresh: true, vendor };
  } catch (e) {
    console.warn(`[flight-status] ${vendor} lookup failed: ${(e as Error).name}`);
    return { info: cached, fetchedAt: row?.fetchedAt ?? null, fresh: false, vendor };
  }
}
