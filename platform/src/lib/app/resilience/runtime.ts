import "server-only";
import { eq, sql } from "drizzle-orm";
import { compareVersions, type ConfigResponse, type Maintenance } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";

/*
 * The switches behind GET /config: which app versions may still talk to us, planned maintenance and feature flags.
 * Defaults come from the environment; Ops can override any of them without a deploy (app_runtime, key "config").
 * Read through a 15-second cache, because route() consults it on every request.
 *
 *   APP_MIN_VERSION           below this the API answers 426 UPGRADE_REQUIRED (default 0.0.0: nobody is blocked)
 *   APP_LATEST_VERSION        the version in the stores (default 0.1.0)
 *   APP_MAINTENANCE           "on" pauses every change (POST/PATCH/PUT/DELETE) with 503 MAINTENANCE; reads still work
 *   APP_MAINTENANCE_UNTIL     ISO time it ends (after which it switches itself off)
 *   APP_MAINTENANCE_MESSAGE   a finished sentence for the maintenance screen
 *   APP_FEATURES              comma list, "name" on and "-name" off, e.g. "offlineOutbox,-circlesDiscover"
 *   APP_STORE_URL_IOS / APP_STORE_URL_ANDROID
 */

export type RuntimeConfig = Omit<ConfigResponse, "serverTime">;

export const DEFAULT_FEATURES: Record<string, boolean> = { offlineOutbox: true, statusChecks: true, softUpdatePrompt: true };

function fromEnv(): RuntimeConfig {
  const e = process.env;
  const features = { ...DEFAULT_FEATURES };
  for (const raw of (e.APP_FEATURES ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if (raw.startsWith("-")) features[raw.slice(1)] = false;
    else features[raw] = true;
  }
  return {
    minVersion: e.APP_MIN_VERSION || "0.0.0",
    latestVersion: e.APP_LATEST_VERSION || "0.1.0",
    maintenance: { on: e.APP_MAINTENANCE === "on", message: e.APP_MAINTENANCE_MESSAGE || null, until: e.APP_MAINTENANCE_UNTIL || null },
    features,
    storeUrls: {
      ios: e.APP_STORE_URL_IOS || "https://apps.apple.com/app/mada-trips",
      android: e.APP_STORE_URL_ANDROID || "https://play.google.com/store/apps/details?id=sa.madatrips.app",
    },
  };
}

type Override = Partial<Omit<RuntimeConfig, "maintenance">> & { maintenance?: Partial<Maintenance> };

function merge(base: RuntimeConfig, o: Override): RuntimeConfig {
  return {
    ...base,
    ...(o.minVersion ? { minVersion: o.minVersion } : null),
    ...(o.latestVersion ? { latestVersion: o.latestVersion } : null),
    maintenance: { ...base.maintenance, ...(o.maintenance ?? {}) },
    features: { ...base.features, ...(o.features ?? {}) },
    storeUrls: { ...base.storeUrls, ...(o.storeUrls ?? {}) },
  };
}

/** Maintenance that has passed its end time is over, whatever the switch says. */
function settle(c: RuntimeConfig, now = Date.now()): RuntimeConfig {
  const until = c.maintenance.until ? Date.parse(c.maintenance.until) : NaN;
  if (c.maintenance.on && Number.isFinite(until) && until <= now) return { ...c, maintenance: { ...c.maintenance, on: false } };
  return c;
}

let cache: { at: number; value: RuntimeConfig } | null = null;
const TTL = 15_000;

export async function runtimeConfig(): Promise<RuntimeConfig> {
  if (cache && Date.now() - cache.at < TTL) return settle(cache.value);
  let value = fromEnv();
  try {
    const [row] = await db.select({ value: appRuntime.value }).from(appRuntime).where(eq(appRuntime.key, "config")).limit(1);
    if (row) value = merge(value, row.value as Override);
  } catch {
    // The table isn't there yet or the database is slow: the environment's defaults still answer.
  }
  cache = { at: Date.now(), value };
  return settle(value);
}

/** Change the switches (Ops, scripts, tests). Takes effect on this instance at once, elsewhere within 15 seconds. */
export async function setRuntimeConfig(patch: Override | null): Promise<void> {
  if (patch === null) await db.delete(appRuntime).where(eq(appRuntime.key, "config"));
  else {
    await db.insert(appRuntime).values({ key: "config", value: patch as Record<string, unknown> })
      .onConflictDoUpdate({ target: appRuntime.key, set: { value: patch as Record<string, unknown>, updatedAt: sql`now()` } });
  }
  cache = null;
}

export const clearRuntimeCache = () => { cache = null; };

/** True when this app version must update before it can do anything else. Unknown versions are let through. */
export function mustUpdate(appVersion: string | null, c: RuntimeConfig): boolean {
  return !!appVersion && /^\d+(\.\d+){0,2}/.test(appVersion) && compareVersions(appVersion, c.minVersion) < 0;
}

/** Seconds until maintenance ends, for Retry-After (5 minutes when nobody said). */
export function maintenanceRetryAfter(c: RuntimeConfig, now = Date.now()): number {
  const until = c.maintenance.until ? Date.parse(c.maintenance.until) : NaN;
  return Number.isFinite(until) ? Math.max(30, Math.min(3600, Math.ceil((until - now) / 1000))) : 300;
}
