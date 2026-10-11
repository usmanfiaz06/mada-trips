/*
 * How often we may ask a paid flight-status supplier about one flight, by how close it is to departure, so the
 * month's quota lasts. Pure: no clock, no I/O (the tests drive it with fixed instants).
 *
 *                       more than 48 h   6–48 h    3–6 h     last 3 h and in the air   after landing / cancelled
 *   tight (aviationstack Free, 100 calls/month)
 *                       never            never     2 h       1 h                       never
 *   basic (AeroDataBox Basic, 400 units = 200 calls/month)
 *                       24 h             12 h      90 min    30 min                    never
 *   pro   (AeroDataBox Pro and up, FlightAware, paid aviationstack)
 *                       24 h             3 h       30 min    10 min                    never
 *
 * "never" with nothing cached still allows one lookup for basic/pro (someone just tracked the flight), not for tight.
 * Polling stops 2 h after the planned arrival (or at once when the flight landed or was cancelled).
 */

import type { FlightStatus } from "@mada/shared";

export type Plan = "tight" | "basic" | "pro";

const MIN = 60_000;
const H = 60 * MIN;

const TABLE: Record<Plan, { far: number | null; day: number | null; near: number; close: number }> = {
  tight: { far: null, day: null, near: 2 * H, close: 1 * H },
  basic: { far: 24 * H, day: 12 * H, near: 90 * MIN, close: 30 * MIN },
  pro: { far: 24 * H, day: 3 * H, near: 30 * MIN, close: 10 * MIN },
};

const FINAL: ReadonlySet<FlightStatus> = new Set(["landed", "cancelled", "diverted"]);
const AIRBORNE: ReadonlySet<FlightStatus> = new Set(["departed", "in_air"]);

export type CadenceInput = {
  now: number;
  /** Best-known departure and arrival instants (ms). Arrival may be unknown. */
  departAt: number;
  arriveAt?: number | null;
  status?: FlightStatus | null;
  plan: Plan;
};

/** Milliseconds between lookups for this flight right now, or null when we shouldn't ask at all. */
export function refreshEvery({ now, departAt, arriveAt, status, plan }: CadenceInput): number | null {
  if (status && FINAL.has(status)) return null;
  const arrive = arriveAt ?? departAt + 6 * H;
  if (now > arrive + 2 * H) return null;
  const t = TABLE[plan];
  const toGo = departAt - now;
  if ((status && AIRBORNE.has(status)) || toGo <= 3 * H) return t.close;
  if (toGo <= 6 * H) return t.near;
  if (toGo <= 48 * H) return t.day;
  return t.far;
}

/** Is a fresh lookup due, given when we last asked (null: never)? */
export function isDue(input: CadenceInput & { fetchedAt: number | null }): boolean {
  const every = refreshEvery(input);
  if (input.fetchedAt === null) return every !== null || input.plan !== "tight";
  if (every === null) return false;
  return input.now - input.fetchedAt >= every;
}

/** The plan profile for a vendor, from the env the owner set. */
export function planFor(vendor: string, env: Record<string, string | undefined> = process.env): Plan {
  if (vendor === "aviationstack") return (env.AVIATIONSTACK_PLAN ?? "free").toLowerCase() === "free" ? "tight" : "pro";
  if (vendor === "aerodatabox") return (env.AERODATABOX_PLAN ?? "basic").toLowerCase() === "basic" ? "basic" : "pro";
  return "pro";
}
