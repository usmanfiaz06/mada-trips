import "server-only";
import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import {
  CreatePlanRequest, PlanOpsRequest, SetOriginRequest, addDays, daysBetween, todayIn, type PlanChange, type PlanChangeResponse, type PlanItemInput, type Plan,
  type CreatePlanRequest as CreateInput, type PlanOpsRequest as OpsInput, type SetOriginRequest as OriginInput,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPeople, appTrips } from "@/db/app-schema";
import { appPlanItems, appPlans, type PlanDriveJson, type PlanPlaceJson } from "@/db/app-schema-plans";
import { AppError } from "../http";
import { travellersOf } from "../booking/common";
import { emit } from "./events";
import { resolvePlace, samePlace } from "./places";
import {
  countryName, deriveStatus, liveItems, loadBookings, matchBookings, originLegs, ownTrip, planEvent, readPlan, resolveOrigin, shapeOf, stopsOf,
  defaultStart, type By, type ItemRow, type Origin, type PlanRow,
} from "./plans";
import { templateOf } from "./templates";
import { driveStale, getDrive, toPlanDrive } from "../drive/drive";
import { pointOf } from "../drive/places";

/*
 * Writes to a living plan (ASK-INTEGRATED §3.5, §3.8): create, item ops and the origin. Every write takes the plan's
 * row lock, checks the version the caller read (a stale one is refused with PLAN_CHANGED, so a manual edit is never
 * overwritten by Ask or another device), bumps it, and writes a plan event. Booked items can't be moved or removed
 * here: that's the change flow.
 */

/* ───────────── drives (U4) ───────────── */

/**
 * The one call site for drive numbers: after a write, the drive legs that need them (lib/app/drive). Each gets km and
 * time from a router (cached), or a straight-line estimate labelled as one with no time when the router is down or
 * today's budget is spent; an estimate or an expired figure is asked again on the next write. A leg whose places we
 * can't locate keeps no drive: no distance or time rather than one nobody measured.
 */
export async function fillDrives(planId: string, legs: Pick<ItemRow, "id" | "fromPlace" | "toPlace" | "day" | "startsAt">[]): Promise<Map<string, PlanDriveJson>> {
  const out = new Map<string, PlanDriveJson>();
  if (!legs.length) return out;
  const [plan] = await db.select({ startDate: appPlans.startDate }).from(appPlans).where(eq(appPlans.id, planId));
  for (const leg of legs) {
    const from = pointOf(leg.fromPlace), to = pointOf(leg.toPlace);
    if (!from || !to) continue;
    const date = plan && leg.day != null ? addDays(plan.startDate, leg.day) : null;
    try {
      out.set(leg.id, toPlanDrive(await getDrive({ from, to, date, at: leg.startsAt?.slice(11, 16) ?? null })));
    } catch (e) {
      console.warn("[plans] drive not filled", e instanceof Error ? e.message.slice(0, 120) : "");
    }
  }
  return out;
}

async function driveLegs(planId: string, ids?: string[]) {
  const legs = (await liveItems(planId)).filter((i) => i.kind === "leg" && i.mode === "drive" && driveStale(i.drive) && (!ids || !!i.drive || ids.includes(i.id)));
  if (!legs.length) return;
  const found = await fillDrives(planId, legs);
  for (const [id, drive] of found) await db.update(appPlanItems).set({ drive, updatedAt: new Date() }).where(and(eq(appPlanItems.id, id), eq(appPlanItems.planId, planId)));
}

/* ───────────── create ───────────── */

/**
 * A plan from a shape (places and nights) or a template, on a new planning trip or on a trip that has none yet.
 * Free and reversible: nothing is priced, held or shared. The origin comes from what was said, memory or the last
 * booking; unknown leaves the plan without legs out and home and the read says originNeeded.
 */
export async function createPlan(ownerId: string, input: CreateInput, opts: { by?: By; tripId?: string | null } = {}): Promise<Plan> {
  const b = CreatePlanRequest.parse(input);
  const by = opts.by ?? "traveller";
  if (b.templateId && !templateOf(b.templateId)) throw new AppError("NOT_FOUND");
  const existing = opts.tripId ? await ownTrip(ownerId, opts.tripId) : null;
  const origin = await resolveOrigin(ownerId, b.origin);
  const returnTo = b.returnTo === null ? null : b.returnTo && b.returnTo !== "same" ? resolvePlace(b.returnTo) : origin ? stripSource(origin) : null;
  let travellerIds = b.travellerIds?.length ? (await travellersOf(ownerId, b.travellerIds)).map((p) => p.id) : existing?.travellerIds ?? [];
  if (!travellerIds.length) {
    const [self] = await db.select({ id: appPeople.id }).from(appPeople).where(and(eq(appPeople.ownerId, ownerId), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt)));
    if (self) travellerIds = [self.id];
  }
  const start = b.start ?? existing?.startDate ?? defaultStart(todayIn());
  const shape = shapeOf(b, start, origin ? stripSource(origin) : null, returnTo);
  const end = addDays(start, shape.days - 1);
  const createdBy = by === "system" ? "traveller" : shape.template && by === "traveller" ? "template" : by;

  const tripId = await db.transaction(async (tx) => {
    let tripId = existing?.id ?? null;
    if (tripId) {
      const [taken] = await tx.select({ id: appPlans.id }).from(appPlans).where(eq(appPlans.tripId, tripId));
      if (taken) throw new AppError("VALIDATION", { fields: { tripId: "This trip already has a plan" } });
      await tx.update(appTrips).set({ origin: origin ?? existing!.origin, kind: shape.kind, travellerIds, updatedAt: new Date() }).where(eq(appTrips.id, tripId));
    } else {
      const [trip] = await tx.insert(appTrips).values({
        ownerId, city: shape.main.city || shape.main.name, country: countryName(shape.main), startDate: start, endDate: end, travellerIds, status: "planning", origin, kind: shape.kind,
      }).returning({ id: appTrips.id });
      tripId = trip!.id;
    }
    const [plan] = await tx.insert(appPlans).values({
      tripId, ownerId, origin, returnTo, startDate: start, endDate: end, pace: b.pace ?? "normal", templateId: shape.template?.id ?? null, createdBy,
    }).returning();
    if (shape.items.length) await tx.insert(appPlanItems).values(shape.items.map((x) => ({ ...x, planId: plan!.id, source: x.source === "template" ? "template" : sourceOf(by) })));
    await planEvent(tx, plan!.id, by, "create", null, { title: shape.template?.title ?? shape.main.name, days: shape.days, items: shape.items.length });
    return tripId;
  });
  const plan = (await db.select().from(appPlans).where(eq(appPlans.tripId, tripId)))[0]!;
  await driveLegs(plan.id);
  // A trip that already had bookings: link them to the new items straight away.
  if (existing) await emit({ kind: "segment.changed", tripId });
  await emit({ kind: "plan.changed", tripId, planId: plan.id, version: plan.version, by });
  return readPlan(ownerId, tripId);
}

const stripSource = (o: Origin): PlanPlaceJson => { const { source: _s, ...p } = o; return p; };
const sourceOf = (by: By) => (by === "traveller" ? "manual" : by === "system" ? "booking" : by);

/* ───────────── the version lock ───────────── */

async function locked(tx: Tx, ownerId: string, tripId: string, version: number | undefined): Promise<PlanRow> {
  await ownTrip(ownerId, tripId, tx);
  const [plan] = await tx.select().from(appPlans).where(eq(appPlans.tripId, tripId)).for("update");
  if (!plan) throw new AppError("NOT_FOUND");
  if (version !== undefined && version !== plan.version) throw new AppError("PLAN_CHANGED", { details: { version: plan.version } });
  return plan;
}

const BOOKED = new Set(["held", "booked", "confirmed"]);

/** Items whose booking says they're held, booked or confirmed: the agent and the plan screen can't move them. */
async function bookedIds(tx: Tx, plan: PlanRow, items: ItemRow[]): Promise<Set<string>> {
  const b = await loadBookings(plan.tripId, items, tx);
  const links = matchBookings(items, b, plan.startDate);
  return new Set(items.filter((i) => BOOKED.has(deriveStatus(i, b, links.get(i.id) ?? null).status)).map((i) => i.id));
}

/* ───────────── item ops ───────────── */

function toRow(plan: PlanRow, day: number | null, x: Partial<PlanItemInput>) {
  const at = (hhmm: string | null | undefined) => (hhmm && day != null ? `${addDays(plan.startDate, day)}T${hhmm}` : hhmm === null ? null : undefined);
  const from = x.from === undefined ? undefined : resolvePlace(x.from);
  const to = x.to === undefined ? undefined : resolvePlace(x.to);
  return {
    ...(x.kind !== undefined ? { kind: x.kind } : {}),
    ...(x.mode !== undefined ? { mode: x.mode } : {}),
    ...(x.title !== undefined ? { title: x.title } : {}),
    ...(x.note !== undefined ? { note: x.note } : {}),
    ...(x.place !== undefined ? { place: resolvePlace(x.place) } : {}),
    ...(from !== undefined ? { fromPlace: from } : {}),
    ...(to !== undefined ? { toPlace: to } : {}),
    ...(at(x.at) !== undefined ? { startsAt: at(x.at) } : {}),
    ...(at(x.until) !== undefined ? { endsAt: at(x.until) } : {}),
    ...(x.nights !== undefined ? { nights: x.nights } : {}),
    // A leg's places changed: its drive numbers no longer hold.
    ...(from !== undefined || to !== undefined || x.mode !== undefined ? { drive: null } : {}),
  };
}

/** Where an item goes in a day: after the given item, or last. Later items move down to make room. */
async function placeIn(tx: Tx, planId: string, items: ItemRow[], day: number | null, afterItemId: string | null | undefined): Promise<number> {
  const same = items.filter((i) => i.day === day).sort((a, b) => a.sort - b.sort);
  if (afterItemId) {
    const after = same.find((i) => i.id === afterItemId);
    if (!after) throw new AppError("VALIDATION", { fields: { afterItemId: "Not on that day" } });
    const later = same.filter((i) => i.sort > after.sort);
    if (later.length) await tx.update(appPlanItems).set({ sort: sqlPlus(1) }).where(inArray(appPlanItems.id, later.map((i) => i.id)));
    later.forEach((i) => { i.sort += 1; });
    return after.sort + 1;
  }
  return (same.at(-1)?.sort ?? 0) + 10;
}

const sqlPlus = (n: number) => sql`${appPlanItems.sort} + ${n}`;

/**
 * Apply up to 10 ops at once, all or none, against the version the caller read. by "ask" | "traveller" | "desk"
 * marks who did it (the chat is told about the others' changes, §3.6).
 */
export async function applyOps(ownerId: string, tripId: string, input: OpsInput, by: By = "traveller"): Promise<PlanChangeResponse> {
  const b = PlanOpsRequest.parse(input);
  const changes: PlanChange[] = [];
  const touched: string[] = [];
  const planId = await db.transaction(async (tx) => {
    const plan = await locked(tx, ownerId, tripId, b.version);
    const items = await liveItems(plan.id, tx);
    const days = daysBetween(plan.startDate, plan.endDate) + 1;
    const booked = await bookedIds(tx, plan, items);
    const find = (id: string) => {
      const it = items.find((i) => i.id === id);
      if (!it) throw new AppError("NOT_FOUND");
      return it;
    };
    const dayOk = (d: number | null) => {
      if (d != null && d >= days) throw new AppError("VALIDATION", { fields: { day: `The plan has ${days} days` } });
    };
    const refuseBooked = (it: ItemRow) => {
      if (booked.has(it.id)) throw new AppError("VALIDATION", { fields: { itemId: "Booked: change it through the booking" }, details: { booked: true, itemId: it.id } });
    };
    for (const op of b.ops) {
      if (op.op === "add") {
        dayOk(op.day);
        const sort = await placeIn(tx, plan.id, items, op.day, op.afterItemId);
        const [row] = await tx.insert(appPlanItems).values({ planId: plan.id, day: op.day, sort, status: "idea", source: sourceOf(by), ...toRow(plan, op.day, op.item), kind: op.item.kind, title: op.item.title }).returning();
        items.push(row!);
        touched.push(row!.id);
        changes.push({ op: "add", itemId: row!.id, day: op.day, title: row!.title });
        await planEvent(tx, plan.id, by, "add", row!.id, { title: row!.title, day: op.day, kind: row!.kind });
      } else if (op.op === "update") {
        const it = find(op.itemId);
        // A booked item keeps everything but its note.
        const keys = Object.keys(op.item).filter((k) => (op.item as Record<string, unknown>)[k] !== undefined);
        if (keys.some((k) => k !== "note")) refuseBooked(it);
        const set = toRow(plan, it.day, op.item);
        await tx.update(appPlanItems).set({ ...set, updatedAt: new Date() }).where(eq(appPlanItems.id, it.id));
        touched.push(it.id);
        changes.push({ op: "update", itemId: it.id, day: it.day, title: op.item.title ?? it.title });
        await planEvent(tx, plan.id, by, "update", it.id, { title: op.item.title ?? it.title, day: it.day, fields: keys });
      } else if (op.op === "move") {
        const it = find(op.itemId);
        refuseBooked(it);
        dayOk(op.day);
        // "Move up" to the top of a day: before everything on it.
        const others = items.filter((i) => i.id !== it.id);
        const top = Math.min(...others.filter((i) => i.day === op.day).map((i) => i.sort));
        const sort = op.first ? (Number.isFinite(top) ? top - 10 : 10) : await placeIn(tx, plan.id, others, op.day, op.afterItemId);
        // A timed item keeps its time of day on its new day.
        const startsAt = it.startsAt && op.day != null ? `${addDays(plan.startDate, op.day)}T${it.startsAt.slice(11, 16)}` : it.startsAt;
        const endsAt = it.endsAt && op.day != null ? `${addDays(plan.startDate, op.day)}T${it.endsAt.slice(11, 16)}` : it.endsAt;
        await tx.update(appPlanItems).set({ day: op.day, sort, startsAt, endsAt, updatedAt: new Date() }).where(eq(appPlanItems.id, it.id));
        changes.push({ op: "move", itemId: it.id, day: op.day, title: it.title });
        await planEvent(tx, plan.id, by, "move", it.id, { title: it.title, from: it.day, day: op.day });
        Object.assign(it, { day: op.day, sort });
      } else if (op.op === "remove") {
        const it = find(op.itemId);
        refuseBooked(it);
        await tx.update(appPlanItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(appPlanItems.id, it.id));
        items.splice(items.indexOf(it), 1);
        changes.push({ op: "remove", itemId: it.id, day: it.day, title: it.title });
        await planEvent(tx, plan.id, by, "remove", it.id, { title: it.title, day: it.day });
      } else {
        const it = find(op.itemId);
        if (op.op === "skip") refuseBooked(it);
        const status = op.op === "skip" ? "skipped" : "idea";
        await tx.update(appPlanItems).set({ status, statusNote: null, updatedAt: new Date() }).where(eq(appPlanItems.id, it.id));
        changes.push({ op: "status", itemId: it.id, day: it.day, title: it.title });
        await planEvent(tx, plan.id, by, "status", it.id, { title: it.title, day: it.day, to: status });
      }
    }
    await tx.update(appPlans).set({ version: plan.version + 1, updatedAt: new Date() }).where(eq(appPlans.id, plan.id));
    return plan.id;
  });
  await driveLegs(planId, touched);
  const plan = await readPlan(ownerId, tripId);
  await emit({ kind: "plan.changed", tripId, planId, version: plan.version, by });
  return { plan, changes, untouched: [] };
}

/* ───────────── origin ───────────── */

/**
 * A new start (§3.8): the leg out and the leg home are rebuilt from the new place, a priced leg drops back to an idea
 * ("price needs checking again"), and a booked leg is never touched: it comes back in `untouched` so Mada can offer
 * the change flow or a connecting leg. The title follows unless the traveller renamed the trip.
 */
export async function setOrigin(ownerId: string, tripId: string, input: OriginInput, by: By = "traveller"): Promise<PlanChangeResponse> {
  const b = SetOriginRequest.parse(input);
  const place = resolvePlace(b.origin)!;
  const origin: Origin = { ...place, source: "said" };
  const changes: PlanChange[] = [];
  const untouched: { itemId: string; title: string }[] = [];
  const touched: string[] = [];
  const planId = await db.transaction(async (tx) => {
    const plan = await locked(tx, ownerId, tripId, b.version);
    const [trip] = await tx.select().from(appTrips).where(eq(appTrips.id, tripId));
    const items = await liveItems(plan.id, tx);
    const booked = await bookedIds(tx, plan, items);
    const old = (trip!.origin ?? plan.origin) as PlanPlaceJson | null;
    // The way home follows the start unless it was set to somewhere else (or one way).
    const returnTo = b.returnTo === null ? null : b.returnTo && b.returnTo !== "same" ? resolvePlace(b.returnTo) : b.returnTo === "same" || !plan.returnTo || samePlace(plan.returnTo, old) ? place : plan.returnTo;
    const stops = stopsOf(items.filter((i) => !i.originLeg), trip!);
    const tpl = templateOf(plan.templateId);
    const days = daysBetween(plan.startDate, plan.endDate) + 1;
    const fresh = originLegs({ origin: place, returnTo, first: stops[0]!, last: stops[stops.length - 1]!, start: plan.startDate, lastDay: days - 1, template: tpl });
    for (const which of ["out", "home"] as const) {
      const cur = items.find((i) => i.originLeg === which);
      const next = fresh.find((x) => x.originLeg === which) ?? null;
      if (cur && booked.has(cur.id)) { untouched.push({ itemId: cur.id, title: cur.title }); continue; }
      if (cur && !next) {
        await tx.update(appPlanItems).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(appPlanItems.id, cur.id));
        changes.push({ op: "remove", itemId: cur.id, day: cur.day, title: cur.title });
        await planEvent(tx, plan.id, by, "remove", cur.id, { title: cur.title, day: cur.day });
        continue;
      }
      if (!next) continue;
      const wasPriced = !!cur?.offerId || cur?.status === "priced";
      const set = {
        mode: next.mode, title: next.title, note: next.note ?? null, fromPlace: next.fromPlace ?? null, toPlace: next.toPlace ?? null, startsAt: next.startsAt ?? null, endsAt: null,
        drive: null, offerId: null, status: "idea", statusNote: wasPriced ? "Price needs checking again" : null, updatedAt: new Date(),
      };
      if (cur) {
        await tx.update(appPlanItems).set(set).where(eq(appPlanItems.id, cur.id));
        touched.push(cur.id);
        changes.push({ op: "update", itemId: cur.id, day: cur.day, title: next.title });
        await planEvent(tx, plan.id, by, "update", cur.id, { title: next.title, day: cur.day, was: cur.title });
      } else {
        const sameDay = items.filter((i) => i.day === next.day).map((i) => i.sort);
        const sort = which === "out" ? Math.min(10, ...sameDay) - 1 : Math.max(0, ...sameDay) + 10;
        const [row] = await tx.insert(appPlanItems).values({ ...set, planId: plan.id, day: next.day, sort, kind: "leg", originLeg: which, source: sourceOf(by) }).returning({ id: appPlanItems.id });
        touched.push(row!.id);
        changes.push({ op: "add", itemId: row!.id, day: next.day ?? null, title: next.title });
        await planEvent(tx, plan.id, by, "add", row!.id, { title: next.title, day: next.day });
      }
    }
    await tx.update(appTrips).set({ origin, updatedAt: new Date() }).where(eq(appTrips.id, tripId));
    await tx.update(appPlans).set({ origin, returnTo, version: plan.version + 1, updatedAt: new Date() }).where(eq(appPlans.id, plan.id));
    changes.unshift({ op: "origin", itemId: null, day: null, title: place.city || place.name });
    await planEvent(tx, plan.id, by, "origin", null, { from: old?.city ?? old?.name ?? null, to: place.city || place.name });
    return plan.id;
  });
  // A leg that became a drive gets its numbers from the drive interface; the rest keep none.
  await driveLegs(planId, touched);
  const plan = await readPlan(ownerId, tripId);
  await emit({ kind: "plan.changed", tripId, planId, version: plan.version, by });
  return { plan, changes, untouched };
}

