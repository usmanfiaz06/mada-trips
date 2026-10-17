import "server-only";
import { and, eq, inArray, isNull, isNotNull } from "drizzle-orm";
import { liveFlightState, liveWindow, type LiveFlightState, type RegisterLiveActivityRequest, type TripDetail } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appLiveActivities } from "@/db/app-schema-native";
import { pushLiveActivity } from "../apns";
import { AppError } from "../http";
import { localeOfUser } from "../locale";
import { tripDetail } from "../trips/core";
import { walletPassesChanged } from "../wallet-pass/service";
import { liveActivityPushEnabled } from "../wallet-pass/config";

/*
 * The lock-screen flight from the server's side (docs/app/NATIVE.md). The phone starts the Live Activity and hands
 * us its ActivityKit push token; whenever the flight's status changes (an alert, the flights poll, a desk change)
 * and every five minutes for the moments that come by the clock (boarding, in the air, landed), we work out what it
 * should show (liveFlightState, the same function the phone runs) and push only when that changed. Without the APNs
 * key nothing is sent: the phone keeps it current itself while Mada is open, and the inbox and pushes still tell.
 */

type Row = typeof appLiveActivities.$inferSelect;

export async function registerActivity(userId: string, input: RegisterLiveActivityRequest): Promise<{ push: boolean }> {
  const [trip] = await db.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.id, input.tripId), eq(appTrips.ownerId, userId)));
  if (!trip) throw new AppError("NOT_FOUND");
  const locale = input.locale ?? (await localeOfUser(userId));
  const values = { userId, tripId: input.tripId, segmentId: input.segmentId, activityId: input.activityId, platform: input.platform, pushToken: input.pushToken, locale, endedAt: null, lastError: null, updatedAt: new Date() };
  await db.insert(appLiveActivities).values(values).onConflictDoUpdate({ target: [appLiveActivities.userId, appLiveActivities.activityId], set: values });
  return { push: input.platform === "ios" && !!input.pushToken && liveActivityPushEnabled() };
}

export async function endActivity(userId: string, activityId: string): Promise<void> {
  await db.update(appLiveActivities).set({ endedAt: new Date(), updatedAt: new Date() }).where(and(eq(appLiveActivities.userId, userId), eq(appLiveActivities.activityId, activityId)));
}

// jsonb keeps keys in its own order, so compare with keys sorted.
const stable = (v: unknown): string => (v && typeof v === "object" && !Array.isArray(v)
  ? `{${Object.keys(v).sort().map((k) => `${JSON.stringify(k)}:${stable((v as Record<string, unknown>)[k])}`).join(",")}}`
  : JSON.stringify(v ?? null));
const same = (a: Record<string, unknown> | null | undefined, b: LiveFlightState) => {
  if (!a) return false;
  const { updatedEpoch: _x, ...rest } = b;
  const { updatedEpoch: _y, ...prev } = a as LiveFlightState;
  return stable(prev) === stable(rest);
};

/** One activity brought up to date: pushed if what it shows changed, ended if its flight is over. */
async function step(r: Row, trip: TripDetail, now: number): Promise<"pushed" | "ended" | "same" | "skipped"> {
  const seg = trip.segments.find((s) => s.id === r.segmentId);
  const over = !seg || liveWindow(seg, now) === "over";
  const state = seg ? liveFlightState(trip, now, r.locale === "ar" ? "ar" : "en", seg) : null;
  if (!over && state && same(r.lastState, state)) return "same";
  if (r.platform !== "ios" || !r.pushToken || !liveActivityPushEnabled()) {
    if (over) await db.update(appLiveActivities).set({ endedAt: new Date(), updatedAt: new Date() }).where(eq(appLiveActivities.id, r.id));
    return over ? "ended" : "skipped";
  }
  const prev = r.lastState as LiveFlightState | null;
  // A gate change and a delay light up the Dynamic Island; everything else updates quietly.
  const loud = state && prev && (state.gate !== prev.gate || (state.status === "delayed" && state.delayMin !== prev.delayMin) || state.status === "cancelled");
  const alert = loud && state ? { title: `${state.flight} · ${state.statusText}`, body: state.leaveText ?? `${state.labels.gate} ${state.gate ?? "–"} · ${state.labels.boards} ${state.boards}` } : null;
  const finalState = state ?? (prev as LiveFlightState | null) ?? null;
  if (!finalState) return "skipped";
  const res = await pushLiveActivity(r.pushToken, {
    event: over ? "end" : "update", state: finalState, alert, priority: loud || over ? 10 : 5,
    staleAt: over ? undefined : Math.round(now / 1000) + 30 * 60, dismissAt: over ? Math.round(now / 1000) + 15 * 60 : undefined,
  });
  const gone = res.status === 410 || (res.status === 400 && /BadDeviceToken|ExpiredToken/i.test(res.reason ?? ""));
  await db.update(appLiveActivities).set({
    lastState: res.status === 200 ? finalState : r.lastState, lastPushedAt: res.status === 200 ? new Date() : r.lastPushedAt,
    lastError: res.status === 200 ? null : `${res.status} ${res.reason ?? ""}`.trim(), endedAt: over || gone ? new Date() : null, updatedAt: new Date(),
  }).where(eq(appLiveActivities.id, r.id));
  return res.status === 200 ? (over ? "ended" : "pushed") : "skipped";
}

async function run(rows: Row[], now: number) {
  const out = { activities: rows.length, pushed: 0, ended: 0 };
  const trips = new Map<string, TripDetail | null>();
  for (const r of rows) {
    if (!trips.has(r.tripId)) trips.set(r.tripId, await tripDetail(r.userId, r.tripId, null, db).catch(() => null));
    const trip = trips.get(r.tripId);
    if (!trip) { await db.update(appLiveActivities).set({ endedAt: new Date() }).where(eq(appLiveActivities.id, r.id)); out.ended += 1; continue; }
    const s = await step(r, trip, now).catch(() => "skipped" as const);
    if (s === "pushed") out.pushed += 1;
    if (s === "ended") out.ended += 1;
  }
  return out;
}

/** After a status change on these trips: their Live Activities and Wallet passes. Never throws. */
export async function flightChanged(tripIds: string[], now = Date.now()): Promise<void> {
  const ids = [...new Set(tripIds)];
  if (!ids.length) return;
  try {
    const rows = await db.select().from(appLiveActivities).where(and(inArray(appLiveActivities.tripId, ids), isNull(appLiveActivities.endedAt)));
    await run(rows, now);
  } catch { /* the five-minute job catches up */ }
  await walletPassesChanged(ids).catch(() => 0);
}

/** The five-minute job: every open activity, for what changes by the clock alone. */
export async function liveJob(now = Date.now()): Promise<Record<string, number>> {
  const rows = await db.select().from(appLiveActivities).where(and(isNull(appLiveActivities.endedAt), isNotNull(appLiveActivities.segmentId)));
  return run(rows, now);
}
