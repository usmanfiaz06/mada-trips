import "server-only";
import { keyedMode } from "../../config";
import { guarded } from "../../resilience/breaker";
import { estimateDrive } from "./estimate";
import { googleRoutes } from "./google";
import { mockRoutes } from "./mock";
import type { DriveLeg, DrivePoint, DriveQuery, RoutesSupplier } from "./types";

export type * from "./types";
export { estimateDrive } from "./estimate";

/*
 * Daily drives for plans (docs/app/ASK-INTEGRATED.md): SUPPLIER_MODE_ROUTES / GOOGLE_ROUTES_API_KEY (config.ts keyed
 * suppliers). Live: Google behind the "routes" breaker. Off, or Google down: the road estimate, marked as one, so a
 * plan never waits on a map. Each leg is kept per origin, destination and day for 24 hours on this instance, so a
 * plan redrawn ten times costs one call (CONNECT.md §24 on what Google allows us to keep).
 */

export function routesSupplier(): RoutesSupplier | null {
  const m = keyedMode("routes");
  return m === "live" ? guarded("routes", googleRoutes) : m === "mock" ? mockRoutes : null;
}

const TTL_MS = 24 * 60 * 60_000;
const g = globalThis as unknown as { __madaDrives?: Map<string, { at: number; leg: DriveLeg | null }> };
const memo = (g.__madaDrives ??= new Map());
/** About 11 m: the same hotel door is the same origin. */
const pt = (p: DrivePoint) => `${p.lat.toFixed(4)},${p.lng.toFixed(4)}`;
export const driveKey = (q: DriveQuery) => `${pt(q.from)}|${pt(q.to)}|${q.day}|${q.avoidTolls ? 1 : 0}${q.avoidFerries ? 1 : 0}`;
export const clearDriveCache = () => memo.clear();

/** One drive: cached, Google (or the mock), else the estimate. Null only when the supplier says there's no road. */
export async function driveLeg(q: DriveQuery): Promise<DriveLeg | null> {
  const key = driveKey(q);
  const hit = memo.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.leg;
  const s = routesSupplier();
  if (!s) return estimateDrive(q);
  let leg: DriveLeg | null;
  try {
    leg = await s.drive(q);
  } catch (e) {
    // Down or not configured: the estimate, not cached (the next plan may get Google's figure).
    console.warn("[routes] using the estimate", e instanceof Error ? e.message.slice(0, 120) : "");
    return estimateDrive(q);
  }
  memo.set(key, { at: Date.now(), leg });
  if (memo.size > 2000) for (const [k, v] of memo) if (Date.now() - v.at > TTL_MS) memo.delete(k);
  return leg;
}

export type DriveStop = { point: DrivePoint; day: string };

/**
 * The drives of a plan: one leg between each stop and the next, on the day of the next stop (the day you drive).
 * Stops at the same place (under 1 km) are no drive and are skipped.
 */
export async function dailyDrives(stops: DriveStop[], opts: Pick<DriveQuery, "avoidTolls" | "avoidFerries" | "language"> = {}): Promise<(DriveLeg | null)[]> {
  const pairs = stops.slice(1).map((s, i) => ({ from: stops[i]!.point, to: s.point, day: s.day }))
    .filter((p) => Math.abs(p.from.lat - p.to.lat) + Math.abs(p.from.lng - p.to.lng) > 0.01);
  return Promise.all(pairs.map((p) => driveLeg({ ...p, ...opts })));
}
