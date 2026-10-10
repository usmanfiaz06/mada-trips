import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { PlanPlaceRequest, planMessage, t, type BookingRequestView, type PlanPlaceRequest as PlanInput } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appRequests } from "@/db/app-schema";
import { appPlacePlans } from "@/db/app-schema-places";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { agentFor, travellersOf } from "../booking/common";
import { requestView, type AskDetails } from "../booking/requests";
import { findPlace } from "./search";

/*
 * "Plan it with Mada" for any city. One request in app_requests (kind "destination", so the desk's inbox shows the
 * city, its airports and a guide link: desk/adapters.ts destinationOf), the traveller's words as the first message of
 * its thread, and a row in app_place_plans so we can see which cities people ask for. Shaped like a request from Ask
 * (details.source "ask"), so Trips → Requests and the request screen show it with no extra work.
 */

const PROMISE_MIN = 20;

export async function planPlace(ownerId: string, idOrSlug: string, input: PlanInput, ipHash: string | null): Promise<{ request: BookingRequestView; message: string }> {
  const b = PlanPlaceRequest.parse(input);
  const place = await findPlace(idOrSlug);
  if (!place) throw new AppError("NOT_FOUND");
  if (b.clientId) {
    const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'clientId' = ${b.clientId}`));
    if (seen) return { request: requestView(seen), message: String((seen.details as { message?: string }).message ?? "") };
  }
  const travellers = await travellersOf(ownerId, b.travellerIds);
  const count = b.travellers ?? (travellers.length || null);
  const message = b.message ?? planMessage({ city: place.name, travellers: count, depart: b.depart ?? null, ret: b.return ?? null, month: b.month ?? null });
  const title = t("places.request.title", { city: place.name });
  const where = t("places.request.detail", { city: place.name, country: place.country });
  const agentName = await agentFor(ownerId);
  const guideUrl = `https://en.wikivoyage.org/wiki/Special:Search?search=${encodeURIComponent(`${place.name}, ${place.country}`)}`;
  const details: AskDetails & Record<string, unknown> = {
    source: "ask", askKind: "general", title, detail: `${where} · ${message}`, summaryLine: message, note: null, query: message, answers: {}, needs: {},
    search: null, service: null, serviceFor: null, clientId: b.clientId ?? null, short: "trip", quote: null, quoteText: null, withWhom: "faisal",
    // Read by the desk (destinationOf) and by Ops.
    place: { id: String(place.id), name: place.name, country: place.country, countryCode: place.country_code, airports: place.airports.map((a) => a.iata), guideUrl, served: place.served },
    message, dates: { depart: b.depart ?? null, return: b.return ?? null, month: b.month ?? null }, travellers: count, from: b.from ?? null,
  };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      ownerId, kind: "destination", status: "sent", summary: title, travellerIds: travellers.map((p) => p.id), agentName,
      promisedBy: new Date(Date.now() + PROMISE_MIN * 60_000), details,
    }).returning();
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r!.id, authorKind: "user", authorUserId: ownerId, body: message });
    await tx.insert(appPlacePlans).values({ requestId: r!.id, placeId: place.id, ownerId });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.created", entityType: "app_request", entityId: r!.id, summary: `Asked Mada to plan a trip to ${place.name}`, data: { kind: "destination", placeId: place.id }, ipHash });
    return r!;
  });
  return { request: requestView(row), message };
}
