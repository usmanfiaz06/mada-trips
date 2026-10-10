import "server-only";
import { and, asc, eq, sql } from "drizzle-orm";
import { AIRLINE_INFO, dayPart, outSegment, todayIn, type FlightStatus, type TrackFlightRequest, type TrackedFlightView, type TripDetail, type TripPhase } from "@mada/shared";
import { db } from "@/db";
import { appSegments, appTrackedFlights, appTrips } from "@/db/app-schema";
import { appFlightEvents, appTrackedExtras, appTripFacts } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { suppliers, type FlightStatusInfo } from "../suppliers";
import { notify } from "./notify";

/*
 * Flight status: the flightStatus supplier (FlightAware AeroAPI live, a mock by default), pushed to us by alerts and
 * read on demand when a travel-day screen asks. Each change is told once (app_flight_events), then lands in the inbox
 * and goes out as a push. Positions on the map come from the separate open ADS-B route (flights/{no}/position).
 */

export type StatusChange = { kind: "gate" | "delay" | "cancelled" | "time"; segmentId: string; from: string | null; to: string | null; title: string; body: string };

/** Records a change once. False when it was already told. */
async function firstTime(flightNumber: string, day: string, kind: string, value: string, source: string) {
  const [row] = await db.insert(appFlightEvents).values({ flightNumber, day, kind, value, source }).onConflictDoNothing().returning({ id: appFlightEvents.id });
  return !!row;
}

const WALK_MIN = 6;

async function applyGate(ownerId: string, trip: TripDetail, segmentId: string, flightNumber: string, day: string, from: string | null, to: string, source: string): Promise<StatusChange | null> {
  await db.update(appSegments).set({ gate: to, statusSource: source, updatedAt: new Date() }).where(eq(appSegments.id, segmentId));
  const [f] = await db.select({ segments: appTripFacts.segments }).from(appTripFacts).where(eq(appTripFacts.tripId, trip.id));
  const segs = { ...(f?.segments ?? {}) };
  segs[segmentId] = { ...(segs[segmentId] ?? {}), bookedGate: from ?? segs[segmentId]?.bookedGate ?? null, statusAt: new Date().toISOString() };
  await db.update(appTripFacts).set({ segments: segs, updatedAt: new Date() }).where(eq(appTripFacts.tripId, trip.id));
  if (!(await firstTime(flightNumber, day, `gate:${ownerId}`, to, source))) return null;
  await notify(ownerId, { kind: "gate_change", level: "time_sensitive", copy: "notify.gateChange", vars: { gate: to, flight: flightNumber, minutes: WALK_MIN }, href: `/trip/${trip.id}`, data: { segmentId } });
  return { kind: "gate", segmentId, from, to, title: `Gate changed to ${to}`, body: `${flightNumber} now boards from ${to}. It's a ${WALK_MIN}-minute walk.` };
}

/** Re-reads the outbound flight. On a demo travel day the gate moves from B12 to C4, as in the prototype. */
export async function refreshTrip(ownerId: string, trip: TripDetail, demo: TripPhase | null): Promise<StatusChange[]> {
  const out = outSegment(trip);
  if (!out) return [];
  const day = dayPart(out.departLocal);
  const changes: StatusChange[] = [];
  if (demo) {
    if (demo === "travelday" && !trip.rebooked && out.gate !== "C4") {
      const c = await applyGate(ownerId, trip, out.id, out.flightNumber, day, out.gate, "C4", "Live · airline");
      if (c) changes.push(c);
    }
    return changes;
  }
  if (!["daybefore", "travelday", "delayed", "inair"].includes(trip.clock.phase)) return [];
  const info = await suppliers.flightStatus().lookup(out.flightNumber, day).catch(() => null);
  if (!info) return [];
  if (info.gate && info.gate !== out.gate) {
    const c = await applyGate(ownerId, trip, out.id, out.flightNumber, day, out.gate, info.gate, info.source);
    if (c) changes.push(c);
  }
  if (info.status !== out.status && ["delayed", "cancelled", "departed", "in_air", "landed", "boarding", "on_time"].includes(info.status)) {
    await db.update(appSegments).set({ status: info.status, statusSource: info.source, terminal: info.terminal ?? out.terminal, updatedAt: new Date() }).where(eq(appSegments.id, out.id));
    if (info.status === "cancelled" && (await firstTime(out.flightNumber, day, `cancelled:${ownerId}`, "cancelled", info.source))) {
      await db.update(appTripFacts).set({ disruption: { kind: "cancel", segmentId: out.id, cause: null, source: `${out.carrierName} confirmed the cancellation`, decided: null }, updatedAt: new Date() }).where(eq(appTripFacts.tripId, trip.id));
      await notify(ownerId, { kind: "flight_cancelled", level: "time_sensitive", copy: "notify.trip.cancelled", vars: { flight: out.flightNumber }, href: `/disruption/${trip.id}?kind=cancel` });
      changes.push({ kind: "cancelled", segmentId: out.id, from: out.status, to: "cancelled", title: `${out.flightNumber} is cancelled`, body: "We're holding seats on other flights." });
    }
  }
  return changes;
}

/* ───────── FlightAware alerts (webhook) ───────── */

export type AlertInput = { flightNumber: string; date: string; status?: FlightStatus; gate?: string | null; terminal?: string | null; delayMin?: number | null };

/** One alert for one flight: every trip segment and tracked flight on it is updated, and each owner told once. */
export async function applyAlert(a: AlertInput): Promise<{ segments: number; tracked: number }> {
  const segs = await db.select({ s: appSegments, ownerId: appTrips.ownerId }).from(appSegments).innerJoin(appTrips, eq(appTrips.id, appSegments.tripId))
    .where(and(eq(appSegments.flightNumber, a.flightNumber), sql`${appSegments.departLocal}::date = ${a.date}::date`));
  for (const { s, ownerId } of segs) {
    if (a.gate && a.gate !== s.gate) {
      await db.update(appSegments).set({ gate: a.gate, statusSource: "FlightAware", updatedAt: new Date() }).where(eq(appSegments.id, s.id));
      if (await firstTime(a.flightNumber, a.date, `gate:${ownerId}`, a.gate, "flightaware")) {
        await notify(ownerId, { kind: "gate_change", level: "time_sensitive", copy: "notify.gateChange", vars: { gate: a.gate, flight: a.flightNumber, minutes: WALK_MIN }, href: `/trip/${s.tripId}` });
      }
    }
    if (a.status && a.status !== s.status) {
      await db.update(appSegments).set({ status: a.status, statusSource: "FlightAware", ...(a.terminal ? { terminal: a.terminal } : {}), updatedAt: new Date() }).where(eq(appSegments.id, s.id));
      if (a.status === "delayed" && a.delayMin && (await firstTime(a.flightNumber, a.date, `delay:${ownerId}`, String(a.delayMin), "flightaware"))) {
        const [f] = await db.select({ segments: appTripFacts.segments }).from(appTripFacts).where(eq(appTripFacts.tripId, s.tripId));
        await db.update(appTripFacts).set({ segments: { ...(f?.segments ?? {}), [s.id]: { ...(f?.segments?.[s.id] ?? {}), delayMin: a.delayMin, statusAt: new Date().toISOString() } } }).where(eq(appTripFacts.tripId, s.tripId));
        await notify(ownerId, { kind: "flight_delayed", level: "time_sensitive", copy: "notify.trip.delayed", vars: { flight: a.flightNumber, minutes: a.delayMin }, href: `/disruption/${s.tripId}?kind=delay` });
      }
      if (a.status === "cancelled" && (await firstTime(a.flightNumber, a.date, `cancelled:${ownerId}`, "cancelled", "flightaware"))) {
        await db.update(appTripFacts).set({ disruption: { kind: "cancel", segmentId: s.id, cause: null, source: "FlightAware", decided: null } }).where(eq(appTripFacts.tripId, s.tripId));
        await notify(ownerId, { kind: "flight_cancelled", level: "time_sensitive", copy: "notify.trip.cancelled", vars: { flight: a.flightNumber }, href: `/disruption/${s.tripId}?kind=cancel` });
      }
    }
  }
  const tracked = await db.select({ t: appTrackedFlights, alerts: appTrackedExtras.alerts }).from(appTrackedFlights).leftJoin(appTrackedExtras, eq(appTrackedExtras.trackedId, appTrackedFlights.id))
    .where(and(eq(appTrackedFlights.flightNumber, a.flightNumber), eq(appTrackedFlights.date, a.date)));
  for (const { t: tf, alerts } of tracked) {
    await db.update(appTrackedFlights).set({ ...(a.status ? { status: a.status } : {}), ...(a.gate ? { gate: a.gate } : {}), ...(a.terminal ? { terminal: a.terminal } : {}), source: "FlightAware", updatedAt: new Date() }).where(eq(appTrackedFlights.id, tf.id));
    if (alerts && a.gate && a.gate !== tf.gate && (await firstTime(a.flightNumber, a.date, `gate:${tf.userId}`, a.gate, "flightaware"))) {
      await notify(tf.userId, { kind: "gate_change", level: "time_sensitive", copy: "notify.gateChange", vars: { gate: a.gate, flight: a.flightNumber, minutes: WALK_MIN }, href: "/today" });
    }
  }
  return { segments: segs.length, tracked: tracked.length };
}

/* ───────── tracked flights ───────── */

const durationOf = (i: FlightStatusInfo | null) => {
  if (!i?.departLocal || !i.arriveLocal) return null;
  const m = (s: string) => Number(s.slice(11, 13)) * 60 + Number(s.slice(14, 16));
  return ((m(i.arriveLocal) - m(i.departLocal)) + 1440) % 1440 || null;
};

export function toTrackedView(t: typeof appTrackedFlights.$inferSelect, e: typeof appTrackedExtras.$inferSelect | null): TrackedFlightView {
  const local = (v: string | null) => (v ? v.replace(" ", "T").slice(0, 16) : null);
  return {
    id: t.id, flightNumber: t.flightNumber, carrierName: t.carrierName, date: t.date, from: t.fromAirport, to: t.toAirport, departLocal: local(t.departLocal), arriveLocal: local(t.arriveLocal),
    status: t.status as FlightStatus, gate: t.gate, terminal: t.terminal, source: t.source, updatedAt: t.updatedAt.toISOString(),
    alerts: e?.alerts ?? false, known: e?.known ?? !!t.fromAirport, durationMin: e?.durationMin ?? null, brand: e?.brand ?? AIRLINE_INFO[t.flightNumber.slice(0, 2)]?.brand ?? null,
  };
}

export async function listTracked(userId: string): Promise<TrackedFlightView[]> {
  const today = todayIn();
  const rows = await db.select({ t: appTrackedFlights, e: appTrackedExtras }).from(appTrackedFlights).leftJoin(appTrackedExtras, eq(appTrackedExtras.trackedId, appTrackedFlights.id))
    .where(and(eq(appTrackedFlights.userId, userId), sql`${appTrackedFlights.date} >= ${today}::date - 1`)).orderBy(asc(appTrackedFlights.date), asc(appTrackedFlights.createdAt));
  return rows.map((r) => toTrackedView(r.t, r.e));
}

/** The schedule for a flight number on a day, from the flightStatus supplier (null when the airline hasn't shared it). */
export async function lookupFlight(flightNumber: string, date: string) {
  return suppliers.flightStatus().lookup(flightNumber, date).catch(() => null);
}

export async function trackFlight(userId: string, input: TrackFlightRequest, ipHash: string | null): Promise<TrackedFlightView> {
  const today = todayIn();
  if (input.date < today) throw new AppError("VALIDATION", { fields: { date: "Pick today or a day after" } });
  const info = await lookupFlight(input.flightNumber, input.date);
  const values = {
    userId, flightNumber: input.flightNumber, date: input.date, carrierName: info?.carrierName ?? AIRLINE_INFO[input.flightNumber.slice(0, 2)]?.name ?? null,
    fromAirport: info?.from ?? null, toAirport: info?.to ?? null, departLocal: info?.departLocal ?? null, arriveLocal: info?.arriveLocal ?? null,
    status: info?.status ?? "scheduled", gate: info?.gate ?? null, terminal: info?.terminal ?? null, source: info?.source ?? null, updatedAt: new Date(),
  };
  const row = await db.transaction(async (tx) => {
    const [t] = await tx.insert(appTrackedFlights).values(values)
      .onConflictDoUpdate({ target: [appTrackedFlights.userId, appTrackedFlights.flightNumber, appTrackedFlights.date], set: values }).returning();
    const extras = { trackedId: t!.id, alerts: input.alerts, known: !!info, durationMin: durationOf(info), brand: AIRLINE_INFO[input.flightNumber.slice(0, 2)]?.brand ?? null };
    const [e] = await tx.insert(appTrackedExtras).values(extras).onConflictDoUpdate({ target: appTrackedExtras.trackedId, set: extras }).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "flight.tracked", entityType: "app_tracked_flight", entityId: t!.id, summary: `Tracking ${input.flightNumber} on ${input.date}`, data: { alerts: input.alerts }, ipHash });
    return toTrackedView(t!, e!);
  });
  if (input.alerts && info) await suppliers.flightStatus().watch(input.flightNumber, input.date).catch(() => null);
  return row;
}

export async function untrack(userId: string, id: string): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  const rows = await db.delete(appTrackedFlights).where(and(eq(appTrackedFlights.id, id), eq(appTrackedFlights.userId, userId))).returning({ id: appTrackedFlights.id });
  if (!rows.length) throw new AppError("NOT_FOUND");
}

/* ───────── a small in-memory limit for the public lookup (guests) ───────── */

const hits = new Map<string, number[]>();
export function guestLimit(key: string, max = 30, windowMs = 3_600_000): number | null {
  const now = Date.now();
  const list = (hits.get(key) ?? []).filter((t) => now - t < windowMs);
  if (list.length >= max) return Math.ceil((windowMs - (now - list[0]!)) / 1000);
  list.push(now);
  hits.set(key, list);
  if (hits.size > 5000) hits.clear();
  return null;
}
