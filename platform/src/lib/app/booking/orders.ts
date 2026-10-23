import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  CreateOrderBody, rangeLabel, normalizeContactPhone, money, seatsFor, t,
  RequestResult, type CreateOrderResponse, type DemoFlag, type FlightOption, type OrderView, type CreateOrderBody as CreateOrderInput,
} from "@mada/shared";
import { db } from "@/db";
import { appPayments, appQuotes, appRequests, appUsers } from "@/db/app-schema";
import { appOrderEvents, appOrders } from "@/db/app-schema-booking";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { randomInt, randomUUID } from "node:crypto";
import { bookingSuppliers, agentFor, autopilotOn, householdOf, isUuid, newRef, today } from "./common";
import {
  CAPTURE_FAILED, DEMO_FARE_RISE_EACH, acceptFare, acceptOrder, answerQuestion, askQuestion, cancelOrder, confirmOrder, failTicketing, issueTickets, lockPrice, orderEvent,
  priceChanged, retryByPhone, returnCredit, startIssuing, type OrderRow,
} from "./desk";
import { authorize, chargeFor } from "./payments";
import { spendCredit } from "../credit";
import { priceDraft, renewalsFor, type AppliedSnapshot } from "./pricing";
import { createRequest } from "./requests";
import { autoBookStay } from "../suppliers/hotelbeds/bookings";
import { bookingRequiresPhone } from "../switches";
import { memberIds, membership } from "../circles/circles";
import { peopleByIds } from "../circles/common";
import { createSplit, remindSplit } from "../circles/messages";
import { notify } from "../trips/notify";
import { fulfilEsimOrder } from "../esim/service";
import { emit as emitPlanEvent } from "../plans/events";

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
    // Dates are worded when read, in the reader's language (the order was made in the language of the moment).
    title: f && snap.place ? `${snap.place} · ${rangeLabel(f.out.date, f.back?.date ?? null)}` : snap.title ?? "", place: snap.place ?? "", depart: f?.out.date ?? null, departTime: f?.out.dep ?? null, from: f?.out.from ?? null, oneway: f ? !f.back : false,
    photo: snap.photo ?? "istanbul-galata", carrier: f?.carrier ?? null, airline: f?.airline ?? null, flightNumber: f?.out.flightNumber ?? null, cabin: f?.cabin ?? null,
    // Quoted fares get their seats from the airline at check-in: none are invented here.
    seats: f && !(o.snapshot as { quotedFlight?: unknown }).quotedFlight ? seatsFor(o.travellerIds.length, f.cabin) : [], travellerIds: o.travellerIds,
    lines: o.lines as OrderView["lines"], total: money(o.total), extra: money(o.extra), plan: o.plan as OrderView["plan"], paymentLabel: o.paymentLabel, creditUsed: money(o.creditUsed),
    bundle: !!snap.bundle, ref: o.ref, agent: o.agentName ? { name: o.agentName } : null, confirmedBy: o.confirmedByName ? { name: o.confirmedByName } : null,
    question: q && (o.status === "needs_answer" || q.calling) && q.answer !== "yes" ? { text: q.text, options: q.options, calling: !!q.calling } : null,
    fareChange: fc && o.status === "fare_changed" ? { perPerson: money(fc.perPerson), total: money(fc.total), newTotal: money(o.total + o.extra + fc.total) } : null,
    problem: o.problem,
    failure: o.status === "ticketing_failed" ? { cause: o.problem === CAPTURE_FAILED ? "payment" : "airline", actions: ["retry_by_phone", "cancel"] } : null,
    slow: !done && !problem && o.status !== "requires_action" && now - o.createdAt.getTime() > SLOW_MS,
    tripId: o.tripId, requestId: o.requestId,
    action: o.status === "requires_action" ? { kind: "otp", triesLeft: Math.max(0, 3 - o.otpTries), label: o.paymentLabel, amount: money(o.total) } : null,
    payRequest: payRequestOf(o),
    result: orderResult(o),
    createdAt: o.createdAt.toISOString(), confirmedAt: o.confirmedAt?.toISOString() ?? null,
  };
}

/** A booking that won't go ahead, as an outcome (desk.ts cancelResult); older rows read as cancelled with nothing charged. */
function orderResult(o: OrderRow): OrderView["result"] {
  if (o.status !== "cancelled" && o.status !== "declined") return null;
  const stored = RequestResult.safeParse((o.snapshot as { result?: unknown }).result);
  if (stored.success) return stored.data;
  const declined = o.status === "declined";
  return { kind: declined ? "refused" : "cancelled", reason: declined ? "payment" : "mada", with: null, note: null, money: { kind: "none", amount: null, by: null }, next: ["other_dates", "talk"], by: null, at: (o.updatedAt ?? o.createdAt).toISOString() };
}

/** Someone else was asked to pay (owner audit item 31): kept on the snapshot, shown on the order until it is confirmed. */
export type PayRequest = { userId: string; name: string; circleId: string; messageId: string; shareKey: string; requestedAt: string; paidAt: string | null; paidBy?: string | null };
export const payRequestOf = (o: Pick<OrderRow, "snapshot">): OrderView["payRequest"] => {
  const pr = (o.snapshot as { payRequest?: PayRequest }).payRequest;
  return pr ? { userId: pr.userId, name: pr.name, circleId: pr.circleId, messageId: pr.messageId, shareKey: pr.shareKey, requestedAt: pr.requestedAt, paidAt: pr.paidAt } : null;
};

/** What the desk reads of the preferences on a request: the summary, the codes, the numbers (full: the agent types them). */
export function deskPrefs(snapshot: Record<string, unknown>) {
  const a = snapshot.applied as AppliedSnapshot | undefined;
  if (!a) return null;
  return { summary: a.summary, ssr: a.ssr, remarks: a.remarks, hotelRemarks: a.hotelRemarks, loyalty: a.loyalty, notes: a.prefs.notes, extras: a.extras };
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
  // Independent reads side by side (each is a round trip): a replay, the account's phone, the desk agent and the price.
  const bump = demo.has("priceUp") && body.draft.kind === "trip" ? 14_000 : 0;
  // A stay is priced after the checks: pricing a Hotelbeds room asks Hotelbeds (checkrates), never for a replay.
  const early = body.draft.kind !== "stay" ? priceDraft(ownerId, body, { bump, demo }) : null;
  const agentP = agentFor(ownerId);
  early?.catch(() => {});
  agentP.catch(() => {});
  const [prior, [owner]] = await Promise.all([
    db.select().from(appOrders).where(and(eq(appOrders.ownerId, ownerId), eq(appOrders.idempotencyKey, body.idempotencyKey))),
    db.select({ phone: appUsers.phone }).from(appUsers).where(eq(appUsers.id, ownerId)),
  ]);
  if (prior[0]) return outcomeOf(prior[0]);
  // Saudi travel needs a reachable number: accounts that began with Apple, Google or email verify one first (AUTH.md).
  // The beta (APP_BOOKING_REQUIRES_PHONE=no): an account without one gives a number to call instead, kept on the order
  // as not verified; the desk calls it to confirm (switches.ts).
  let contact: { phone: string; verified: false } | null = null;
  if (!owner?.phone) {
    if (bookingRequiresPhone()) throw new AppError("PHONE_REQUIRED");
    const phone = body.contactPhone ? normalizeContactPhone(body.contactPhone) : null;
    if (!phone) throw new AppError("VALIDATION", { copy: "beta.contact.needed", fields: { contactPhone: body.contactPhone ? "invalid" : "missing" } });
    contact = { phone, verified: false };
  }

  // The fare moved at the airline while the traveller looked (demo: once, SAR 140; bump above).
  const priced = await (early ?? priceDraft(ownerId, body, { bump, demo }));
  const { preview } = priced;
  if (preview.holdExpiresAt && Date.parse(preview.holdExpiresAt) <= Date.now()) return { outcome: "hold_ended", preview };
  if (body.expectedTotal !== preview.total.amount) {
    return { outcome: "price_changed", previousTotal: money(body.expectedTotal), preview, changedBy: money(preview.total.amount - body.expectedTotal) };
  }
  // A passport that can't make the trip blocks the booking, unless Mada is renewing it in time: already asked, or
  // agreed on the order sheet (body.renewals, asked below once the order is in). Everything else was answered in Ask.
  let renew: string[] = [];
  if (body.draft.kind === "trip" || body.draft.kind === "stay" || priced.snapshot.quotedFlight) {
    const { checks } = await renewalsFor(ownerId, priced.snapshot.search, priced.travellers, demo);
    const blocked = checks?.checks.filter((c) => c.key === "passport" && c.blocking) ?? [];
    const agreed = new Set(body.renewals ?? []);
    const stuck = blocked.find((c) => !(c.renewal?.inTime && c.personId && agreed.has(c.personId)));
    if (stuck) return { outcome: "blocked", message: stuck.text };
    renew = blocked.map((c) => c.personId!);
  }
  const destination = (priced.snapshot.search as { destination?: string } | undefined)?.destination ?? null;

  // A share between friends is paid in full by card or Apple Pay: no instalments, no Mada credit.
  if (body.draft.kind === "share" && (body.plan !== "full" || body.payment.method === "credit")) throw new AppError("VALIDATION");

  const agentKind = AGENT_KINDS.has(preview.kind);
  // Someone in a circle pays: nothing is charged here; the order waits for them (requestPayment).
  if (body.payment.method === "someone_else") {
    if (!agentKind) throw new AppError("VALIDATION", { message: t("error.validation") });
    const asked = await requestPayment(ownerId, body, priced, body.payment, contact, demo, ipHash, await agentP);
    if ("order" in asked && asked.order) await planItemsBooked(ownerId, asked.order.id, body.draft);
    await fileRenewals(ownerId, renew, destination, ipHash);
    return asked;
  }
  const [charge, agentName] = await Promise.all([chargeFor(ownerId, body.payment, body.plan, preview.total.amount, demo), agentP]);
  const requestId = body.draft.kind === "quote" ? body.draft.requestId : null;
  // A fare or a room the desk quoted for a request: the request itself goes with the order to the desk (no new row).
  const quoted = priced.snapshot.quote as { id: string; requestId: string; optionId?: string; pnr?: string | null } | undefined;
  const quotedByDesk = (!!priced.snapshot.quotedFlight || !!priced.snapshot.quotedStay) && !!quoted;
  const f = priced.snapshot.flight as FlightOption | undefined;

  // Known before the insert, so the desk request can point at its order in the same write (Trips → Requests).
  const orderId = randomUUID();
  const res = await db.transaction(async (tx) => {
    const pay = charge.provider === "mada_credit" ? null
      : await authorize(tx, ownerId, charge, preview.total.amount, `order:${ownerId}:${body.idempotencyKey}`, preview.title, requestId);
    if (pay?.status === "declined" || pay?.status === "failed") return { outcome: "declined" as const };
    const status = pay?.status === "requires_action" ? "requires_action" : agentKind ? "pending_agent" : "paid_now";
    const order = { id: orderId, status: status === "paid_now" ? "pending_agent" : status, failure: null };
    let deskRequest: string | null = requestId;
    if (agentKind && quotedByDesk) {
      await tx.update(appRequests).set({ status: "with_agent", promisedBy: new Date(Date.now() + 30 * 60_000), updatedAt: new Date(),
        details: sql`${appRequests.details} || ${JSON.stringify({ prefs: deskPrefs(priced.snapshot), ...(contact ? { contactPhone: contact.phone, contactVerified: false } : {}) })}::jsonb` }).where(eq(appRequests.id, quoted!.requestId));
      await tx.update(appQuotes).set({ status: "accepted" }).where(eq(appQuotes.id, quoted!.id));
    } else if (agentKind) {
      const [r] = await tx.insert(appRequests).values({
        ownerId, kind: preview.kind === "stay" ? "stay" : preview.kind === "package" ? "trip" : "flight", status: "with_agent", summary: preview.title,
        travellerIds: preview.travellerIds, agentName, promisedBy: new Date(Date.now() + 15 * 60_000),
        details: { askKind: preview.kind, title: preview.title, detail: preview.lines.map((l) => l.text).join(" · "), source: "order", order, prefs: deskPrefs(priced.snapshot), ...(contact ? { contactPhone: contact.phone, contactVerified: false } : {}) },
      }).returning({ id: appRequests.id });
      deskRequest = r!.id;
    }
    const supplierId = priced.offerRows.find((r) => r.kind === "flight")?.supplierOfferId;
    const [o] = await tx.insert(appOrders).values({
      id: orderId, ownerId, kind: preview.kind, status: status === "paid_now" ? "pending_agent" : status, step: 0, idempotencyKey: body.idempotencyKey,
      draft: body.draft as Record<string, unknown>,
      snapshot: { ...priced.snapshot, flightSupplierId: supplierId ?? null, place: priced.place, photo: preview.photo, title: preview.title, preview, ...(contact ? { contact } : {}) },
      supplierRef: quoted?.pnr ?? null,
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
  // Before anything confirms it (an eSIM is confirmed just below): the plan's items point at the order first.
  await planItemsBooked(ownerId, res.order.id, body.draft);
  await fileRenewals(ownerId, renew, destination, ipHash);
  // Charged now: nothing for an agent to confirm (requests, eSIMs).
  if (res.paidNow) {
    const done = await confirmOrder(res.order.id, { name: agentName });
    // An eSIM is bought from the supplier once the card is captured; if it can't be, the order comes back refunded.
    if (done.kind === "esim" && done.status === "confirmed") return { outcome: "paid", order: orderView(await afterEsim(done, demo)) };
    return { outcome: "paid", order: orderView(done) };
  }
  // Stays in live mode (APP_STAYS_MODE=live) are booked on Hotelbeds now; in request mode the desk books them.
  if (res.order.kind === "stay") await autoBookStay(res.order.id);
  return outcomeOf(res.order);
}

/** The living plan's items this order books (its draft's planItemIds, or a quote's request): linked by the plan's listener. */
async function planItemsBooked(ownerId: string, orderId: string, draft: CreateOrderInput["draft"]) {
  const planItemIds = ("planItemIds" in draft ? draft.planItemIds : undefined) ?? [];
  const requestId = draft.kind === "quote" ? draft.requestId : null;
  await emitPlanEvent({ kind: "order.created", orderId, ownerId, planItemIds, requestId });
}

/** "Book now, Mada renews it": each agreed renewal becomes its own request with the desk (priced and paid there). */
async function fileRenewals(ownerId: string, personIds: string[], destination: string | null, ipHash: string | null) {
  for (const personId of personIds) {
    await createRequest(ownerId, { kind: "visa", travellerIds: [personId], service: "passport_renewal", serviceFor: { personId, need: null, destination }, answers: {}, needs: {}, note: "", query: "" }, ipHash);
  }
}

async function afterEsim(o: OrderRow, demo: Set<DemoFlag>): Promise<OrderRow> {
  await fulfilEsimOrder(o.id, { demoFail: demo.has("esimFails") });
  return (await db.select().from(appOrders).where(eq(appOrders.id, o.id)))[0] ?? o;
}

function outcomeOf(o: OrderRow): CreateOrderResponse {
  if (o.status === "payment_requested") return { outcome: "payment_requested", order: orderView(o) };
  if (o.status === "requires_action") return { outcome: "requires_action", order: orderView(o) };
  if (o.status === "declined") return { outcome: "declined", message: t("pay.declined.body") };
  // An eSIM the supplier couldn't give was paid and refunded: the same answer, with its outcome.
  if (!AGENT_KINDS.has(o.kind) && (o.status === "confirmed" || (o.kind === "esim" && o.status === "cancelled"))) return { outcome: "paid", order: orderView(o) };
  return { outcome: "created", order: orderView(o) };
}

/** The bank's code (3-D Secure). Three wrong codes and the bank stops the payment: nothing was charged. */
export async function submitOtp(ownerId: string, id: string, code: string): Promise<OrderView> {
  const o = await ownOrder(ownerId, id);
  if (o.status !== "requires_action" || !o.paymentId) throw new AppError("VALIDATION");
  const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  const answer = await bookingSuppliers.payments().completeAction(p!.providerRef!, code);
  // The third wrong code stops the payment. Counted on the order, so it holds across server instances.
  const r = answer.status === "requires_action" && o.otpTries + 1 >= 3 ? { ...answer, status: "declined" as const, triesLeft: 0, declineReason: "3ds_failed" } : answer;
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
  if (status === "paid_now") {
    const done = await confirmOrder(o.id, { name: o.agentName ?? (await agentFor(ownerId)) });
    return orderView(done.kind === "esim" && done.status === "confirmed" ? await afterEsim(done, new Set(o.demo as DemoFlag[])) : done);
  }
  return orderView(await ownOrder(ownerId, id));
}

/** The bank's code didn't come: ask it for another, three times at most, with a record the desk can see. */
const RESENDS = 3;
async function resendCode(ownerId: string, o: OrderRow): Promise<OrderView> {
  if (o.status !== "requires_action" || !o.paymentId) throw new AppError("VALIDATION");
  const [{ n }] = (await db.select({ n: sql<number>`count(*)::int` }).from(appOrderEvents).where(and(eq(appOrderEvents.orderId, o.id), eq(appOrderEvents.kind, "otp_resent")))) as [{ n: number }];
  if (n >= RESENDS) throw new AppError("RATE_LIMITED", { retryAfter: 600 });
  const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  const pay = bookingSuppliers.payments();
  const r = pay.resendCode ? await pay.resendCode(p!.providerRef!) : { sent: false };
  await db.transaction(async (tx) => {
    await orderEvent(tx, o.id, "otp_resent", { kind: "user" }, { sent: r.sent });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "payment.3ds_resend", entityType: "app_payment", entityId: p!.id, summary: "Asked the bank for a new code" });
  });
  return orderView(await ownOrder(ownerId, o.id));
}

export async function answerOrder(ownerId: string, id: string, answer: "yes" | "call" | "accept_fare" | "stop" | "retry_by_phone" | "cancel" | "remind" | "resend_code"): Promise<OrderView> {
  const o = await ownOrder(ownerId, id);
  let u: OrderRow;
  if (answer === "remind") return remindPayer(ownerId, id);
  if (answer === "resend_code") return resendCode(ownerId, o);
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
  const rows = await db.select().from(appOrders).where(and(eq(appOrders.ownerId, ownerId), inArray(appOrders.status, ["payment_requested", "requires_action", "pending_agent", "held", "price_locked", "issuing", "needs_answer", "fare_changed", "ticketing_failed", "confirmed"])))
    .orderBy(desc(appOrders.createdAt)).limit(10);
  const out: OrderView[] = [];
  for (const r of rows) {
    const a = await advance(r);
    if (a.status !== "confirmed" || (a.confirmedAt && Date.now() - a.confirmedAt.getTime() < 10 * 60_000)) out.push(orderView(a));
  }
  return out;
}

/* ───────────── someone else pays (owner audit item 31) ───────────── */

type PriceOf = Awaited<ReturnType<typeof priceDraft>>;

/**
 * "Ask Abdullah to pay": the order is written without a payment, status 'payment_requested', and a split for the
 * whole amount goes into the circle with Abdullah's share unpaid, so the circle's own "Pay my share" is the pay link.
 * The desk sees the request as waiting for payment. When Abdullah pays (fundRequestedOrder), it becomes a normal
 * order with the desk.
 */
async function requestPayment(ownerId: string, body: CreateOrderInput, priced: PriceOf, pay: { userId: string; circleId: string }, contact: { phone: string; verified: false } | null, demo: Set<DemoFlag>, ipHash: string | null, agentName: string): Promise<CreateOrderResponse> {
  const { preview } = priced;
  if (pay.userId === ownerId) throw new AppError("VALIDATION", { fields: { userId: "yourself" } });
  if (preview.credit.used.amount > 0) throw new AppError("VALIDATION", { message: t("error.validation") }); // credit is the owner's: a friend pays the full price
  await membership(pay.circleId, ownerId);
  const members = await memberIds(pay.circleId);
  if (!members.includes(pay.userId)) throw new AppError("VALIDATION", { fields: { userId: "not_in_circle" } });
  const payee = (await peopleByIds([pay.userId])).get(pay.userId);
  const orderId = randomUUID();
  const f = priced.snapshot.flight as FlightOption | undefined;
  const requestedAt = new Date().toISOString();
  // The split first (its own transaction, Circles' own rules), then the order that points at it.
  const msg = await createSplit(pay.circleId, ownerId, {
    what: t("mp.split.what", { title: preview.title }).slice(0, 40), total: preview.total.amount, paidBy: ownerId, mode: "custom", between: [ownerId, pay.userId], custom: { [ownerId]: 0, [pay.userId]: preview.total.amount },
  }, ipHash, { orderId });
  const payRequest: PayRequest = { userId: pay.userId, name: payee?.short ?? t("circles.someone"), circleId: pay.circleId, messageId: msg.id, shareKey: pay.userId, requestedAt, paidAt: null };
  const order = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      ownerId, kind: preview.kind === "stay" ? "stay" : preview.kind === "package" ? "trip" : "flight", status: "awaiting_payment", summary: preview.title,
      travellerIds: preview.travellerIds, agentName, promisedBy: null,
      details: { askKind: preview.kind, title: preview.title, detail: preview.lines.map((l) => l.text).join(" · "), source: "order", order: { id: orderId, status: "payment_requested", failure: null }, payRequest, prefs: deskPrefs(priced.snapshot), ...(contact ? { contactPhone: contact.phone, contactVerified: false } : {}) },
    }).returning({ id: appRequests.id });
    const supplierId = priced.offerRows.find((x) => x.kind === "flight")?.supplierOfferId;
    const [o] = await tx.insert(appOrders).values({
      id: orderId, ownerId, kind: preview.kind, status: "payment_requested", step: 0, idempotencyKey: body.idempotencyKey,
      draft: body.draft as Record<string, unknown>,
      snapshot: { ...priced.snapshot, flightSupplierId: supplierId ?? null, place: priced.place, photo: preview.photo, title: preview.title, preview, payRequest, ...(contact ? { contact } : {}) },
      lines: preview.lines, travellerIds: preview.travellerIds, subtotal: preview.subtotal.amount, discount: preview.promo?.status === "applied" ? preview.promo.discount.amount : 0,
      promo: preview.promo?.status === "applied" ? preview.promo.code : null, creditUsed: 0, total: preview.total.amount, plan: "full",
      paymentLabel: t("mp.method", { name: payRequest.name }), paymentMethod: { method: "someone_else", userId: pay.userId, circleId: pay.circleId, plan: "full", provider: "circle" },
      paymentId: null, requestId: r!.id, agentName, demo: [...demo], autopilotAt: null,
    }).returning();
    await orderEvent(tx, o!.id, "payment_requested", { kind: "user" }, { userId: pay.userId, circleId: pay.circleId });
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "order.payment_requested", entityType: "app_order", entityId: o!.id, summary: `Asked ${payRequest.name} to pay ${preview.total.amount} halalas for ${preview.title}`, ipHash });
    return o!;
  });
  void f;
  return { outcome: "payment_requested", order: orderView(order) };
}

/**
 * The friend paid their share by card (circles/messages.ts markPaid calls this): the order carries their payment
 * and goes to the desk like any other. Idempotent: a second call finds the order already moved.
 */
export async function fundRequestedOrder(orderId: string, payerId: string, paymentId: string | null): Promise<void> {
  const [o] = await db.select().from(appOrders).where(eq(appOrders.id, orderId));
  if (!o || o.status !== "payment_requested") return;
  const pr = (o.snapshot as { payRequest?: PayRequest }).payRequest;
  if (!pr || pr.userId !== payerId) return;
  const now = new Date();
  const agentName = o.agentName ?? (await agentFor(o.ownerId));
  const updated = await db.transaction(async (tx) => {
    const [u] = await tx.update(appOrders).set({
      status: "pending_agent", paymentId, snapshot: { ...(o.snapshot as object), payRequest: { ...pr, paidAt: now.toISOString() } }, agentName,
      autopilotAt: autopilotOn() ? new Date(Date.now() + tick(new Set(o.demo as DemoFlag[]))) : null, updatedAt: now,
    }).where(and(eq(appOrders.id, o.id), eq(appOrders.status, "payment_requested"))).returning();
    if (!u) return null;
    if (o.requestId) {
      await tx.update(appRequests).set({ status: "with_agent", promisedBy: new Date(Date.now() + 15 * 60_000), updatedAt: now,
        details: sql`${appRequests.details} || ${JSON.stringify({ order: { id: o.id, status: "pending_agent", failure: null }, payRequest: { ...pr, paidAt: now.toISOString() } })}::jsonb` }).where(eq(appRequests.id, o.requestId));
    }
    await orderEvent(tx, o.id, "authorised", { kind: "user", name: pr.name }, { by: payerId, paymentId });
    await appAuditLog(tx, { actorKind: "user", actorId: payerId, action: "order.paid_by_friend", entityType: "app_order", entityId: o.id, summary: `${pr.name} paid ${o.total} halalas for ${(o.snapshot as { title?: string }).title ?? "a booking"}` });
    return u;
  });
  if (!updated) return;
  await notify(o.ownerId, { kind: "other", level: "active", copy: "notify.mp.paid", vars: { name: pr.name }, href: `/waiting/${o.id}` }).catch(() => {});
  if (updated.kind === "stay") await autoBookStay(updated.id).catch(() => {});
}

/** The owner nudges the friend: the circle's own reminder (once a day), from the order. */
export async function remindPayer(ownerId: string, id: string): Promise<OrderView> {
  const o = await ownOrder(ownerId, id);
  const pr = (o.snapshot as { payRequest?: PayRequest }).payRequest;
  if (o.status !== "payment_requested" || !pr) throw new AppError("VALIDATION");
  await remindSplit(pr.circleId, ownerId, pr.messageId);
  return orderView(o);
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
      case "issuing": {
        // A quoted fare: the mock desk records a PNR and a ticket number each, as a person would on the desk.
        const snap = o.snapshot as { quotedFlight?: unknown; tickets?: string[] };
        if (snap.quotedFlight && !snap.tickets?.length) {
          const tickets = o.travellerIds.map(() => `065${String(randomInt(1e9, 1e10))}`);
          await db.update(appOrders).set({ supplierRef: o.supplierRef ?? newRef(), snapshot: { ...(o.snapshot as object), tickets } }).where(eq(appOrders.id, o.id));
        }
        return await issueTickets(o.id, agent);
      }
      default:
        return null;
    }
  } catch (e) {
    if (e instanceof AppError) return null;
    throw e;
  }
}
