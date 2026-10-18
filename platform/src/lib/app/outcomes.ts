import "server-only";
import { and, eq, inArray, isNull, or, sql } from "drizzle-orm";
import {
  canNudge, dayLabel, defaultNext, DeskOutcomeInput, DeskPromiseInput, formatSar, onItStep, outcomeHead, outcomeMoney, outcomeNotifyKey,
  outcomeWhy, progressFromStatus, RequestResult, resultFromLegacy, serviceWhat, listOf, t, timeLabel, todayIn, addDays, type CopyKey, type OnItStep, type RequestProgress,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appMessages, appQuotes, appRequests } from "@/db/app-schema";
import { appDeskItems } from "@/db/app-schema-desk";
import { appAuditLog } from "./audit";
import { AppError } from "./http";
import { localeOfUser } from "./locale";
import { notify } from "./trips/notify";
import { assertCap, deskAudit, DeskError, shortRef, type DeskActor } from "./desk/core";
import { actingAgent, clip } from "./desk/adapters";

/*
 * Outcomes and promises on a request (critique items 5 and 6; shared rules in @mada/shared schemas/outcomes.ts).
 *
 * The desk closes a request with an explicit outcome (issued · refused · partial · cancelled), a reason, the money and
 * the next step; the traveller reads it on the request, in Trips → Requests and in the inbox, in their own language at
 * read time. While it's open the desk can say what it's doing and by when; otherwise Mada's usual time applies. When
 * that time passes the traveller may nudge: the request is escalated on the desk and a line goes in the thread.
 *
 * All of it lives on app_requests.details (result, promise, nudgedAt), so no migration.
 */

type RequestRow = typeof appRequests.$inferSelect;
export type Promise_ = { step: OnItStep; with: string | null; dueAt: string; cost: "free" | "quoted" | "later" | "paid"; amount: number | null; by?: string | null };
type OutcomeDetails = {
  result?: unknown; promise?: Promise_; nudgedAt?: string; outcome?: "yes" | "no" | null; alt?: string | null; yesText?: string | null;
  withdrawn?: boolean; withName?: string | null; withWhom?: "airline" | "hotel" | "faisal"; quote?: number | null; area?: string; askKind?: string;
  order?: unknown; source?: string; service?: string | null; serviceWho?: { name: string; self: boolean }[];
  serviceFor?: { need: string | null } | null;
};

const CLOSED = ["done", "confirmed", "cancelled", "paid"];
const SAR = (amount: number) => ({ amount, currency: "SAR" as const });

/** How a request ended: what the desk recorded, or an older request read as an outcome. Null while open. */
export function resultOfRequest(r: Pick<RequestRow, "status" | "details" | "updatedAt" | "tripId">): RequestResult | null {
  const d = (r.details ?? {}) as OutcomeDetails;
  const stored = d.result ? RequestResult.safeParse(d.result) : null;
  if (stored?.success) return stored.data;
  return resultFromLegacy({
    status: r.status, outcome: d.outcome ?? null, alt: d.alt ?? null, yesText: d.yesText ?? null, withdrawn: !!d.withdrawn, withName: d.withName ?? null,
    quote: d.quote ? SAR(d.quote) : null, updatedAt: r.updatedAt.toISOString(), tripId: r.tripId, booking: !!d.order || d.source === "order", what: serviceWords(d),
  });
}

/** An entry service the desk closed without its own line: what it did, from what was asked ("UK ETA issued for you and Hessa"). */
function serviceWords(d: OutcomeDetails): string | null {
  if (!d.service || !d.serviceWho?.length) return null;
  const ref = serviceWhat(d.service, { names: listOf(d.serviceWho.map((p) => (p.self ? t("oc.you") : p.name))), need: d.serviceFor?.need ?? null });
  return ref ? t(ref[0], ref[1]) : null;
}

/** What Mada is doing on an open request, by when and the cost: the desk's promise, else Mada's usual time. */
export function progressOfRequest(r: Pick<RequestRow, "status" | "details" | "createdAt" | "promisedBy" | "kind">): RequestProgress | null {
  if (CLOSED.includes(r.status)) return null;
  const d = (r.details ?? {}) as OutcomeDetails;
  if (d.withdrawn) return null;
  const nudgedAt = d.nudgedAt ?? null;
  if (d.promise && ["queued", "sent", "reviewing", "with_agent"].includes(r.status)) {
    const p = d.promise;
    return { step: p.step, with: p.with, dueAt: p.dueAt, promised: true, cost: { kind: p.cost, amount: p.amount ? SAR(p.amount) : null }, nudgedAt };
  }
  const p = progressFromStatus({
    status: r.status, withWhom: d.withWhom ?? null, withName: d.withName ?? null, kind: d.askKind ?? r.kind, area: d.area ?? null,
    quote: d.quote ? SAR(d.quote) : null, createdAt: r.createdAt.toISOString(), promisedBy: r.promisedBy?.toISOString() ?? null, service: d.service ?? null,
  });
  return p ? { ...p, nudgedAt } : null;
}

/** The outcome in words, for the request thread (the traveller's language: the caller runs in it). */
export function outcomeWords(res: RequestResult, locale?: "en" | "ar"): string {
  const say = ([k, v]: [CopyKey, Record<string, string | number>?]) => t(k, v, locale);
  const money = say(outcomeMoney(res.money, { amount: (h) => formatSar(h, { locale }), day: (d) => dayLabel(d, { locale }) }));
  // A refused visa says what's left: the appeal (by when, if the embassy said), applying again, the flights and hotel.
  const visa = res.kind === "refused" && res.reason === "visa_refused"
    ? [res.appealBy ? say(["oc.visa.appealBy", { day: dayLabel(res.appealBy, { locale }) }]) : say(["oc.visa.appealAsk"]), say(["oc.visa.reapply"]), say(["oc.visa.trip"])] : [];
  return [say(outcomeHead(res)), say(outcomeWhy(res)), ...visa, money, res.note ?? ""].filter(Boolean).join(" ");
}

const open = (status: string) => !CLOSED.includes(status);

async function lock(tx: Tx, id: string) {
  const [r] = await tx.select().from(appRequests).where(eq(appRequests.id, id)).for("update");
  if (!r) throw new DeskError("Request not found", "NOT_FOUND");
  return r;
}

/**
 * The desk closes a request with an outcome. Money words only: issuing a refund itself stays on the Refunds page.
 * Older apps read `outcome` ('no' with `alt`), so a refusal also writes those, in the traveller's language.
 */
export async function setOutcome(actor: DeskActor, raw: DeskOutcomeInput): Promise<RequestResult> {
  assertCap(actor, "desk.act");
  const parsed = DeskOutcomeInput.safeParse(raw);
  if (!parsed.success) throw new DeskError("Check the outcome: the kind, the reason and the money");
  const v = parsed.data;
  if (v.money !== "none" && !v.amount) throw new DeskError("Say how much, for the money line");
  if ((v.kind === "partial" || v.reason === "other") && !v.note) throw new DeskError("Say in a line what was and wasn't done, for the traveller");
  // Never a bare "It's done": the traveller reads what was done, in a line (CRITIQUE-2 #7).
  if (v.kind === "issued" && !v.what) throw new DeskError("Say what was done, for the traveller: “UK ETA issued for you and Hessa”");
  if (v.reason === "visa_refused" && v.kind !== "refused") throw new DeskError("A refused visa closes as refused");
  return db.transaction(async (tx) => {
    const r = await lock(tx, v.requestId);
    const d = (r.details ?? {}) as OutcomeDetails;
    if (!open(r.status) && d.result) throw new DeskError("This request already has its outcome", "CONFLICT");
    if (d.withdrawn) throw new DeskError("The traveller took this back", "CONFLICT");
    if (d.order && open(r.status)) throw new DeskError("This follows a booking: close it on its order page", "CONFLICT");
    const me = await actingAgent(tx, actor);
    const locale = await localeOfUser(r.ownerId, tx);
    const result: RequestResult = {
      kind: v.kind, reason: v.reason, what: v.what || null, appealBy: v.reason === "visa_refused" ? v.appealBy ?? null : null, with: v.with || d.withName || null, note: v.note || null,
      money: { kind: v.money, amount: v.amount ? SAR(v.amount) : null, by: v.money === "refund" ? v.by : null },
      next: v.next.length ? v.next : defaultNext(v.kind, { trip: !!r.tripId, booking: ["flight", "stay", "trip", "package"].includes(r.kind), reason: v.reason }),
      by: me.name, at: new Date().toISOString(),
    };
    const status = v.kind === "refused" || v.kind === "cancelled" ? "cancelled" : d.withWhom && d.withWhom !== "faisal" ? "confirmed" : "done";
    const words = outcomeWords(result, locale);
    const legacy = v.kind === "refused" ? { outcome: "no", alt: [t(outcomeWhy(result)[0], outcomeWhy(result)[1], locale), result.note].filter(Boolean).join(" ") }
      : v.kind === "issued" || v.kind === "partial" ? { outcome: "yes", yesText: words } : { outcome: null };
    await tx.update(appRequests).set({
      status, updatedAt: new Date(), agentOpsUserId: r.agentOpsUserId ?? actor.id, agentName: r.agentName ?? me.name,
      details: sql`${appRequests.details} || ${JSON.stringify({ result, ...legacy })}::jsonb`,
    }).where(eq(appRequests.id, r.id));
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "agent", authorOpsUserId: actor.id, authorName: me.name, body: words, card: { outcome: result.kind } });
    const [why, whyVars] = outcomeWhy(result);
    await notify(r.ownerId, {
      kind: "agent_reply", level: "active", copy: outcomeNotifyKey(result.kind), href: `/ask/request/${r.id}`,
      vars: { what: clip(r.summary, 40), why: { k: why, v: whyVars } },
    }, tx);
    await deskAudit(tx, actor, {
      action: `desk.request.${result.kind}`, entityType: "request", entityId: r.id, ref: shortRef(r.id),
      summary: `Closed ${shortRef(r.id)} as ${result.kind} (${result.reason})${result.money.amount ? `, ${result.money.kind} ${formatSar(result.money.amount.amount)}` : ""}: ${clip(r.summary, 80)}`,
      data: { kind: result.kind, reason: result.reason, money: result.money },
    });
    return result;
  });
}

/** The desk says what it's doing on an open request and by when; the traveller is told once. */
export async function setPromise(actor: DeskActor, raw: DeskPromiseInput): Promise<void> {
  assertCap(actor, "desk.act");
  const parsed = DeskPromiseInput.safeParse(raw);
  if (!parsed.success) throw new DeskError("Check the step and the time");
  const v = parsed.data;
  const due = new Date(v.dueAt);
  if (due.getTime() < Date.now() - 60_000) throw new DeskError("Pick a time that hasn't passed");
  if ((v.cost === "quoted" || v.cost === "paid") && !v.amount) throw new DeskError("Say how much it costs");
  await db.transaction(async (tx) => {
    const r = await lock(tx, v.requestId);
    if (!["queued", "sent", "reviewing", "with_agent"].includes(r.status)) throw new DeskError("Only open requests take a time", "CONFLICT");
    const me = await actingAgent(tx, actor);
    const locale = await localeOfUser(r.ownerId, tx);
    const promise: Promise_ = { step: v.step, with: v.with || null, dueAt: due.toISOString(), cost: v.cost, amount: v.amount ?? null, by: me.name };
    await tx.update(appRequests).set({
      status: r.status === "sent" || r.status === "queued" ? "reviewing" : r.status, promisedBy: due, updatedAt: new Date(),
      agentOpsUserId: r.agentOpsUserId ?? actor.id, agentName: r.agentName ?? me.name,
      details: sql`${appRequests.details} || ${JSON.stringify({ promise })}::jsonb`,
    }).where(eq(appRequests.id, r.id));
    const [stepKey, stepVars] = onItStep(promise);
    await notify(r.ownerId, {
      kind: "agent_reply", level: "passive", copy: "notify.oi.promise", href: `/ask/request/${r.id}`,
      vars: { what: clip(r.summary, 30), step: { k: stepKey, v: stepVars }, time: timeLabel(due, { locale }) },
    }, tx);
    await deskAudit(tx, actor, {
      action: "desk.request.promised", entityType: "request", entityId: r.id, ref: shortRef(r.id),
      summary: `Told the traveller: ${v.step}${v.with ? ` (${v.with})` : ""}, answer by ${due.toISOString()}, cost ${v.cost}`,
      data: { step: v.step, dueAt: promise.dueAt, cost: v.cost, amount: v.amount ?? null },
    });
  });
}

/**
 * The traveller nudges a request whose time has passed: once every 30 minutes. It escalates the request on the desk
 * (it floats to the top) and puts "Any news on this?" in the thread, in the traveller's language.
 */
export async function nudgeRequest(ownerId: string, id: string, ipHash: string | null, now = Date.now()): Promise<RequestProgress> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(appRequests).where(and(eq(appRequests.id, id), eq(appRequests.ownerId, ownerId))).for("update");
    if (!r) throw new AppError("NOT_FOUND");
    const p = progressOfRequest(r);
    if (!p) throw new AppError("VALIDATION", { message: t("error.validation") });
    if (!canNudge(p, now)) return p;
    const at = new Date(now).toISOString();
    const locale = await localeOfUser(ownerId, tx);
    await tx.update(appRequests).set({ details: sql`${appRequests.details} || ${JSON.stringify({ nudgedAt: at })}::jsonb`, updatedAt: new Date(now) }).where(eq(appRequests.id, id));
    await tx.insert(appMessages).values({ threadKind: "request", threadId: id, authorKind: "user", authorUserId: ownerId, body: t("oi.nudge.message", undefined, locale) });
    const note = "The traveller nudged: past the time we gave";
    await tx.insert(appDeskItems).values({ itemKind: "request", itemId: id, escalatedAt: new Date(now), escalationNote: note })
      .onConflictDoUpdate({ target: [appDeskItems.itemKind, appDeskItems.itemId], set: { escalatedAt: new Date(now), escalationNote: note, updatedAt: new Date(now) } });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.nudged", entityType: "app_request", entityId: id, summary: "Nudged a request past its promised time", ipHash });
    return { ...p, nudgedAt: at };
  });
}

/* ───────── requests whose dates have passed (CRITIQUE-2 #7) ───────── */

/** Open and not yet paid: these close by themselves once their dates pass, nothing charged. */
const UNPAID_OPEN = ["queued", "sent", "reviewing", "needs_answer", "quoted", "awaiting_payment"];
/** Paid and with a person: never closed by a job (money moved), only put in front of the desk. */
const PAID_OPEN = ["with_agent", "confirmed"];

/**
 * Run with the quotes job (every 15 minutes). A request asked for dates (its search's first day) that are now past,
 * still unpaid: closed as cancelled, "the dates passed", nothing charged, with a line in its thread and a notification,
 * in the traveller's language. One already paid, or one whose day is today or tomorrow and still open: escalated on
 * the desk once, so a person answers it before it's too late. Idempotent: closed rows and escalated items are skipped.
 */
export async function pastDatesJob(now = new Date()): Promise<{ closed: number; escalated: number }> {
  const today = todayIn(undefined, now);
  const tomorrow = addDays(today, 1);
  const depart = sql<string | null>`${appRequests.details}->'search'->>'depart'`;
  const rows = await db.select().from(appRequests).where(and(
    inArray(appRequests.status, [...UNPAID_OPEN, ...PAID_OPEN]),
    sql`${depart} IS NOT NULL AND ${depart} <= ${tomorrow}`,
    or(isNull(sql`${appRequests.details}->>'withdrawn'`), sql`${appRequests.details}->>'withdrawn' <> 'true'`),
  ));
  let closed = 0, escalated = 0;
  for (const r of rows) {
    const day = String(((r.details ?? {}) as { search?: { depart?: string } }).search?.depart ?? "");
    if (day < today && UNPAID_OPEN.includes(r.status)) {
      if (await closePastDates(r.id, now)) closed += 1;
      continue;
    }
    // Paid with its day gone, or its day is today or tomorrow and nobody has closed it: a person, now.
    const note = day < today ? "Its dates have passed and it was paid: sort it out with the traveller" : "Travels today or tomorrow and still open";
    const [item] = await db.select().from(appDeskItems).where(and(eq(appDeskItems.itemKind, "request"), eq(appDeskItems.itemId, r.id)));
    if (item?.escalatedAt && item.escalationNote === note) continue;
    await db.insert(appDeskItems).values({ itemKind: "request", itemId: r.id, escalatedAt: now, escalationNote: note })
      .onConflictDoUpdate({ target: [appDeskItems.itemKind, appDeskItems.itemId], set: { escalatedAt: now, escalationNote: note, updatedAt: now } });
    escalated += 1;
  }
  return { closed, escalated };
}

async function closePastDates(id: string, now: Date): Promise<boolean> {
  return db.transaction(async (tx) => {
    const r = await lock(tx, id);
    const d = (r.details ?? {}) as OutcomeDetails;
    if (!UNPAID_OPEN.includes(r.status) || d.result || d.withdrawn) return false;
    const locale = await localeOfUser(r.ownerId, tx);
    const result: RequestResult = {
      kind: "cancelled", reason: "dates_passed", with: null, note: null, by: null, at: now.toISOString(),
      money: { kind: "none", amount: null, by: null }, next: defaultNext("cancelled", { reason: "dates_passed", booking: ["flight", "stay", "trip", "package"].includes(r.kind) }),
    };
    await tx.update(appRequests).set({ status: "cancelled", updatedAt: now, details: sql`${appRequests.details} || ${JSON.stringify({ result, outcome: null })}::jsonb` }).where(eq(appRequests.id, r.id));
    await tx.update(appQuotes).set({ status: "expired" }).where(and(eq(appQuotes.requestId, r.id), eq(appQuotes.status, "open")));
    // Mada says it plainly, in the thread: the dates went by, nothing was charged, sorry.
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "mada", body: outcomeWords(result, locale), card: { outcome: result.kind } });
    const [why, whyVars] = outcomeWhy(result);
    await notify(r.ownerId, { kind: "agent_reply", level: "passive", copy: outcomeNotifyKey(result.kind), href: `/ask/request/${r.id}`, vars: { what: clip(r.summary, 40), why: { k: why, v: whyVars } } }, tx);
    await appAuditLog(tx, { actorKind: "system", actorId: null, action: "request.dates_passed", entityType: "app_request", entityId: r.id, summary: `Closed ${shortRef(r.id)}: its dates passed with nothing booked, nothing charged` });
    return true;
  });
}
