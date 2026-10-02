"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { toHalalas, sar } from "@/lib/money";
import { addDays, businessDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { createApproval } from "@/lib/approvals";
import { clientExposure } from "@/lib/finance";
import { issueCheck } from "@/lib/issuance";
import { canViewRecord } from "@/lib/access";
import { isUuid, safeNext } from "@/lib/security";
import { flash, optStr, str, toState, zodError, type ActionState } from "@/lib/actions";
import { AIRLINE_LABELS, AIRPORT_CODES } from "@/lib/travel-data";
import { cleanDetails, cleanTravellers, describeService, type Traveller } from "@/lib/services";
import { riyadhDate } from "@/lib/dates";
import { ACCOUNT } from "@/lib/labels";
import { recordSupplierPayment } from "@/lib/suppliers";

const money = z.string().transform((v, ctx) => {
  try { return toHalalas(v); } catch { ctx.addIssue({ code: "custom", message: "Enter a valid amount" }); return z.NEVER; }
});

const SaleSchema = z.object({
  clientId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  newClientName: z.string().max(120).optional(),
  newClientPhone: z.string().max(40).optional(),
  newClientType: z.enum(["retail", "noncontracted"]).optional(),
  serviceType: z.enum(["flight", "hotel", "visa", "package", "transport", "event", "other"]),
  passengers: z.string().trim().max(2000).optional(),
  paxCount: z.coerce.number().int().min(1).max(30).catch(1),
  travellers: z.string().max(20000).optional(),
  description: z.string().trim().max(200).optional(),
  supplier: z.string().trim().max(100).optional(),
  pnr: z.string().trim().max(20).optional(),
  travelDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("").transform(() => undefined)),
  netCost: money.refine((v) => v > 0, "Net cost must be more than zero"),
  sellPrice: money.refine((v) => v > 0, "Selling price must be more than zero"),
  paidNow: money,
  method: z.enum(["cash", "mada", "card", "transfer"]),
  account: z.enum(["retail", "corporate"]).catch("retail"), // which company bank account received the money
  supplierPay: z.enum(["unpaid", "bank", "partner"]).catch("unpaid"), // has the supplier been paid, and how
  supplierAccount: z.enum(["retail", "corporate"]).catch("retail"),
  supplierPartnerId: z.string().optional(),
  viaBsp: z.string().optional(),

  paymentRef: z.string().trim().max(60).optional(),
  issueNow: z.string().optional(),
  ticketNumbers: z.string().trim().max(200).optional(),
  creditReason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
  details: z.string().max(4000).optional(),
});

export async function createSale(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!can(u, "sales.create")) return { error: "You can't create sales" };
  const parsed = SaleSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodError(parsed.error);
  const v = parsed.data;
  // Travellers: one row per visa, ticket or guest. Names (and passports where needed) are checked here again.
  let travellers: Traveller[];
  {
    let raw: unknown = null;
    try { raw = v.travellers ? JSON.parse(v.travellers) : [{ name: v.passengers ?? "" }]; } catch { return { error: "Something went wrong with the form. Reload and try again" }; }
    const r = cleanTravellers(v.serviceType, raw, riyadhDate());
    if (!r.ok) return { error: r.error, fields: { travellers: "x" } };
    travellers = r.travellers;
  }
  const passengers = travellers.map((x) => x.name).filter(Boolean).join(", ").slice(0, 1000);
  const tickets = ticketsFrom(fd);
  if (v.paidNow < 0 || v.paidNow > v.sellPrice) return { error: "Amount paid can't be more than the selling price", fields: { paidNow: "x" } };
  if (v.serviceType === "flight" && !v.pnr) return { error: "Flights need a PNR", fields: { pnr: "x" } };
  // Non-flight services: the server builds the description from the structured answers.
  let details: Record<string, unknown> | null = null;
  if (v.serviceType !== "flight") {
    try { details = v.details ? JSON.parse(v.details) : {}; } catch { return { error: "Something went wrong with the form. Reload and try again" }; }
    if (!details || typeof details !== "object" || Array.isArray(details)) details = {};
    const r = describeService(v.serviceType, details);
    if (!r.ok) return { error: r.error, fields: { details: "x" } };
    details = cleanDetails(v.serviceType, details); // only the known answers are stored
    v.description = r.description || undefined;
    if (r.supplier) v.supplier = r.supplier;
    if (r.travelDate) v.travelDate = r.travelDate;
  }
  if (v.serviceType === "flight") {
    const m = /^([A-Z]{3}) (→|⇄) ([A-Z]{3})$/.exec(v.description ?? "");
    if (!m || !AIRPORT_CODES.has(m[1]) || !AIRPORT_CODES.has(m[3])) return { error: "Pick both airports from the list", fields: { description: "x" } };
    if (m[1] === m[3]) return { error: "From and To can't be the same airport", fields: { description: "x" } };
    if (!v.supplier || !AIRLINE_LABELS.has(v.supplier)) return { error: "Pick the airline from the list", fields: { supplier: "x" } };
    // No silent IATA: a flight only lands in the IATA balance when it was explicitly bought through BSP.
    if (v.viaBsp !== "1" && v.viaBsp !== "0") return { error: "Choose how this ticket was bought — IATA (BSP) or direct from the airline", fields: { viaBsp: "x" } };
  }

  let id = "";
  try {
    const s = await getSettings();
    id = await db.transaction(async (tx) => {
      // Client: pick existing or create inline.
      let client: typeof schema.clients.$inferSelect | undefined;
      if (v.clientId) {
        // Locked, so two sales for the same client can't both squeeze under its credit limit.
        [client] = await tx.select().from(schema.clients).where(eq(schema.clients.id, v.clientId)).for("update");
      } else if (v.newClientName?.trim()) {
        [client] = await tx.insert(schema.clients).values({ name: v.newClientName.trim(), phone: v.newClientPhone?.trim() || null, type: v.newClientType ?? "retail", createdBy: u.id }).returning();
        await audit(tx, { actorId: u.id, action: "client.created", entityType: "client", entityId: client.id, entityRef: client.name, summary: `Added client ${client.name}` });
      }
      if (!client) throw new Error("Choose a client or add a new one");

      const channel = client.type === "retail" ? "retail" : "corporate"; // for reporting and issuing scope
      const account = v.account; // which bank account the money lands in — either bank, chosen on the sale
      const bdate = businessDate(new Date(), s.closeHour);
      const unpaid = v.sellPrice - v.paidNow;

      // Governance: who may extend credit for the unpaid part?
      let needsCredit = false;
      let creditReason = v.creditReason || null;
      let exposure = 0;
      if (unpaid > 0) {
        exposure = await clientExposure(tx, client.id);
        if (client.type === "contracted") {
          if (exposure + unpaid > client.creditLimit) {
            needsCredit = true;
            creditReason = `Over contract limit: exposure ${sar(exposure)} + ${sar(unpaid)} > limit ${sar(client.creditLimit)}. ${creditReason ?? ""}`.trim();
          }
        } else {
          needsCredit = true;
          if (!creditReason) throw new Error("Say why this client should pay later. Directors will see it");
        }
      }

      const [{ rate: preparerRate }] = await tx.select({ rate: schema.users.commissionBps }).from(schema.users).where(eq(schema.users.id, u.id));
      const ref = await nextRef(tx, "S", 10000);
      const [b] = await tx.insert(schema.bookings).values({
        ref, channel, account, serviceType: v.serviceType, clientId: client.id, passengers, paxCount: travellers.length, travellers,
        description: v.description || null, details, supplier: v.supplier || null, pnr: v.pnr?.toUpperCase() || null, travelDate: v.travelDate || null,
        commissionBps: preparerRate, viaBsp: v.serviceType === "flight" && v.viaBsp === "1",
        netCost: v.netCost, sellPrice: v.sellPrice, status: needsCredit ? "awaiting_credit" : "pending_issue",
        onCredit: unpaid > 0, dueDate: unpaid > 0 ? addDays(bdate, client.paymentTermsDays || 14) : null,
        businessDate: bdate, preparedBy: u.id,
      }).returning();
      await audit(tx, { actorId: u.id, action: "booking.created", entityType: "booking", entityId: b.id, entityRef: ref,
        summary: `Created ${ref} · ${travellers.length > 1 ? `${travellers.length} × ` : ""}${passengers}${v.description ? ` · ${v.description}` : ""} · sell ${sar(v.sellPrice)}, margin ${sar(v.sellPrice - v.netCost)}` });

      if (v.paidNow > 0) {
        await tx.insert(schema.payments).values({ bookingId: b.id, clientId: client.id, account, method: v.method, amount: v.paidNow, reference: v.paymentRef || null, businessDate: bdate, recordedBy: u.id });
        await audit(tx, { actorId: u.id, action: "payment.recorded", entityType: "booking", entityId: b.id, entityRef: ref, summary: `Received ${sar(v.paidNow)} by ${v.method} into ${ACCOUNT[account]}` });
      }
      if (v.note) {
        await tx.insert(schema.remarks).values({ entityType: "booking", entityId: b.id, userId: u.id, body: v.note });
      }

      // Supplier cost: BSP flights roll into the 15-day IATA closing; everything else is a direct supplier payable.
      const viaBsp = v.serviceType === "flight" && v.viaBsp === "1";
      if (!viaBsp && v.supplierPay !== "unpaid" && v.netCost > 0) {
        if (v.supplierPay === "partner" && !u.partnerId) throw new Error("Only a partner can record a partner-paid supplier cost");
        await recordSupplierPayment(tx, b, { source: v.supplierPay, account: v.supplierAccount, partnerId: v.supplierPartnerId || null, recordedBy: u.id });
      }

      if (needsCredit) {
        // The approval route looks at everything this client would owe, so splitting a sale can't dodge the all-directors rule.
        const req = await createApproval(tx, { kind: "credit", entityType: "booking", entityId: b.id, title: `Credit for ${client.name} · ${ref}`, amount: unpaid, routeAmount: exposure + unpaid, reason: creditReason, requestedBy: u.id });
        await tx.update(schema.bookings).set({ creditApprovalId: req.id }).where(eq(schema.bookings.id, b.id));
        await flash(`${ref} saved. Credit request ${req.ref} sent to directors`);
        return b.id;
      }

      if (v.issueNow === "on") {
        const chk = await issueCheck(tx, u, b, { lock: true });
        if (!chk.ok) {
          await flash(`${ref} saved and sent to issuance (${chk.reason})`);
          return b.id;
        }
        const tk = tickets ?? v.ticketNumbers ?? null;
        if (v.serviceType === "flight") assertTickets(tk, travellers.length);
        await tx.update(schema.bookings).set({ status: "issued", issuedBy: u.id, issuedAt: new Date(), ticketNumbers: tk, issuedUnderDelegation: chk.delegationId }).where(eq(schema.bookings.id, b.id));
        await audit(tx, { actorId: u.id, action: "booking.issued", entityType: "booking", entityId: b.id, entityRef: ref,
          summary: `Issued ${ref}${tk ? ` · ticket${travellers.length > 1 ? "s" : ""} ${tk}` : ""}${chk.delegationId ? " (under delegation)" : ""}` });
        await flash(`${ref} issued`);
        return b.id;
      }
      await flash(`${ref} saved and waiting to issue`);
      return b.id;
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

/** Ticket numbers typed one per passenger (inputs named "ticket"), joined for storage. */
function ticketsFrom(fd: FormData): string | null {
  const list = fd.getAll("ticket").map((x) => String(x).trim().slice(0, 30)).filter(Boolean);
  return list.length ? list.join(", ").slice(0, 1000) : null;
}

/** Flights: one ticket number for every passenger, no duplicates. */
function assertTickets(joined: string | null, pax: number) {
  const list = (joined ?? "").split(/[,\n]+/).map((x) => x.trim()).filter(Boolean);
  if (!list.length) throw new Error(pax > 1 ? "Enter a ticket number for each passenger" : "Enter the ticket number(s)");
  if (list.length < pax) throw new Error(`Enter a ticket number for each passenger (${list.length} of ${pax})`);
  if (new Set(list).size !== list.length) throw new Error("The same ticket number is entered twice");
}

/** A sale this person may act on: it exists and they can see it (their team's, or everyone's with sales.view_all). */
async function loadScopedBooking(u: Awaited<ReturnType<typeof requireUser>>, id: string) {
  if (!isUuid(id) || !(await canViewRecord(u, "booking", id))) throw new Error("Sale not found");
  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!b) throw new Error("Sale not found");
  return b;
}

const paidOn = async (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string) =>
  (await tx.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) }).from(schema.payments).where(eq(schema.payments.bookingId, id)))[0].total;

export async function issueBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  const tickets = ticketsFrom(fd) ?? optStr(fd, "ticketNumbers")?.slice(0, 1000) ?? null;
  const pnr = optStr(fd, "pnr")?.slice(0, 20) ?? null;
  try {
    await loadScopedBooking(u, id);
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      if (b.status !== "pending_issue") throw new Error("This sale is not waiting to issue");
      const chk = await issueCheck(tx, u, b, { lock: true });
      if (!chk.ok) throw new Error(chk.reason);
      if (b.serviceType === "flight") assertTickets(tickets, b.paxCount);
      await tx.update(schema.bookings).set({ status: "issued", issuedBy: u.id, issuedAt: new Date(), ticketNumbers: tickets ?? b.ticketNumbers, pnr: pnr?.toUpperCase() ?? b.pnr, issuedUnderDelegation: chk.delegationId, returnNote: null, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await audit(tx, { actorId: u.id, action: "booking.issued", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `Issued ${b.ref}${tickets ? ` · ticket ${tickets}` : ""}${chk.delegationId ? " (under delegation)" : ""}` });
      await flash(`${b.ref} issued`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(safeNext(str(fd, "back"), `/adminwork/sales/${id}`));
}

export async function returnBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), note = str(fd, "note");
  if (!note) return { error: "Say what needs fixing so the preparer knows" };
  if (note.length > 1000) return { error: "Keep the note under 1,000 characters" };
  try {
    const b = await loadScopedBooking(u, id);
    // Only someone who could actually issue it sends it back, and never the person who prepared it.
    const chk = await issueCheck(db, u, b);
    if (!chk.ok && !can(u, "issue.delegate")) throw new Error("Only issuers can send a sale back");
    if (b.preparedBy === u.id && !can(u, "issue.unlimited")) throw new Error("You prepared this sale. Void it or ask an issuer");
    await db.transaction(async (tx) => {
      const [cur] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (cur.status !== "pending_issue") throw new Error("Only sales waiting to issue can be sent back");
      await tx.update(schema.bookings).set({ status: "returned", returnNote: note, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await tx.insert(schema.remarks).values({ entityType: "booking", entityId: id, userId: u.id, body: note });
      await audit(tx, { actorId: u.id, action: "booking.returned", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Sent ${b.ref} back: "${note}"` });
    });
    await flash(`${b.ref} sent back to the preparer`);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(safeNext(str(fd, "back"), `/adminwork/sales/${id}`));
}

export async function resubmitBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  let outcome = "";
  try {
    await loadScopedBooking(u, id);
    const num = (k: string, fallback: number) => (str(fd, k) ? toHalalas(str(fd, k)) : fallback);
    const { diff } = await import("@/lib/audit");
    outcome = await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b || b.status !== "returned") throw new Error("Only sent-back sales can be resubmitted");
      if (b.preparedBy !== u.id && !can(u, "sales.edit")) throw new Error("Only the preparer can resubmit");
      const patch = { pnr: optStr(fd, "pnr")?.slice(0, 20).toUpperCase() ?? b.pnr, netCost: num("netCost", b.netCost), sellPrice: num("sellPrice", b.sellPrice) };
      if (patch.netCost <= 0 || patch.sellPrice <= 0) throw new Error("Prices must be more than zero");
      // Lowering the cost raises the margin (and commission), so only managers may do that after a sale was sent back.
      if (patch.netCost < b.netCost && !can(u, "sales.edit")) throw new Error("Only a manager can lower the net cost. Add a remark explaining the right cost");
      const paid = await paidOn(tx, id);
      if (patch.sellPrice < paid) throw new Error(`${sar(paid)} was already received. The price can't be lower than that`);

      // If the client now owes more than before, the credit rules run again, as on a new sale.
      const [client] = await tx.select().from(schema.clients).where(eq(schema.clients.id, b.clientId)).for("update");
      const oldUnpaid = b.sellPrice - paid, newUnpaid = patch.sellPrice - paid;
      let needsCredit = false, reason = "";
      if (newUnpaid > oldUnpaid && newUnpaid > 0) {
        const exposure = await clientExposure(tx, client.id) - oldUnpaid; // everything else this client owes
        if (client.type === "contracted") {
          if (exposure + newUnpaid > client.creditLimit) { needsCredit = true; reason = `Over contract limit after price change: ${sar(exposure)} + ${sar(newUnpaid)} > ${sar(client.creditLimit)}`; }
        } else { needsCredit = true; reason = `Price changed on resubmit: client now owes ${sar(newUnpaid)} instead of ${sar(oldUnpaid)}`; }
        if (needsCredit) {
          await tx.update(schema.approvalRequests).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, "pending")));
          const req = await createApproval(tx, { kind: "credit", entityType: "booking", entityId: id, title: `Credit for ${client.name} · ${b.ref}`, amount: newUnpaid, routeAmount: exposure + newUnpaid, reason, requestedBy: u.id });
          await tx.update(schema.bookings).set({ creditApprovalId: req.id }).where(eq(schema.bookings.id, id));
        }
      }
      const bdate = b.businessDate;
      await tx.update(schema.bookings).set({
        ...patch, status: needsCredit ? "awaiting_credit" : "pending_issue", updatedAt: new Date(),
        onCredit: newUnpaid > 0, dueDate: newUnpaid > 0 ? (b.dueDate ?? addDays(bdate, client.paymentTermsDays || 14)) : null,
      }).where(eq(schema.bookings.id, id));
      await audit(tx, { actorId: u.id, action: "booking.resubmitted", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Fixed and resubmitted ${b.ref}${needsCredit ? " · needs credit approval again" : ""}`, changes: diff(b, patch) });
      return needsCredit ? `${b.ref} resubmitted. The client now owes more, so it needs approval again` : `${b.ref} resubmitted for issuing`;
    });
  } catch (e) { return toState(e); }
  await flash(outcome);
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!can(u, "sales.create")) return { error: "You can't record payments" };
  const id = str(fd, "id");
  try {
    await loadScopedBooking(u, id);
    const amount = toHalalas(str(fd, "amount"));
    const method = str(fd, "method");
    if (amount <= 0) throw new Error("Enter the amount received");
    if (!["cash", "mada", "card", "transfer"].includes(method)) throw new Error("Choose how they paid");
    const s = await getSettings();
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      if (["void", "refunded"].includes(b.status)) throw new Error("This sale is closed");
      if (b.status === "awaiting_credit") throw new Error("Wait for the credit decision before taking more payments");
      const paid = await paidOn(tx, id);
      if (paid + amount > b.sellPrice) throw new Error(`Only ${sar(b.sellPrice - paid)} is still owed`);
      const acct = ["retail", "corporate"].includes(str(fd, "account")) ? str(fd, "account") : b.account;
      await tx.insert(schema.payments).values({ bookingId: id, clientId: b.clientId, account: acct, method, amount, reference: optStr(fd, "reference")?.slice(0, 60) ?? null, businessDate: businessDate(new Date(), s.closeHour), recordedBy: u.id });
      await audit(tx, { actorId: u.id, action: "payment.recorded", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Received ${sar(amount)} by ${method} for ${b.ref} into ${ACCOUNT[acct]}` });
    });
  } catch (e) { return toState(e); }
  await flash("Payment recorded");
  revalidatePath(`/adminwork/sales/${id}`);
  return null;
}

export async function voidBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), reason = str(fd, "reason");
  if (!reason) return { error: "Give a reason for voiding" };
  if (reason.length > 1000) return { error: "Keep the reason under 1,000 characters" };
  try {
    await loadScopedBooking(u, id);
    const s = await getSettings();
    const ref = await db.transaction(async (tx) => {
      // Locked and checked inside one transaction, so a payment can't land on it mid-void.
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      const own = b.preparedBy === u.id && b.status !== "issued";
      if (!own && !can(u, "sales.edit")) throw new Error("You can't void this sale");
      if (["void", "refunded"].includes(b.status)) throw new Error("Already closed");
      if (b.recognizedCycleId) throw new Error("This sale is part of a signed Day-25 settlement. Request a refund instead");
      // An issued ticket can only be voided on the day it was issued (the airline void window). After that it's a refund, which directors approve.
      if (b.status === "issued" && (!b.issuedAt || businessDate(b.issuedAt, s.closeHour) !== businessDate(new Date(), s.closeHour))) throw new Error("Issued sales can only be voided on the day they were issued. Request a refund instead");
      if ((await paidOn(tx, id)) > 0) throw new Error("Money was received for this sale. Request a refund instead");
      await tx.update(schema.bookings).set({ status: "void", returnNote: reason, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await tx.update(schema.approvalRequests).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, "pending")));
      await audit(tx, { actorId: u.id, action: "booking.voided", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Voided ${b.ref}: "${reason}"` });
      return b.ref;
    });
    await flash(`${ref} voided`);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

export async function requestRefund(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!can(u, "sales.create") && !can(u, "sales.edit")) return { error: "You can't request refunds" };
  const id = str(fd, "id"), reason = str(fd, "reason");
  if (!reason) return { error: "Explain the refund so directors can decide" };
  if (reason.length > 1000) return { error: "Keep the reason under 1,000 characters" };
  try {
    await loadScopedBooking(u, id);
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (b.status !== "issued") throw new Error("Only issued sales can be refunded");
      const [open] = await tx.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.kind, "refund"), eq(schema.approvalRequests.status, "pending")));
      if (open) throw new Error(`A refund request (${open.ref}) is already open`);
      const r = await createApproval(tx, { kind: "refund", entityType: "booking", entityId: id, title: `Refund ${b.ref} · ${b.passengers}`, amount: b.sellPrice, reason, requestedBy: u.id });
      await flash(`Refund request ${r.ref} sent`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

export async function paySupplier(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!can(u, "finance.reconcile")) return { error: "You can't record supplier payments" };
  const id = str(fd, "id"), source = str(fd, "source");
  try {
    await loadScopedBooking(u, id);
    if (source === "partner" && !u.partnerId) throw new Error("Only a partner can record a partner-paid supplier cost");
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      await recordSupplierPayment(tx, b, { source: source === "partner" ? "partner" : "bank", account: str(fd, "account") || "retail", partnerId: optStr(fd, "partnerId"), method: str(fd, "method") || "transfer", reference: optStr(fd, "reference"), recordedBy: u.id });
    });
    await flash(source === "partner" ? "Sent to the other directors to approve" : "Supplier marked paid");
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}
