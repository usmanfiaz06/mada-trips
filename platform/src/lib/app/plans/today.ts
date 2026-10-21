import "server-only";
import { and, asc, eq, gte, inArray, lte, ne, or } from "drizzle-orm";
import { TODAY_PASSPORT_DAYS, addDays, daysBetween, todayCards, type TodayPlanResponse } from "@mada/shared";
import { db } from "@/db";
import { appPickups, appTrips } from "@/db/app-schema";
import { appPlans } from "@/db/app-schema-plans";
import { appTripTravellers } from "@/db/app-schema-trips";
import { riyadhDate } from "@/lib/dates";
import { listPeople } from "../people";
import { planFor } from "./access";

/*
 * Today from the plan (ASK-INTEGRATED.md §1.3, §11 U9). The trip that's near (owned, or one you're going on), and what
 * its plan says for today and tomorrow: a pickup (the booking's time and meeting point) or a car to collect, a booked
 * stay's check-in, a drive U4 measured ("3 h to Melaka", "leave by" only when the item has a time), and the checks that
 * aren't fine. The cards are built by the shared todayCards() (the app's mock builds the same); nothing is made up.
 * Planning trips show nothing until 7 days before (passports from 30, since renewing takes weeks).
 */

/** The nearest trip with a plan that hasn't ended and starts within a month: owned or one you're going on. */
async function nearTrip(userId: string, today: string): Promise<{ id: string } | null> {
  const going = db.select({ id: appTripTravellers.tripId }).from(appTripTravellers)
    .where(and(eq(appTripTravellers.userId, userId), eq(appTripTravellers.status, "going")));
  const [t] = await db.select({ id: appTrips.id }).from(appTrips).innerJoin(appPlans, eq(appPlans.tripId, appTrips.id))
    .where(and(or(eq(appTrips.ownerId, userId), inArray(appTrips.id, going)), ne(appTrips.status, "cancelled"), gte(appPlans.endDate, today), lte(appPlans.startDate, addDays(today, TODAY_PASSPORT_DAYS))))
    .orderBy(asc(appPlans.startDate)).limit(1);
  return t ?? null;
}

/** GET /trips/plan-today. `today` is injectable for tests (Riyadh's date otherwise). */
export async function todayFromPlan(userId: string, today = riyadhDate()): Promise<TodayPlanResponse> {
  const near = await nearTrip(userId, today);
  if (!near) return { trip: null, cards: [] };
  const { plan, access } = await planFor(userId, near.id);
  const pickups = await db.select({ id: appPickups.id, at: appPickups.at, meetingPoint: appPickups.meetingPoint }).from(appPickups)
    .where(and(eq(appPickups.tripId, plan.tripId), ne(appPickups.status, "cancelled")));
  // Names on to-dos are the owner's household's first names; a companion sees the to-dos without them.
  const names = new Map<string, string>();
  if (access?.role === "owner") for (const p of await listPeople(userId)) names.set(p.id, p.firstName || p.givenNames.split(" ")[0] || "");
  return {
    trip: { id: plan.tripId, title: plan.title, startDate: plan.startDate, endDate: plan.endDate, startsIn: daysBetween(today, plan.startDate) },
    cards: todayCards(plan, today, pickups, names),
  };
}
