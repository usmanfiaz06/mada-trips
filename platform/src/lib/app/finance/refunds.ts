import "server-only";
import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { REFUND_BANK_WORKING_DAYS, addWorkingDays, type RefundClear } from "@mada/shared";
import { db, schema, type Tx } from "@/db";
import { appPayments, appRefunds } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { supplierMode } from "@/lib/app/config";
import { bookingSuppliers } from "@/lib/app/booking/common";
import { flightBookingOf, supplierFlightOf } from "@/lib/app/booking/supplier-flights";
import { cancelSupplierBooking } from "@/lib/app/suppliers/hotelbeds/bookings";
import { feeHalalas } from "@/lib/app/suppliers/hotelbeds/money";
import type { TicketingFlightSupplier } from "@/lib/app/suppliers/flight-ticketing";
import { notify } from "@/lib/app/trips/notify";
import { approveRefund, refundableLeft } from "@/lib/app/desk/adapters";
import { assertCap, deskAudit, DeskError, sarText, shortRef, type DeskActor } from "@/lib/app/desk/core";
import { postAppRefund } from "./ops-posting";
import { auditAuto, notifyGroupStep, sendAutoCardRefunds, syncRefundGroup } from "./refund-groups";
import { decideAuto } from "./auto-approve";
import { CAPTURED } from "./costs";

/*
 * Refunds after the decision (DESK-PLAN U6). The decision itself (partial amounts, the agent's limits, the lead's
 * approval) is approveRefund in lib/app/desk/adapters.ts; this file moves a refund on from there:
 *
 *   requested ─approve (within limits)──▶ approved (card) ─provider confirms──▶ sent ─settlement file──▶ settled
 *       │                               └▶ sent (Mada Wallet, at once)
 *       └─approve (over a limit)──▶ awaiting_lead ─lead approves in Ops Approvals──▶ lead_approved ─sent by the job──▶ approved/sent
 *                                                  └─lead declines──▶ requested (the desk decides again)
 *   approved ─provider says failed──▶ requested (with a note: refund to the Mada Wallet, or try again)
 *
 * When the rules are clear a trip refund skips the decision (auto-approve.ts): straight to approved (card) or sent
 * (Mada Wallet), tagged Auto with the rule that allowed it. Every move here also moves the traveller's refund group
 * (refund-groups.ts), which is what the Requests tracker shows and what the one push per step follows.
 *
 * The finance job (lib/app/jobs.ts "finance", every 5 minutes) runs sendLeadApproved and refundsSentJob. Card refunds
 * are confirmed with the provider's refund status (MyFatoorah GetRefundStatus; the mock answers at once). Instalment
 * providers (Tabby, Tamara) have no status call yet: the desk marks those sent by hand with the provider's reference.
 */

const SEEDED = /^mf_seed_/;

/** Ops Approvals decided an app refund above an agent's limit (lib/approvals.ts applyOutcome). */
export async function applyRefundApproval(tx: Tx, req: typeof schema.approvalRequests.$inferSelect, outcome: "approved" | "rejected" | "cancelled", actorId: string) {
  const [f] = await tx.select().from(appRefunds).where(eq(appRefunds.id, req.entityId)).for("update");
  if (!f || f.stage !== "awaiting_lead" || f.approvalId !== req.id) return;
  const ok = outcome === "approved";
  await tx.update(appRefunds).set({ stage: ok ? "lead_approved" : "requested", approvalId: ok ? req.id : null, updatedAt: new Date() }).where(eq(appRefunds.id, f.id));
  await tx.insert(schema.auditEvents).values({ actorId, action: ok ? "desk.refund.lead_approved" : "desk.refund.lead_declined", entityType: "desk", entityId: f.id, entityRef: req.ref,
    summary: ok ? `${req.ref} approved: the app refund of ${sarText(req.amount)} is being sent` : `${req.ref} ${outcome}: the app refund of ${sarText(req.amount)} is back with the desk to decide` });
}

/** The person who approved a request, as a desk actor (they act on the refund the job sends for them). */
async function approverOf(approvalId: string): Promise<DeskActor | null> {
  const [d] = await db.select({ id: schema.users.id, name: schema.users.name, perms: schema.roles.permissions })
    .from(schema.approvalDecisions).innerJoin(schema.users, eq(schema.users.id, schema.approvalDecisions.userId)).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.approvalDecisions.requestId, approvalId), eq(schema.approvalDecisions.decision, "approve"))).orderBy(desc(schema.approvalDecisions.createdAt)).limit(1);
  return d ? { id: d.id, name: d.name, permissions: new Set(d.perms) } : null;
}

/** Send refunds a lead approved: to the card (or credit) as the agent asked, on the lead's name. */
export async function sendLeadApproved(): Promise<{ sent: number; failed: number }> {
  const rows = await db.select().from(appRefunds).where(eq(appRefunds.stage, "lead_approved")).orderBy(asc(appRefunds.updatedAt)).limit(50);
  let sent = 0, failed = 0;
  for (const f of rows) {
    const [req] = f.approvalId ? await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, f.approvalId)) : [];
    const p = (req?.payload ?? {}) as { destination?: "original" | "credit"; amount?: number; note?: string | null };
    const lead = req ? await approverOf(req.id) : null;
    if (!req || !lead) { failed += 1; continue; }
    try {
      await approveRefund(lead, f.id, { destination: p.destination === "credit" ? "credit" : "original", amount: p.amount ?? f.amount, note: p.note ?? null, viaApproval: req.id });
      sent += 1;
    } catch (e) {
      failed += 1;
      console.error("[finance] lead-approved refund not sent", f.id, e instanceof Error ? e.message : "");
    }
  }
  return { sent, failed };
}

/** Run the lead's approved refund now, from the desk (the same as the job does). */
export async function sendApprovedNow(actor: DeskActor, id: string) {
  assertCap(actor, "desk.refund");
  const [f] = await db.select().from(appRefunds).where(eq(appRefunds.id, id));
  if (!f || f.stage !== "lead_approved") throw new DeskError("This refund isn't waiting to be sent", "CONFLICT");
  const r = await sendLeadApproved();
  if (!r.sent) throw new DeskError("It didn't go through. The card refund may have failed: try again in a minute", "CONFLICT");
}

type SentResult = { checked: number; sent: number; pending: number; failed: number };

/**
 * approved → sent: ask the provider about every card refund still on its way. Sent: the traveller is told (once) and
 * the refund goes to Ops payments. Failed: back to the desk to decide again. Pending: asked again next run.
 */
export async function refundsSentJob(now = new Date()): Promise<SentResult> {
  const rows = await db.select({ f: appRefunds, p: appPayments }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
    .where(and(eq(appRefunds.stage, "approved"), eq(appRefunds.destination, "original"), isNotNull(appRefunds.providerRef)))
    .orderBy(asc(appRefunds.checkedAt)).limit(100);
  const out: SentResult = { checked: rows.length, sent: 0, pending: 0, failed: 0 };
  const pay = bookingSuppliers.payments();
  for (const { f, p } of rows) {
    let status: "refunded" | "pending" | "failed" | "unknown" = "unknown";
    let reference: string | null = null;
    if (supplierMode("payments") === "mock" && p.providerRef && SEEDED.test(p.providerRef)) status = f.providerRef!.includes("pending") ? "pending" : "refunded";
    else if (pay.refundStatus && p.providerRef) {
      try { const r = await pay.refundStatus(p.providerRef, f.providerRef!); status = r.status; reference = r.reference ?? null; }
      catch { status = "unknown"; }
    }
    if (status === "refunded") { if (await markSent(null, f.id, { reference, at: now })) out.sent += 1; }
    else if (status === "failed") { await refundFailed(f.id, now); out.failed += 1; }
    else {
      out.pending += 1;
      await db.update(appRefunds).set({ checkedAt: now, checks: sql`${appRefunds.checks} + 1` }).where(eq(appRefunds.id, f.id));
    }
  }
  return out;
}

/** approved → sent, once: by the job (actor null) or by hand from the desk with the provider's reference. */
async function markSent(actor: DeskActor | null, id: string, v: { reference?: string | null; at?: Date }): Promise<boolean> {
  const at = v.at ?? new Date();
  const done = await db.transaction(async (tx) => {
    const [x] = await tx.select({ f: appRefunds, p: appPayments }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
      .where(eq(appRefunds.id, id)).for("update", { of: appRefunds });
    if (!x || x.f.stage !== "approved") return null;
    const bankRef = v.reference?.trim() || null;
    await tx.update(appRefunds).set({ stage: "sent", sentAt: at, checkedAt: at, checks: sql`${appRefunds.checks} + 1`, providerRef: bankRef || x.f.providerRef, bankReference: bankRef ?? x.f.bankReference, updatedAt: at }).where(eq(appRefunds.id, id));
    const summary = `The card refund of ${sarText(x.f.amount)} reached ${x.p.label ?? "the card"}${actor ? ` (marked by hand${v.reference ? `, reference ${v.reference}` : ""})` : " (the provider confirmed it)"}`;
    if (actor) await deskAudit(tx, actor, { action: "desk.refund.sent", entityType: "refund", entityId: id, ref: shortRef(id, "F"), summary });
    else await tx.insert(schema.auditEvents).values({ actorId: null, action: "desk.refund.sent", entityType: "desk", entityId: id, entityRef: shortRef(id, "F"), summary });
    // A trip refund tells the traveller once for the whole refund (with the bank's reference); an order's refund once for itself.
    const step = await syncRefundGroup(tx, id, at);
    if (step) { if (step.changed) await notifyGroupStep(tx, step.group); }
    else await notify(x.p.ownerId, { kind: "refund_moved", level: "active", copy: bankRef ? "notify.refundRef" : "notify.refund", vars: { amount: sarText(x.f.amount), card: x.p.label ?? "card", ...(bankRef ? { ref: bankRef } : {}) }, href: x.p.requestId ? `/requests/${x.p.requestId}` : null, data: { refundId: id } }, tx);
    return x;
  });
  if (done) await postAppRefund(id).catch((e) => console.error("[finance] refund not posted to Ops", id, e instanceof Error ? e.message : ""));
  return !!done;
}

/** The desk marks a card refund sent by hand (an instalment provider, or the provider's portal shows it done). */
export async function markRefundSent(actor: DeskActor, id: string, reference: string) {
  assertCap(actor, "desk.refund");
  const ref = reference.trim();
  if (ref.length < 3) throw new DeskError("Give the provider's refund reference");
  if (!(await markSent(actor, id, { reference: ref }))) throw new DeskError("Only an approved card refund can be marked sent", "CONFLICT");
}

async function refundFailed(id: string, at: Date) {
  await db.transaction(async (tx) => {
    const [f] = await tx.select().from(appRefunds).where(eq(appRefunds.id, id)).for("update");
    if (!f || f.stage !== "approved") return;
    await tx.update(appRefunds).set({ stage: "requested", note: "The card refund failed at the provider. Refund to the Mada Wallet, or approve again", decidedBy: null, decidedAt: null, autoRule: null, checkedAt: at, updatedAt: at }).where(eq(appRefunds.id, id));
    await syncRefundGroup(tx, id, at);
    const [p] = await tx.select().from(appPayments).where(eq(appPayments.id, f.paymentId));
    const [s] = await tx.select({ s: sql<number>`coalesce(sum(${appRefunds.amount}),0)::bigint` }).from(appRefunds).where(and(eq(appRefunds.paymentId, f.paymentId), inArray(appRefunds.stage, ["approved", "sent", "settled"])));
    if (p) await tx.update(appPayments).set({ status: Number(s?.s ?? 0) === 0 ? "captured" : Number(s!.s) >= p.amount ? "refunded" : "partially_refunded", updatedAt: at }).where(eq(appPayments.id, p.id));
    await tx.insert(schema.auditEvents).values({ actorId: null, action: "desk.refund.failed", entityType: "desk", entityId: id, entityRef: shortRef(id, "F"), summary: `The card refund of ${sarText(f.amount)} failed at the provider; it is back with the desk` });
  });
}

/* ───────────── desk-started cancel and refund ───────────── */

export type DeskCancelOption =
  | { kind: "hotelbeds"; id: string; product: string; supplierRef: string; label: string }
  | { kind: "tbo"; pnr: string | null; label: string }
  | { kind: "none"; label: string };

/** A captured app booking the desk can cancel and refund: its payment, what is left to refund, and what can be cancelled. */
export async function refundTarget(ref: string) {
  const q = ref.trim().toUpperCase();
  if (!q) return null;
  const [o] = await db.select().from(appOrders).where(sql`upper(${appOrders.ref}) = ${q} OR ${appOrders.id}::text = ${ref.trim()}`).limit(1);
  if (!o?.paymentId) return null;
  const [p] = await db.select().from(appPayments).where(eq(appPayments.id, o.paymentId));
  if (!p || !(CAPTURED as readonly string[]).includes(p.status)) return { order: o, payment: p ?? null, left: 0, options: [] as DeskCancelOption[] };
  // What is left counts refunds still to decide, so the desk never opens a second one for the same money.
  const left = await refundableLeft(db, p, null, { withRequested: true });
  const options: DeskCancelOption[] = [];
  const hb = await db.select().from(appSupplierBookings).where(and(inArray(appSupplierBookings.sourceId, [o.id, ...(o.requestId ? [o.requestId] : [])]), eq(appSupplierBookings.status, "confirmed")));
  for (const b of hb) if (b.supplierRef) options.push({ kind: "hotelbeds", id: b.id, product: b.product, supplierRef: b.supplierRef, label: `Hotelbeds ${b.product} ${b.supplierRef}` });
  const fb = flightBookingOf(o);
  const pnr = fb?.parts.map((x) => x.pnr).filter(Boolean).join(" / ") || null;
  if (fb && supplierFlightOf(o)) options.push({ kind: "tbo", pnr, label: `TBO flight${pnr ? ` ${pnr}` : ""}` });
  options.push({ kind: "none", label: "Refund only (nothing to cancel with a supplier)" });
  return { order: o, payment: p, left, options };
}

export type DeskRefundInput = { orderRef: string; cancel: string; amount?: number | null; reason: string; confirm: boolean };
export type DeskRefundResult =
  | { preview: true; fee: number; supplierFee: { amount: number; currency: string | null } | null; refund: number; note: string }
  | { preview: false; refundId: string; refund: number; note: string; auto?: boolean };

/**
 * Cancel an app booking with its supplier and open the refund, from the desk. Hotelbeds: simulate first (what the hotel
 * keeps), then cancel; the refund is what was paid less that fee, in proportion. TBO: release the hold or ask for the
 * refund (the airline's rules decide what comes back), and the desk enters the amount to give back. The refund then
 * goes through the same decision as any other (limits, lead approval, card or Mada Wallet), unless the supplier cancelled
 * it free or released the hold and all of it comes back: then the rules approve it at once (auto-approve.ts).
 * `flightSupplier` is for tests.
 */
export async function startDeskRefund(actor: DeskActor, v: DeskRefundInput, deps: { flightSupplier?: TicketingFlightSupplier } = {}): Promise<DeskRefundResult> {
  assertCap(actor, "desk.refund");
  const reason = v.reason.trim();
  if (v.confirm && reason.length < 5) throw new DeskError("Say why, in a few words (the traveller reads it)");
  const t = await refundTarget(v.orderRef);
  if (!t || !t.payment) throw new DeskError("No paid app booking with that reference", "NOT_FOUND");
  if (t.left <= 0) throw new DeskError("Everything paid on this booking has already been refunded", "CONFLICT");
  const opt = t.options.find((o) => (o.kind === "hotelbeds" ? `hotelbeds:${o.id}` : o.kind) === v.cancel);
  if (!opt) throw new DeskError("Pick what to cancel");

  let refund = v.amount ?? null;
  let note = "";
  let clear: RefundClear = null;
  if (opt.kind === "hotelbeds") {
    const [row] = await db.select().from(appSupplierBookings).where(eq(appSupplierBookings.id, opt.id));
    const sim = await cancelSupplierBooking(opt.id, { name: actor.name, opsUserId: actor.id }, { confirm: false }).catch((e) => { throw new DeskError(e instanceof Error ? e.message : "Hotelbeds didn't answer", "CONFLICT"); });
    const net = Number(row?.net ?? 0);
    const paidForIt = Math.min(t.left, row?.sell ?? t.left);
    const fee = sim.amount > 0 ? feeHalalas(sim.amount, net || sim.amount, paidForIt) : 0;
    const back = Math.max(0, paidForIt - fee);
    if (!v.confirm) return { preview: true, fee, supplierFee: { amount: sim.amount, currency: sim.currency }, refund: back, note: sim.amount > 0 ? `Hotelbeds keeps ${sim.amount} ${sim.currency ?? ""}`.trim() : "Free to cancel" };
    const done = await cancelSupplierBooking(opt.id, { name: actor.name, opsUserId: actor.id }, { confirm: true }).catch((e) => { throw new DeskError(e instanceof Error ? e.message : "Hotelbeds didn't cancel it", "CONFLICT"); });
    refund = refund ?? back;
    if (done.amount === 0 && refund === back) clear = "free";
    note = `Cancelled on Hotelbeds ${opt.supplierRef}${done.amount > 0 ? ` (fee ${done.amount} ${done.currency ?? ""})` : " (free)"}`;
  } else if (opt.kind === "tbo") {
    if (!v.confirm) return { preview: true, fee: 0, supplierFee: null, refund: refund ?? t.left, note: "TBO asks the airline: what comes back follows the fare rules. Enter what to refund." };
    const sf = supplierFlightOf(t.order);
    const supplier = deps.flightSupplier ?? sf?.supplier;
    const ref = flightBookingOf(t.order);
    if (!supplier || !ref) throw new DeskError("This flight isn't booked with TBO from the app", "CONFLICT");
    const r = await supplier.cancel(ref, `Mada desk: ${reason}`.slice(0, 120)).catch((e) => { throw new DeskError(e instanceof Error ? e.message : "TBO didn't answer", "CONFLICT"); });
    if (r.released && refund === t.left) clear = "supplier_confirmed";
    note = r.released ? `Released the hold on TBO${ref.parts[0]?.pnr ? ` ${ref.parts[0].pnr}` : ""}` : `Refund asked of TBO${r.changeRequestIds.length ? ` (change request ${r.changeRequestIds.join(", ")})` : ""}`;
  } else if (!v.confirm) {
    return { preview: true, fee: 0, supplierFee: null, refund: refund ?? t.left, note: "Nothing is cancelled with a supplier." };
  }
  if (!refund || !Number.isInteger(refund) || refund <= 0) throw new DeskError("Enter the amount to refund");
  if (refund > t.left) throw new DeskError(`Only ${sarText(t.left)} is left to refund on this booking`);

  // The supplier cancelled it free (or released the hold) and the amount is all of it: the rules approve it at once.
  const auto = await decideAuto(db, { userId: t.payment.ownerId, clear, destination: "original", amount: refund });
  const id = await db.transaction(async (tx) => {
    const now = new Date();
    const [f] = await tx.insert(appRefunds).values({ paymentId: t.payment!.id, amount: refund!, stage: auto.ok ? "approved" : "requested", origin: "desk", reason, note: note || null,
      autoRule: auto.ok ? auto.rule : null, decidedAt: auto.ok ? now : null, expectedBy: auto.ok ? addWorkingDays(now, REFUND_BANK_WORKING_DAYS) : null }).returning({ id: appRefunds.id });
    await deskAudit(tx, actor, { action: "desk.refund.started", entityType: "refund", entityId: f!.id, ref: t.order.ref ?? shortRef(f!.id, "F"),
      summary: `Started a refund of ${sarText(refund!)} on ${t.order.ref ?? "an app booking"}${note ? `: ${note}` : ""}`, data: { amount: refund, cancel: v.cancel } });
    if (auto.ok) await auditAuto(tx, { ownerId: t.payment!.ownerId, groupId: null, refundIds: [f!.id], amount: refund!, rule: auto.rule, destination: "original" });
    return f!.id;
  });
  if (auto.ok && (await sendAutoCardRefunds([id]))) {
    await notify(t.payment.ownerId, { kind: "refund_moved", level: "active", copy: "notify.refundApproved", vars: { amount: sarText(refund), card: t.payment.label ?? "card" }, href: t.payment.requestId ? `/requests/${t.payment.requestId}` : null, data: { refundId: id } });
  }
  return { preview: false, refundId: id, refund, note, auto: auto.ok };
}
