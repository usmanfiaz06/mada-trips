import "server-only";
import { inArray, sql } from "drizzle-orm";
import type { SupplierHealth, SupplierState } from "@mada/shared";
import { t, type CopyKey } from "@mada/shared";
import { db } from "@/db";
import { appSupplierHealth } from "@/db/app-schema-resilience";
import { AppError } from "../http";

/*
 * Timeouts and circuit breakers around supplier calls, so one supplier that stops answering costs the traveller a
 * quick, honest SUPPLIER_DOWN ("Saudia's system isn't answering. Faisal is booking this by hand.") instead of a
 * spinner that never ends, and doesn't drag every other request down with it.
 *
 *   closed     calls go through, each with a timeout. FAILURES failures inside WINDOW_MS open the circuit.
 *   open       calls fail at once with SUPPLIER_DOWN for the cooldown (30 s, doubling to 5 min while it stays down).
 *   half-open  after the cooldown one trial call goes through: success closes the circuit, failure opens it again.
 *
 * What counts as a failure: a timeout, a thrown non-AppError (network, 5xx, a bad answer), or an AppError that says
 * the supplier is unavailable. Business answers (a declined card, NOT_CONFIGURED, VALIDATION) don't count, and the
 * original error is always rethrown unchanged so callers' own handling keeps working.
 *
 * State is per server instance (each serverless instance learns on its own, within a few calls). Transitions are
 * written to app_supplier_health, which GET /status reads, so the app and Ops see a supplier that's down everywhere.
 */

export const BREAKER = { FAILURES: 5, WINDOW_MS: 60_000, COOLDOWN_MS: 30_000, MAX_COOLDOWN_MS: 300_000 } as const;

/** How long each supplier may take before we stop waiting (ms). Payments wait longest: a bank's 3-D Secure is slow. */
export const SUPPLIER_TIMEOUTS: Record<string, number> = {
  flights: 15_000, hotels: 15_000, payments: 25_000, sms: 8_000, whatsapp: 8_000, email: 8_000,
  flightStatus: 6_000, flightPositions: 6_000, ai: 20_000, identity: 8_000,
};

/** The traveller-facing name of each supplier slot (copy catalogue). */
const LABELS: Record<string, CopyKey> = {
  flights: "supplier.flights", hotels: "supplier.hotels", payments: "supplier.payments", sms: "supplier.sms", whatsapp: "supplier.whatsapp",
  email: "supplier.email", flightStatus: "supplier.flightStatus", flightPositions: "supplier.flightPositions", ai: "supplier.ai", identity: "supplier.identity",
};
export const supplierLabel = (name: string) => (LABELS[name] ? t(LABELS[name]) : t("supplierDown.generic"));

type Circuit = {
  state: "closed" | "open" | "half-open";
  failures: number[]; // timestamps inside the window
  openedAt: number;
  cooldown: number;
  trial: boolean; // a half-open trial call is in flight
  lastProblem: string | null;
};

const circuits = new Map<string, Circuit>();
const fresh = (): Circuit => ({ state: "closed", failures: [], openedAt: 0, cooldown: BREAKER.COOLDOWN_MS, trial: false, lastProblem: null });
const circuit = (name: string) => { let c = circuits.get(name); if (!c) { c = fresh(); circuits.set(name, c); } return c; };

export class SupplierTimeout extends Error {
  constructor(readonly supplier: string, readonly ms: number) { super(`${supplier} took longer than ${ms} ms`); }
}

/** The error the app sees: fast, honest, with the supplier's name for the screen. */
export function supplierDown(name: string, reason: "open" | "timeout" | "failing", retryAfter?: number) {
  return new AppError("SUPPLIER_DOWN", { retryAfter, details: { supplier: name, label: supplierLabel(name), reason } });
}

/** Transport trouble: the network, a 5xx, a dropped socket. A refused token or a 4xx is an answer, not an outage. */
const TRANSPORT = /fetch failed|network|socket|ECONN|ETIMEDOUT|EAI_AGAIN|ENOTFOUND|EPIPE|aborted|timed? ?out|answered 5\d\d|\b5\d\d\b/i;

function counts(e: unknown): boolean {
  if (e instanceof SupplierTimeout) return true;
  if (e instanceof AppError) return e.code === "SUPPLIER_UNAVAILABLE" || e.code === "SUPPLIER_DOWN" || e.code === "TIMEOUT";
  if (e instanceof Error) return e.name === "TypeError" || e.name === "AbortError" || TRANSPORT.test(`${e.message} ${(e as { cause?: { code?: string } }).cause?.code ?? ""}`);
  return false;
}

export function healthOf(name: string, now = Date.now()): SupplierState {
  const c = circuits.get(name);
  if (!c) return "up";
  if (c.state === "open" && now - c.openedAt < c.cooldown) return "down";
  if (c.state !== "closed") return "degraded";
  return c.failures.filter((t) => now - t < BREAKER.WINDOW_MS).length > 0 ? "degraded" : "up";
}

/** Writes for one supplier happen in order, so "degraded" never lands after "down". */
const writes = new Map<string, Promise<void>>();
function record(name: string, state: SupplierState, c: Circuit): Promise<void> {
  const snapshot = { ...c, failures: [...c.failures] };
  const next = (writes.get(name) ?? Promise.resolve()).then(() => write(name, state, snapshot));
  writes.set(name, next);
  return next;
}

async function write(name: string, state: SupplierState, c: Circuit) {
  try {
    await db.insert(appSupplierHealth).values({ name, state, failures: c.failures.length, lastProblem: c.lastProblem })
      .onConflictDoUpdate({
        target: appSupplierHealth.name,
        set: { state, failures: c.failures.length, lastProblem: c.lastProblem, updatedAt: sql`now()`, since: sql`CASE WHEN ${appSupplierHealth.state} = ${state} THEN ${appSupplierHealth.since} ELSE now() END` },
      });
  } catch {
    // Health is advisory: never fail a request because we couldn't write it down.
  }
}

function open(name: string, c: Circuit, now: number) {
  const wasOpen = c.state !== "closed";
  c.cooldown = wasOpen ? Math.min(c.cooldown * 2, BREAKER.MAX_COOLDOWN_MS) : BREAKER.COOLDOWN_MS;
  c.state = "open";
  c.openedAt = now;
  c.trial = false;
  void record(name, "down", c);
}

function onFailure(name: string, c: Circuit, e: unknown, now: number) {
  c.lastProblem = e instanceof SupplierTimeout ? "timeout" : e instanceof AppError ? e.code : (e as Error)?.name ?? "error";
  if (c.state === "half-open") { open(name, c, now); return; }
  c.failures = [...c.failures.filter((t) => now - t < BREAKER.WINDOW_MS), now];
  if (c.failures.length >= BREAKER.FAILURES) open(name, c, now);
  else if (c.failures.length === 1) void record(name, "degraded", c);
}

function onSuccess(name: string, c: Circuit) {
  const was = c.state;
  const hadFailures = c.failures.length > 0;
  c.state = "closed"; c.failures = []; c.trial = false; c.cooldown = BREAKER.COOLDOWN_MS; c.lastProblem = null;
  if (was !== "closed" || hadFailures) void record(name, "up", c);
}

function withTimeout<T>(name: string, p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new SupplierTimeout(name, ms)), ms); });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Call a supplier through its breaker. Fails fast with SUPPLIER_DOWN while the circuit is open; turns a timeout
 * into SUPPLIER_DOWN; rethrows any other error unchanged.
 */
export async function callSupplier<T>(name: string, fn: () => Promise<T>, opts: { timeoutMs?: number } = {}): Promise<T> {
  const c = circuit(name);
  const now = Date.now();
  if (c.state === "open") {
    const left = c.cooldown - (now - c.openedAt);
    if (left > 0) throw supplierDown(name, "open", Math.ceil(left / 1000));
    c.state = "half-open";
  }
  if (c.state === "half-open") {
    if (c.trial) throw supplierDown(name, "open", 5);
    c.trial = true;
  }
  try {
    const out = await withTimeout(name, fn(), opts.timeoutMs ?? SUPPLIER_TIMEOUTS[name] ?? 10_000);
    onSuccess(name, c);
    return out;
  } catch (e) {
    if (counts(e)) onFailure(name, c, e, Date.now());
    else if (c.state === "half-open") onSuccess(name, c); // it answered, just not with what we wanted: it's alive
    if (e instanceof SupplierTimeout) throw supplierDown(name, "timeout", 10);
    throw e;
  }
}

/**
 * Wrap a supplier adapter so every method that returns a promise goes through its breaker. `name` stays readable.
 * suppliers/index.ts applies this to live adapters; mocks stay unwrapped so demo failures stay deterministic.
 */
export function guarded<T extends object>(name: string, impl: T): T {
  return new Proxy(impl, {
    get(target, prop, receiver) {
      const v = Reflect.get(target, prop, receiver);
      if (typeof v !== "function") return v;
      // Every supplier method is async (suppliers/types.ts); while the circuit is open the call is never made.
      return (...args: unknown[]) => callSupplier(name, async () => (v as (...a: unknown[]) => unknown).apply(target, args));
    },
  });
}

/** Every supplier that isn't fully up, from this instance's breakers and what other instances wrote down. */
export async function degradedSuppliers(names: readonly string[], now = Date.now()): Promise<SupplierHealth[]> {
  const out = new Map<string, SupplierHealth>();
  try {
    const rows = await db.select().from(appSupplierHealth).where(inArray(appSupplierHealth.name, [...names]));
    for (const r of rows) {
      // A row nobody has refreshed in 10 minutes is history, not news.
      if (r.state === "up" || now - r.updatedAt.getTime() > 10 * 60_000) continue;
      out.set(r.name, { name: r.name, label: supplierLabel(r.name), state: r.state as SupplierState, since: r.since.toISOString() });
    }
  } catch {
    // No table or no database: this instance's own view still answers.
  }
  for (const name of names) {
    const s = healthOf(name, now);
    if (s === "up") { if (circuits.has(name) && circuits.get(name)!.state === "closed" && circuits.get(name)!.failures.length === 0) out.delete(name); continue; }
    const c = circuits.get(name)!;
    out.set(name, { name, label: supplierLabel(name), state: s, since: new Date(c.openedAt || now).toISOString() });
  }
  return [...out.values()];
}

/** Tests only: forget every circuit. */
export function resetBreakers() { circuits.clear(); }
