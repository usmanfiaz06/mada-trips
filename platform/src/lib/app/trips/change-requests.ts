import "server-only";
import { and, desc, eq, isNull, lte } from "drizzle-orm";
import {
  CHANGE_REQUEST_REMIND_H, CHANGE_REQUEST_TTL_H, ChangeAsk, DecideChangeRequest, PlanOpsRequest, t,
  type ChangeLine, type ChangeRequestView, type ChatCard, type PlanOp,
} from "@mada/shared";
import { db } from "@/db";
import { appAskThreads } from "@/db/app-schema-ask";
import { appPlanChangeRequests, type ChangeLineRow } from "@/db/app-schema-trips";
import { AppError } from "../http";
import { localeOfUser } from "../locale";
import { peopleByIds } from "../circles/common";
import { applyOps } from "../plans/ops";
import { deriveStatus, liveItems, loadBookings, matchBookings, planRowOf, type ItemRow } from "../plans/plans";
import { redact } from "../ask-chat/guard";
import { appendLine, appendLineTo, newThread, primaryThreadOf } from "../ask-chat/store";
import { notify } from "./notify";
import { roleOf, tripName } from "./travellers";

/*
 * Changes asked by a companion (ASK-INTEGRATED.md §5.5). Abdullah, with "Can suggest", asks Mada in his chat for the
 * trip ("two nights in Melaka"); Mada turns it into plan ops against the version he read, and this keeps it as a
 * change request: the same card in his chat ("Waiting for Omar") and in Omar's chat for the trip (Approve · Decline ·
 * Change it), with a push. Approving applies the ops through the plan's own versioned write (plans/ops.ts), so every
 * screen updates through the event map; declining can carry a one-line reason. Either way Abdullah's chat gets the
 * line. "Can edit" applies ideas straight away. Anything that needs booking goes to the payer, never to the companion.
 * Open requests close after 48 hours, with a reminder at 24 (the quotes job).
 */

type Row = typeof appPlanChangeRequests.$inferSelect;
const HOUR = 3_600_000;
/** Open requests one companion may have on a trip at once. */
const MAX_OPEN = 5;

/* ───────────── words ───────────── */

const dayNo = (d: number | null | undefined) => (d == null ? null : String(d + 1));

/** What each op does, in plain words: the app words it in the reader's language from op, field, from and to. */
export function linesOf(ops: PlanOp[], items: Pick<ItemRow, "id" | "title" | "day" | "nights">[]): ChangeLineRow[] {
  const find = (id: string) => items.find((i) => i.id === id);
  return ops.map((op): ChangeLineRow => {
    if (op.op === "add") return { op: "add", title: op.item.title, day: op.day, field: null, from: null, to: null, text: `Add ${op.item.title}${op.day != null ? ` on day ${op.day + 1}` : ""}${op.item.nights ? `, ${op.item.nights} nights` : ""}` };
    const it = find(op.itemId);
    const title = it?.title ?? "";
    if (op.op === "move") return { op: "move", title, day: op.day, field: "day", from: dayNo(it?.day), to: dayNo(op.day), text: `${title}: day ${dayNo(it?.day) ?? "?"} → day ${dayNo(op.day) ?? "?"}` };
    if (op.op === "update") {
      if (op.item.nights != null) return { op: "update", title, day: it?.day ?? null, field: "nights", from: String(it?.nights ?? 1), to: String(op.item.nights), text: `${title}: ${it?.nights ?? 1} → ${op.item.nights} nights` };
      if (op.item.title) return { op: "update", title, day: it?.day ?? null, field: "title", from: title, to: op.item.title, text: `${title} → ${op.item.title}` };
      return { op: "update", title, day: it?.day ?? null, field: "other", from: null, to: null, text: `Change ${title}` };
    }
    return { op: op.op, title, day: it?.day ?? null, field: null, from: null, to: null, text: `${op.op === "remove" ? "Remove" : op.op === "skip" ? "Skip" : "Bring back"} ${title}` };
  });
}

async function viewOf(r: Row, viewerId: string): Promise<ChangeRequestView> {
  const [people, trip] = await Promise.all([peopleByIds([r.byUserId, r.ownerId]), roleOf(r.ownerId, r.tripId)]);
  const lines: ChangeLine[] = r.lines.map((l) => ({ ...l, field: l.field ?? null, from: l.from ?? null, to: l.to ?? null }));
  return {
    id: r.id, tripId: r.tripId, tripTitle: trip ? await tripName(trip.trip) : "", byName: people.get(r.byUserId)?.short ?? "", ownerName: people.get(r.ownerId)?.short ?? "",
    summary: r.summary, lines, costs: r.costs, status: r.status as ChangeRequestView["status"], reason: r.reason, mine: viewerId === r.ownerId,
    createdAt: r.createdAt.toISOString(), expiresAt: r.expiresAt.toISOString(), decidedAt: r.decidedAt?.toISOString() ?? null,
  };
}

export const changeCard = (change: ChangeRequestView): ChatCard => ({ type: "change", change });

/* ───────────── asking ───────────── */

export type Asked = { change: ChangeRequestView | null; applied: boolean; text: string };

/**
 * A companion asks for a change. View: refused (he can ask questions only). Suggest: a change request to the owner.
 * Edit: applied at once when nothing in it needs booking. The owner himself is sent to the plan's own edit tool.
 * Booked items can't be moved or removed from here (that's the change flow); a booked stay asked for more nights is
 * kept as a request that costs money, so it goes to the payer.
 */
export async function requestChange(userId: string, tripId: string, input: ChangeAsk, opts: { threadId?: string | null } = {}): Promise<Asked> {
  const b = ChangeAsk.parse(input);
  const who = await roleOf(userId, tripId);
  if (!who) throw new AppError("NOT_FOUND");
  if (who.role === "owner") throw new AppError("VALIDATION", { fields: { tripId: "Your own trip: change the plan directly" }, details: { owner: true } });
  if (who.role === "view") throw new AppError("FORBIDDEN", { details: { role: "view" } });
  const plan = await planRowOf(tripId);
  if (!plan) throw new AppError("NOT_FOUND");
  PlanOpsRequest.parse({ version: plan.version, ops: b.ops });
  // Each one pushes the owner: a few open at a time is plenty.
  const open = await db.select({ id: appPlanChangeRequests.id }).from(appPlanChangeRequests)
    .where(and(eq(appPlanChangeRequests.tripId, tripId), eq(appPlanChangeRequests.byUserId, userId), eq(appPlanChangeRequests.status, "pending")));
  if (open.length >= MAX_OPEN) throw new AppError("RATE_LIMITED", { retryAfter: 3600, details: { open: open.length } });
  const items = await liveItems(plan.id);
  const bookings = await loadBookings(tripId, items);
  const links = matchBookings(items, bookings, plan.startDate);
  const booked = new Set(items.filter((i) => ["booked", "confirmed", "held"].includes(deriveStatus(i, bookings, links.get(i.id) ?? null).status)).map((i) => i.id));
  let costs = false;
  for (const op of b.ops) {
    if (op.op === "add") { if (["stay", "leg", "car"].includes(op.item.kind) && who.trip.status !== "planning") costs = true; continue; }
    if (!items.some((i) => i.id === op.itemId)) throw new AppError("NOT_FOUND", { details: { itemId: op.itemId } });
    if (!booked.has(op.itemId)) continue;
    // More nights at a booked stay can be asked for (it needs booking: the payer decides); anything else booked can't.
    if (op.op === "update" && op.item.nights != null && Object.keys(op.item).every((k) => k === "nights" || k === "note")) { costs = true; continue; }
    throw new AppError("VALIDATION", { fields: { itemId: "Booked: change it through the booking" }, details: { booked: true, itemId: op.itemId } });
  }
  const summary = redact(b.summary).text.slice(0, 200);
  const lines = linesOf(b.ops, items);
  if (who.role === "edit" && !costs) {
    await applyOps(who.trip.ownerId, tripId, { version: plan.version, ops: b.ops }, "traveller");
    return { change: null, applied: true, text: `Done: ${lines.map((l) => l.text).join("; ")}.` };
  }
  const [row] = await db.insert(appPlanChangeRequests).values({
    tripId, planId: plan.id, ownerId: who.trip.ownerId, byUserId: userId, byThreadId: opts.threadId ?? null, summary, ops: b.ops, lines, baseVersion: plan.version, costs,
    expiresAt: new Date(Date.now() + CHANGE_REQUEST_TTL_H * HOUR),
  }).returning();
  const ownerThread = await tellOwner(row!);
  if (ownerThread) await db.update(appPlanChangeRequests).set({ ownerThreadId: ownerThread }).where(eq(appPlanChangeRequests.id, row!.id));
  const change = await viewOf({ ...row!, ownerThreadId: ownerThread }, userId);
  return { change, applied: false, text: `Change request sent to ${change.ownerName}: ${lines.map((l) => l.text).join("; ")}.` };
}

/**
 * The owner's chat for the trip gets the card (a new chat about the trip if he has none), and his phone a push. Asked
 * in the shared trip chat (§5.5), the card goes into that same chat, so the owner approves it in place where everyone
 * reads it.
 */
async function tellOwner(r: Row): Promise<string | null> {
  const lang = await localeOfUser(r.ownerId);
  const owner = await roleOf(r.ownerId, r.tripId);
  if (!owner) return null;
  const trip = await tripName(owner.trip);
  const by = (await peopleByIds([r.byUserId])).get(r.byUserId)?.short ?? "";
  const [asked] = r.byThreadId ? await db.select({ kind: appAskThreads.kind, tripId: appAskThreads.tripId }).from(appAskThreads).where(eq(appAskThreads.id, r.byThreadId)) : [];
  if (asked?.kind === "trip" && asked.tripId === r.tripId) {
    const change = await viewOf(r, r.ownerId);
    await appendLineTo(r.byThreadId!, { who: "mada", text: t("people.line.asked", { name: by, trip, summary: r.summary }, lang), kept: [changeCard(change)], at: new Date().toISOString() });
    await notify(r.ownerId, { kind: "circle", level: "active", copy: "notify.tripChange", vars: { name: by, trip }, href: `/ask/${r.byThreadId}`, data: { tripId: r.tripId, changeId: r.id } }).catch(() => {});
    return r.byThreadId;
  }
  let thread = await primaryThreadOf(r.ownerId, r.tripId);
  if (!thread) {
    thread = await newThread(r.ownerId, lang, r.tripId);
    await db.update(appAskThreads).set({ title: trip, titledBy: "trip" }).where(and(eq(appAskThreads.id, thread.id), eq(appAskThreads.ownerId, r.ownerId), isNull(appAskThreads.title)));
  }
  const change = await viewOf(r, r.ownerId);
  await appendLine(r.ownerId, thread.id, { who: "mada", text: t("people.line.asked", { name: by, trip, summary: r.summary }, lang), kept: [changeCard(change)], at: new Date().toISOString() });
  await notify(r.ownerId, { kind: "circle", level: "active", copy: "notify.tripChange", vars: { name: by, trip }, href: `/ask/${thread.id}`, data: { tripId: r.tripId, changeId: r.id } }).catch(() => {});
  return thread.id;
}

/* ───────────── deciding ───────────── */

async function ownRow(viewerId: string, tripId: string, changeId: string): Promise<Row> {
  if (!/^[0-9a-f-]{36}$/i.test(changeId)) throw new AppError("NOT_FOUND");
  const [r] = await db.select().from(appPlanChangeRequests).where(and(eq(appPlanChangeRequests.id, changeId), eq(appPlanChangeRequests.tripId, tripId)));
  if (!r || (r.ownerId !== viewerId && r.byUserId !== viewerId)) throw new AppError("NOT_FOUND");
  return r;
}

/** The card's live state: the owner or the one who asked. A request past its 48 hours reads as expired. */
export async function getChange(viewerId: string, tripId: string, changeId: string): Promise<ChangeRequestView> {
  let r = await ownRow(viewerId, tripId, changeId);
  if (r.status === "pending" && r.expiresAt.getTime() <= Date.now()) r = (await expire(r)) ?? r;
  return viewOf(r, viewerId);
}

/** His requests on this trip, newest first, for the shared trip view. */
export async function changesBy(userId: string, tripId: string): Promise<ChangeRequestView[]> {
  const rows = await db.select().from(appPlanChangeRequests).where(and(eq(appPlanChangeRequests.tripId, tripId), eq(appPlanChangeRequests.byUserId, userId))).orderBy(desc(appPlanChangeRequests.createdAt)).limit(10);
  return Promise.all(rows.map((r) => viewOf(r, userId)));
}

/**
 * The owner decides. Approve applies the ops to the plan as it is now (versioned, so a plan that has moved on since
 * may refuse them: the card then says to ask again); a stay that's booked gets its extra nights as a new idea to book
 * from the plan, on the payer's pay sheet. Decline keeps the plan and says the reason, if one was given. A second tap
 * changes nothing.
 */
export async function decideChange(ownerId: string, tripId: string, changeId: string, input: DecideChangeRequest): Promise<ChangeRequestView> {
  const b = DecideChangeRequest.parse(input);
  const r = await ownRow(ownerId, tripId, changeId);
  if (r.ownerId !== ownerId) throw new AppError("FORBIDDEN");
  if (r.status !== "pending") return viewOf(r, ownerId);
  if (r.expiresAt.getTime() <= Date.now()) return viewOf((await expire(r)) ?? r, ownerId);
  if (b.decision === "approve") {
    const plan = await planRowOf(tripId);
    if (!plan) throw new AppError("NOT_FOUND");
    try {
      await applyOps(ownerId, tripId, { version: plan.version, ops: await approvable(r, plan.id, plan.startDate) }, "traveller");
    } catch (e) {
      if (e instanceof AppError && (e.code === "NOT_FOUND" || e.code === "VALIDATION" || e.code === "PLAN_CHANGED")) throw new AppError("VALIDATION", { copy: "people.change.stale", details: { stale: true } });
      throw e;
    }
  }
  const reason = b.decision === "decline" && b.reason ? redact(b.reason).text.slice(0, 140) : null;
  const [done] = await db.update(appPlanChangeRequests).set({ status: b.decision === "approve" ? "approved" : "declined", reason, decidedAt: new Date() })
    .where(and(eq(appPlanChangeRequests.id, r.id), eq(appPlanChangeRequests.status, "pending"))).returning();
  if (!done) return viewOf(await ownRow(ownerId, tripId, changeId), ownerId);
  await tellAsker(done);
  return viewOf(done, ownerId);
}

/** The ops as they can be applied now: more nights at a booked stay become a new stay idea after it, to book. */
async function approvable(r: Row, planId: string, start: string): Promise<PlanOp[]> {
  const ops = r.ops as PlanOp[];
  if (!r.costs) return ops;
  const items = await liveItems(planId);
  const bookings = await loadBookings(r.tripId, items);
  const links = matchBookings(items, bookings, start);
  return ops.map((op): PlanOp => {
    if (op.op !== "update" || op.item.nights == null) return op;
    const it = items.find((i) => i.id === op.itemId);
    if (!it || !["booked", "confirmed", "held"].includes(deriveStatus(it, bookings, links.get(it.id) ?? null).status)) return op;
    const extra = Math.max(1, op.item.nights - (it.nights ?? 1));
    const day = (it.day ?? 0) + (it.nights ?? 1);
    return { op: "add", day, afterItemId: it.id, item: { kind: "stay", title: it.title, nights: extra, note: null } };
  });
}

/** The line in the asker's chat, the card with it, and a push to his phone. */
async function tellAsker(r: Row): Promise<void> {
  const lang = await localeOfUser(r.byUserId);
  const owner = (await peopleByIds([r.ownerId])).get(r.ownerId)?.short ?? "";
  const trip = await roleOf(r.ownerId, r.tripId);
  const tripTitle = trip ? await tripName(trip.trip) : "";
  const text = r.status === "approved" ? t("people.line.approved", { owner, summary: r.summary }, lang)
    : r.status === "declined" ? (r.reason ? t("people.line.declinedWhy", { owner, reason: r.reason }, lang) : t("people.line.declined", { owner }, lang))
    : t("people.line.expired", { owner }, lang);
  // His own chat, or the trip chat he asked in (whoever owns it).
  if (r.byThreadId) await appendLineTo(r.byThreadId, { who: "mada", text, kept: [changeCard(await viewOf(r, r.byUserId))], at: new Date().toISOString() });
  if (r.status === "approved" || r.status === "declined") {
    await notify(r.byUserId, { kind: "circle", level: "active", copy: r.status === "approved" ? "notify.tripChangeYes" : "notify.tripChangeNo", vars: { name: owner, trip: tripTitle }, href: r.byThreadId ? `/ask/${r.byThreadId}` : "/trips", data: { tripId: r.tripId, changeId: r.id } }).catch(() => {});
  }
}

async function expire(r: Row): Promise<Row | null> {
  const [done] = await db.update(appPlanChangeRequests).set({ status: "expired", decidedAt: new Date() })
    .where(and(eq(appPlanChangeRequests.id, r.id), eq(appPlanChangeRequests.status, "pending"))).returning();
  if (done) await tellAsker(done);
  return done ?? null;
}

/**
 * The job (run with the quotes job, every 15 minutes): a reminder to the owner at 24 hours, once; at 48 hours the
 * request closes and the asker's chat says so.
 */
export async function changeRequestsJob(now = new Date()): Promise<{ changeReminded: number; changeExpired: number }> {
  const due = await db.select().from(appPlanChangeRequests).where(and(eq(appPlanChangeRequests.status, "pending"), lte(appPlanChangeRequests.expiresAt, now)));
  let changeExpired = 0;
  for (const r of due) if (await expire(r)) changeExpired += 1;
  const remindBefore = new Date(now.getTime() - CHANGE_REQUEST_REMIND_H * HOUR);
  const toRemind = await db.update(appPlanChangeRequests).set({ remindedAt: now })
    .where(and(eq(appPlanChangeRequests.status, "pending"), isNull(appPlanChangeRequests.remindedAt), lte(appPlanChangeRequests.createdAt, remindBefore))).returning();
  for (const r of toRemind) {
    const by = (await peopleByIds([r.byUserId])).get(r.byUserId)?.short ?? "";
    const trip = await roleOf(r.ownerId, r.tripId);
    await notify(r.ownerId, { kind: "circle", level: "active", copy: "notify.tripChangeRemind", vars: { name: by, trip: trip ? await tripName(trip.trip) : "" }, href: r.ownerThreadId ? `/ask/${r.ownerThreadId}` : `/trip/${r.tripId}`, data: { tripId: r.tripId, changeId: r.id } }).catch(() => {});
  }
  return { changeReminded: toRemind.length, changeExpired };
}
