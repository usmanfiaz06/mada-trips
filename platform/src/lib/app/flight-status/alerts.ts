import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { db } from "@/db";
import { appFlightSubscriptions } from "@/db/app-schema-flight-status";
import { appRuntime } from "@/db/app-schema-resilience";
import { flightStatusVendor } from "../suppliers";
import { adbFetch, mapAdb, type AdbFlight } from "../suppliers/live/aerodatabox";
import { alertFromInfo, applyAlert } from "../trips/status";
import { writeCache } from "./service";

/*
 * AeroDataBox flight alerts (push), by FLIGHT NUMBER only. Never by airport: an airport subscription bills one credit
 * per flight per update and would drain the balance in an hour.
 *
 * CONFIRMED (OpenAPI v1.15.4.0, doc.aerodatabox.com, read 2026-10-11):
 *   POST   /subscriptions/webhook/FlightByNumber/{flightNumber}  body { url, maxDeliveryRetries }  → FlightSubscriptionContract
 *          { id, isActive, billingType: CreditBased, subject { type, id }, expiresOnUtc? … }      (FREE TIER: no API units)
 *   GET    /subscriptions/webhook            list;  GET/DELETE /subscriptions/webhook/{subscriptionId}    (FREE TIER)
 *   GET    /subscriptions/balance            { creditsRemaining, lastRefilledUtc, lastDeductedUtc }       (FREE TIER)
 *   POST   /subscriptions/balance/refill     { credits }: 1 credit = 1 API unit from the plan's quota       (TIER 1)
 *   Each notification is a POST of FlightNotificationContract { id, timestampUtc, subscription, balance,
 *   deliveryAttempt { seqNo, costCredits, timestampUtc }, flights: [FlightNotificationItemContract] } where each flight
 *   item has the same shape as the flight-status answer (plus notificationSummary/Remark), containing only flights
 *   that changed. 1 credit per flight item. Credit-based subscriptions never expire; at zero balance every
 *   subscription pauses until a refill. Delivery is best effort; retries only with maxDeliveryRetries (0–2), each
 *   retry billed again. Notifications cover flights from 6 h ago to 72 h ahead. Your endpoint must answer 2xx within
 *   10 s and "not require additional authorization".
 * ASSUMED / NOT DOCUMENTED: notifications carry no signature. So the URL carries a secret path token
 *   (AERODATABOX_WEBHOOK_SECRET), and a notification is only acted on when its subscription id is one we created.
 *   Subscription limits per plan and per-refill credit caps "depend on your pricing plan" (not quantified).
 *
 * Lifecycle: /api/cron/flights reconciles. A flight number is subscribed while one of our flights on it (a booked
 * segment, or a tracked flight with alerts on) departs within the next 72 h and hasn't landed + 2 h; then removed.
 * Tracking a flight subscribes at once. If the plan or balance refuses, the row is marked failed and the flight is
 * polled instead (polling is only the fallback while alerts work).
 */

const VENDOR = "aerodatabox";
const RUNTIME_KEY = "flight-alerts:aerodatabox";
export const ALERT_WINDOW_H = 72;

const secret = () => {
  const s = process.env.AERODATABOX_WEBHOOK_SECRET ?? "";
  return s.length >= 24 ? s : null;
};

/** Alerts are on when AeroDataBox is the vendor and a webhook secret (24+ chars) is set. AERODATABOX_ALERTS=off turns them off. */
export function alertsEnabled(): boolean {
  return flightStatusVendor() === VENDOR && !!secret() && (process.env.AERODATABOX_ALERTS ?? "on").toLowerCase() !== "off";
}

export function webhookUrl(): string {
  const base = (process.env.AERODATABOX_WEBHOOK_BASE_URL ?? process.env.APP_PUBLIC_URL ?? "https://madatrips.sa").replace(/\/+$/, "");
  return `${base}/api/app/v1/flights/alerts/aerodatabox/${secret()}`;
}

/** Constant-time check of the path token. */
export function tokenMatches(given: string): boolean {
  const want = secret();
  if (!want || given.length !== want.length) return false;
  let diff = 0;
  for (let i = 0; i < want.length; i++) diff |= want.charCodeAt(i) ^ given.charCodeAt(i);
  return diff === 0;
}

async function saveBalance(credits: number | null) {
  if (credits === null || !Number.isFinite(credits)) return;
  const value = { creditsRemaining: credits, at: new Date().toISOString() };
  await db.insert(appRuntime).values({ key: RUNTIME_KEY, value }).onConflictDoUpdate({ target: appRuntime.key, set: { value, updatedAt: sql`now()` } }).catch(() => {});
}

export async function lastBalance(): Promise<number | null> {
  const [r] = await db.select({ value: appRuntime.value }).from(appRuntime).where(eq(appRuntime.key, RUNTIME_KEY)).catch(() => []);
  const n = (r?.value as { creditsRemaining?: number } | undefined)?.creditsRemaining;
  return typeof n === "number" ? n : null;
}

/** Asks AeroDataBox for the alert balance (free). Null when it won't say (an old plan, an outage). */
export async function checkBalance(): Promise<number | null> {
  try {
    const res = await adbFetch("/subscriptions/balance");
    if (!res.ok) return null;
    const b = (await res.json()) as { creditsRemaining?: number };
    const n = typeof b.creditsRemaining === "number" ? b.creditsRemaining : null;
    await saveBalance(n);
    return n;
  } catch { return null; }
}

async function setRow(flightNumber: string, values: { subscriptionId?: string | null; status: string; error?: string | null }) {
  await db.insert(appFlightSubscriptions).values({ vendor: VENDOR, flightNumber, subscriptionId: values.subscriptionId ?? null, status: values.status, error: values.error ?? null })
    .onConflictDoUpdate({ target: [appFlightSubscriptions.vendor, appFlightSubscriptions.flightNumber], set: { ...values, updatedAt: sql`now()` } });
}

/** Subscribe one flight number. True when AeroDataBox accepted it. */
export async function subscribe(flightNumber: string): Promise<boolean> {
  try {
    const res = await adbFetch(`/subscriptions/webhook/FlightByNumber/${encodeURIComponent(flightNumber)}`, { method: "POST", body: { url: webhookUrl(), maxDeliveryRetries: 1 } });
    if (!res.ok) { await setRow(flightNumber, { status: "failed", error: `http ${res.status}` }); return false; }
    const sub = (await res.json()) as { id?: string; isActive?: boolean };
    if (!sub.id) { await setRow(flightNumber, { status: "failed", error: "no id" }); return false; }
    await setRow(flightNumber, { subscriptionId: sub.id, status: "active" });
    return true;
  } catch (e) {
    await setRow(flightNumber, { status: "failed", error: (e as Error).name }).catch(() => {});
    return false;
  }
}

export async function unsubscribe(flightNumber: string, subscriptionId: string | null): Promise<boolean> {
  if (subscriptionId) {
    try {
      const res = await adbFetch(`/subscriptions/webhook/${encodeURIComponent(subscriptionId)}`, { method: "DELETE" });
      if (!res.ok && res.status !== 404 && res.status !== 204) return false;
    } catch { return false; }
  }
  await setRow(flightNumber, { subscriptionId, status: "removed" });
  return true;
}

/** Flight numbers whose alerts are live right now (polling skips them while the balance holds). */
export async function activeSubscriptions(): Promise<Set<string>> {
  const rows = await db.select({ n: appFlightSubscriptions.flightNumber }).from(appFlightSubscriptions)
    .where(and(eq(appFlightSubscriptions.vendor, VENDOR), eq(appFlightSubscriptions.status, "active")));
  return new Set(rows.map((r) => r.n));
}

/**
 * Make the subscriptions match the flights we care about: subscribe what's wanted and missing (failed ones retried
 * after a day), remove what's no longer wanted. At most `max` changes a run.
 */
export async function reconcile(wanted: Set<string>, max = 10): Promise<{ subscribed: number; removed: number; failed: number }> {
  const rows = await db.select().from(appFlightSubscriptions).where(eq(appFlightSubscriptions.vendor, VENDOR));
  const byNo = new Map(rows.map((r) => [r.flightNumber, r]));
  let subscribed = 0, removed = 0, failed = 0, budget = max;
  for (const r of rows) {
    if (budget <= 0) break;
    if (r.status === "active" && !wanted.has(r.flightNumber)) { budget -= 1; if (await unsubscribe(r.flightNumber, r.subscriptionId)) removed += 1; }
  }
  for (const n of wanted) {
    if (budget <= 0) break;
    const r = byNo.get(n);
    if (r?.status === "active") continue;
    if (r?.status === "failed" && Date.now() - r.updatedAt.getTime() < 86_400_000) continue;
    budget -= 1;
    if (await subscribe(n)) subscribed += 1; else failed += 1;
  }
  return { subscribed, removed, failed };
}

/** Subscribe as soon as someone tracks a flight (the next cron run would too, minutes later). */
export async function subscribeNow(flightNumber: string): Promise<void> {
  if (!alertsEnabled()) return;
  const [r] = await db.select().from(appFlightSubscriptions).where(and(eq(appFlightSubscriptions.vendor, VENDOR), eq(appFlightSubscriptions.flightNumber, flightNumber)));
  if (r?.status === "active") return;
  await subscribe(flightNumber);
}

type Notification = {
  id?: string;
  subscription?: { id?: string; subject?: { type?: string; id?: string } } | null;
  balance?: { creditsRemaining?: number } | null;
  flights?: (AdbFlight & { notificationSummary?: string })[];
};

/**
 * One AeroDataBox notification: each changed flight is written to the status cache and runs through the same
 * disruption logic as polling (applyAlert, idempotent per change). Unknown subscriptions are ignored.
 */
export async function handleNotification(body: unknown): Promise<{ ok: true; ignored?: true; flights: number; told: number }> {
  const n = (body ?? {}) as Notification;
  const subId = n.subscription?.id;
  if (!subId) return { ok: true, ignored: true, flights: 0, told: 0 };
  const [row] = await db.select().from(appFlightSubscriptions)
    .where(and(eq(appFlightSubscriptions.vendor, VENDOR), eq(appFlightSubscriptions.subscriptionId, subId), inArray(appFlightSubscriptions.status, ["active", "removed"])));
  if (!row) return { ok: true, ignored: true, flights: 0, told: 0 };
  if (typeof n.balance?.creditsRemaining === "number") await saveBalance(n.balance.creditsRemaining);
  let told = 0, flights = 0;
  for (const f of n.flights ?? []) {
    const no = (f.number ?? row.flightNumber).replace(/\s+/g, "").toUpperCase();
    const flightNumber = no === row.flightNumber.replace(/\s+/g, "").toUpperCase() ? row.flightNumber : no;
    const day = (f.departure?.scheduledTime?.local ?? "").slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) continue;
    const info = mapAdb(flightNumber, day, f);
    await writeCache(VENDOR, flightNumber, day, info).catch(() => {});
    const r = await applyAlert(alertFromInfo(info, day));
    told += r.told;
    flights += 1;
  }
  await db.update(appFlightSubscriptions).set({ lastEventAt: new Date() }).where(and(eq(appFlightSubscriptions.vendor, VENDOR), eq(appFlightSubscriptions.flightNumber, row.flightNumber)));
  return { ok: true, flights, told };
}
