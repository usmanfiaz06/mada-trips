import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { RequestRideBody, mockRideMatch, rideView, type RequestRideBody as RideInput, type Ride, type StoredRide } from "@mada/shared";
import { db } from "@/db";
import { appRequests, appTrips } from "@/db/app-schema";
import { appAuditLog } from "../audit";
import { isProductionDeploy } from "../config";
import { AppError } from "../http";
import { isUuid } from "../booking/common";

/*
 * A car right now (critique 4): POST /rides, GET /rides/{id}, POST /rides/{id}/cancel. Stored on app_requests
 * (kind "car", details.source "ride", outside Ask's request pipe and the mock desk), and worked out when read by the
 * shared rideView, so the app's mock and this agree to the second.
 *
 * Supplier: SUPPLIER_MODE_RIDES=mock|live. Mock (demo, staging, local) finds a driver in a few seconds where it
 * has cars, and says no car is free anywhere else. Live has no ride supplier connected yet, so it says plainly that
 * no car is free and the app's next step is Mada finding one by hand (an urgent call-back the desk sees first).
 */

type RideDetails = { source: "ride"; ride: StoredRide; clientKey: string };

export function ridesMode(): "mock" | "live" {
  const v = process.env.SUPPLIER_MODE_RIDES?.toLowerCase();
  if (v === "mock" || v === "live") return v;
  return isProductionDeploy() && process.env.APP_ALLOW_MOCKS !== "yes" ? "live" : "mock";
}

async function ownRide(ownerId: string, id: string) {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [r] = await db.select().from(appRequests).where(and(eq(appRequests.id, id), eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'source' = 'ride'`));
  if (!r) throw new AppError("NOT_FOUND");
  return r;
}

/** The ride as it stands now; a ride the supplier couldn't fill is closed on the row, so lists don't show it open. */
async function view(r: typeof appRequests.$inferSelect, now = Date.now()): Promise<Ride> {
  const d = r.details as unknown as RideDetails;
  const ride = rideView(d.ride, now);
  if (ride.status === "none" && r.status !== "cancelled") {
    await db.update(appRequests).set({ status: "cancelled", updatedAt: new Date(now), details: { ...d, noCar: true } }).where(eq(appRequests.id, r.id));
  }
  return ride;
}

export async function requestRide(ownerId: string, input: RideInput, ipHash: string | null): Promise<Ride> {
  const b = RequestRideBody.parse(input);
  const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'source' = 'ride'`, sql`${appRequests.details}->>'clientKey' = ${b.clientKey}`));
  if (seen) return view(seen);
  let tripId: string | null = null;
  if (b.tripId) {
    const [trip] = await db.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.id, b.tripId), eq(appTrips.ownerId, ownerId)));
    tripId = trip?.id ?? null;
  }
  const id = crypto.randomUUID();
  const supplier = ridesMode() === "mock" ? "mock" : "none";
  const ride: StoredRide = {
    id, when: b.when, city: b.city, meetingPoint: b.meetingPoint, tripId, requestedAt: new Date().toISOString(), cancelledAt: null, supplier,
    match: supplier === "mock" ? mockRideMatch(id, b.city) : null,
  };
  const details: RideDetails = { source: "ride", ride, clientKey: b.clientKey };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      id, ownerId, kind: "car", status: "confirmed", summary: `A car ${b.when === "now" ? "now" : "in 15 minutes"} in ${b.city}`, details: details as unknown as Record<string, unknown>,
    }).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "ride.requested", entityType: "app_request", entityId: id, summary: `Asked for a car ${b.when === "now" ? "now" : "in 15 minutes"} in ${b.city}`, data: { supplier }, ipHash });
    return r!;
  });
  return view(row);
}

export async function getRide(ownerId: string, id: string): Promise<Ride> {
  return view(await ownRide(ownerId, id));
}

export async function cancelRide(ownerId: string, id: string, ipHash: string | null): Promise<Ride> {
  const r = await ownRide(ownerId, id);
  const d = r.details as unknown as RideDetails;
  const now = Date.now();
  const cur = rideView(d.ride, now);
  if (cur.status === "cancelled") return cur;
  if (!cur.cancellable) throw new AppError("VALIDATION", { message: "This car can’t be cancelled now." });
  const next: RideDetails = { ...d, ride: { ...d.ride, cancelledAt: new Date(now).toISOString() } };
  await db.transaction(async (tx) => {
    await tx.update(appRequests).set({ status: "cancelled", updatedAt: new Date(now), details: next as unknown as Record<string, unknown> }).where(eq(appRequests.id, id));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "ride.cancelled", entityType: "app_request", entityId: id, summary: "Cancelled a car", ipHash });
  });
  return rideView(next.ride, now);
}
