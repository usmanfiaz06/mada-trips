import "server-only";
import { randomUUID } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import { zonedToInstant } from "@mada/shared";
import { db } from "@/db";
import { appPayments, appPeople, appPickups, appSegments, appStays, appTrips, appUsers } from "@/db/app-schema";
import { appTripFacts } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { loadBase, withClock } from "./core";
import { createCharge, customerOf, instalmentPlan } from "./money";

/*
 * The demo trip from the prototype (store.jsx seedTrip): Omar's family, Istanbul for Eid, 9–15 March 2027. Saudia
 * SV263 out and SV264 back, rooms near Galata Tower paid with Tabby, pickups both ways. Mock mode only (POST /trips/demo
 * and tests). Plus last Eid in Baku as a past trip.
 */

const FAMILY = [
  { givenNames: "Hessa", surname: "Alharbi", relation: "spouse", dateOfBirth: "1988-07-24", sex: "F", passportExpiry: "2029-01-15" },
  { givenNames: "Sara", surname: "Alharbi", relation: "child", dateOfBirth: "2013-05-12", sex: "F", passportExpiry: "2027-08-14" },
  { givenNames: "Ahmed", surname: "Alharbi", relation: "child", dateOfBirth: "2016-09-03", sex: "M", passportExpiry: "2030-03-21" },
];

export async function seedDemoTrip(userId: string, opts: { outDay?: string; backDay?: string; city?: "Istanbul" } = {}): Promise<string> {
  const outDay = opts.outDay ?? "2027-03-09";
  const backDay = opts.backDay ?? "2027-03-15";
  const existing = await db.select({ id: appTrips.id }).from(appTrips).where(and(eq(appTrips.ownerId, userId), eq(appTrips.bookingRef, "X7K2QD"), eq(appTrips.startDate, outDay)));
  if (existing[0]) return existing[0].id;
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId));
  if (!user) throw new AppError("NOT_FOUND");

  const tripId = await db.transaction(async (tx) => {
    // The household: the account holder plus Hessa, Sara and Ahmed, unless they're already there.
    const people = await tx.select().from(appPeople).where(and(eq(appPeople.ownerId, userId), isNull(appPeople.deletedAt)));
    let self = people.find((p) => p.isSelf);
    if (!self) [self] = await tx.insert(appPeople).values({ ownerId: userId, isSelf: true, relation: "self", givenNames: user.name || "Omar", surname: "Alharbi" }).returning();
    else if (!self.givenNames) [self] = await tx.update(appPeople).set({ givenNames: user.name || "Omar", surname: self.surname || "Alharbi", dateOfBirth: self.dateOfBirth ?? "1984-03-11", passportExpiry: self.passportExpiry ?? "2031-06-22" }).where(eq(appPeople.id, self.id)).returning();
    const ids = [self!.id];
    for (const f of FAMILY) {
      const found = people.find((p) => p.givenNames === f.givenNames);
      if (found) { ids.push(found.id); continue; }
      const [p] = await tx.insert(appPeople).values({ ownerId: userId, ...f }).returning();
      ids.push(p!.id);
    }
    const n = ids.length;
    const [trip] = await tx.insert(appTrips).values({
      ownerId: userId, city: "Istanbul", country: "Türkiye", imageUrl: "istanbul-galata", startDate: outDay, endDate: backDay, travellerIds: ids,
      status: "booked", bookingRef: "X7K2QD", confirmedByName: "Faisal",
    }).returning();
    const seats = (row: number) => Array.from({ length: n }, (_, i) => `${row}${"ABCDEF"[i % 6]}`);
    const [out] = await tx.insert(appSegments).values({
      tripId: trip!.id, direction: "out", sort: 0, carrier: "SV", carrierName: "Saudia", flightNumber: "SV263", fromAirport: "RUH", toAirport: "IST",
      departLocal: `${outDay} 09:40`, departTz: "Asia/Riyadh", arriveLocal: `${outDay} 13:55`, arriveTz: "Europe/Istanbul", durationMin: 255,
      cabin: "economy", terminal: "Terminal 3", gate: "B12", seats: seats(14), baggage: "2 × 23 kg", status: "scheduled", statusSource: "Schedule", pnr: "X7K2QD",
    }).returning();
    await tx.insert(appSegments).values({
      tripId: trip!.id, direction: "back", sort: 1, carrier: "SV", carrierName: "Saudia", flightNumber: "SV264", fromAirport: "IST", toAirport: "RUH",
      departLocal: `${backDay} 15:10`, departTz: "Europe/Istanbul", arriveLocal: `${backDay} 19:20`, arriveTz: "Asia/Riyadh", durationMin: 250,
      cabin: "economy", terminal: "Terminal 1", gate: null, seats: seats(16), baggage: "2 × 23 kg", status: "scheduled", statusSource: "Schedule", pnr: "X7K2QD",
    });
    const [stay] = await tx.insert(appStays).values({
      tripId: trip!.id, name: "Rooms near Galata Tower", area: "Beyoğlu · 3 min to the tower", address: "Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul",
      checkIn: outDay, nights: 6, rooms: n > 2 ? 2 : 1, price: 5880_00, cancellation: "Free to cancel until 7 days before", status: "booked", confirmation: "GT-48213", supplier: "mock",
    }).returning();
    const [home] = await tx.insert(appPickups).values({
      tripId: trip!.id, direction: "to_airport", at: new Date(zonedToInstant(`${outDay}T09:40`, "Asia/Riyadh").getTime() - 155 * 60_000), driverName: "Khalid",
      car: n > 3 ? "Black GMC Yukon" : "Grey Lexus ES", phone: "+966 55 014 2287", meetingPoint: "Your door", price: 220_00, status: "booked",
    }).returning();
    const [arrive] = await tx.insert(appPickups).values({
      tripId: trip!.id, direction: "from_airport", at: zonedToInstant(`${outDay}T13:55`, "Europe/Istanbul"), driverName: "Ahmet", car: "Grey Mercedes Vito", plate: "34 MDA 21",
      phone: "+90 532 418 6610", meetingPoint: "Door 3", price: 220_00, status: "booked",
    }).returning();
    await tx.insert(appTripFacts).values({
      tripId: trip!.id, agentName: "Faisal", bookedAt: new Date("2027-02-14T07:42:00Z"),
      stays: { [stay!.id]: { phone: "+90 212 000 0000", addressShort: "Galata Kulesi Sk. 12, Beyoğlu", walk: "3 min walk to Galata Tower", fromAirport: "45 min", roomType: null, plan: "tabby" } },
      pickups: { [home!.id]: { room: n > 3 ? "room for 8 bags" : "room for 4 bags", waits: "10 min", offsetMin: -155, city: "Riyadh" }, [arrive!.id]: { waits: "60 min", city: "Istanbul" } },
      segments: { [out!.id]: { bookedGate: "B12" } },
      weather: { tempC: 14, summary: "Light rain. Dry by Thursday.", tip: "Light rain. Pack the umbrella.", rain: true },
    });
    const base = withClock(await loadBase(trip!, tx), null);
    const pay = async (method: string, amount: number, label: string, provider: string, instalments = 1) => {
      const [p] = await tx.insert(appPayments).values({ ownerId: userId, method, status: "captured", amount, label, instalments, provider, providerRef: `mock_${randomUUID().slice(0, 12)}`, idempotencyKey: `seed-${randomUUID()}` }).returning();
      return p!.id;
    };
    const paidAt = new Date("2027-02-14T07:42:00Z");
    const customer = customerOf(base, user.name || "Omar Alharbi");
    await createCharge(tx, base, { ownerId: userId, tripId: trip!.id, paymentId: await pay("card", 2160_00 * n, "Visa ending 41", "mock"), item: "flight", title: "Flights · Saudia", sub: `SV263 and SV264 · ${n} travellers`, amount: 2160_00 * n, method: "card", label: "Visa ending 41", paidAt, customer });
    await createCharge(tx, base, { ownerId: userId, tripId: trip!.id, paymentId: await pay("tabby", 5880_00, "Tabby", "tabby", 4), item: "stay", title: "Rooms near Galata Tower", sub: "6 nights · from 9 Mar", amount: 5880_00, method: "tabby", label: "Visa ending 41", plan: "tabby", instalments: instalmentPlan(5880_00, "tabby", "2027-02-14", 1), paidAt, customer });
    await createCharge(tx, base, { ownerId: userId, tripId: trip!.id, paymentId: await pay("card", 440_00, "Visa ending 41", "mock"), item: "pickup", title: "Airport pickup both ways", sub: "Khalid in Riyadh · Ahmet in Istanbul", amount: 440_00, method: "card", label: "Visa ending 41", paidAt, customer });
    // Last Eid in Baku, so Past and the recap have something real to remember.
    await tx.insert(appTrips).values({ ownerId: userId, city: "Baku", country: "Azerbaijan", imageUrl: "baku-old-city", startDate: "2026-03-30", endDate: "2026-04-04", travellerIds: ids, status: "completed", bookingRef: "B4KU26", confirmedByName: "Faisal" });
    await appAuditLog(tx, { actorKind: "system", actorId: null, action: "trip.demo_seeded", entityType: "app_trip", entityId: trip!.id, summary: "Seeded the Istanbul demo trip" });
    return trip!.id;
  });
  return tripId;
}
