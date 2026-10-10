import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { t as copy, type CopyKey, type Vars } from "@mada/shared";
import { db, schema, type Tx } from "@/db";
import {
  appMessages, appNotifications, appPayments, appPeople, appQuotes, appRefunds, appRequests, appSegments, appTrips, appUsers,
} from "@/db/app-schema";
import { appAgents, appDeskBlocks, appDeskModeration, appDeskNotes } from "@/db/app-schema-desk";
import { appOrderEvents, appOrders } from "@/db/app-schema-booking";
import * as booking from "@/lib/app/booking/desk";
import { addCredit } from "@/lib/app/credit";
import { appSupportThreads } from "@/db/app-schema-wallet";
import * as supportDesk from "@/lib/app/support/desk";
import { decryptField, passportAad } from "@/lib/app/crypto";
import { supplierMode } from "@/lib/app/config";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { assertCap, deskAudit, DeskError, sarText, shortRef, travellerName, type DeskActor } from "./core";
import { inRequestOwnerLocale, inUserLocale, localeOfUser } from "@/lib/app/locale";

/*
 * Thin adapters for the desk. They read and write the M0 app_ tables directly, so the desk works today.
 * NOTE FOR THE LEAD: these mirror functions the feature engineers own. When they land, swap the bodies for calls:
 *   order actions (confirmHold, askTraveller, priceChanged, issueTickets, failTicketing) → lib/app/booking/desk.ts
 *   chat list and agent replies (listConversations, sendAgentReply)                     → lib/app/support/desk.ts
 *   moderation (decideModeration, blockTraveller)                                        → lib/app/circles/moderation.ts
 *   refunds and vouchers (approveRefund, rejectRefund, creditEntry)                      → lib/app/trips/**, lib/app/credit.ts
 * The signatures here take the desk actor and return plain rows, so integration is a swap, not a rewrite.
 */

export const ORDER_KINDS = ["flight", "stay", "trip"] as const;
const isOrderKind = (k: string) => (ORDER_KINDS as readonly string[]).includes(k);

export type DeskState = {
  heldAt?: string; heldBy?: string; heldPnr?: string | null;
  issuedAt?: string; issuedBy?: string; pnr?: string; tickets?: string[];
  failedAt?: string; failReason?: string;
  question?: { text: string; choices: string[]; askedAt: string; askedBy: string; answer?: string | null; answeredAt?: string | null };
  priceChange?: { from: number; to: number; at: string; reason?: string | null };
  checklist?: { label: string; done: boolean }[];
  doneAt?: string;
};
type Details = Record<string, unknown> & { desk?: DeskState };
export const deskState = (d: unknown): DeskState => ((d as Details | null)?.desk ?? {}) as DeskState;

/** The person on the desk, as travellers will read it: their agent name, else their first name in Ops. */
export async function actingAgent(tx: Tx | typeof db, actor: DeskActor) {
  const [a] = await tx.select().from(appAgents).where(eq(appAgents.opsUserId, actor.id)).limit(1);
  return { agentId: a?.id ?? null, name: a?.displayName ?? actor.name.split(" ")[0] ?? actor.name, photoUrl: a?.photoUrl ?? null };
}

const isUuidLike = (s: string) => /^[0-9a-f-]{36}$/i.test(s);
export const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1).trimEnd()}…` : s);

async function notify(tx: Tx, userId: string, n: { kind: string; level: "time_sensitive" | "active" | "passive"; title: CopyKey; body: CopyKey; vars?: Vars; href?: string | null; data?: Record<string, unknown> }) {
  const locale = await localeOfUser(userId, tx);
  await tx.insert(appNotifications).values({
    userId, kind: n.kind, level: n.level, title: clip(copy(n.title, n.vars, locale), 32), body: clip(copy(n.body, n.vars, locale), 90), href: n.href ?? null, data: n.data ?? null,
  });
}

async function agentMessage(tx: Tx, threadKind: "request" | "support", threadId: string, actor: DeskActor, body: string, card: Record<string, unknown> | null = null) {
  const me = await actingAgent(tx, actor);
  const [m] = await tx.insert(appMessages).values({ threadKind, threadId, authorKind: "agent", authorOpsUserId: actor.id, authorName: me.name, body, card }).returning();
  return { message: m!, agent: me };
}
const madaMessage = (tx: Tx, threadKind: "request" | "support", threadId: string, body: string, card: Record<string, unknown> | null = null) =>
  tx.insert(appMessages).values({ threadKind, threadId, authorKind: "mada", body, card });

async function setDesk(tx: Tx, id: string, patch: Partial<DeskState>, extra: Partial<typeof appRequests.$inferInsert> = {}) {
  await tx.update(appRequests).set({
    ...extra,
    details: sql`jsonb_set(coalesce(${appRequests.details}, '{}'::jsonb), '{desk}', coalesce(${appRequests.details}->'desk', '{}'::jsonb) || ${JSON.stringify(patch)}::jsonb)`,
    updatedAt: new Date(),
  }).where(eq(appRequests.id, id));
}

async function lockRequest(tx: Tx, id: string) {
  const [r] = await tx.select().from(appRequests).where(eq(appRequests.id, id)).for("update");
  if (!r) throw new DeskError("Request not found", "NOT_FOUND");
  return r;
}

/** The first person who acts on a request becomes its named agent. */
async function claim(tx: Tx, r: typeof appRequests.$inferSelect, actor: DeskActor) {
  if (r.agentOpsUserId) return;
  const me = await actingAgent(tx, actor);
  await tx.update(appRequests).set({ agentOpsUserId: actor.id, agentName: me.name }).where(eq(appRequests.id, r.id));
}

/* ═════════════ orders ═════════════ */

export type OrderStage = "awaiting" | "held" | "needs_answer" | "price_changed" | "issued" | "failed" | "not_issued" | "other";
export type BookingOrder = typeof appOrders.$inferSelect;

/** The booking engine's order behind a request (app_orders.request_id), when the app made one. */
export async function linkedOrder(requestId: string): Promise<BookingOrder | null> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.requestId, requestId)).orderBy(desc(appOrders.createdAt)).limit(1);
  return o ?? null;
}

/** The booking engine's states, as the desk names them. */
export function bookingStage(status: string): OrderStage {
  switch (status) {
    case "pending_agent": return "awaiting";
    case "held": case "price_locked": case "issuing": return "held";
    case "needs_answer": return "needs_answer";
    case "fare_changed": return "price_changed";
    case "confirmed": return "issued";
    case "ticketing_failed": return "failed";
    case "cancelled": case "declined": return "not_issued";
    default: return "other";
  }
}

export function orderStage(r: { status: string; details: unknown }, payStatus?: string | null, order?: { status: string } | null): OrderStage {
  if (order) return bookingStage(order.status);
  const d = deskState(r.details);
  if (r.status === "confirmed" || r.status === "done" || d.issuedAt) return "issued";
  if (r.status === "cancelled" && d.failedAt) return "not_issued";
  if (r.status === "needs_answer") return "needs_answer";
  if (r.status === "quoted" && d.priceChange) return "price_changed";
  if (r.status === "with_agent") return d.heldAt || payStatus === "failed" ? "held" : "awaiting";
  return "other";
}

export async function listOrders(opts: { stage?: OrderStage | "open" | "all"; limit?: number } = {}) {
  const rows = await db.select({ r: appRequests, userName: appUsers.name, phone: appUsers.phone }).from(appRequests)
    .innerJoin(appUsers, eq(appUsers.id, appRequests.ownerId))
    .where(and(inArray(appRequests.kind, [...ORDER_KINDS]), ne(appRequests.status, "queued")))
    .orderBy(desc(appRequests.createdAt)).limit(opts.limit ?? 300);
  const ids = rows.map((x) => x.r.id);
  const [pays, quotes, orders] = ids.length ? await Promise.all([
    db.select().from(appPayments).where(inArray(appPayments.requestId, ids)).orderBy(desc(appPayments.createdAt)),
    db.select().from(appQuotes).where(inArray(appQuotes.requestId, ids)).orderBy(desc(appQuotes.createdAt)),
    db.select().from(appOrders).where(inArray(appOrders.requestId, ids)).orderBy(desc(appOrders.createdAt)),
  ]) : [[], [], []];
  const orderPays = orders.some((o) => o.paymentId) ? await db.select().from(appPayments).where(inArray(appPayments.id, orders.map((o) => o.paymentId).filter((x): x is string => !!x))) : [];
  const out = rows.map(({ r, userName, phone }) => {
    const order = orders.find((o) => o.requestId === r.id) ?? null;
    const pay = (order?.paymentId ? orderPays.find((p) => p.id === order.paymentId) : null) ?? pays.find((p) => p.requestId === r.id) ?? null;
    const quote = quotes.find((q) => q.requestId === r.id && q.status !== "withdrawn") ?? quotes.find((q) => q.requestId === r.id) ?? null;
    const total = order ? order.total + order.extra : pay?.amount ?? quote?.total ?? 0;
    const desk = deskState(r.details);
    if (order?.supplierRef && !desk.heldPnr) desk.heldPnr = order.supplierRef;
    return { ...r, ref: order?.ref ?? shortRef(r.id, "O"), userName: travellerName(userName), phone, payment: pay, total, stage: orderStage(r, pay?.status, order), desk, order };
  });
  const st = opts.stage ?? "all";
  if (st === "all") return out;
  if (st === "open") return out.filter((o) => ["awaiting", "held", "needs_answer", "price_changed", "failed"].includes(o.stage));
  return out.filter((o) => o.stage === st);
}

export async function getRequestFull(id: string) {
  const [row] = await db.select({ r: appRequests, u: appUsers }).from(appRequests).innerJoin(appUsers, eq(appUsers.id, appRequests.ownerId)).where(eq(appRequests.id, id));
  if (!row) return null;
  const { r, u } = row;
  const [people, quotes, payments, trip, segments, messages, notes] = await Promise.all([
    r.travellerIds.length ? db.select().from(appPeople).where(inArray(appPeople.id, r.travellerIds)) : Promise.resolve([] as (typeof appPeople.$inferSelect)[]),
    db.select().from(appQuotes).where(eq(appQuotes.requestId, id)).orderBy(desc(appQuotes.createdAt)),
    db.select().from(appPayments).where(eq(appPayments.requestId, id)).orderBy(desc(appPayments.createdAt)),
    r.tripId ? db.select().from(appTrips).where(eq(appTrips.id, r.tripId)).then((x) => x[0] ?? null) : Promise.resolve(null),
    r.tripId ? db.select().from(appSegments).where(eq(appSegments.tripId, r.tripId)).orderBy(asc(appSegments.sort)) : Promise.resolve([] as (typeof appSegments.$inferSelect)[]),
    db.select().from(appMessages).where(and(eq(appMessages.threadKind, "request"), eq(appMessages.threadId, id))).orderBy(asc(appMessages.createdAt)),
    db.select({ n: appDeskNotes, name: schema.users.name }).from(appDeskNotes).innerJoin(schema.users, eq(schema.users.id, appDeskNotes.opsUserId))
      .where(and(eq(appDeskNotes.threadKind, "request"), eq(appDeskNotes.threadId, id))).orderBy(asc(appDeskNotes.createdAt)),
  ]);
  const order = isOrderKind(r.kind) ? await linkedOrder(id) : null;
  const [orderPay, events] = order ? await Promise.all([
    order.paymentId ? db.select().from(appPayments).where(eq(appPayments.id, order.paymentId)).then((x) => x[0] ?? null) : Promise.resolve(null),
    db.select().from(appOrderEvents).where(eq(appOrderEvents.orderId, order.id)).orderBy(asc(appOrderEvents.createdAt)),
  ]) : [null, [] as (typeof appOrderEvents.$inferSelect)[]];
  if (orderPay && !payments.some((p) => p.id === orderPay.id)) payments.unshift(orderPay);
  const payment = orderPay ?? payments[0] ?? null;
  // Travellers in the order they were picked; the passport number only ever leaves masked.
  const travellers = r.travellerIds.map((pid) => people.find((p) => p.id === pid)).filter(Boolean).map((p) => ({
    id: p!.id, name: `${p!.givenNames} ${p!.surname}`.trim() || u.name, relation: p!.relation, dateOfBirth: p!.dateOfBirth, nationality: p!.nationality,
    passportMasked: p!.passportNumberMasked, passportExpiry: p!.passportExpiry, hasPassport: !!p!.passportNumberEnc,
  }));
  return {
    request: r, ref: shortRef(r.id, isOrderKind(r.kind) ? "O" : "R"), user: u, travellers, quotes, payments, payment, trip, segments,
    messages, notes, desk: { ...deskState(r.details), ...(order?.supplierRef && !deskState(r.details).heldPnr ? { heldPnr: order.supplierRef } : {}) },
    stage: orderStage(r, payment?.status, order), isOrder: isOrderKind(r.kind), order, events,
  };
}
export type RequestFull = NonNullable<Awaited<ReturnType<typeof getRequestFull>>>;

/** The full passport number, for the person issuing the ticket. Every look is in both logs. */
export async function revealPassport(actor: DeskActor, personId: string, context: { requestId?: string | null } = {}) {
  assertCap(actor, "desk.issue");
  return db.transaction(async (tx) => {
    const [p] = await tx.select().from(appPeople).where(eq(appPeople.id, personId));
    if (!p || !p.passportNumberEnc) throw new DeskError("No passport on file", "NOT_FOUND");
    if (context.requestId) {
      const [r] = await tx.select({ ids: appRequests.travellerIds }).from(appRequests).where(eq(appRequests.id, context.requestId));
      if (!r || !r.ids.includes(personId)) throw new DeskError("That traveller isn't on this order", "FORBIDDEN");
    }
    const number = decryptField(p.passportNumberEnc, passportAad(p.id));
    await deskAudit(tx, actor, { action: "desk.passport.revealed", entityType: "person", entityId: p.id, ref: `${p.givenNames} ${p.surname}`.trim(),
      summary: `Viewed the full passport number for ${p.givenNames || "a traveller"} (${p.passportNumberMasked ?? "masked"})`, data: { requestId: context.requestId ?? null } });
    return number;
  });
}

/* The booking engine owns app_orders: for an order it made, the desk calls lib/app/booking/desk.ts. */
export async function engine<T>(fn: () => Promise<T>): Promise<T> {
  try { return await fn(); } catch (e) {
    const code = (e as { code?: string }).code;
    if (code === "NOT_FOUND") throw new DeskError("Order not found", "NOT_FOUND");
    if (code) throw new DeskError("Someone else just changed this order", "CONFLICT");
    throw e;
  }
}
async function engineAgent(actor: DeskActor) {
  const me = await actingAgent(db, actor);
  return { name: me.name, opsUserId: actor.id };
}
const opsLog = (actor: DeskActor, o: BookingOrder, requestId: string, action: string, summary: string, data?: Record<string, unknown>) =>
  db.transaction((tx) => deskAudit(tx, actor, { action, entityType: "request", entityId: requestId, ref: o.ref ?? shortRef(requestId, "O"), summary, data: { orderId: o.id, ...data } }, { app: false }));

/** Confirm the order and hold the seats (a PNR when the GDS gave one). The app's waiting screen moves to "holding". */
async function confirmHoldHere(actor: DeskActor, id: string, v: { pnr?: string | null } = {}) {
  assertCap(actor, "desk.act");
  const o = await linkedOrder(id);
  if (o) {
    if (o.status !== "pending_agent") throw new DeskError(o.status === "held" ? "Already held" : "This order isn't waiting for confirmation", "CONFLICT");
    const pnr = v.pnr?.trim().toUpperCase() || null;
    if (pnr && !/^[A-Z0-9]{5,8}$/.test(pnr)) throw new DeskError("A PNR is 5 to 8 letters and numbers");
    const agent = await engineAgent(actor);
    await engine(() => booking.acceptOrder(o.id, agent));
    if (pnr) await db.transaction(async (tx) => { await tx.update(appOrders).set({ supplierRef: pnr }).where(eq(appOrders.id, o.id)); await booking.orderEvent(tx, o.id, "pnr", { kind: "agent", name: agent.name }, { pnr }); });
    await opsLog(actor, o, id, "desk.order.held", `Confirmed and held ${o.ref ?? shortRef(id, "O")}${pnr ? ` · PNR ${pnr}` : ""}`);
    return;
  }
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!isOrderKind(r.kind)) throw new DeskError("Only orders can be held");
    if (r.status !== "with_agent") throw new DeskError("This order isn't waiting for confirmation", "CONFLICT");
    if (deskState(r.details).heldAt) throw new DeskError("Already held", "CONFLICT");
    const pnr = v.pnr?.trim().toUpperCase() || null;
    if (pnr && !/^[A-Z0-9]{5,8}$/.test(pnr)) throw new DeskError("A PNR is 5 to 8 letters and numbers");
    await claim(tx, r, actor);
    await setDesk(tx, id, { heldAt: new Date().toISOString(), heldBy: actor.id, heldPnr: pnr });
    await agentMessage(tx, "request", id, actor, copy("desk.order.held"), { stage: "held" });
    await deskAudit(tx, actor, { action: "desk.order.held", entityType: "request", entityId: id, ref: shortRef(id, "O"), summary: `Confirmed and held ${shortRef(id, "O")}${pnr ? ` · PNR ${pnr}` : ""}` });
  });
}

/** Ask the traveller something before booking. It shows on the app's waiting screen with one-tap answers. */
async function askTravellerHere(actor: DeskActor, id: string, v: { question: string; choices: string[] }) {
  assertCap(actor, "desk.act");
  const question = v.question.trim();
  const choices = v.choices.map((c) => c.trim()).filter(Boolean).slice(0, 4);
  if (question.length < 5 || question.length > 300) throw new DeskError("Write the question in 5 to 300 characters");
  if (choices.some((c) => c.length > 40)) throw new DeskError("Keep each answer under 40 characters");
  const o = isUuidLike(id) ? await linkedOrder(id) : null;
  if (o) {
    // The app answers an order's question with "Yes" or "Call me" (the booking engine's two answers).
    await engine(() => engineAgent(actor).then((agent) => booking.askQuestion(o.id, agent, question)));
    await opsLog(actor, o, id, "desk.request.asked", `Asked the traveller: "${clip(question, 120)}"`);
    return;
  }
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (["confirmed", "done", "cancelled"].includes(r.status)) throw new DeskError("This one is already closed", "CONFLICT");
    await claim(tx, r, actor);
    await setDesk(tx, id, { question: { text: question, choices, askedAt: new Date().toISOString(), askedBy: actor.id, answer: null, answeredAt: null } }, { status: "needs_answer" });
    const { agent } = await agentMessage(tx, "request", id, actor, question, { question: true, choices: choices.map((c, i) => ({ label: c, key: `c${i + 1}` })) });
    await notify(tx, r.ownerId, { kind: "agent_needs_answer", level: "time_sensitive", title: "notify.desk.question.title", body: "notify.desk.question.body", vars: { agent: agent.name, question }, href: `/requests/${id}` });
    await deskAudit(tx, actor, { action: "desk.request.asked", entityType: "request", entityId: id, ref: shortRef(id, isOrderKind(r.kind) ? "O" : "R"), summary: `Asked the traveller: "${clip(question, 120)}"` });
  });
}

/** The fare moved before booking: send the new price. Nothing is captured; the old card hold is released. */
async function priceChangedHere(actor: DeskActor, id: string, v: { total: number; reason?: string | null }) {
  assertCap(actor, "desk.act");
  if (!Number.isInteger(v.total) || v.total <= 0 || v.total > 100_000_000_00) throw new DeskError("Enter the new total");
  const o = await linkedOrder(id);
  if (o) {
    const now = o.total + o.extra;
    if (v.total === now) throw new DeskError("That's the same price");
    if (v.total < now) throw new DeskError("A lower price is good news: confirm at the price they agreed");
    const perPerson = Math.ceil((v.total - now) / Math.max(1, o.travellerIds.length));
    await engine(() => engineAgent(actor).then((agent) => booking.priceChanged(o.id, agent, perPerson)));
    await opsLog(actor, o, id, "desk.order.price_changed", `Sent a new price for ${o.ref ?? shortRef(id, "O")}: ${sarText(now)} → ${sarText(v.total)}`, { total: { from: now, to: v.total }, reason: v.reason ?? null });
    return null;
  }
  const [cur] = await db.select().from(appRequests).where(eq(appRequests.id, id));
  if (!cur) throw new DeskError("Request not found", "NOT_FOUND");
  if (!isOrderKind(cur.kind)) throw new DeskError("Only orders have a fare to change");
  if (!["with_agent", "needs_answer"].includes(cur.status)) throw new DeskError("This order can't be repriced now", "CONFLICT");
  const [cq] = await db.select({ total: appQuotes.total }).from(appQuotes).where(and(eq(appQuotes.requestId, id), ne(appQuotes.status, "withdrawn"))).orderBy(desc(appQuotes.createdAt)).limit(1);
  const pre = await db.select().from(appPayments).where(and(eq(appPayments.requestId, id), eq(appPayments.status, "authorized")));
  if ((cq?.total ?? pre[0]?.amount) === v.total) throw new DeskError("That's the same price");
  // Release the old authorisation first (outside the transaction: it's a call to the payment provider).
  const voids = await Promise.all(pre.map(async (p) => ({ p, res: await voidAuth(p) })));
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!isOrderKind(r.kind)) throw new DeskError("Only orders have a fare to change");
    if (!["with_agent", "needs_answer"].includes(r.status)) throw new DeskError("This order can't be repriced now", "CONFLICT");
    const [old] = await tx.select().from(appQuotes).where(and(eq(appQuotes.requestId, id), ne(appQuotes.status, "withdrawn"))).orderBy(desc(appQuotes.createdAt)).limit(1);
    const from = old?.total ?? pre[0]?.amount ?? 0;
    if (from === v.total) throw new DeskError("That's the same price");
    await tx.update(appQuotes).set({ status: "withdrawn" }).where(and(eq(appQuotes.requestId, id), inArray(appQuotes.status, ["open", "accepted"])));
    const lines = [...(old?.lines ?? []), { label: copy("desk.order.priceChanged.reason"), amount: v.total - from, kind: "other" }];
    const [q] = await tx.insert(appQuotes).values({ requestId: id, lines, total: v.total, cancellation: old?.cancellation ?? null, expiresAt: new Date(Date.now() + 30 * 60_000), status: "open", createdByOpsUserId: actor.id }).returning();
    for (const { p, res } of voids) await tx.update(appPayments).set({ status: res === "voided" ? "voided" : p.status, updatedAt: new Date() }).where(eq(appPayments.id, p.id));
    await claim(tx, r, actor);
    await setDesk(tx, id, { priceChange: { from, to: v.total, at: new Date().toISOString(), reason: v.reason?.trim() || null } }, { status: "quoted" });
    await agentMessage(tx, "request", id, actor, copy("desk.order.priceChanged", { amount: sarText(v.total) }), { priceChange: true, quoteId: q!.id, from, to: v.total });
    await notify(tx, r.ownerId, { kind: "agent_needs_answer", level: "time_sensitive", title: "notify.desk.price.title", body: "notify.desk.price.body", href: `/requests/${id}` });
    await deskAudit(tx, actor, { action: "desk.order.price_changed", entityType: "request", entityId: id, ref: shortRef(id, "O"),
      summary: `Sent a new price for ${shortRef(id, "O")}: ${sarText(from)} → ${sarText(v.total)}`, data: { total: { from, to: v.total }, reason: v.reason ?? null } });
    return q!;
  });
}

const SEEDED = /^mf_seed_/; // demo rows from the desk seed: the in-memory mock provider never saw them
async function capture(p: typeof appPayments.$inferSelect): Promise<"captured" | "failed"> {
  if (p.method === "credit" || p.provider === "mada_credit") return "captured";
  if (!p.providerRef) return "failed";
  if (supplierMode("payments") === "mock" && SEEDED.test(p.providerRef)) return p.providerRef.includes("fail") ? "failed" : "captured";
  const res = await bookingSuppliers.payments().capture(p.providerRef, p.amount).catch(() => null);
  return res?.status === "captured" ? "captured" : "failed";
}
async function voidAuth(p: typeof appPayments.$inferSelect): Promise<"voided" | "failed"> {
  if (p.method === "credit" || p.provider === "mada_credit") return "voided";
  if (!p.providerRef) return "failed";
  if (supplierMode("payments") === "mock" && SEEDED.test(p.providerRef)) return "voided";
  const res = await bookingSuppliers.payments().void(p.providerRef).catch(() => null);
  return res?.status === "voided" ? "voided" : "failed";
}

/**
 * Issue the tickets: record the PNR and one ticket number per traveller, capture the payment, and only then tell
 * the traveller it's booked, signed by the person who did it ("Confirmed by Faisal at Mada").
 * If the capture doesn't go through, nothing is confirmed and the order shows under ticketing problems.
 */
async function issueTicketsHere(actor: DeskActor, id: string, v: { pnr: string; tickets: string[] }) {
  assertCap(actor, "desk.issue");
  const pnr = v.pnr.trim().toUpperCase();
  const tickets = v.tickets.map((x) => x.replace(/[\s-]/g, "")).filter(Boolean);
  if (!/^[A-Z0-9]{5,8}$/.test(pnr)) throw new DeskError("A PNR is 5 to 8 letters and numbers");
  if (tickets.some((x) => !/^\d{13}$/.test(x))) throw new DeskError("Ticket numbers are 13 digits");
  if (new Set(tickets).size !== tickets.length) throw new DeskError("The same ticket number appears twice");
  const o = await linkedOrder(id);
  if (o) {
    if (!["pending_agent", "held", "price_locked", "issuing"].includes(o.status)) throw new DeskError("This order isn't ready to issue", "CONFLICT");
    if (o.kind !== "stay" && tickets.length !== Math.max(1, o.travellerIds.length)) throw new DeskError(`Enter one ticket number for each traveller (${Math.max(1, o.travellerIds.length)})`);
    const agent = await engineAgent(actor);
    if (o.status === "pending_agent") await engine(() => booking.acceptOrder(o.id, agent));
    if (o.status === "pending_agent" || o.status === "held") await engine(() => booking.lockPrice(o.id, agent));
    await db.transaction(async (tx) => { await tx.update(appOrders).set({ supplierRef: pnr }).where(eq(appOrders.id, o.id)); await booking.orderEvent(tx, o.id, "tickets", { kind: "agent", name: agent.name }, { pnr, tickets }); });
    const done = await engine(() => booking.issueTickets(o.id, agent));
    const ok = done.status === "confirmed";
    await db.transaction(async (tx) => {
      if (ok) await setDesk(tx, id, { issuedAt: new Date().toISOString(), issuedBy: actor.id, pnr, tickets });
      await deskAudit(tx, actor, { action: ok ? "desk.order.issued" : "desk.order.capture_failed", entityType: "request", entityId: id, ref: done.ref ?? shortRef(id, "O"),
        summary: ok ? `Issued ${tickets.length || "the"} ticket${tickets.length === 1 ? "" : "s"} for ${done.ref ?? shortRef(id, "O")} · PNR ${pnr}` : `Payment capture didn't go through for ${done.ref ?? shortRef(id, "O")}. Tickets not issued`, data: { orderId: o.id, pnr, tickets } }, { app: false });
    });
    return { ok };
  }
  const full = await getRequestFull(id);
  if (!full) throw new DeskError("Order not found", "NOT_FOUND");
  if (!full.isOrder) throw new DeskError("Only orders have tickets");
  if (full.request.status !== "with_agent") throw new DeskError("This order isn't ready to issue", "CONFLICT");
  const need = Math.max(1, full.request.kind === "stay" ? 0 : full.travellers.length);
  if (full.request.kind !== "stay" && tickets.length !== need) throw new DeskError(`Enter one ticket number for each traveller (${need})`);
  const pay = full.payments.find((p) => p.status === "authorized") ?? full.payments.find((p) => p.status === "captured") ?? null;
  if (!pay) throw new DeskError("There's no card hold on this order to capture", "CONFLICT");
  const result = pay.status === "captured" ? "captured" : await capture(pay);

  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (r.status !== "with_agent") throw new DeskError("Someone else just changed this order", "CONFLICT");
    if (result === "failed") {
      await tx.update(appPayments).set({ status: "failed", updatedAt: new Date() }).where(eq(appPayments.id, pay.id));
      await setDesk(tx, id, { heldAt: deskState(r.details).heldAt ?? new Date().toISOString(), heldPnr: pnr });
      await deskAudit(tx, actor, { action: "desk.order.capture_failed", entityType: "request", entityId: id, ref: shortRef(id, "O"), summary: `Payment capture didn't go through for ${shortRef(id, "O")}. Tickets not issued` });
      return { ok: false as const };
    }
    await tx.update(appPayments).set({ status: "captured", updatedAt: new Date() }).where(eq(appPayments.id, pay.id));
    const me = await actingAgent(tx, actor);
    await tx.update(appRequests).set({ agentOpsUserId: actor.id, agentName: me.name }).where(eq(appRequests.id, id));
    await setDesk(tx, id, { issuedAt: new Date().toISOString(), issuedBy: actor.id, pnr, tickets }, { status: "confirmed" });
    if (r.tripId) {
      await tx.update(appTrips).set({ status: "booked", bookingRef: pnr, confirmedByName: me.name, confirmedByOpsUserId: actor.id, updatedAt: new Date() }).where(eq(appTrips.id, r.tripId));
      await tx.update(appSegments).set({ pnr, updatedAt: new Date() }).where(eq(appSegments.tripId, r.tripId));
    }
    await agentMessage(tx, "request", id, actor, copy("desk.order.issued", { ref: pnr }), { issued: true, pnr, confirmedBy: copy("actor.confirmed", { agent: me.name }) });
    const [trip] = r.tripId ? await tx.select({ city: appTrips.city }).from(appTrips).where(eq(appTrips.id, r.tripId)) : [];
    await tx.insert(appNotifications).values({
      userId: r.ownerId, kind: "booking_confirmed", level: "active",
      title: clip(trip ? copy("notify.confirmed.title", { city: trip.city }) : copy("actor.confirmed", { agent: me.name }), 32),
      body: clip(copy("notify.confirmed.body", { agent: me.name, ref: pnr }), 90), href: r.tripId ? `/trips/${r.tripId}` : `/requests/${id}`,
    });
    await deskAudit(tx, actor, { action: "desk.order.issued", entityType: "request", entityId: id, ref: shortRef(id, "O"),
      summary: `Issued ${tickets.length || "the"} ticket${tickets.length === 1 ? "" : "s"} for ${shortRef(id, "O")} · PNR ${pnr} · captured ${sarText(pay.amount)}`, data: { pnr, tickets, paymentId: pay.id } });
    return { ok: true as const };
  });
}

/** Ticketing didn't work: release the card hold, close the order, and tell the traveller plainly that nothing was charged. */
async function failTicketingHere(actor: DeskActor, id: string, v: { reason: string }) {
  assertCap(actor, "desk.act");
  const reason = v.reason.trim();
  if (reason.length < 3) throw new DeskError("Say what happened, for the team");
  const o = await linkedOrder(id);
  if (o) {
    const agent = await engineAgent(actor);
    if (["held", "price_locked", "issuing"].includes(o.status)) await engine(() => booking.failTicketing(o.id, agent, reason));
    else if (["pending_agent", "needs_answer", "fare_changed", "ticketing_failed", "requires_action"].includes(o.status)) await engine(() => booking.cancelOrder(o.id, { kind: "agent", name: agent.name }));
    else throw new DeskError("This order is already closed", "CONFLICT");
    await db.transaction(async (tx) => { await setDesk(tx, id, { failedAt: new Date().toISOString(), failReason: reason }); });
    await opsLog(actor, o, id, "desk.order.not_issued", `Marked ${o.ref ?? shortRef(id, "O")} not issued and released the card hold: ${clip(reason, 140)}`);
    return;
  }
  const pays = await db.select().from(appPayments).where(and(eq(appPayments.requestId, id), inArray(appPayments.status, ["authorized", "failed", "requires_action"])));
  // A failed capture can still leave the hold in place at the provider, so it is released too.
  const voids = await Promise.all(pays.map(async (p) => ({ p, res: p.status === "requires_action" ? "voided" as const : await voidAuth(p) })));
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (!isOrderKind(r.kind)) throw new DeskError("Only orders are ticketed");
    if (["confirmed", "done", "cancelled"].includes(r.status)) throw new DeskError("This order is already closed", "CONFLICT");
    for (const { p, res } of voids) await tx.update(appPayments).set({ status: res === "voided" ? "voided" : p.status, updatedAt: new Date() }).where(eq(appPayments.id, p.id));
    await claim(tx, r, actor);
    await setDesk(tx, id, { failedAt: new Date().toISOString(), failReason: reason }, { status: "cancelled" });
    await madaMessage(tx, "request", id, `${copy("desk.order.notIssued")} ${copy("desk.order.notIssued.next")}`, { notIssued: true });
    await notify(tx, r.ownerId, { kind: "other", level: "time_sensitive", title: "notify.desk.notIssued.title", body: "notify.desk.notIssued.body", href: `/requests/${id}` });
    await deskAudit(tx, actor, { action: "desk.order.not_issued", entityType: "request", entityId: id, ref: shortRef(id, "O"),
      summary: `Marked ${shortRef(id, "O")} not issued and released the card hold: ${clip(reason, 140)}`, data: { voided: voids.map((x) => ({ id: x.p.id, result: x.res })) } });
  });
}

/* ═════════════ requests and quotes ═════════════ */

/**
 * A "Plan it with Mada" request for a city we don't sell automatically (kind "destination", created by
 * POST /places/:id/plan). The team plans and quotes it by hand. Reads the place from the request's details,
 * tolerating either { place: {…} } or the fields at the top level.
 */
export function destinationOf(details: unknown) {
  const d = (details ?? {}) as Record<string, unknown>;
  const p = (d.place && typeof d.place === "object" ? d.place : d) as Record<string, unknown>;
  const name = String(p.name ?? p.city ?? "").trim();
  if (!name) return null;
  const country = p.country ? String(p.country) : null;
  const airports = (Array.isArray(p.airports) ? p.airports : Array.isArray(p.nearestAirports) ? p.nearestAirports : [])
    .map((a) => (typeof a === "string" ? a : String((a as Record<string, unknown>)?.code ?? (a as Record<string, unknown>)?.iata ?? ""))).filter(Boolean).slice(0, 4);
  const guide = typeof p.guideUrl === "string" && /^https:\/\//.test(p.guideUrl) ? p.guideUrl
    : `https://en.wikivoyage.org/wiki/Special:Search?search=${encodeURIComponent(country ? `${name}, ${country}` : name)}`;
  return { id: p.id ? String(p.id) : p.placeId ? String(p.placeId) : null, name, country, airports, guideUrl: guide, message: typeof d.message === "string" ? d.message : null };
}

export const QUOTE_LINE_KINDS = ["flight", "stay", "pickup", "visa", "service", "discount", "credit", "other"] as const;

export async function listRequests(opts: { open?: boolean; limit?: number } = {}) {
  const rows = await db.select({ r: appRequests, userName: appUsers.name }).from(appRequests).innerJoin(appUsers, eq(appUsers.id, appRequests.ownerId))
    .where(and(sql`${appRequests.kind} NOT IN ('flight','stay','trip')`, ne(appRequests.status, "queued"),
      opts.open ? inArray(appRequests.status, ["sent", "reviewing", "needs_answer", "quoted", "awaiting_payment", "with_agent"]) : undefined))
    .orderBy(desc(appRequests.createdAt)).limit(opts.limit ?? 300);
  return rows.map(({ r, userName }) => ({ ...r, ref: shortRef(r.id), userName: travellerName(userName), desk: deskState(r.details) }));
}

/** A price for each person, sent to the traveller as a card they can pay from. */
async function sendQuoteHere(actor: DeskActor, id: string, v: { lines: { label: string; amount: number; kind: string }[]; cancellation?: string | null; holdHours?: number | null }) {
  assertCap(actor, "desk.act");
  const lines = v.lines.map((l) => ({ label: l.label.trim(), amount: l.amount, kind: (QUOTE_LINE_KINDS as readonly string[]).includes(l.kind) ? l.kind : "other" })).filter((l) => l.label);
  if (!lines.length) throw new DeskError("Add at least one line");
  if (lines.length > 20) throw new DeskError("Keep a quote to 20 lines");
  if (lines.some((l) => !Number.isInteger(l.amount) || Math.abs(l.amount) > 100_000_000_00 || l.label.length > 80)) throw new DeskError("Check each line's name and amount");
  const total = lines.reduce((s, l) => s + l.amount, 0);
  if (total <= 0) throw new DeskError("The total must be more than zero");
  return db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (["confirmed", "done", "cancelled"].includes(r.status)) throw new DeskError("This request is already closed", "CONFLICT");
    await tx.update(appQuotes).set({ status: "withdrawn" }).where(and(eq(appQuotes.requestId, id), eq(appQuotes.status, "open")));
    const hold = v.holdHours && v.holdHours > 0 ? Math.min(v.holdHours, 72) : null;
    const [q] = await tx.insert(appQuotes).values({ requestId: id, lines, total, cancellation: v.cancellation?.trim() || null, expiresAt: hold ? new Date(Date.now() + hold * 3600_000) : null, status: "open", createdByOpsUserId: actor.id }).returning();
    await claim(tx, r, actor);
    await tx.update(appRequests).set({ status: "quoted", updatedAt: new Date() }).where(eq(appRequests.id, id));
    const { agent } = await agentMessage(tx, "request", id, actor, copy("desk.quote.sent"), { quoteId: q!.id, total, lines });
    await notify(tx, r.ownerId, { kind: "agent_reply", level: "active", title: "notify.desk.quote.title", body: "notify.desk.quote.body", vars: { agent: agent.name, summary: r.summary }, href: `/requests/${id}` });
    await deskAudit(tx, actor, { action: "desk.quote.sent", entityType: "request", entityId: id, ref: shortRef(id), summary: `Sent a quote for ${shortRef(id)}: ${sarText(total)} in ${lines.length} line${lines.length === 1 ? "" : "s"}`, data: { quoteId: q!.id, total } });
    return q!;
  });
}

/** What the traveller has to bring, per service (FLOWS.md §4: every pilgrim needs their own Nusuk permit). */
export const CHECKLISTS: Record<string, string[]> = {
  visa: ["Passport valid 6 months past return", "Passport photo, white background", "Bank statement, last 3 months", "Employment letter or iqama", "Flight and hotel booking", "Travel insurance"],
  umrah: ["Nusuk permit for each traveller", "Passport valid 6 months", "Meningitis vaccination certificate", "Hotel in Makkah booked", "Transport Jeddah to Makkah", "Ihram for each man"],
};

export async function saveChecklist(actor: DeskActor, id: string, items: { label: string; done: boolean }[]) {
  assertCap(actor, "desk.act");
  const list = items.map((i) => ({ label: i.label.trim().slice(0, 80), done: !!i.done })).filter((i) => i.label).slice(0, 20);
  await db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    const before = deskState(r.details).checklist ?? [];
    await setDesk(tx, id, { checklist: list });
    const ticked = list.filter((i) => i.done && !before.find((b) => b.label === i.label && b.done)).map((i) => i.label);
    await deskAudit(tx, actor, { action: "desk.checklist.saved", entityType: "request", entityId: id, ref: shortRef(id),
      summary: ticked.length ? `Ticked ${ticked.join(", ")} on ${shortRef(id)}` : `Updated the checklist on ${shortRef(id)}`, data: { done: list.filter((i) => i.done).length, of: list.length } });
  });
}

async function markDoneHere(actor: DeskActor, id: string) {
  assertCap(actor, "desk.act");
  await db.transaction(async (tx) => {
    const r = await lockRequest(tx, id);
    if (["done", "cancelled"].includes(r.status)) throw new DeskError("Already closed", "CONFLICT");
    await claim(tx, r, actor);
    await setDesk(tx, id, { doneAt: new Date().toISOString() }, { status: "done" });
    await agentMessage(tx, "request", id, actor, copy("desk.request.done"), { done: true });
    await deskAudit(tx, actor, { action: "desk.request.done", entityType: "request", entityId: id, ref: shortRef(id), summary: `Marked ${shortRef(id)} done: ${clip(r.summary, 80)}` });
  });
}

/* ═════════════ conversations ═════════════ */

export type Conversation = {
  kind: "request" | "support"; id: string; userId: string | null; userName: string; lastBody: string; lastAt: Date; lastAuthor: string;
  waitingSince: Date | null; firstReplyAt: Date | null; summary: string | null;
};

/** Support chats and request threads, newest first, with how long the traveller has been waiting for a person. */
export async function listConversations(limit = 200): Promise<Conversation[]> {
  const rows = await db.execute(sql`
    WITH last AS (
      SELECT DISTINCT ON (thread_kind, thread_id) thread_kind, thread_id, author_kind, body, created_at
      FROM ${appMessages} WHERE thread_kind IN ('support','request') ORDER BY thread_kind, thread_id, created_at DESC
    ), agent_last AS (
      SELECT thread_kind, thread_id, max(created_at) AS at FROM ${appMessages} WHERE author_kind = 'agent' GROUP BY 1, 2
    ), waiting AS (
      SELECT m.thread_kind, m.thread_id, min(m.created_at) AS since FROM ${appMessages} m
      LEFT JOIN agent_last a ON a.thread_kind = m.thread_kind AND a.thread_id = m.thread_id
      WHERE m.author_kind = 'user' AND m.created_at > coalesce(a.at, 'epoch') GROUP BY 1, 2
    ), owner AS (
      SELECT DISTINCT ON (thread_kind, thread_id) thread_kind, thread_id, author_user_id FROM ${appMessages}
      WHERE author_user_id IS NOT NULL ORDER BY thread_kind, thread_id, created_at
    )
    SELECT l.thread_kind, l.thread_id, l.author_kind, l.body, l.created_at, w.since, a.at AS agent_at,
      coalesce(r.owner_id, st.user_id, o.author_user_id) AS user_id, u.name AS user_name, coalesce(r.summary, st.about) AS summary
    FROM last l
    LEFT JOIN waiting w ON w.thread_kind = l.thread_kind AND w.thread_id = l.thread_id
    LEFT JOIN agent_last a ON a.thread_kind = l.thread_kind AND a.thread_id = l.thread_id
    LEFT JOIN owner o ON o.thread_kind = l.thread_kind AND o.thread_id = l.thread_id
    LEFT JOIN ${appRequests} r ON l.thread_kind = 'request' AND r.id = l.thread_id
    LEFT JOIN ${appSupportThreads} st ON l.thread_kind = 'support' AND st.id = l.thread_id
    LEFT JOIN ${appUsers} u ON u.id = coalesce(r.owner_id, st.user_id, o.author_user_id)
    ORDER BY (w.since IS NULL), l.created_at DESC LIMIT ${limit}`);
  type Row = { thread_kind: "request" | "support"; thread_id: string; author_kind: string; body: string; created_at: string | Date; since: string | Date | null; agent_at: string | Date | null; user_id: string | null; user_name: string | null; summary: string | null };
  const d = (x: string | Date | null) => (x ? new Date(x) : null);
  return (rows as unknown as Row[]).map((x) => ({
    kind: x.thread_kind, id: x.thread_id, userId: x.user_id, userName: travellerName(x.user_name), lastBody: x.body, lastAt: new Date(x.created_at), lastAuthor: x.author_kind,
    waitingSince: d(x.since), firstReplyAt: d(x.agent_at), summary: x.summary,
  }));
}

export async function getThread(kind: "request" | "support", id: string) {
  const [messages, notes] = await Promise.all([
    db.select().from(appMessages).where(and(eq(appMessages.threadKind, kind), eq(appMessages.threadId, id))).orderBy(asc(appMessages.createdAt)).limit(500),
    db.select({ n: appDeskNotes, name: schema.users.name }).from(appDeskNotes).innerJoin(schema.users, eq(schema.users.id, appDeskNotes.opsUserId))
      .where(and(eq(appDeskNotes.threadKind, kind), eq(appDeskNotes.threadId, id))).orderBy(asc(appDeskNotes.createdAt)),
  ]);
  let userId: string | null = null, summary: string | null = null;
  if (kind === "request") {
    const [r] = await db.select({ o: appRequests.ownerId, s: appRequests.summary }).from(appRequests).where(eq(appRequests.id, id));
    userId = r?.o ?? null; summary = r?.s ?? null;
  } else {
    const [th] = await db.select({ u: appSupportThreads.userId, about: appSupportThreads.about }).from(appSupportThreads).where(eq(appSupportThreads.id, id));
    userId = th?.u ?? messages.find((m) => m.authorUserId)?.authorUserId ?? null; summary = th?.about ?? null;
  }
  const [user] = userId ? await db.select().from(appUsers).where(eq(appUsers.id, userId)) : [];
  return { kind, id, messages, notes, user: user ?? null, summary };
}

async function threadOwner(tx: Tx, kind: "request" | "support", id: string) {
  if (kind === "request") return (await tx.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, id)))[0]?.o ?? null;
  const [th] = await tx.select({ o: appSupportThreads.userId }).from(appSupportThreads).where(eq(appSupportThreads.id, id));
  if (th) return th.o;
  return (await tx.select({ o: appMessages.authorUserId }).from(appMessages)
    .where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, id), sql`${appMessages.authorUserId} IS NOT NULL`)).limit(1))[0]?.o ?? null;
}

/** A reply in the traveller's thread, sent as the agent's own name. */
async function sendAgentReplyHere(actor: DeskActor, kind: "request" | "support", id: string, v: { body: string; attachment?: { id: string; filename: string; mime: string; size: number } | null }) {
  assertCap(actor, "desk.act");
  const body = v.body.trim();
  if (!body && !v.attachment) throw new DeskError("Write a reply first");
  if (body.length > 4000) throw new DeskError("Keep a reply under 4,000 characters");
  // A support thread the wallet's support module knows: its agentReply updates the thread and notifies the traveller.
  if (kind === "support" && body && !v.attachment) {
    const [th] = await db.select({ id: appSupportThreads.id }).from(appSupportThreads).where(eq(appSupportThreads.id, id));
    if (th) {
      const me = await actingAgent(db, actor);
      const m = await engine(() => supportDesk.agentReply(id, { opsUserId: actor.id, name: me.name }, body));
      await db.transaction(async (tx) => {
        await tx.execute(sql`DELETE FROM app_desk_typing WHERE thread_id = ${id} AND agent_id IN (SELECT id FROM app_agents WHERE ops_user_id = ${actor.id})`);
        await deskAudit(tx, actor, { action: "desk.chat.replied", entityType: "support_thread", entityId: id, ref: shortRef(id, "C"), summary: `Replied as ${me.name}`, data: { messageId: m.id, chars: body.length } }, { app: false });
      });
      return m;
    }
  }
  return db.transaction(async (tx) => {
    const owner = await threadOwner(tx, kind, id);
    if (!owner) throw new DeskError("Conversation not found", "NOT_FOUND");
    if (kind === "request") { const r = await lockRequest(tx, id); await claim(tx, r, actor); }
    const { message, agent } = await agentMessage(tx, kind, id, actor, body, v.attachment ? { attachment: v.attachment } : null);
    if (kind === "support") await tx.update(appSupportThreads).set({ lastMessageAt: new Date(), agentReadAt: new Date() }).where(eq(appSupportThreads.id, id));
    await tx.execute(sql`DELETE FROM app_desk_typing WHERE thread_id = ${id} AND agent_id IN (SELECT id FROM app_agents WHERE ops_user_id = ${actor.id})`);
    await notify(tx, owner, { kind: "agent_reply", level: "active", title: "notify.desk.reply.title", body: "notify.desk.reply.body", vars: { agent: agent.name, text: body || v.attachment?.filename || "" }, href: kind === "request" ? `/requests/${id}` : `/support/${id}` });
    await deskAudit(tx, actor, { action: "desk.chat.replied", entityType: kind === "request" ? "request" : "support_thread", entityId: id, ref: kind === "request" ? shortRef(id) : shortRef(id, "C"),
      summary: `Replied as ${agent.name}${v.attachment ? ` with ${v.attachment.filename}` : ""}`, data: { messageId: message.id, chars: body.length } });
    return message;
  });
}

/** A note for the team, never shown to the traveller. */
export async function addNote(actor: DeskActor, kind: "request" | "support", id: string, body: string) {
  assertCap(actor, "desk.act");
  const text = body.trim();
  if (!text) throw new DeskError("Write the note first");
  if (text.length > 2000) throw new DeskError("Keep notes under 2,000 characters");
  await db.transaction(async (tx) => {
    if (!(await threadOwner(tx, kind, id))) throw new DeskError("Conversation not found", "NOT_FOUND");
    await tx.insert(appDeskNotes).values({ threadKind: kind, threadId: id, opsUserId: actor.id, body: text });
    await deskAudit(tx, actor, { action: "desk.note.added", entityType: kind === "request" ? "request" : "support_thread", entityId: id, ref: kind === "request" ? shortRef(id) : shortRef(id, "C"), summary: `Added an internal note: "${clip(text, 100)}"` });
  });
}

/* ═════════════ refunds ═════════════ */

export async function listRefunds(stage?: string) {
  const rows = await db.select({ f: appRefunds, p: appPayments, userName: appUsers.name, userId: appUsers.id, summary: appRequests.summary, requestId: appRequests.id })
    .from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId)).innerJoin(appUsers, eq(appUsers.id, appPayments.ownerId))
    .leftJoin(appRequests, eq(appRequests.id, appPayments.requestId))
    .where(stage ? eq(appRefunds.stage, stage) : undefined).orderBy(desc(appRefunds.createdAt)).limit(300);
  return rows.map((x) => ({ ...x.f, payment: x.p, userId: x.userId, userName: travellerName(x.userName), summary: x.summary, requestId: x.requestId, ref: shortRef(x.f.id, "F") }));
}

const instalmentProvider = (m: string) => (m === "tabby" ? "Tabby" : m === "tamara" ? "Tamara" : null);

/** Approve a refund to the card it came from, or to Mada credit (instant). Credit goes in as a ledger entry. */
async function approveRefundHere(actor: DeskActor, id: string, v: { destination: "original" | "credit"; note?: string | null }) {
  assertCap(actor, "desk.refund");
  const [pre] = await db.select({ f: appRefunds, p: appPayments }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId)).where(eq(appRefunds.id, id));
  if (!pre) throw new DeskError("Refund not found", "NOT_FOUND");
  if (pre.f.stage !== "requested") throw new DeskError("This refund has already been decided", "CONFLICT");
  let providerRef: string | null = null;
  if (v.destination === "original" && pre.p.providerRef && pre.p.method !== "credit") {
    if (!(supplierMode("payments") === "mock" && SEEDED.test(pre.p.providerRef))) {
      const res = await bookingSuppliers.payments().refund(pre.p.providerRef, pre.f.amount, `refund:${id}`).catch(() => null);
      if (!res || (res.status !== "refunded" && res.status !== "partially_refunded")) throw new DeskError("The card refund didn't go through. Try again, or refund to Mada credit", "CONFLICT");
      providerRef = res.providerRef;
    } else providerRef = `${pre.p.providerRef}_rf`;
  }
  return db.transaction(async (tx) => {
    const [f] = await tx.select().from(appRefunds).where(eq(appRefunds.id, id)).for("update");
    if (!f || f.stage !== "requested") throw new DeskError("This refund has already been decided", "CONFLICT");
    const toCredit = v.destination === "credit";
    const expected = toCredit ? new Date() : new Date(Date.now() + 10 * 86400_000);
    await tx.update(appRefunds).set({ stage: toCredit ? "sent" : "approved", destination: v.destination, expectedBy: expected, providerRef, updatedAt: new Date() }).where(eq(appRefunds.id, id));
    if (toCredit) await creditEntry(tx, actor, { userId: pre.p.ownerId, amount: f.amount, kind: "refund", note: v.note?.trim() || "Refund to Mada credit", refundId: id });
    const total = (await tx.select({ s: sql<number>`coalesce(sum(${appRefunds.amount}),0)::bigint` }).from(appRefunds).where(and(eq(appRefunds.paymentId, f.paymentId), inArray(appRefunds.stage, ["approved", "sent"]))))[0]!.s;
    await tx.update(appPayments).set({ status: Number(total) >= pre.p.amount ? "refunded" : "partially_refunded", updatedAt: new Date() }).where(eq(appPayments.id, f.paymentId));
    const amount = sarText(f.amount);
    const provider = instalmentProvider(pre.p.method);
    const line = toCredit ? copy("desk.refund.approved.credit", { amount }) : copy("desk.refund.approved.card", { amount, card: pre.p.label ?? "card" });
    const body = provider && !toCredit ? `${line} ${copy("desk.refund.instalments", { provider })}` : line;
    if (pre.p.requestId) await agentMessage(tx, "request", pre.p.requestId, actor, body, { refund: { amount: f.amount, stage: toCredit ? "sent" : "approved", destination: v.destination } });
    await notify(tx, pre.p.ownerId, { kind: "refund_moved", level: "active", title: "notify.desk.refund.title", body: "notify.desk.refund.body", vars: { amount }, href: pre.p.requestId ? `/requests/${pre.p.requestId}` : null });
    await deskAudit(tx, actor, { action: "desk.refund.approved", entityType: "refund", entityId: id, ref: shortRef(id, "F"),
      summary: `Approved a refund of ${amount} to ${toCredit ? "Mada credit" : pre.p.label ?? "the card"}${provider ? ` (${provider} instalments cancelled)` : ""}`, data: { amount: f.amount, destination: v.destination, providerRef } });
  });
}

/** Say no, with the reason the traveller will read in the app. */
async function rejectRefundHere(actor: DeskActor, id: string, v: { reason: string }) {
  assertCap(actor, "desk.refund");
  const reason = v.reason.trim();
  if (reason.length < 10 || reason.length > 300) throw new DeskError("Give the traveller a clear reason, 10 to 300 characters");
  await db.transaction(async (tx) => {
    const [x] = await tx.select({ f: appRefunds, p: appPayments }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId)).where(eq(appRefunds.id, id)).for("update", { of: appRefunds });
    if (!x) throw new DeskError("Refund not found", "NOT_FOUND");
    if (x.f.stage !== "requested") throw new DeskError("This refund has already been decided", "CONFLICT");
    await tx.update(appRefunds).set({ stage: "rejected", reason, updatedAt: new Date() }).where(eq(appRefunds.id, id));
    if (x.p.requestId) await agentMessage(tx, "request", x.p.requestId, actor, copy("desk.refund.rejected", { reason }), { refund: { amount: x.f.amount, stage: "rejected" } });
    await notify(tx, x.p.ownerId, { kind: "refund_moved", level: "active", title: "notify.desk.refundNo.title", body: "notify.desk.refundNo.body", href: x.p.requestId ? `/requests/${x.p.requestId}` : null });
    await deskAudit(tx, actor, { action: "desk.refund.rejected", entityType: "refund", entityId: id, ref: shortRef(id, "F"), summary: `Declined a refund of ${sarText(x.f.amount)}: ${clip(reason, 140)}` });
  });
}

/** One line on the traveller's Mada credit ledger (append-only; corrections are new lines). */
export async function creditEntry(tx: Tx, actor: DeskActor, v: { userId: string; amount: number; kind: "refund" | "goodwill" | "adjustment"; note: string; refundId?: string | null }) {
  if (!Number.isInteger(v.amount) || v.amount <= 0) throw new DeskError("Enter an amount");
  // lib/app/credit.ts keeps the ledger (and writes its own app audit row); the desk adds the Ops log line.
  await addCredit(tx, { userId: v.userId, amount: v.amount, kind: v.kind, note: v.note.slice(0, 200), refundId: v.refundId ?? null, actor: { kind: "agent", id: actor.id } });
  await deskAudit(tx, actor, { action: "desk.credit.added", entityType: "app_user", entityId: v.userId, ref: "Mada credit", summary: `Added ${sarText(v.amount)} Mada credit (${v.kind})`, data: { amount: v.amount, kind: v.kind } }, { app: false });
}

/* ═════════════ moderation ═════════════ */

export async function blockTraveller(actor: DeskActor, userId: string, reason: string) {
  assertCap(actor, "desk.moderate");
  const why = reason.trim();
  if (why.length < 5) throw new DeskError("Say why the account is blocked");
  await db.transaction(async (tx) => {
    const [u] = await tx.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, userId));
    if (!u) throw new DeskError("Traveller not found", "NOT_FOUND");
    const [open] = await tx.select({ id: appDeskBlocks.id }).from(appDeskBlocks).where(and(eq(appDeskBlocks.userId, userId), isNull(appDeskBlocks.liftedAt)));
    if (open) throw new DeskError("Already blocked", "CONFLICT");
    await tx.insert(appDeskBlocks).values({ userId, reason: why, blockedBy: actor.id });
    await deskAudit(tx, actor, { action: "desk.traveller.blocked", entityType: "app_user", entityId: userId, ref: travellerName(u.name), summary: `Blocked ${travellerName(u.name)} from posting and messaging: ${clip(why, 120)}` });
  });
}

export async function unblockTraveller(actor: DeskActor, userId: string) {
  assertCap(actor, "desk.moderate");
  await db.transaction(async (tx) => {
    const [b] = await tx.select().from(appDeskBlocks).where(and(eq(appDeskBlocks.userId, userId), isNull(appDeskBlocks.liftedAt))).for("update");
    if (!b) throw new DeskError("Not blocked", "CONFLICT");
    await tx.update(appDeskBlocks).set({ liftedAt: new Date(), liftedBy: actor.id }).where(eq(appDeskBlocks.id, b.id));
    await deskAudit(tx, actor, { action: "desk.traveller.unblocked", entityType: "app_user", entityId: userId, ref: "Block", summary: `Lifted the block on a traveller account` });
  });
}

/* ───────── the desk writes to a traveller in the traveller's language ─────────
 * Every message, line and notification these actions create is read by the traveller who owns the request, refund
 * or thread, so the action runs in that traveller's saved language (lib/app/locale.ts), not the agent's.
 */
const forOwner = <V, R>(fn: (actor: DeskActor, id: string, v: V) => Promise<R>) =>
  (actor: DeskActor, id: string, v: V): Promise<R> => inRequestOwnerLocale(id, () => fn(actor, id, v));
export const confirmHold = (actor: DeskActor, id: string, v: { pnr?: string | null } = {}) => inRequestOwnerLocale(id, () => confirmHoldHere(actor, id, v));
export const askTraveller = forOwner(askTravellerHere);
export const priceChanged = forOwner(priceChangedHere);
export const issueTickets = forOwner(issueTicketsHere);
export const failTicketing = forOwner(failTicketingHere);
export const sendQuote = forOwner(sendQuoteHere);
export const markDone = (actor: DeskActor, id: string) => inRequestOwnerLocale(id, () => markDoneHere(actor, id));
export const sendAgentReply: typeof sendAgentReplyHere = async (actor, kind, id, v) =>
  inUserLocale(await db.transaction((tx) => threadOwner(tx, kind, id)), () => sendAgentReplyHere(actor, kind, id, v));
async function refundOwner(id: string): Promise<string | null> {
  const [r] = await db.select({ userId: appPayments.ownerId }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId)).where(eq(appRefunds.id, id)).limit(1);
  return r?.userId ?? null;
}
export const approveRefund: typeof approveRefundHere = async (actor, id, v) => inUserLocale(await refundOwner(id), () => approveRefundHere(actor, id, v));
export const rejectRefund: typeof rejectRefundHere = async (actor, id, v) => inUserLocale(await refundOwner(id), () => rejectRefundHere(actor, id, v));
