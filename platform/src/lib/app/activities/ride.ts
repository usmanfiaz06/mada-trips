import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { RideThingRequest, dayLabel, liveStay, t, type BookingRequestView, type RideThingRequest as RideInput } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appRequests } from "@/db/app-schema";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { agentFor } from "../booking/common";
import { requestView } from "../booking/requests";
import { tripDetail } from "../trips/core";
import { findThing } from "./things";

/*
 * "Get there with Mada" from a place or an experience: a car and driver to it, at a time, from the hotel (or where they
 * say). Built like an airport pickup (transfers/service.ts chooseTransfer): one request in app_requests, kind "car",
 * askKind "car", so Trips → Requests, the desk inbox and, once quoted and paid, the itinerary pick it up. In the beta
 * the desk books the car by hand and quotes; details.ride carries what it needs (where to, the point, when, from where).
 */

const PROMISE_MIN = 60;

export type RideDetails = {
  ref: { kind: "activity" | "experience" | "event"; id: string };
  to: string; toAddress: string | null; lat: number | null; lon: number | null;
  placeId: string; city: string; day: string; time: string;
  pickup: "hotel" | "other"; from: string; hotel: string | null; travellers: number; tripId: string | null;
};

export async function rideToThing(ownerId: string, input: RideInput, ipHash: string | null): Promise<{ request: BookingRequestView; message: string }> {
  const b = RideThingRequest.parse(input);
  const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'clientId' = ${b.clientId}`));
  if (seen) return { request: requestView(seen), message: String((seen.details as { message?: string }).message ?? "") };
  // Someone else's trip reads as not found; so does a pickup "from the hotel" with no trip or no hotel to come from.
  const trip = b.tripId ? await tripDetail(ownerId, b.tripId, null) : null;
  const stay = trip ? liveStay(trip) : null;
  if (b.pickup === "hotel" && !stay) throw new AppError("VALIDATION", { fields: { pickupText: t("things.ride.whereNeeded") } });
  if (trip && (b.day < trip.startDate || (trip.endDate && b.day > trip.endDate))) throw new AppError("VALIDATION", { fields: { day: "That day isn't part of this trip" } });
  const thing = await findThing(Number(b.placeId), b.ref);
  if (!thing) throw new AppError("NOT_FOUND");
  const mp = thing.experience?.meetingPoint ?? null;
  const lat = thing.activity?.lat ?? mp?.lat ?? null;
  const lon = thing.activity?.lon ?? mp?.lon ?? null;
  const toAddress = thing.activity?.address ?? mp?.address ?? thing.event?.venue ?? null;
  const from = b.pickup === "hotel" ? stay!.name : b.pickupText!.trim();
  const travellers = b.travellers ?? Math.max(1, trip?.travellers.length ?? 1);
  const who = travellers === 1 ? t("things.request.whoOne") : t("things.request.who", { n: travellers });
  const day = dayLabel(b.day, { today: b.day });
  const message = b.message ?? t("things.ride.message", { name: thing.title, day, time: b.time, from, who });
  const title = t("things.ride.requestTitle", { name: thing.title });
  const detail = [`${from} → ${thing.title}`, `${day} ${b.time}`, who].join(" · ");
  const ride: RideDetails = {
    ref: b.ref, to: thing.title, toAddress, lat, lon, placeId: b.placeId, city: thing.place.name, day: b.day, time: b.time,
    pickup: b.pickup, from, hotel: stay?.name ?? null, travellers, tripId: trip?.id ?? null,
  };
  const agentName = await agentFor(ownerId);
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      ownerId, kind: "car", status: "sent", summary: title, travellerIds: trip?.travellerIds ?? [], tripId: trip?.id ?? null, agentName,
      promisedBy: new Date(Date.now() + PROMISE_MIN * 60_000),
      details: {
        // Read by Ask's request screen (booking/requests.ts) and Trips → Requests (trips/requests.ts), like a pickup.
        source: "ask", askKind: "car", title, detail, summaryLine: detail, note: null, query: message, answers: {}, needs: {}, clientId: b.clientId,
        short: "ride", area: "other", quote: null, quoteText: null, withWhom: "faisal", message, ride,
      },
    }).returning();
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r!.id, authorKind: "user", authorUserId: ownerId, body: message });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.created", entityType: "app_request", entityId: r!.id, summary: `Asked for a car to ${thing.title}`, data: { kind: "ride", ref: b.ref, pickup: b.pickup }, ipHash });
    return r!;
  });
  return { request: requestView(row), message };
}
