import "server-only";
import { and, desc, eq, inArray } from "drizzle-orm";
import {
  CreateOrderBody, entryChecks, money, seatsFor, t,
  type CreateOrderResponse, type DemoFlag, type FlightOption, type OrderView, type CreateOrderBody as CreateOrderInput,
} from "@mada/shared";
import { db } from "@/db";
import { appPayments, appRequests } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { bookingSuppliers, agentFor, autopilotOn, householdOf, isUuid, today } from "./common";
import {
  DEMO_FARE_RISE_EACH, acceptFare, acceptOrder, answerQuestion, askQuestion, cancelOrder, confirmOrder, failTicketing, issueTickets, lockPrice, orderEvent,
  priceChanged, retryByPhone, returnCredit, startIssuing, type OrderRow,
} from "./desk";
import { authorize, chargeFor } from "./payments";
import { spendCredit } from "../credit";
import { priceDraft } from "./pricing";

/*
 * Orders: POST /orders authorises the payment and hands the booking to the desk ('pending_agent'); GET /orders/:id is
 * what the With Mada screen polls. In mock mode the desk's autopilot moves the order on each poll, through the same
 * desk functions a person uses, with the demo switches the order was made with.
 */

const SLOW_MS = 8000;

export function orderView(o: OrderRow, now = Date.now()): OrderView {
  const snap = o.snapshot as { flight?: FlightOption; place?: string; photo?: string; bundle?: boolean; title?: string; from?: string };
  const f = snap.flight ?? null;
  const q = o.question as { text: string; options: ("yes" | "call")[]; calling?: boolean; answer?: string | null } | null;
  const fc = o.fareChange as { perPerson: number; total: number } | null;
  const done = ["confirmed", "cancelled", "declined"].includes(o.status);
  const problem = ["needs_answer", "fare_changed", "ticketing_failed"].includes(o.status);
  return {
    id: o.id, kind: o.kind as OrderView["kind"], status: o.status as OrderView["status"], step: Math.min(3, o.step),
    title: snap.title ?? "", place: snap.place ?? "", depart: f?.out.date ?? null, departTime: f?.out.dep ?? null, from: f?.out.from ?? null, oneway: f ? !f.back : false,
    photo: snap.photo ?? "istanbul-galata", carrier: f?.carrier ?? null, airline: f?.airline ?? null, flightNumber: f?.out.flightNumber ?? null, cabin: f?.cabin ?? null,
    seats: f ? seatsFor(o.travellerIds.length, f.cabin) : [], travellerIds: o.travellerIds,
    lines: o.lines as OrderView["lines"], total: money(o.total), extra: money(o.extra), plan: o.plan as OrderView["plan"], paymentLabel: o.paymentLabel, creditUsed: money(o.creditUsed),
    bundle: !!snap.bundle, ref: o.ref, agent: o.agentName ? { name: o.agentName } : null, confirmedBy: o.confirmedByName ? { name: o.confirmedByName } : null,
    question: q && (o.status === "needs_answer" || q.calling) && q.answer !== "yes" ? { text: q.text, options: q.options, calling: !!q.calling } : null,
    fareChange: fc && o.status === "fare_changed" ? { perPerson: money(fc.perPerson), total: money(fc.total), newTotal: money(o.total + o.extra + fc.total) } : null,
    problem: o.problem, slow: !done && !problem && o.status !== "requires_action" && now - o.createdAt.getTime() > SLOW_MS,
    tripId: o.tripId, requestId: o.requestId,
    action: o.status === "requires_action" ? { kind: "otp", triesLeft: Math.max(0, 3 - o.otpTries), label: o.paymentLabel, amount: money(o.total) } : null,
    createdAt: o.createdAt.toISOString(), confirmedAt: o.confirmedAt?.toISOString() ?? null,
  };
}

export async function ownOrder(ownerId: string, id: string): Promise<OrderRow> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [o] = await db.select().from(appOrders).where(and(eq(appOrders.id, id), eq(appOrders.ownerId, ownerId)));
  if (!o) throw new AppError("NOT_FOUND");
  return o;
}

const AGENT_KINDS = new Set(["trip", "stay", "package"]);

export async function createOrder(ownerId: string, input: CreateOrderInput, demo: Set<DemoFlag>, ipHash: string | null): Promise<CreateOrderResponse> {
  const body = CreateOrderBody.parse(input);
  const prior = await db.select().from(appOrders).where(and(eq(appOrders.ownerId, ownerId), eq(appOrders.idempotencyKey, body.idempotencyKey)));
  if (prior[0]) return outcomeOf(prior[0]);

  // The fare moved at the airline while the traveller looked (demo: once, SAR 140).
  const bump = demo.has("priceUp") && body.draft.kind === "trip" ? 14_000 : 0;
  const priced = await priceDraft(ownerId, body, { bump });
  const { preview } = priced;
  if (preview.holdExpiresAt && Date.parse(preview.holdExpiresAt) <= Date.now()) return { outcome: "hold_ended", preview };
  if (body.expectedTotal !== preview.total.amount) {
    return { outcome: "price_changed", previousTotal: money(body.expectedTotal), preview, changedBy: money(preview.total.amount - body.expectedTotal) };
  }
  // A passport that can't make the trip blocks the booking; everything else was answered in Ask.
  if (body.draft.kind === "trip" || body.draft.kind === "stay") {
    const search = priced.snapshot.search as { destination: string; depart?: string; return?: string | null; checkIn?: string };
    const depart = search.depart ?? search.checkIn ?? today();
    const checks = entryChecks({ destination: search.destination, travellers: priced.travellers, depart, return: search.return ?? null, answers: {}, today: today(), demo: { passportProblem: demo.has("passportProblem") } });
    const blocked = checks.checks.find((c) => c.key === "passport" && c.blocking);
    if (blocked) return { outcome: "blocked", message: blocked.text };
  }

  const agentKind = AGENT_KINDS.has(preview.kind);
  const charge = await chargeFor(ownerId, body.payment, body.plan, preview.total.amount, demo);
  const agentName = await agentFor(ownerId);
  const requestId = body.draft.kind === "quote" ? body.draft.requestId : null;
  const f = priced.snapshot.flight as FlightOption | undefined;

  const res = await db.transaction(async (tx) => {
    const pay = charge.provider === "mada_credit" ? null
      : await authorize(tx, ownerId, charge, preview.total.amount, `order:${ownerId}:${body.idempotencyKey}`, preview.title, requestId);
    if (pay?.status === "declined" || pay?.status === "failed") return { outcome: "declined" as const };
    const status = pay?.status === "requires_action" ? "requires_action" : agentKind ? "pending_agent" : "paid_now";
    let deskRequest: string | null = requestId;
    if (agentKind) {
      const [r] = await tx.insert(appRequests).values({
        ownerId, kind: preview.kind === "stay" ? "stay" : preview.kind === "package" ? "trip" : "flight", status: "with_agent", summary: preview.title,
        travellerIds: preview.travellerIds, agentName, promisedBy: new Date(Date.now() + 15 * 60_000),
        details: { askKind: preview.kind, title: preview.title, detail: preview.lines.map((l) => l.text).join(" · "), source: "order" },
      }).returning({ id: appRequests.id });
      deskRequest = r!.id;
    }
    const supplierId = priced.offerRows.find((r) => r.kind === "flight")?.supplierOfferId;
    const [o] = await tx.insert(appOrders).values({
      ownerId, kind: preview.kind, status: status === "paid_now" ? "pending_agent" : status, step: 0, idempotencyKey: body.idempotencyKey,
      draft: body.draft as Record<string, unknown>,
      snapshot: { ...priced.snapshot, flightSupplierId: supplierId ?? null, place: priced.place, photo: preview.photo, title: preview.title, preview },
      lines: preview.lines, travellerIds: preview.travellerIds, subtotal: preview.subtotal.amount, discount: preview.promo?.status === "applied" ? preview.promo.discount.amount : 0,
      promo: preview.promo?.status === "applied" ? preview.promo.code : null, creditUsed: preview.credit.used.amount, total: preview.total.amount, plan: charge.instalments > 1 ? body.plan : "full",
      paymentLabel: charge.label, paymentMethod: { method: body.payment.method === "new_card" ? "new_card" : body.payment.method, cardId: body.payment.method === "card" ? body.payment.cardId : null, plan: body.plan, provider: charge.provider },
      paymentId: pay?.id ?? null, requestId: deskRequest, agentName, demo: [...demo], autopilotAt: autopilotOn() ? new Date(Date.now() + tick(demo)) : null,
    }).returning();
    // Mada credit is held now (it never goes below zero) and comes back if the booking doesn't happen.
    if (o!.creditUsed > 0) await spendCredit(tx, { userId: ownerId, amount: o!.creditUsed, note: preview.title, paymentId: pay?.id ?? null, actor: { kind: "user", id: ownerId }, ipHash });
    await orderEvent(tx, o!.id, "created", { kind: "user" }, { total: o!.total });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "order.created", entityType: "app_order", entityId: o!.id, summary: `Booked ${preview.title} for ${o!.total} halalas (${charge.label})`, ipHash });
    return { outcome: "ok" as const, order: o!, paidNow: status === "paid_now" };
  });
  if (res.outcome === "declined") return { outcome: "declined", message: t("pay.declined.body") };
  // Charged now: nothing for an agent to confirm (requests, eSIMs).
  if (res.paidNow) {
    const done = await confirmOrder(res.order.id, { name: agentName });
    return { outcome: "paid", order: orderView(done) };
  }
  return outcomeOf(res.order);
}

function outcomeOf(o: OrderRow): CreateOrderResponse {
  if (o.status === "requires_action") return { outcome: "requires_action", order: orderView(o) };
  if (o.status === "declined") return { outcome: "declined", message: t("pay.declined.body") };
  if (!AGENT_KINDS.has(o.kind) && o.status === "confirmed") return { outcome: "paid", order: orderView(o) };
  return { outcome: "created", order: orderView(o) };
}

/** The bank's code (3-D Secure). Three wrong codes and the bank stops the payment: nothing was charged. */
export async function submitOtp(ownerId: string, id: string, code: string): Promise<OrderView> {
  const o = await ownOrder(ownerId, id);
  if (o.status !== "requires_action" || !o.paymentId) throw new AppError("VALIDATION");
  const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  const r = await bookingSuppliers.payments().completeAction(p!.providerRef!, code);
  const status = r.status === "authorized" ? (AGENT_KINDS.has(o.kind) ? "pending_agent" : "paid_now") : r.status === "requires_action" ? "requires_action" : "declined";
  await db.transaction(async (tx) => {
    await tx.update(appPayments).set({ status: r.status === "authorized" ? "authorized" : r.status === "requires_action" ? "requires_action" : "declined", updatedAt: new Date() }).where(eq(appPayments.id, p!.id));
    await tx.update(appOrders).set({
      status: status === "paid_now" ? "pending_agent" : status, otpTries: r.status === "requires_action" ? o.otpTries + 1 : status === "declined" ? 3 : o.otpTries,
      autopilotAt: status === "pending_agent" && autopilotOn() ? new Date(Date.now() + tick(new Set(o.demo as DemoFlag[]))) : o.autopilotAt, updatedAt: new Date(),
    }).where(eq(appOrders.id, o.id));
    await orderEvent(tx, o.id, r.status === "authorized" ? "authorised" : "otp_wrong", { kind: "user" });
    if (status === "declined") await returnCredit(tx, o);
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: `payment.3ds_${r.status === "authorized" ? "passed" : status === "declined" ? "stopped" : "wrong"}`, entityType: "app_payment", entityId: p!.id, summary: "Bank code checked" });
  });
  if (status === "paid_now") return orderView(await confirmOrder(o.id, { name: o.agentName ?? (await agentFor(ownerId)) }));
  return orderView(await ownOrder(ownerId, id));
}

export async function answerOrder(ownerId: string, id: string, answer: "yes" | "call" | "accept_fare" | "stop" | "retry_by_phone" | "cancel"): Promise<OrderView> {
  const o = await ownOrder(ownerId, id);
  let u: OrderRow;
  if (answer === "yes" || answer === "call") u = await answerQuestion(o.id, ownerId, answer);
  else if (answer === "accept_fare") u = await acceptFare(o.id, ownerId);
  else if (answer === "retry_by_phone") u = await retryByPhone(o.id, ownerId);
  else u = await cancelOrder(o.id, { kind: "user", name: "traveller" });
  if (autopilotOn() && !["cancelled", "confirmed"].includes(u.status) && !u.autopilotAt) {
    await db.update(appOrders).set({ autopilotAt: new Date(Date.now() + tick(new Set(u.demo as DemoFlag[]))) }).where(eq(appOrders.id, u.id));
  }
  return orderView(await advance(await ownOrder(ownerId, id)));
}

export async function getOrder(ownerId: string, id: string): Promise<OrderView> {
  return orderView(await advance(await ownOrder(ownerId, id)));
}

/** Orders still with the desk, for "close and finish in the background". */
export async function activeOrders(ownerId: string): Promise<OrderView[]> {
  const rows = await db.select().from(appOrders).where(and(eq(appOrders.ownerId, ownerId), inArray(appOrders.status, ["requires_action", "pending_agent", "held", "price_locked", "issuing", "needs_answer", "fare_changed", "ticketing_failed", "confirmed"])))
    .orderBy(desc(appOrders.createdAt)).limit(10);
  const out: OrderView[] = [];
  for (const r of rows) {
    const a = await advance(r);
    if (a.status !== "confirmed" || (a.confirmedAt && Date.now() - a.confirmedAt.getTime() < 10 * 60_000)) out.push(orderView(a));
  }
  return out;
}

/* ───────────── the mock desk's autopilot ───────────── */

/** The demo question is about someone actually on this booking: their given names, as on the passport. */
async function questionText(o: OrderRow): Promise<string> {
  const people = await householdOf(o.ownerId);
  const p = people.find((x) => o.travellerIds.includes(x.id) && !x.isSelf) ?? people.find((x) => o.travellerIds.includes(x.id));
  const self = people.find((x) => x.isSelf);
  const given = `${(p?.givenNames || p?.firstName || "").split(/\s+/)[0] ?? ""} ${self?.firstName && p && !p.isSelf ? self.firstName : ""}`.trim().toUpperCase();
  return p && !p.isSelf ? t("wait.question.names", { name: p.firstName, given }) : t("wait.question.namesYours", { given });
}

const tick = (demo: Set<DemoFlag>) => (demo.has("slowAgent") ? 4200 : 1200);

/** One step at a time, each when its moment has come, through the desk's own functions. Returns the order as it now is. */
export async function advance(o: OrderRow, now = new Date()): Promise<OrderRow> {
  let cur = o;
  for (let i = 0; i < 6; i += 1) {
    if (!cur.autopilotAt || cur.autopilotAt.getTime() > now.getTime()) return cur;
    const next = await step(cur);
    if (!next) {
      await db.update(appOrders).set({ autopilotAt: null }).where(eq(appOrders.id, cur.id));
      return { ...cur, autopilotAt: null };
    }
    const demo = new Set(next.demo as DemoFlag[]);
    const waiting = ["needs_answer", "fare_changed", "ticketing_failed", "confirmed", "cancelled", "declined", "requires_action"].includes(next.status);
    const at = waiting ? null : new Date(Math.max(now.getTime(), (cur.autopilotAt?.getTime() ?? now.getTime())) + tick(demo));
    // Steps that were due long ago (the app was closed) all happen now, in order.
    const catchUp = !waiting && cur.autopilotAt.getTime() + tick(demo) <= now.getTime();
    const [u] = await db.update(appOrders).set({ autopilotAt: waiting ? null : catchUp ? new Date(cur.autopilotAt.getTime() + tick(demo)) : at }).where(eq(appOrders.id, cur.id)).returning();
    cur = u!;
  }
  return cur;
}

async function step(o: OrderRow): Promise<OrderRow | null> {
  const demo = new Set(o.demo as DemoFlag[]);
  const agent = { name: o.agentName ?? "Faisal" };
  const doneSet = new Set(o.autopilotDone);
  const mark = async (k: string) => { await db.update(appOrders).set({ autopilotDone: [...o.autopilotDone, k] }).where(eq(appOrders.id, o.id)); };
  const q = o.question as { calling?: boolean; answer?: string | null } | null;
  try {
    if (q?.calling) {
      await db.update(appOrders).set({ question: { ...(o.question as object), calling: false, answer: "yes" } as never }).where(eq(appOrders.id, o.id));
      return (await db.select().from(appOrders).where(eq(appOrders.id, o.id)))[0]!;
    }
    switch (o.status) {
      case "pending_agent":
        if (demo.has("fareGone") && o.kind === "trip" && !doneSet.has("fare")) { await mark("fare"); return await priceChanged(o.id, agent, DEMO_FARE_RISE_EACH); }
        return await acceptOrder(o.id, agent);
      case "held":
        if (demo.has("agentQuestion") && !doneSet.has("question")) {
          await mark("question");
          return await askQuestion(o.id, agent, await questionText(o));
        }
        return await lockPrice(o.id, agent);
      case "price_locked":
        if (demo.has("ticketingFails") && !doneSet.has("ticketing")) { await mark("ticketing"); return await failTicketing(o.id, agent); }
        return o.kind === "trip" ? await startIssuing(o.id, agent) : await confirmOrder(o.id, agent);
      case "issuing":
        return await issueTickets(o.id, agent);
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
}
