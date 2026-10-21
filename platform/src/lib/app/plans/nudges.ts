import "server-only";
import { and, desc, eq, gte, isNull, sql } from "drizzle-orm";
import { formatSar, t, type ChatCard, type PlanCheck } from "@mada/shared";
import { db } from "@/db";
import { appQuotes, appRequests, appTrips } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { appPlanItems, appPlans } from "@/db/app-schema-plans";
import { appPlanChangeRequests } from "@/db/app-schema-trips";
import { riyadhDate } from "@/lib/dates";
import { localeOfUser } from "../locale";
import { listPeople } from "../people";
import { peopleByIds } from "../circles/common";
import { appendLine, newThread, primaryThreadOf } from "../ask-chat/store";
import { createRequest } from "../booking/requests";
import { notify } from "../trips/notify";
import { tripName } from "../trips/travellers";
import { readPlan, riyadhHm } from "./plans";

/*
 * The plan's nudges (ASK-INTEGRATED.md §1.3, §5.5 step 4; U9). Three things a person hears about without opening the
 * plan:
 *   - a companion's change the owner approved that costs money: the team prices it (a request on the new item, linked
 *     back to the change), and the payer's chat gets "Abdullah's change needs booking" with Book · Not now once priced;
 *   - a price ready on a plan item (the desk's quote, or the mock desk's): one push that opens the plan at the item;
 *   - a plan check turning amber (a passport that won't last the trip): one push, by the hourly documents job, never at
 *     night (22:00 to 07:00 Riyadh). The checks last told are kept on the plan (app_plans.checks), so it never repeats.
 * Every push lands in the inbox first (trips/notify.ts). Nothing here charges anyone or shares anything.
 */

type ChangeRow = typeof appPlanChangeRequests.$inferSelect;

/** Riyadh's night: no plan pushes from a job between 22:00 and 07:00. */
export const quietHours = (now = new Date()) => {
  const h = Number(riyadhHm(now).slice(0, 2));
  return h >= 22 || h < 7;
};

/** The payer's chat about the trip: the one the change was posted in, else his primary one, else a new one. */
async function payerThread(ownerId: string, tripId: string, preferred: string | null): Promise<string> {
  if (preferred) {
    const [ok] = await db.select({ id: appAskThreads.id }).from(appAskThreads).where(and(eq(appAskThreads.id, preferred), eq(appAskThreads.ownerId, ownerId)));
    if (ok) return ok.id;
  }
  const have = await primaryThreadOf(ownerId, tripId);
  if (have) return have.id;
  return (await newThread(ownerId, await localeOfUser(ownerId), tripId)).id;
}

/**
 * Approved, and it costs money (§5.5 step 4): each new item that needs booking goes to the team to price (it reads
 * "With the team · back by …" on the plan), and the payer's chat says so with the card in its pricing state. When the
 * quote comes in, quoteReady() posts the card again with the price.
 */
export async function payChangeOnApprove(r: ChangeRow, addedItemIds: string[]): Promise<void> {
  if (!r.costs || !addedItemIds.length) return;
  const items = await db.select().from(appPlanItems).where(and(eq(appPlanItems.planId, r.planId), isNull(appPlanItems.deletedAt)));
  const [plan] = await db.select().from(appPlans).where(eq(appPlans.id, r.planId));
  const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, r.tripId));
  if (!plan || !trip) return;
  const byName = (await peopleByIds([r.byUserId])).get(r.byUserId)?.short?.split(/\s+/)[0] ?? "";
  const title = await tripName(trip);
  const lang = await localeOfUser(r.ownerId);
  const threadId = await payerThread(r.ownerId, r.tripId, r.ownerThreadId);
  for (const id of addedItemIds) {
    const it = items.find((i) => i.id === id);
    if (!it || !["stay", "leg", "car"].includes(it.kind)) continue;
    const place = (it.place as { city?: string | null; name?: string } | null) ?? null;
    const from = it.day != null ? addDaysIso(plan.startDate, it.day) : null;
    const to = from && it.nights ? addDaysIso(from, it.nights) : null;
    const req = await createRequest(r.ownerId, {
      kind: it.kind === "stay" ? "stay" : it.kind === "car" ? "car_rental" : "general",
      query: r.summary, travellerIds: trip.travellerIds, note: "", answers: {}, needs: {},
      contactPreference: "in_app", clientId: `change-${r.id.slice(0, 8)}-${id.slice(0, 8)}`, planItemId: id,
      ...(it.kind === "stay" ? { search: { destination: null, destinationName: (place?.city || place?.name || it.title).slice(0, 60), from: null, depart: from, return: to, cabin: null, carrier: null } } : {}),
    } as Parameters<typeof createRequest>[1], null);
    // The request knows which change it serves, so its quote comes back to the payer as this change's card.
    await db.update(appRequests).set({ details: sql`${appRequests.details} || ${JSON.stringify({ changeId: r.id })}::jsonb` }).where(eq(appRequests.id, req.id));
    const card: ChatCard = { type: "pay_change", tripId: r.tripId, changeId: r.id, byName, tripTitle: title, what: it.title, requestId: req.id, amount: null, promisedBy: req.promisedBy ? riyadhHm(new Date(req.promisedBy)) : null };
    await appendLine(r.ownerId, threadId, { who: "mada", text: t("people.line.needsBooking", { name: byName }, lang), kept: [card], at: new Date().toISOString() });
  }
}

const addDaysIso = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/**
 * A price is in on a request (the desk's quote, the mock desk's): when the request is for a plan item, the owner gets
 * one push that opens the plan; when it prices a companion's change, the push and the payer's chat say so with the
 * card (Book · Not now). Once per quote (the request remembers the quote it told about).
 */
export async function quoteReady(requestId: string): Promise<boolean> {
  const [r] = await db.select().from(appRequests).where(eq(appRequests.id, requestId));
  if (!r?.planItemId || !r.tripId) return false;
  const [q] = await db.select().from(appQuotes).where(and(eq(appQuotes.requestId, r.id), eq(appQuotes.status, "open"))).orderBy(desc(appQuotes.createdAt)).limit(1);
  if (!q) return false;
  const d = (r.details ?? {}) as { changeId?: string; toldQuoteId?: string };
  if (d.toldQuoteId === q.id) return false;
  const [told] = await db.update(appRequests).set({ details: sql`${appRequests.details} || ${JSON.stringify({ toldQuoteId: q.id })}::jsonb` })
    .where(and(eq(appRequests.id, r.id), sql`coalesce(${appRequests.details}->>'toldQuoteId', '') <> ${q.id}`)).returning({ id: appRequests.id });
  if (!told) return false;
  const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, r.tripId));
  const [item] = await db.select({ title: appPlanItems.title }).from(appPlanItems).where(eq(appPlanItems.id, r.planItemId));
  if (!trip) return false;
  const title = await tripName(trip);
  const amount = formatSar(q.total);
  const change = d.changeId ? (await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.id, d.changeId)))[0] : undefined;
  if (change) {
    const byName = (await peopleByIds([change.byUserId])).get(change.byUserId)?.short?.split(/\s+/)[0] ?? "";
    const threadId = await payerThread(r.ownerId, r.tripId, change.ownerThreadId);
    const lang = await localeOfUser(r.ownerId);
    const card: ChatCard = { type: "pay_change", tripId: r.tripId, changeId: change.id, byName, tripTitle: title, what: item?.title ?? r.summary, requestId: r.id, amount: q.total, promisedBy: null };
    await appendLine(r.ownerId, threadId, { who: "mada", text: t("people.line.priced", { name: byName }, lang), kept: [card], at: new Date().toISOString() });
    await notify(r.ownerId, { kind: "plan", level: "active", copy: "notify.planPayChange", vars: { name: byName, trip: title, amount }, href: `/ask/${threadId}`, data: { tripId: r.tripId, changeId: change.id, requestId: r.id } }).catch(() => {});
    return true;
  }
  await notify(r.ownerId, { kind: "plan", level: "active", copy: "notify.planQuote", vars: { what: item?.title ?? r.summary, trip: title, amount }, href: `/trip/${r.tripId}/plan?item=${r.planItemId}`, data: { tripId: r.tripId, itemId: r.planItemId, requestId: r.id } }).catch(() => {});
  return true;
}

/** Checks that turned amber since the plan last told: a check in `now` that's warn and wasn't warn in `before`. */
export function newlyAmber(before: Pick<PlanCheck, "key" | "state">[], now: PlanCheck[]): PlanCheck[] {
  return now.filter((c) => c.state === "warn" && !before.some((b) => b.key === c.key && b.state === "warn"));
}

/**
 * The hourly documents job: each plan that hasn't ended reads its checks again; a check that turned amber is pushed
 * once to the owner (opening the plan). Quiet at night: nothing is read or stored, so the next day's run tells it.
 */
export async function planChecksJob(now = new Date()): Promise<{ planChecks: number }> {
  if (quietHours(now)) return { planChecks: 0 };
  const today = riyadhDate(now);
  const plans = await db.select({ id: appPlans.id, tripId: appPlans.tripId, ownerId: appPlans.ownerId, checks: appPlans.checks }).from(appPlans)
    .innerJoin(appTrips, eq(appTrips.id, appPlans.tripId)).where(and(gte(appPlans.endDate, today), sql`${appTrips.status} <> 'cancelled'`)).limit(500);
  let told = 0;
  for (const p of plans) {
    const plan = await readPlan(p.ownerId, p.tripId).catch(() => null);
    if (!plan) continue;
    const amber = newlyAmber((p.checks ?? []) as Pick<PlanCheck, "key" | "state">[], plan.checks);
    await db.update(appPlans).set({ checks: plan.checks.map((c) => ({ key: c.key, state: c.state })) }).where(eq(appPlans.id, p.id));
    for (const c of amber) {
      const people = c.key === "passports" ? await listPeople(p.ownerId) : [];
      const names = c.who.map((id) => people.find((x) => x.id === id)).filter(Boolean).map((x) => x!.firstName || x!.givenNames.split(" ")[0]).filter(Boolean).join(", ");
      await notify(p.ownerId, {
        kind: "plan", level: "active", copy: c.key === "passports" && names ? "notify.planCheck.passports" : "notify.planCheck", vars: { names, trip: plan.title },
        href: `/trip/${p.tripId}/plan`, data: { tripId: p.tripId, check: c.key },
      }).catch(() => {});
      told += 1;
    }
  }
  return { planChecks: told };
}
