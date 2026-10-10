import "server-only";
import { and, asc, eq, inArray, isNull } from "drizzle-orm";
import {
  DEMO_PHASE_HEADER, TripPhase, derivePhase, demoNow, demoView, fareRulesFor, firstNameOf, outSegment, todayIn, TZ, AIRLINE_INFO,
  type TripDetail, type TripPhase as Phase, type SegmentDetail, type StayDetail, type PickupDetail, type TripTraveller, type FlightStatus,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPeople, appPickups, appSegments, appStays, appTrips, appUsers } from "@/db/app-schema";
import { appTripCharges, appTripFacts } from "@/db/app-schema-trips";
import { isProductionDeploy, supplierMode } from "../config";
import { AppError } from "../http";

/*
 * The trip clock and the trip view. GET /trips/{id} is built here and nowhere else, so every screen reads the same
 * seats, terminal, gate, drivers, pickup times and hotel address.
 */

export type Exec = Tx | typeof db;
export type TripRow = typeof appTrips.$inferSelect;
export type FactsRow = typeof appTripFacts.$inferSelect;

/** Demo overrides are honoured only where the flight-status supplier is a mock and never on a production deployment. */
export function demoAllowed(): boolean {
  if (isProductionDeploy()) return false;
  try { return supplierMode("flightStatus") === "mock"; } catch { return false; }
}

/** The phase the caller asked to see (mock mode only), or null. */
export function demoPhase(req: Request | null): Phase | null {
  if (!req || !demoAllowed()) return null;
  const raw = req.headers.get(DEMO_PHASE_HEADER);
  const p = TripPhase.safeParse(raw);
  return p.success ? p.data : null;
}

const local = (v: string) => v.replace(" ", "T").slice(0, 16);

/** The trip, owned by this user, or NOT_FOUND (never FORBIDDEN: another account's trip doesn't exist for you). */
export async function ownTrip(ownerId: string, tripId: string, tx: Exec = db): Promise<TripRow> {
  if (!/^[0-9a-f-]{36}$/i.test(tripId)) throw new AppError("NOT_FOUND");
  const [t] = await tx.select().from(appTrips).where(and(eq(appTrips.id, tripId), eq(appTrips.ownerId, ownerId)));
  if (!t) throw new AppError("NOT_FOUND");
  return t;
}

export async function factsOf(tripId: string, tx: Exec = db): Promise<FactsRow> {
  const [f] = await tx.select().from(appTripFacts).where(eq(appTripFacts.tripId, tripId));
  if (f) return f;
  const [created] = await tx.insert(appTripFacts).values({ tripId }).onConflictDoNothing().returning();
  if (created) return created;
  const [again] = await tx.select().from(appTripFacts).where(eq(appTripFacts.tripId, tripId));
  return again!;
}

function travellerOf(p: typeof appPeople.$inferSelect, selfName: string): TripTraveller {
  const first = firstNameOf(p.givenNames) || (p.isSelf ? selfName : "") || "You";
  const full = [p.givenNames, p.surname].filter(Boolean).join(" ").trim() || first;
  return {
    id: p.id, firstName: first, fullName: full, initial: first.charAt(0).toUpperCase(), relation: p.relation, isSelf: p.isSelf,
    birthYear: p.dateOfBirth ? Number(p.dateOfBirth.slice(0, 4)) : null, passportExpiry: p.passportExpiry ?? null,
  };
}

/** Everything but the clock, read from the tables. */
export async function loadBase(trip: TripRow, tx: Exec = db): Promise<Omit<TripDetail, "clock">> {
  const [segs, stays, pickups, facts, charges, people, [owner]] = await Promise.all([
    tx.select().from(appSegments).where(eq(appSegments.tripId, trip.id)).orderBy(asc(appSegments.sort), asc(appSegments.departLocal)),
    tx.select().from(appStays).where(eq(appStays.tripId, trip.id)).orderBy(asc(appStays.checkIn)),
    tx.select().from(appPickups).where(eq(appPickups.tripId, trip.id)).orderBy(asc(appPickups.at)),
    factsOf(trip.id, tx),
    tx.select({ item: appTripCharges.item, amount: appTripCharges.amount }).from(appTripCharges).where(eq(appTripCharges.tripId, trip.id)),
    trip.travellerIds.length ? tx.select().from(appPeople).where(and(inArray(appPeople.id, trip.travellerIds), eq(appPeople.ownerId, trip.ownerId), isNull(appPeople.deletedAt))) : Promise.resolve([]),
    tx.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, trip.ownerId)),
  ]);
  const segments: SegmentDetail[] = segs.map((s) => {
    const f = facts.segments[s.id] ?? {};
    return {
      id: s.id, carrier: s.carrier, carrierName: s.carrierName, flightNumber: s.flightNumber, from: s.fromAirport, to: s.toAirport,
      departLocal: local(s.departLocal), departTz: s.departTz, arriveLocal: local(s.arriveLocal), arriveTz: s.arriveTz, durationMin: s.durationMin,
      cabin: s.cabin as SegmentDetail["cabin"], terminal: s.terminal, gate: s.gate, seats: s.seats, baggage: s.baggage,
      status: s.status as FlightStatus, statusSource: s.statusSource, pnr: s.pnr, direction: s.direction as SegmentDetail["direction"],
      bookedGate: f.bookedGate ?? s.gate, delayMin: f.delayMin ?? null, predictedDelay: !!f.predictedDelay, statusAt: f.statusAt ?? null,
      brand: AIRLINE_INFO[s.carrier]?.brand ?? null,
    };
  });
  const stayList: StayDetail[] = stays.map((s) => {
    const f = facts.stays[s.id] ?? {};
    return {
      id: s.id, name: s.name, area: s.area, address: s.address, checkIn: s.checkIn, nights: s.nights, rooms: s.rooms, price: { amount: s.price, currency: "SAR" },
      cancellation: s.cancellation, status: s.status as StayDetail["status"], confirmation: s.confirmation,
      phone: f.phone ?? null, addressShort: f.addressShort ?? null, walk: f.walk ?? null, fromAirport: f.fromAirport ?? null, roomType: f.roomType ?? null, plan: f.plan ?? "full",
    };
  });
  const pickupList: PickupDetail[] = pickups.map((p) => {
    const f = facts.pickups[p.id] ?? {};
    return {
      id: p.id, direction: p.direction as PickupDetail["direction"], at: p.at.toISOString(), driverName: p.driverName, car: p.car, plate: p.plate,
      meetingPoint: p.meetingPoint, phone: p.phone, price: { amount: p.price, currency: "SAR" }, status: p.status as PickupDetail["status"],
      room: f.room ?? null, waits: f.waits ?? null, offsetMin: f.offsetMin ?? null, city: f.city ?? null,
    };
  });
  const byId = new Map(people.map((p) => [p.id, travellerOf(p, owner?.name ?? "")]));
  const travellers = trip.travellerIds.map((id) => byId.get(id)).filter((x): x is TripTraveller => !!x);
  const sum = (items: string[]) => charges.filter((c) => items.includes(c.item)).reduce((a, c) => a + c.amount, 0);
  const flights = sum(["flight"]);
  const staysSum = sum(["stay"]);
  const pickupsSum = sum(["pickup"]);
  const total = charges.reduce((a, c) => a + c.amount, 0);
  const out = segments.find((s) => s.direction === "out");
  return {
    id: trip.id, city: trip.city, country: trip.country, imageUrl: trip.imageUrl, startDate: trip.startDate, endDate: trip.endDate,
    travellerIds: trip.travellerIds, segments, stays: stayList, pickups: pickupList, status: trip.status as TripDetail["status"],
    bookingRef: trip.bookingRef, confirmedBy: trip.confirmedByName ? { id: trip.confirmedByOpsUserId ?? "agent", name: trip.confirmedByName, photoUrl: null } : null,
    imported: trip.imported, createdAt: trip.createdAt.toISOString(),
    travellers, fare: out ? fareRulesFor(out.carrier) : null,
    prices: {
      flights: { amount: flights, currency: "SAR" }, stays: { amount: staysSum, currency: "SAR" }, pickups: { amount: pickupsSum, currency: "SAR" },
      discount: { amount: facts.discount, currency: "SAR" }, total: { amount: total, currency: "SAR" },
    },
    noStay: facts.noStay ?? null, rebooked: facts.rebooked, vouchers: facts.vouchers, bagReport: facts.bagReport, picks: facts.picks,
    rating: facts.rating ? { hotel: (facts.rating.hotel as "yes" | "no" | null) ?? null, driver: (facts.rating.driver as "great" | "fine" | "poor" | null) ?? null, agent: (facts.rating.agent as "great" | "fine" | "poor" | null) ?? null, note: facts.rating.note ?? null, sentAt: facts.rating.sentAt ?? null } : null,
    company: facts.company ?? null, weather: facts.weather ?? null, disruption: facts.disruption ?? null, openRequests: 0,
    agent: { name: facts.agentName, initial: facts.agentName.charAt(0).toUpperCase(), online: true, covering: facts.coveringName ? { name: facts.coveringName, initial: facts.coveringName.charAt(0).toUpperCase() } : null },
    bookedAt: facts.bookedAt.toISOString(),
  };
}

/** The clock for one trip: a demo moment (mock mode), or the phase from the real dates. */
export function withClock(base: Omit<TripDetail, "clock">, override: Phase | null, now = new Date()): TripDetail {
  if (override) {
    const at = demoNow(base, override, now);
    const viewed = demoView(base, override);
    const out = outSegment(viewed);
    return { ...viewed, clock: { phase: override, now: at.toISOString(), today: todayIn(out?.departTz ?? TZ, at), demo: true } };
  }
  const phase = derivePhase(base, now);
  const out = outSegment(base);
  return { ...base, clock: { phase, now: now.toISOString(), today: todayIn(out?.departTz ?? TZ, now), demo: false } };
}

export async function tripDetail(ownerId: string, tripId: string, req: Request | null, tx: Exec = db): Promise<TripDetail> {
  const trip = await ownTrip(ownerId, tripId, tx);
  return withClock(await loadBase(trip, tx), demoPhase(req));
}
