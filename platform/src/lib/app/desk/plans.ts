import "server-only";
import { and, desc, eq, inArray, isNull } from "drizzle-orm";
import type { Plan } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appRequests, appTrips, appUsers } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { appPlanItems, appPlans } from "@/db/app-schema-plans";
import { appTripTravellers } from "@/db/app-schema-trips";
import { readPlan } from "../plans/plans";
import { linkRequest } from "../plans/booking";
import { assertCap, deskAudit, DeskError, type DeskActor } from "./core";

/*
 * The living plan as the desk sees it (ASK-INTEGRATED.md §10, U8): read-only on the customer page (each trip with its
 * plan, travellers and chats), and on a request page the plan item it fulfils, with "Link to plan item" for a request
 * that came in without one (or was booked by hand). Linking goes through the plan's own write (plans/booking.ts
 * linkRequest), so the item reads "With the team" in the app and the chat is told the desk changed it.
 */

export type DeskPlan = {
  tripId: string; title: string; status: string; plan: Plan;
  travellers: { name: string; status: string; role: string }[];
  threads: { id: string; title: string | null; kind: string }[];
};

/** Every trip of this customer that has a plan, newest first. */
export async function customerPlans(userId: string): Promise<DeskPlan[]> {
  const trips = await db.select({ id: appTrips.id, status: appTrips.status }).from(appTrips).innerJoin(appPlans, eq(appPlans.tripId, appTrips.id))
    .where(eq(appTrips.ownerId, userId)).orderBy(desc(appTrips.startDate)).limit(20);
  if (!trips.length) return [];
  const ids = trips.map((t) => t.id);
  const [people, threads] = await Promise.all([
    db.select({ tripId: appTripTravellers.tripId, name: appTripTravellers.name, given: appPeople.givenNames, userName: appUsers.name, status: appTripTravellers.status, role: appTripTravellers.role })
      .from(appTripTravellers).leftJoin(appPeople, eq(appPeople.id, appTripTravellers.personId)).leftJoin(appUsers, eq(appUsers.id, appTripTravellers.userId))
      .where(inArray(appTripTravellers.tripId, ids)),
    db.select({ id: appAskThreads.id, tripId: appAskThreads.tripId, title: appAskThreads.title, kind: appAskThreads.kind }).from(appAskThreads)
      .where(and(inArray(appAskThreads.tripId, ids), isNull(appAskThreads.archivedAt))),
  ]);
  const out: DeskPlan[] = [];
  for (const t of trips) {
    const plan = await readPlan(userId, t.id);
    out.push({
      tripId: t.id, title: plan.title, status: t.status, plan,
      // Names as the plan knows them (first names); never documents or contacts.
      travellers: people.filter((p) => p.tripId === t.id).map((p) => ({ name: (p.userName || p.given || p.name || "").split(/\s+/)[0] || "—", status: p.status, role: p.role })),
      threads: threads.filter((x) => x.tripId === t.id).map((x) => ({ id: x.id, title: x.title, kind: x.kind })),
    });
  }
  return out;
}

export type RequestPlanView = {
  linked: { itemId: string; title: string; day: number | null; status: string; tripId: string; planTitle: string } | null;
  /** Items this request could be linked to: unbooked items on the customer's plans (the request's trip first). */
  candidates: { itemId: string; label: string }[];
};

const BOOKED = new Set(["held", "booked", "confirmed", "cancelled", "skipped"]);

export async function requestPlan(requestId: string): Promise<RequestPlanView | null> {
  const [r] = await db.select({ ownerId: appRequests.ownerId, tripId: appRequests.tripId, planItemId: appRequests.planItemId }).from(appRequests).where(eq(appRequests.id, requestId));
  if (!r) return null;
  const trips = await db.select({ id: appTrips.id }).from(appTrips).innerJoin(appPlans, eq(appPlans.tripId, appTrips.id))
    .where(and(eq(appTrips.ownerId, r.ownerId), r.tripId ? eq(appTrips.id, r.tripId) : undefined)).orderBy(desc(appTrips.startDate)).limit(5);
  let linked: RequestPlanView["linked"] = null;
  const candidates: RequestPlanView["candidates"] = [];
  for (const t of trips) {
    const plan = await readPlan(r.ownerId, t.id);
    for (const i of plan.items) {
      if (i.id === r.planItemId) linked = { itemId: i.id, title: i.title, day: i.day, status: i.status, tripId: t.id, planTitle: plan.title };
      else if (!BOOKED.has(i.status) && !i.requestId) candidates.push({ itemId: i.id, label: `${plan.title} · ${i.day == null ? "Whole trip" : `Day ${i.day + 1}`} · ${i.title}` });
    }
  }
  return { linked, candidates: candidates.slice(0, 40) };
}

/** "Link to plan item": the request now fulfils that item (desk.act), written as the desk's change to the plan. */
export async function linkRequestToItem(actor: DeskActor, requestId: string, itemId: string): Promise<void> {
  assertCap(actor, "desk.act");
  const [r] = await db.select({ ownerId: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, requestId));
  if (!r) throw new DeskError("Not found", "NOT_FOUND");
  const [item] = await db.select({ title: appPlanItems.title }).from(appPlanItems).where(eq(appPlanItems.id, itemId));
  const done = await linkRequest(r.ownerId, itemId, requestId, "desk");
  if (!done || !item) throw new DeskError("That plan item can't be linked (it's booked, gone, or on someone else's trip)");
  await deskAudit(db, actor, { action: "desk.request.plan_linked", entityType: "request", entityId: requestId, summary: `Linked to plan item: ${item.title}`, data: { itemId, tripId: done.tripId } });
}
