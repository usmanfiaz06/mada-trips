import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, sql } from "drizzle-orm";
import {
  SELLER, creditLines, formatSar, invoiceHtml, invoiceLinesFor, invoiceNumber, outSegment, refundQuoteItems, zatcaQr, addDays,
  type Company, type CreateRefundRequest, type InvoiceDoc, type RefundView, type TripDetail, type TripPayment, type TripPaymentItem,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appInvoices, appPayments, appRefunds, appStays, appUsers } from "@/db/app-schema";
import { appOrders, appTripBookings } from "@/db/app-schema-booking";
import { appInvoiceCounters, appInvoiceDetails, appRefundGroups, appRefundItems, appTripCharges, appTripFacts, type InstalmentRow, type InvoiceLineRow } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { addCredit } from "../credit";
import { supplierMode } from "../config";
import { AppError } from "../http";
import type { Exec } from "./core";
import { insertRequest } from "./requests";
import { notify } from "./notify";

/*
 * The money side of a trip: one charge per thing paid for (flight, stay, pickups, a change, an extra), each with its
 * own invoice. Simplified tax invoices by default; a full tax invoice for a company on request; a credit note for
 * every refund. VAT 15% on taxable lines; air fares are zero-rated (international transport).
 */

type ChargeRow = typeof appTripCharges.$inferSelect;
const SAR = (amount: number) => ({ amount, currency: "SAR" as const });

/** The next number in a series (gapless per series and year; the row lock serialises concurrent issues). */
async function nextNumber(tx: Exec, kind: "simplified" | "tax" | "credit_note", at: Date): Promise<string> {
  const year = Number(new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Riyadh", year: "numeric" }).format(at));
  const series = invoiceNumber(kind, year, 0).slice(0, 5);
  const [row] = await tx.insert(appInvoiceCounters).values({ series, next: 2 })
    .onConflictDoUpdate({ target: appInvoiceCounters.series, set: { next: sql`${appInvoiceCounters.next} + 1` } })
    .returning({ next: appInvoiceCounters.next });
  return invoiceNumber(kind, year, row!.next - 1);
}

type IssueInput = {
  ownerId: string; tripId: string | null; chargeId: string | null; paymentId: string | null; kind: "simplified" | "tax" | "credit_note"; status: "draft" | "issued";
  customer: string; company: Company | null; lines: InvoiceLineRow[]; againstInvoiceId: string | null; paidWith: string | null; at?: Date;
};

export async function issueInvoice(tx: Exec, o: IssueInput) {
  const at = o.at ?? new Date();
  const number = o.status === "draft" ? `DRAFT-${randomUUID().slice(0, 8).toUpperCase()}` : await nextNumber(tx, o.kind, at);
  const total = o.lines.reduce((a, l) => a + l.gross, 0);
  const vat = o.lines.reduce((a, l) => a + l.vat, 0);
  const [inv] = await tx.insert(appInvoices).values({
    ownerId: o.ownerId, number, tripId: o.tripId, paymentId: o.paymentId, total, vat, issuedAt: at, zatcaStatus: o.status === "draft" ? "not_required" : "pending",
  }).returning();
  await tx.insert(appInvoiceDetails).values({
    invoiceId: inv!.id, chargeId: o.chargeId, kind: o.kind, status: o.status, customer: o.customer, company: o.company, againstInvoiceId: o.againstInvoiceId, paidWith: o.paidWith, lines: o.lines,
  });
  await appAuditLog(tx, {
    actorKind: "user", actorId: o.ownerId, action: o.status === "draft" ? "invoice.drafted" : "invoice.issued", entityType: "app_invoice", entityId: inv!.id,
    summary: `${o.kind === "credit_note" ? "Credit note" : o.kind === "tax" ? "Tax invoice" : "Invoice"} ${number} for ${formatSar(total)}`, data: { kind: o.kind, total, vat },
  });
  return inv!;
}

export type ChargeInput = {
  ownerId: string; tripId: string; paymentId: string | null; requestId?: string | null; item: TripPaymentItem; title: string; sub: string; amount: number;
  method: string; label: string | null; plan?: "full" | "tabby" | "tamara"; instalments?: InstalmentRow[] | null; creditUsed?: number; discount?: number;
  lineLabel?: string; zeroRated?: boolean; paidAt?: Date; customer: string;
};

/** A paid charge and its simplified tax invoice, in one transaction. */
export async function createCharge(tx: Exec, trip: TripDetail, c: ChargeInput): Promise<ChargeRow> {
  const lines = invoiceLinesFor(c.item, c.amount, { trip, title: c.title, discount: c.discount, label: c.lineLabel, zeroRated: c.zeroRated });
  const [row] = await tx.insert(appTripCharges).values({
    tripId: c.tripId, ownerId: c.ownerId, paymentId: c.paymentId, requestId: c.requestId ?? null, item: c.item, title: c.title, sub: c.sub, amount: c.amount,
    method: c.method, label: c.label, plan: c.plan ?? "full", instalments: c.instalments ?? null, creditUsed: c.creditUsed ?? 0, discount: c.discount ?? 0, lines, paidAt: c.paidAt ?? new Date(),
  }).returning();
  const inv = await issueInvoice(tx, {
    ownerId: c.ownerId, tripId: c.tripId, chargeId: row!.id, paymentId: c.paymentId, kind: "simplified", status: "issued", customer: c.customer, company: null, lines,
    againstInvoiceId: null, paidWith: paidWith(c.method, c.label, c.plan ?? "full", c.creditUsed ?? 0), at: c.paidAt,
  });
  await tx.update(appTripCharges).set({ invoiceId: inv.id }).where(eq(appTripCharges.id, row!.id));
  return { ...row!, invoiceId: inv.id };
}

const paidWith = (method: string, label: string | null, plan: string, credit: number) =>
  (plan === "tabby" ? "Tabby · 4 payments" : plan === "tamara" ? "Tamara · 3 payments" : label ?? method) + (credit ? ` and ${formatSar(credit)} Mada credit` : "");

export function customerOf(trip: TripDetail, fallback = "The traveller") {
  return trip.travellers[0]?.fullName || fallback;
}

/**
 * Trips booked through the order sheet (M2) carry one payment for the whole order and its lines; the first time the
 * trip's money is read, those lines become charges with their invoices.
 */
export async function ensureCharges(trip: TripDetail): Promise<void> {
  const [have] = await db.select({ id: appTripCharges.id }).from(appTripCharges).where(eq(appTripCharges.tripId, trip.id)).limit(1);
  if (have) return;
  const bookings = await db.select({ b: appTripBookings, o: appOrders }).from(appTripBookings).innerJoin(appOrders, eq(appOrders.id, appTripBookings.orderId)).where(eq(appTripBookings.tripId, trip.id));
  if (!bookings.length) return;
  const [ownerRow] = await db.select({ id: appUsers.id }).from(appUsers).innerJoin(appOrders, eq(appOrders.ownerId, appUsers.id)).where(eq(appOrders.id, bookings[0]!.o.id));
  await db.transaction(async (tx) => {
    const again = await tx.select({ id: appTripCharges.id }).from(appTripCharges).where(eq(appTripCharges.tripId, trip.id)).limit(1);
    if (again.length) return;
    for (const { b, o } of bookings) {
      const [pay] = o.paymentId ? await tx.select().from(appPayments).where(eq(appPayments.id, o.paymentId)) : [];
      for (const line of b.lines) {
        const item: TripPaymentItem = line.key === "flight" || line.key === "stay" || line.key === "pickup" ? line.key : "extra";
        await createCharge(tx, trip, {
          ownerId: ownerRow?.id ?? o.ownerId, tripId: trip.id, paymentId: o.paymentId, item, title: line.text, sub: line.text, amount: item === "flight" ? line.amount - (b.paid.discount ?? 0) : line.amount,
          method: pay?.method ?? "card", label: b.paid.card, plan: (b.payPlan as "full" | "tabby" | "tamara") ?? "full", discount: item === "flight" ? b.paid.discount ?? 0 : 0,
          paidAt: b.bookedAt, customer: customerOf(trip),
        });
      }
    }
  });
}

async function chargesOf(tripId: string, tx: Exec = db) {
  return tx.select().from(appTripCharges).where(eq(appTripCharges.tripId, tripId)).orderBy(asc(appTripCharges.paidAt), asc(appTripCharges.createdAt));
}

/** Every payment on the trip, with what's been credited back and its credit note. */
export async function listPayments(trip: TripDetail, tx: Exec = db): Promise<TripPayment[]> {
  const charges = await chargesOf(trip.id, tx);
  if (!charges.length) return [];
  const items = await tx.select({ chargeId: appRefundItems.chargeId, credited: appRefundItems.credited, creditNoteId: appRefundItems.creditNoteId, stage: appRefundGroups.stage, anyway: appRefundGroups.anyway })
    .from(appRefundItems).innerJoin(appRefundGroups, eq(appRefundGroups.id, appRefundItems.groupId)).where(inArray(appRefundItems.chargeId, charges.map((c) => c.id)));
  const [inv] = charges.length ? [await tx.select({ id: appInvoices.id, number: appInvoices.number }).from(appInvoices).where(inArray(appInvoices.id, charges.map((c) => c.invoiceId).filter((x): x is string => !!x)))] : [[]];
  const numbers = new Map((inv ?? []).map((i) => [i.id, i.number]));
  return charges.map((c) => {
    const ref = items.filter((i) => i.chargeId === c.id && i.stage !== "rejected" && !i.anyway);
    const credited = ref.reduce((a, i) => a + i.credited, 0);
    return {
      id: c.id, item: c.item as TripPaymentItem, title: c.title, sub: c.sub, amount: SAR(c.amount), method: c.method as TripPayment["method"], label: c.label,
      paidAt: c.paidAt.toISOString(), invoiceId: c.invoiceId, invoiceNumber: c.invoiceId ? numbers.get(c.invoiceId) ?? null : null,
      creditNoteId: ref.find((i) => i.creditNoteId)?.creditNoteId ?? null,
      plan: c.instalments ? c.instalments.map((i) => ({ seq: i.seq, dueOn: i.dueOn, amount: SAR(i.amount), paid: !!i.paidAt })) : null,
      refunded: ref.length ? SAR(credited) : null, creditUsed: SAR(c.creditUsed),
    };
  });
}

/* ───────── invoices ───────── */

export async function invoiceDoc(ownerId: string, invoiceId: string): Promise<{ invoice: InvoiceDoc; html: string }> {
  if (!/^[0-9a-f-]{36}$/i.test(invoiceId)) throw new AppError("NOT_FOUND");
  const [row] = await db.select({ i: appInvoices, d: appInvoiceDetails }).from(appInvoices).innerJoin(appInvoiceDetails, eq(appInvoiceDetails.invoiceId, appInvoices.id))
    .where(and(eq(appInvoices.id, invoiceId), eq(appInvoices.ownerId, ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  const { i, d } = row;
  const [against] = d.againstInvoiceId ? await db.select({ number: appInvoices.number }).from(appInvoices).where(eq(appInvoices.id, d.againstInvoiceId)) : [];
  const related = d.chargeId
    ? await db.select({ id: appInvoices.id, number: appInvoices.number, kind: appInvoiceDetails.kind, status: appInvoiceDetails.status }).from(appInvoiceDetails)
      .innerJoin(appInvoices, eq(appInvoices.id, appInvoiceDetails.invoiceId)).where(eq(appInvoiceDetails.chargeId, d.chargeId)).orderBy(asc(appInvoices.issuedAt))
    : [];
  const issuedAt = i.issuedAt.toISOString();
  const qr = zatcaQr({ seller: SELLER.legal, vatNumber: SELLER.vat, issuedAt, total: i.total, vat: i.vat });
  const invoice: InvoiceDoc = {
    id: i.id, number: i.number, tripId: i.tripId, paymentId: i.paymentId, total: SAR(i.total), vat: SAR(i.vat), issuedAt, zatcaStatus: i.zatcaStatus as InvoiceDoc["zatcaStatus"],
    pdfUrl: null, kind: d.kind as InvoiceDoc["kind"], status: d.status as InvoiceDoc["status"], seller: { ...SELLER }, customer: d.customer, company: d.company ?? null,
    lines: d.lines, net: SAR(i.total - i.vat), againstNumber: against?.number ?? null, paidWith: d.paidWith, qr,
    related: related.map((r) => ({ id: r.id, number: r.number, kind: r.kind as InvoiceDoc["kind"], status: r.status as "draft" | "issued" })),
  };
  return { invoice, html: invoiceHtml({ kind: invoice.kind, status: invoice.status, number: invoice.number, issuedAt, customer: d.customer, company: invoice.company, lines: d.lines, againstNumber: invoice.againstNumber, paidWith: d.paidWith, qr }) };
}

/** A full tax invoice for a company: a draft first, to check; issuing makes it final. */
export async function draftCompanyInvoice(ownerId: string, invoiceId: string, company: Company, ipHash: string | null): Promise<string> {
  const [row] = await db.select({ i: appInvoices, d: appInvoiceDetails }).from(appInvoices).innerJoin(appInvoiceDetails, eq(appInvoiceDetails.invoiceId, appInvoices.id))
    .where(and(eq(appInvoices.id, invoiceId), eq(appInvoices.ownerId, ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  if (row.d.kind === "credit_note") throw new AppError("VALIDATION", { message: "A credit note can’t be reissued for a company." });
  return db.transaction(async (tx) => {
    const base = row.d.kind === "tax" && row.d.againstInvoiceId ? row.d.againstInvoiceId : row.i.id;
    const drafts = row.d.chargeId ? await tx.select({ id: appInvoiceDetails.invoiceId, status: appInvoiceDetails.status, kind: appInvoiceDetails.kind }).from(appInvoiceDetails).where(eq(appInvoiceDetails.chargeId, row.d.chargeId)) : [];
    if (drafts.some((x) => x.kind === "tax" && x.status === "issued")) throw new AppError("VALIDATION", { message: "This tax invoice is issued. Mada can cancel it with a credit note and issue a new one." });
    const draft = drafts.find((x) => x.kind === "tax" && x.status === "draft");
    if (row.i.tripId) await tx.update(appTripFacts).set({ company, updatedAt: new Date() }).where(eq(appTripFacts.tripId, row.i.tripId));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "invoice.company_saved", entityType: "app_invoice", entityId: invoiceId, summary: `Saved company details for a tax invoice (${company.name})`, data: { vat: company.vat }, ipHash });
    if (draft) {
      await tx.update(appInvoiceDetails).set({ company }).where(eq(appInvoiceDetails.invoiceId, draft.id));
      return draft.id;
    }
    const inv = await issueInvoice(tx, {
      ownerId, tripId: row.i.tripId, chargeId: row.d.chargeId, paymentId: row.i.paymentId, kind: "tax", status: "draft", customer: row.d.customer, company,
      lines: row.d.lines, againstInvoiceId: base, paidWith: row.d.paidWith,
    });
    return inv.id;
  });
}

export async function issueDraft(ownerId: string, invoiceId: string, ipHash: string | null): Promise<void> {
  const [row] = await db.select({ i: appInvoices, d: appInvoiceDetails }).from(appInvoices).innerJoin(appInvoiceDetails, eq(appInvoiceDetails.invoiceId, appInvoices.id))
    .where(and(eq(appInvoices.id, invoiceId), eq(appInvoices.ownerId, ownerId)));
  if (!row) throw new AppError("NOT_FOUND");
  if (row.d.status !== "draft") throw new AppError("VALIDATION", { message: "This invoice is already issued." });
  await db.transaction(async (tx) => {
    const at = new Date();
    const number = await nextNumber(tx, row.d.kind as "tax", at);
    await tx.update(appInvoices).set({ number, issuedAt: at, zatcaStatus: "pending" }).where(eq(appInvoices.id, invoiceId));
    await tx.update(appInvoiceDetails).set({ status: "issued" }).where(eq(appInvoiceDetails.invoiceId, invoiceId));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "invoice.issued", entityType: "app_invoice", entityId: invoiceId, summary: `Issued tax invoice ${number} to ${row.d.company?.name ?? "a company"}`, data: { total: row.i.total, vat: row.i.vat }, ipHash });
  });
}

/* ───────── refunds ───────── */

const REJECT_PICKUP = "{driver}’s company charges in full inside 24 hours, and he has turned down other work for your morning. I asked twice.";
const REJECT_OTHER = "The place is already holding the booking for you and won’t release it this close. I asked twice.";

type GroupRow = typeof appRefundGroups.$inferSelect;

export function toRefundView(g: GroupRow): RefundView {
  return {
    id: g.id, tripId: g.tripId, title: g.title, amount: SAR(g.amount), stage: g.stage as RefundView["stage"], destination: g.destination as RefundView["destination"],
    provider: g.provider, card: g.card, anyway: g.anyway, reject: g.stage === "rejected" ? g.reject : null, alt: g.stage === "rejected" ? g.alt : null, law: g.law, airline: g.airline,
    cancelledInstalments: g.cancelledCount ? { count: g.cancelledCount, amount: SAR(g.cancelledAmount) } : null,
    expectedBy: g.expectedBy?.toISOString() ?? null, sentAt: g.sentAt?.toISOString() ?? null, createdAt: g.createdAt.toISOString(), updatedAt: g.updatedAt.toISOString(),
  };
}

/** In mock mode the desk answers an "ask anyway" after 7 seconds: no, with the reason and another way. */
async function progressMockRefunds(ownerId: string) {
  let mock = false;
  try { mock = supplierMode("payments") === "mock"; } catch { mock = false; }
  if (!mock) return;
  await db.update(appRefundGroups).set({ stage: "rejected", updatedAt: new Date() })
    .where(and(eq(appRefundGroups.ownerId, ownerId), eq(appRefundGroups.anyway, true), eq(appRefundGroups.stage, "requested"), sql`${appRefundGroups.createdAt} < now() - interval '7 seconds'`));
}

export async function listRefunds(ownerId: string, tripId?: string): Promise<RefundView[]> {
  await progressMockRefunds(ownerId);
  const rows = await db.select().from(appRefundGroups).where(tripId ? and(eq(appRefundGroups.ownerId, ownerId), eq(appRefundGroups.tripId, tripId)) : eq(appRefundGroups.ownerId, ownerId)).orderBy(desc(appRefundGroups.createdAt));
  return rows.map(toRefundView);
}

export async function getRefund(ownerId: string, id: string): Promise<RefundView> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  await progressMockRefunds(ownerId);
  const [g] = await db.select().from(appRefundGroups).where(and(eq(appRefundGroups.id, id), eq(appRefundGroups.ownerId, ownerId)));
  if (!g) throw new AppError("NOT_FOUND");
  return toRefundView(g);
}

export const REASON_TEXT: Record<CreateRefundRequest["reason"], string> = { plans: "Plans changed", ill: "Someone is ill", docs: "Visa or passport problem", airline: "The airline changed it", else: "Found something else", other: "Other" };

/** Ask for a refund: the amount is worked out from the rules, never sent by the phone. */
export async function createRefund(ownerId: string, trip: TripDetail, input: CreateRefundRequest, ipHash: string | null, opts: { titleOverride?: string } = {}): Promise<RefundView> {
  const [existing] = await db.select().from(appRefundGroups).where(and(eq(appRefundGroups.ownerId, ownerId), eq(appRefundGroups.clientKey, input.clientKey)));
  if (existing) return toRefundView(existing);
  const payments = await listPayments(trip);
  const chosen = payments.filter((p) => input.paymentIds.includes(p.id));
  if (chosen.length !== new Set(input.paymentIds).size) throw new AppError("NOT_FOUND");
  if (chosen.some((p) => p.refunded)) throw new AppError("VALIDATION", { message: "That’s already refunded." });
  const quotes = refundQuoteItems(trip, chosen);
  if (quotes.some((q) => q.back.amount === 0 && !q.askAnyway)) throw new AppError("VALIDATION", { message: "Nothing comes back for that under the rules." });
  const cashTotal = quotes.reduce((a, q) => a + q.cash.amount, 0);
  const backTotal = quotes.reduce((a, q) => a + q.back.amount, 0);
  const anyway = backTotal === 0;
  const instal = quotes.filter((q) => q.method === "tabby" || q.method === "tamara");
  const destination: RefundView["destination"] = anyway ? "original" : instal.length && instal.length === quotes.length ? "instalments" : input.destination;
  const card = chosen.find((p) => p.method !== "tabby" && p.method !== "tamara")?.label ?? chosen[0]?.label ?? "your card";
  const what = chosen.map((p) => (p.item === "flight" ? "flights" : p.item === "stay" ? "the stay" : p.item === "pickup" ? "the pickup" : p.title.toLowerCase()));
  const title = opts.titleOverride ?? `${trip.city} · ${what.length < 2 ? what.join("") : `${what.slice(0, -1).join(", ")} and ${what[what.length - 1]}`}`;
  const amount = anyway ? chosen.reduce((a, p) => a + p.amount.amount, 0) : cashTotal;
  const law = quotes.some((q) => q.law);
  const out = outSegment(trip);
  const pickupDriver = trip.pickups.find((p) => p.direction === "to_airport")?.driverName ?? "The driver";

  const group = await db.transaction(async (tx) => {
    const req = await insertRequest(tx, {
      ownerId, tripId: trip.id, kind: "refund", summary: title, ipHash, agentName: trip.agent.name,
      status: destination === "credit" ? "done" : "sent",
      details: { area: "refund", short: "Refund", detail: REASON_TEXT[input.reason], withWhom: "faisal", outcome: null, clientKey: input.clientKey },
    });
    const now = new Date();
    const [g] = await tx.insert(appRefundGroups).values({
      ownerId, tripId: trip.id, title, amount, stage: anyway ? "requested" : destination === "credit" ? "sent" : "requested", destination,
      provider: destination === "instalments" ? instal[0]!.method : destination === "credit" ? "mada_credit" : null, card, reason: input.reason, anyway,
      reject: anyway ? (chosen[0]?.item === "pickup" ? REJECT_PICKUP.replace("{driver}", pickupDriver) : REJECT_OTHER) : null,
      alt: anyway ? (chosen[0]?.item === "pickup" ? "I can move the ride to another day in the next 3 months instead, free." : "I can move it to another day this trip, free.") : null,
      law, airline: out?.carrierName ?? null, cancelledCount: instal.reduce((a, q) => a + (q.cancelled?.count ?? 0), 0), cancelledAmount: instal.reduce((a, q) => a + (q.cancelled?.amount.amount ?? 0), 0),
      expectedBy: destination === "credit" ? now : new Date(now.getTime() + (law ? 7 : 14) * 86_400_000), sentAt: destination === "credit" ? now : null, clientKey: input.clientKey,
    }).returning();
    const charges = await tx.select().from(appTripCharges).where(inArray(appTripCharges.id, chosen.map((p) => p.id)));
    for (const q of quotes) {
      const charge = charges.find((c) => c.id === q.paymentId)!;
      if (!charge.paymentId) throw new AppError("VALIDATION", { message: "This payment can’t be refunded here. Mada can do it by hand." });
      const credited = anyway ? 0 : q.back.amount;
      const [r] = await tx.insert(appRefunds).values({
        paymentId: charge.paymentId, amount: anyway ? 0 : q.cash.amount, stage: g!.stage, destination: destination === "credit" ? "credit" : "original", reason: REASON_TEXT[input.reason],
        expectedBy: g!.expectedBy,
      }).returning();
      let creditNoteId: string | null = null;
      if (credited > 0 && charge.invoiceId) {
        const cn = await issueInvoice(tx, {
          ownerId, tripId: trip.id, chargeId: charge.id, paymentId: charge.paymentId, kind: "credit_note", status: "issued", customer: customerOf(trip),
          company: null, lines: creditLines(charge.lines, credited), againstInvoiceId: charge.invoiceId, paidWith: null,
        });
        creditNoteId = cn.id;
      }
      await tx.insert(appRefundItems).values({ refundId: r!.id, groupId: g!.id, chargeId: charge.id, credited, creditNoteId });
      if (destination === "credit" && q.cash.amount > 0) await addCredit(tx, { userId: ownerId, amount: q.cash.amount, kind: "refund", note: `Refund · ${title}`, refundId: r!.id, actor: { kind: "user", id: ownerId }, ipHash });
      if (q.item === "stay" && !anyway) await tx.update(appStays).set({ status: "cancelled", updatedAt: now }).where(eq(appStays.tripId, trip.id));
    }
    await appAuditLog(tx, {
      actorKind: "user", actorId: ownerId, action: "refund.requested", entityType: "app_refund_group", entityId: g!.id,
      summary: `Asked for a refund of ${formatSar(amount)} (${title})${anyway ? ", nothing due by the rules" : ""}`, data: { destination, amount, anyway, items: chosen.map((p) => p.item), requestId: req.id }, ipHash,
    });
    return g!;
  });
  if (destination === "credit" && amount > 0) await notify(ownerId, { kind: "refund_moved", level: "active", copy: "notify.trip.credit", vars: { amount: formatSar(amount) }, href: "/trips?tab=requests" });
  return toRefundView(group);
}

/** Plan dates for an instalment plan, monthly from the day it was booked. */
export function instalmentPlan(total: number, plan: "tabby" | "tamara", bookedOn: string, paidCount: number): InstalmentRow[] {
  const count = plan === "tamara" ? 3 : 4;
  const each = Math.ceil(total / count);
  return Array.from({ length: count }, (_, i) => {
    const d = new Date(`${bookedOn}T00:00:00Z`);
    d.setUTCMonth(d.getUTCMonth() + i);
    return { seq: i + 1, dueOn: d.toISOString().slice(0, 10), amount: i === count - 1 ? total - each * (count - 1) : each, paidAt: i < paidCount ? `${d.toISOString().slice(0, 10)}T09:00:00.000Z` : null };
  });
}

export const nextWeek = (day: string) => addDays(day, 7);

/** Part of one charge back to the card (a night dropped inside the free window), with its credit note. */
export async function partialRefund(tx: Tx, ownerId: string, trip: TripDetail, item: TripPaymentItem, amount: number, title: string, clientKey: string, ipHash: string | null): Promise<GroupRow | null> {
  const [charge] = await tx.select().from(appTripCharges).where(and(eq(appTripCharges.tripId, trip.id), eq(appTripCharges.item, item))).limit(1);
  if (!charge?.paymentId || amount <= 0) return null;
  const now = new Date();
  const [g] = await tx.insert(appRefundGroups).values({
    ownerId, tripId: trip.id, title, amount, stage: "requested", destination: "original", card: charge.label ?? "your card", reason: "plans",
    expectedBy: new Date(now.getTime() + 14 * 86_400_000), clientKey,
  }).returning();
  const [r] = await tx.insert(appRefunds).values({ paymentId: charge.paymentId, amount, stage: "requested", destination: "original", reason: title, expectedBy: g!.expectedBy }).returning();
  const cn = charge.invoiceId ? await issueInvoice(tx, {
    ownerId, tripId: trip.id, chargeId: charge.id, paymentId: charge.paymentId, kind: "credit_note", status: "issued", customer: customerOf(trip), company: null,
    lines: creditLines(charge.lines, amount), againstInvoiceId: charge.invoiceId, paidWith: null,
  }) : null;
  await tx.insert(appRefundItems).values({ refundId: r!.id, groupId: g!.id, chargeId: charge.id, credited: amount, creditNoteId: cn?.id ?? null });
  await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "refund.requested", entityType: "app_refund_group", entityId: g!.id, summary: `Refund of ${formatSar(amount)} (${title})`, data: { amount, item }, ipHash });
  return g!;
}
