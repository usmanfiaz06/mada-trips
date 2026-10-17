import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { BookThingRequest, dayLabel, t, type BookThingRequest as BookInput, type BookingRequestView } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appRequests, appTrips } from "@/db/app-schema";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { agentFor, travellersOf } from "../booking/common";
import { requestView, type AskDetails } from "../booking/requests";
import { findThing } from "./things";

/*
 * "Book with Mada" from Things to do. For the beta everything goes through the desk: one request in app_requests
 * (kind "activity", askKind "todo", so Trips → Requests, the desk inbox and, once quoted and paid, the itinerary all
 * pick it up), with the traveller's words as the first message. details.activity carries what the desk needs to book
 * in one step: the supplier and its product code, the Hotelbeds modality, the day and everyone's ages.
 */

const PROMISE_MIN = 30;

export type ActivityDetails = {
  ref: { kind: "activity" | "experience" | "event"; id: string };
  title: string; placeId: string; city: string; day: string | null; ages: number[]; travellers: number;
  supplier: string | null; code: string | null; modality: string | null; priceFrom: number | null;
  lat: number | null; lon: number | null; link: string | null; tripId: string | null;
};

export function activityOf(details: unknown): ActivityDetails | null {
  const a = (details as { activity?: ActivityDetails } | null)?.activity;
  return a && typeof a === "object" && a.ref && typeof a.title === "string" ? a : null;
}

export async function bookThing(ownerId: string, input: BookInput, ipHash: string | null): Promise<{ request: BookingRequestView; message: string }> {
  const b = BookThingRequest.parse(input);
  const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'clientId' = ${b.clientId}`));
  if (seen) return { request: requestView(seen), message: String((seen.details as { message?: string }).message ?? "") };
  if (b.tripId) {
    const [trip] = await db.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.id, b.tripId), eq(appTrips.ownerId, ownerId)));
    if (!trip) throw new AppError("NOT_FOUND");
  }
  const thing = await findThing(Number(b.placeId), b.ref);
  if (!thing) throw new AppError("NOT_FOUND");
  const travellers = await travellersOf(ownerId, b.travellerIds);
  const count = b.travellers ?? Math.max(travellers.length, 1);
  const kids = b.ages.length;
  const adults = Math.max(1, count - kids);
  const who = kids ? t("things.request.whoKids", { adults, ages: b.ages.join(", ") }) : t(adults === 1 ? "things.request.whoOne" : "things.request.who", { n: adults });
  const when = b.day ? dayLabel(b.day, { today: b.day }) : t("things.request.dayOpen");
  const message = b.message ?? t("things.request.message", { name: thing.title, city: thing.place.name, who, when });
  const title = t("things.request.title", { name: thing.title });
  const e = thing.experience;
  const activity: ActivityDetails = {
    ref: b.ref, title: thing.title, placeId: b.placeId, city: thing.place.name, day: b.day ?? null, ages: [...b.ages, ...Array.from({ length: adults }, () => 30)], travellers: count,
    supplier: e?.supplier ?? (thing.event ? thing.event.source : "openstreetmap"), code: e?.code ?? (thing.activity ? thing.activity.id : thing.event?.id ?? null), modality: e?.modality ?? null,
    priceFrom: e?.priceFrom.amount ?? null, lat: thing.activity?.lat ?? null, lon: thing.activity?.lon ?? null,
    link: thing.activity ? `https://www.openstreetmap.org/${{ n: "node", w: "way", r: "relation" }[thing.activity.id[4] as "n" | "w" | "r"]}/${thing.activity.id.slice(5)}` : thing.event?.link ?? null,
    tripId: b.tripId ?? null,
  };
  const agentName = await agentFor(ownerId);
  const details: AskDetails & Record<string, unknown> = {
    source: "ask", askKind: "todo", title, detail: `${thing.place.name} · ${who} · ${when}`, summaryLine: `${who} · ${when}`, note: null, query: message, answers: {}, needs: {}, titleCopy: ["things.request.title", { name: thing.title }],
    search: null, service: null, serviceFor: null, clientId: b.clientId, short: "plans", quote: null, quoteText: null, withWhom: "faisal", message, activity,
  };
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      ownerId, kind: "activity", status: "sent", summary: title, travellerIds: travellers.map((p) => p.id), agentName, tripId: b.tripId ?? null,
      promisedBy: new Date(Date.now() + PROMISE_MIN * 60_000), details,
    }).returning();
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r!.id, authorKind: "user", authorUserId: ownerId, body: message });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.created", entityType: "app_request", entityId: r!.id, summary: `Asked Mada to book ${thing.title}`, data: { kind: "activity", ref: b.ref, supplier: activity.supplier }, ipHash });
    return r!;
  });
  return { request: requestView(row), message };
}
