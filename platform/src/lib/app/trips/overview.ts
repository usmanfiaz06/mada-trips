import "server-only";
import { and, asc, count, eq, isNull, ne } from "drizzle-orm";
import {
  buildItinerary, calendarEvents, liveStay, moveNeeded, outSegment, rangeLong, shareText, sameTimeAsHome, todayIn, dayPart, backSegment,
  type ItineraryResponse, type TripCard, type TripDetail, type TripPhase, type TripsResponse,
} from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appTrips } from "@/db/app-schema";
import { getBalance } from "../credit";
import { loadBase, withClock } from "./core";
import { listRefunds } from "./money";
import { isOpen, listRequests } from "./requests";
import { listTracked } from "./status";

/* GET /trips: the clock, the trip Today is about, the lists on the Trips tab, and what the bell needs. */

function card(t: TripDetail): TripCard {
  const out = outSegment(t);
  const back = backSegment(t);
  const st = liveStay(t);
  const names = t.travellers.map((p) => p.firstName);
  return {
    id: t.id, city: t.city, country: t.country, imageUrl: t.imageUrl, startDate: t.startDate, endDate: t.endDate, status: t.status, phase: t.clock.phase,
    travellerNames: names, justYou: t.travellers.length === 1 && !!t.travellers[0]?.isSelf, travellerCount: t.travellers.length,
    flight: out ? { code: out.flightNumber, date: dayPart(out.departLocal), depart: out.departLocal.slice(11, 16), oneWay: !back } : null,
    stayName: st?.name ?? null, note: null, when: null,
  };
}

export async function overview(ownerId: string, demo: TripPhase | null): Promise<TripsResponse> {
  const rows = await db.select().from(appTrips).where(and(eq(appTrips.ownerId, ownerId), ne(appTrips.status, "planning"))).orderBy(asc(appTrips.startDate));
  const now = new Date();
  const details: TripDetail[] = [];
  for (const r of rows) {
    const base = await loadBase(r);
    details.push(withClock(base, null, now));
  }
  // The trip Today is about: the first one still in play. A demo override applies to that trip only.
  const live = details.filter((d) => d.status !== "cancelled" && d.clock.phase !== "none");
  let current = live[0] ?? null;
  if (demo) {
    const candidate = current ?? details.find((d) => d.status !== "cancelled" && d.status !== "completed" && (d.endDate ?? d.startDate) >= todayIn()) ?? null;
    current = candidate && demo !== "none" ? withClock(await loadBase(rows.find((r) => r.id === candidate.id)!), demo) : null;
  }
  const clock = current?.clock ?? { phase: "none" as const, now: now.toISOString(), today: todayIn(), demo: !!demo };
  const today = todayIn();
  const isPast = (d: TripDetail) => d.status === "completed" || (d.status !== "cancelled" && d.clock.phase === "none" && (d.endDate ?? d.startDate) < today);
  const upcoming = details.filter((d) => d.status !== "cancelled" && !isPast(d)).map((d) => (current && d.id === current.id ? card(current) : card(d)));
  const past = details.filter(isPast).reverse().map(card);
  const [requests, refunds, tracked, [unread], credit] = await Promise.all([
    listRequests(ownerId), listRefunds(ownerId), listTracked(ownerId),
    db.select({ n: count() }).from(appNotifications).where(and(eq(appNotifications.userId, ownerId), isNull(appNotifications.readAt))),
    getBalance(ownerId),
  ]);
  return {
    clock, currentId: current?.id ?? null, upcoming, past, requests, refunds, tracked, unread: unread?.n ?? 0,
    credit: { amount: credit, currency: "SAR" }, stamps: past.length,
  };
}

export async function openRequestCount(ownerId: string, tripId: string) {
  const list = await listRequests(ownerId, tripId);
  return list.filter(isOpen).length;
}

export async function itinerary(ownerId: string, trip: TripDetail): Promise<ItineraryResponse> {
  const requests = await listRequests(ownerId, trip.id);
  const days = buildItinerary({ trip, requests, picks: trip.picks });
  const out = outSegment(trip);
  return {
    tripId: trip.id, title: trip.city, datesLong: rangeLong(trip.startDate, trip.endDate), days, events: calendarEvents(trip, days),
    shareText: shareText(trip, days), move: moveNeeded(trip), sameTimeAsHome: out ? sameTimeAsHome(out) : true,
  };
}
