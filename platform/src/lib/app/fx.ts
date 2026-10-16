import "server-only";
import { eq } from "drizzle-orm";
import { FX_FALLBACK, FxRates, fxIsFresh, parseErApi } from "@mada/shared";
import { db } from "@/db";
import { appRuntime } from "@/db/app-schema-resilience";
import { supplierMode } from "./config";

/*
 * Exchange rates for the display currency (owner audit item 4). SAR is what Mada charges; the app shows "≈ AED 2,304
 * (rate of 16 Oct)" beside it from this table.
 *
 * Source: open.er-api.com/v6/latest/SAR (Exchange Rate API's open endpoint). Free, no key, rates updated once a
 * day, their terms ask for attribution ("Rates By Exchange Rate API") and no more than one request a day per
 * base, which the daily cache keeps to. Mode follows SUPPLIER_MODE_FX (mock: the built-in table; live: fetched
 * and cached for 24 hours in app_runtime under "fx"). When the source is down, yesterday's table is served marked
 * stale, and the built-in table when there is nothing at all; the date on the line is always the table's own.
 */

export const FX_URL = "https://open.er-api.com/v6/latest/SAR";
const KEY = "fx";
const TIMEOUT_MS = 4000;
const RETRY_MS = 10 * 60_000;

type Fetcher = (url: string, init: { signal: AbortSignal }) => Promise<{ ok: boolean; json(): Promise<unknown> }>;

let memory: { fx: FxRates; at: number } | null = null;
let inflight: Promise<FxRates> | null = null;

export const clearFxCache = () => { memory = null; inflight = null; };

export function fxMode(): "mock" | "live" {
  const raw = (process.env.SUPPLIER_MODE_FX ?? "").toLowerCase();
  if (raw === "live") return "live";
  if (raw === "mock") return "mock";
  try { return supplierMode("payments") === "live" ? "live" : "mock"; } catch { return "mock"; }
}

async function stored(): Promise<FxRates | null> {
  const [row] = await db.select().from(appRuntime).where(eq(appRuntime.key, KEY));
  const p = row ? FxRates.safeParse(row.value) : null;
  return p?.success ? p.data : null;
}

async function store(fx: FxRates) {
  await db.insert(appRuntime).values({ key: KEY, value: fx, updatedAt: new Date() }).onConflictDoUpdate({ target: appRuntime.key, set: { value: fx, updatedAt: new Date() } });
}

/** Ask the source once, within the timeout; null when it does not answer or answers nonsense. */
export async function fetchRates(fetcher: Fetcher = fetch as unknown as Fetcher, now = new Date()): Promise<FxRates | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), TIMEOUT_MS);
  try {
    const res = await fetcher(FX_URL, { signal: ctl.signal });
    if (!res.ok) return null;
    return parseErApi(await res.json(), now);
  } catch { return null; }
  finally { clearTimeout(timer); }
}

/**
 * Today's table: from memory, then the database, and when that is older than a day from the source. Never throws:
 * worst case the built-in fallback, dated.
 */
export async function getRates(opts: { fetcher?: Fetcher; now?: Date; mode?: "mock" | "live" } = {}): Promise<FxRates> {
  const now = opts.now ?? new Date();
  const mode = opts.mode ?? fxMode();
  if (mode === "mock") return { ...FX_FALLBACK };
  if (memory && fxIsFresh(memory.fx, now.getTime()) && !memory.fx.stale) return memory.fx;
  // A source that is down is asked again every ten minutes, not on every screen.
  if (memory?.fx.stale && now.getTime() - memory.at < RETRY_MS) return memory.fx;
  if (inflight) return inflight;
  inflight = (async () => {
    try {
      const have = await stored().catch(() => null);
      if (have && fxIsFresh(have, now.getTime()) && !have.stale) { memory = { fx: have, at: now.getTime() }; return have; }
      const fresh = await fetchRates(opts.fetcher, now);
      if (fresh) { await store(fresh).catch(() => {}); memory = { fx: fresh, at: now.getTime() }; return fresh; }
      const fallback: FxRates = have ? { ...have, stale: true } : { ...FX_FALLBACK, stale: true };
      memory = { fx: fallback, at: now.getTime() };
      return fallback;
    } finally { inflight = null; }
  })();
  return inflight;
}
