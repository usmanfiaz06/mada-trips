import "server-only";
import { and, asc, eq } from "drizzle-orm";
import { AddTripIdeaRequest, liveStay, type AddTripIdeaRequest as AddInput, type ThingsResponse, type TripDetail, type TripIdea } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appGeocodes, appTripIdeas } from "@/db/app-schema-activities";
import { supplierMode } from "../config";
import { AppError } from "../http";
import { findPlace } from "../places/search";
import type { Fetch } from "../places/wiki";
import { getJson } from "./opendata";
import { findThing, thingsFor } from "./things";

/*
 * Things to do inside a trip: the trip's city, measured from the hotel, for the children who are going, on the day
 * being planned. Plus "Add to my plan" (an idea on a day of the itinerary, never booked or held).
 */

/** The hotel's address → a point, once, from OpenStreetMap Nominatim (ODbL; at most one request a second, cached for good). */
export async function geocode(query: string, f: Fetch): Promise<{ lat: number; lon: number } | null> {
  const key = query.trim().toLowerCase().slice(0, 300);
  if (!key) return null;
  const [hit] = await db.select().from(appGeocodes).where(eq(appGeocodes.query, key));
  if (hit) return hit.lat !== null && hit.lon !== null ? { lat: hit.lat, lon: hit.lon } : null;
  if (supplierMode("openData") !== "live") return null;
  const r = await getJson(f, `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&q=${encodeURIComponent(query)}`, {}, 5000);
  const first = r.ok ? (r.data as { lat?: string; lon?: string }[])[0] : undefined;
  const point = first?.lat && first.lon ? { lat: Number(first.lat), lon: Number(first.lon) } : null;
  if (r.ok) await db.insert(appGeocodes).values({ query: key, lat: point?.lat ?? null, lon: point?.lon ?? null }).onConflictDoNothing();
  return point;
}

/** Children on the trip and how old they'll be. */
export const kidsAges = (trip: TripDetail) => {
  const year = Number(trip.startDate.slice(0, 4));
  return trip.travellers.map((p) => (p.birthYear !== null ? year - p.birthYear : null)).filter((a): a is number => a !== null && a >= 0 && a < 18).sort((a, b) => a - b);
};

export async function tripThings(trip: TripDetail, rawQuery: Record<string, string>, opts: { fetch?: Fetch; now?: Date; locale?: "en" | "ar" } = {}): Promise<ThingsResponse> {
  const place = await findPlace(trip.city);
  if (!place) throw new AppError("NOT_FOUND");
  const f: Fetch = opts.fetch ?? ((url, init) => fetch(url, init));
  const st = liveStay(trip);
  const point = st ? await geocode([st.address ?? st.name, trip.city].filter(Boolean).join(", "), f).catch(() => null) : null;
  const q = { ...rawQuery };
  const inTrip = (d: string) => d >= trip.startDate && (!trip.endDate || d <= trip.endDate);
  if (q.day && !inTrip(q.day)) throw new AppError("VALIDATION", { fields: { day: "That day isn't part of this trip" } });
  return thingsFor(String(place.id), q, { ...opts, near: point ? { ...point, label: "hotel" } : null, ages: kidsAges(trip) });
}

const ideaView = (r: typeof appTripIdeas.$inferSelect): TripIdea => ({
  id: r.id, tripId: r.tripId, ref: { kind: r.refKind as TripIdea["ref"]["kind"], id: r.refId }, day: r.day, title: r.title, sub: r.sub, createdAt: r.createdAt.toISOString(),
});

async function ownTrip(ownerId: string, tripId: string) {
  const [t] = await db.select({ id: appTrips.id, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ownerId)));
  if (!t) throw new AppError("NOT_FOUND");
  return t;
}

export async function listIdeas(ownerId: string, tripId: string): Promise<TripIdea[]> {
  await ownTrip(ownerId, tripId);
  return (await db.select().from(appTripIdeas).where(and(eq(appTripIdeas.tripId, tripId), eq(appTripIdeas.ownerId, ownerId))).orderBy(asc(appTripIdeas.createdAt))).map(ideaView);
}

/** For the itinerary: ideas as buildItinerary wants them. */
export async function plannedFor(ownerId: string, tripId: string) {
  const rows = await db.select().from(appTripIdeas).where(and(eq(appTripIdeas.tripId, tripId), eq(appTripIdeas.ownerId, ownerId))).orderBy(asc(appTripIdeas.createdAt));
  return rows.map((r) => ({ id: r.id, day: r.day, title: r.title, sub: r.sub }));
}

export async function addIdea(ownerId: string, tripId: string, input: AddInput): Promise<{ idea: TripIdea; created: boolean }> {
  const b = AddTripIdeaRequest.parse(input);
  const trip = await ownTrip(ownerId, tripId);
  if (b.day && (b.day < trip.startDate || (trip.endDate && b.day > trip.endDate))) throw new AppError("VALIDATION", { fields: { day: "That day isn't part of this trip" } });
  const [had] = await db.select().from(appTripIdeas).where(and(eq(appTripIdeas.tripId, tripId), eq(appTripIdeas.refId, b.ref.id)));
  if (had) {
    if (had.day === b.day) return { idea: ideaView(had), created: false };
    const [moved] = await db.update(appTripIdeas).set({ day: b.day }).where(eq(appTripIdeas.id, had.id)).returning();
    return { idea: ideaView(moved!), created: false };
  }
  const thing = await findThing(Number(b.placeId), b.ref);
  if (!thing) throw new AppError("NOT_FOUND");
  const [row] = await db.insert(appTripIdeas).values({ tripId, ownerId, refKind: b.ref.kind, refId: b.ref.id, day: b.day, title: thing.title.slice(0, 160), sub: thing.sub?.slice(0, 200) ?? null }).returning();
  return { idea: ideaView(row!), created: true };
}

export async function removeIdea(ownerId: string, tripId: string, ideaId: string): Promise<void> {
  await ownTrip(ownerId, tripId);
  const gone = await db.delete(appTripIdeas).where(and(eq(appTripIdeas.id, ideaId), eq(appTripIdeas.tripId, tripId), eq(appTripIdeas.ownerId, ownerId))).returning({ id: appTripIdeas.id });
  if (!gone.length) throw new AppError("NOT_FOUND");
}
