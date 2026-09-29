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
import { flash, optStr, str, toState, zodError, type ActionState } from "@/lib/actions";
import { AIRLINE_LABELS, AIRPORT_CODES } from "@/lib/travel-data";

const money = z.string().transform((v, ctx) => {
  try { return toHalalas(v); } catch { ctx.addIssue({ code: "custom", message: "Enter a valid amount" }); return z.NEVER; }
});

const SaleSchema = z.object({
  clientId: z.string().optional(),
  newClientName: z.string().optional(),
  newClientPhone: z.string().optional(),
  newClientType: z.enum(["retail", "noncontracted"]).optional(),
  serviceType: z.enum(["flight", "hotel", "visa", "package", "transport", "event", "other"]),
  passengers: z.string().trim().min(2, "Add the passenger or guest name"),
  paxCount: z.coerce.number().int().min(1).max(99),
  description: z.string().trim().max(200).optional(),
  supplier: z.string().trim().max(100).optional(),
  pnr: z.string().trim().max(20).optional(),
  travelDate: z.string().optional(),
  netCost: money.refine((v) => v > 0, "Net cost must be more than zero"),
  sellPrice: money.refine((v) => v > 0, "Selling price must be more than zero"),
  paidNow: money,
  method: z.enum(["cash", "mada", "card", "transfer"]),
  paymentRef: z.string().trim().max(60).optional(),
  issueNow: z.string().optional(),
  ticketNumbers: z.string().trim().max(200).optional(),
  creditReason: z.string().trim().max(500).optional(),
  note: z.string().trim().max(1000).optional(),
});

export async function createSale(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  if (!can(u, "sales.create")) return { error: "You can't create sales" };
  const parsed = SaleSchema.safeParse(Object.fromEntries(fd));
  if (!parsed.success) return zodError(parsed.error);
  const v = parsed.data;
  if (v.paidNow < 0 || v.paidNow > v.sellPrice) return { error: "Amount paid can't be more than the selling price", fields: { paidNow: "x" } };
  if (v.serviceType === "flight" && !v.pnr) return { error: "Flights need a PNR", fields: { pnr: "x" } };
  if (v.serviceType === "flight") {
    const m = /^([A-Z]{3}) (→|⇄) ([A-Z]{3})$/.exec(v.description ?? "");
    if (!m || !AIRPORT_CODES.has(m[1]) || !AIRPORT_CODES.has(m[3])) return { error: "Pick both airports from the list", fields: { description: "x" } };
    if (m[1] === m[3]) return { error: "From and To can't be the same airport", fields: { description: "x" } };
    if (!v.supplier || !AIRLINE_LABELS.has(v.supplier)) return { error: "Pick the airline from the list", fields: { supplier: "x" } };
  }

  let id = "";
  try {
    const s = await getSettings();
    id = await db.transaction(async (tx) => {
      // Client: pick existing or create inline.
      let client: typeof schema.clients.$inferSelect | undefined;
      if (v.clientId) {
        [client] = await tx.select().from(schema.clients).where(eq(schema.clients.id, v.clientId));
      } else if (v.newClientName?.trim()) {
        [client] = await tx.insert(schema.clients).values({ name: v.newClientName.trim(), phone: v.newClientPhone?.trim() || null, type: v.newClientType ?? "retail", createdBy: u.id }).returning();
        await audit(tx, { actorId: u.id, action: "client.created", entityType: "client", entityId: client.id, entityRef: client.name, summary: `Added client ${client.name}` });
      }
      if (!client) throw new Error("Choose a client or add a new one");

      const channel = client.type === "retail" ? "retail" : "corporate";
      const account = channel; // funds must land in the matching bank account
      const bdate = businessDate(new Date(), s.closeHour);
      const unpaid = v.sellPrice - v.paidNow;

      // Governance: who may extend credit for the unpaid part?
      let needsCredit = false;
      let creditReason = v.creditReason || null;
      if (unpaid > 0) {
        if (client.type === "contracted") {
          const exposure = await clientExposure(tx, client.id);
          if (exposure + unpaid > client.creditLimit) {
            needsCredit = true;
            creditReason = `Over contract limit: exposure ${sar(exposure)} + ${sar(unpaid)} > limit ${sar(client.creditLimit)}. ${creditReason ?? ""}`.trim();
          }
        } else {
          needsCredit = true;
          if (!creditReason) throw new Error("Say why this client should pay later. Directors will see it");
        }
      }

      const ref = await nextRef(tx, "S", 10000);
      const [b] = await tx.insert(schema.bookings).values({
        ref, channel, account, serviceType: v.serviceType, clientId: client.id, passengers: v.passengers, paxCount: v.paxCount,
        description: v.description || null, supplier: v.supplier || null, pnr: v.pnr?.toUpperCase() || null, travelDate: v.travelDate || null,
        netCost: v.netCost, sellPrice: v.sellPrice, status: needsCredit ? "awaiting_credit" : "pending_issue",
        onCredit: unpaid > 0, dueDate: unpaid > 0 ? addDays(bdate, client.paymentTermsDays || 14) : null,
        businessDate: bdate, preparedBy: u.id,
      }).returning();
      await audit(tx, { actorId: u.id, action: "booking.created", entityType: "booking", entityId: b.id, entityRef: ref,
        summary: `Created ${ref} · ${v.passengers}${v.description ? ` · ${v.description}` : ""} · sell ${sar(v.sellPrice)}, margin ${sar(v.sellPrice - v.netCost)}` });

      if (v.paidNow > 0) {
        await tx.insert(schema.payments).values({ bookingId: b.id, clientId: client.id, account, method: v.method, amount: v.paidNow, reference: v.paymentRef || null, businessDate: bdate, recordedBy: u.id });
        await audit(tx, { actorId: u.id, action: "payment.recorded", entityType: "booking", entityId: b.id, entityRef: ref, summary: `Received ${sar(v.paidNow)} by ${v.method} into ${account} account` });
      }
      if (v.note) {
        await tx.insert(schema.remarks).values({ entityType: "booking", entityId: b.id, userId: u.id, body: v.note });
      }

      if (needsCredit) {
        const req = await createApproval(tx, { kind: "credit", entityType: "booking", entityId: b.id, title: `Credit for ${client.name} · ${ref}`, amount: unpaid, reason: creditReason, requestedBy: u.id });
        await tx.update(schema.bookings).set({ creditApprovalId: req.id }).where(eq(schema.bookings.id, b.id));
        await flash(`${ref} saved. Credit request ${req.ref} sent to directors`);
        return b.id;
      }

      if (v.issueNow === "on") {
        const chk = await issueCheck(tx, u, b);
        if (!chk.ok) {
          await flash(`${ref} saved and sent to issuance (${chk.reason})`);
          return b.id;
        }
        if (v.serviceType === "flight" && !v.ticketNumbers) throw new Error("Enter the ticket number to issue now, or untick Issue now");
        await tx.update(schema.bookings).set({ status: "issued", issuedBy: u.id, issuedAt: new Date(), ticketNumbers: v.ticketNumbers || null, issuedUnderDelegation: chk.delegationId }).where(eq(schema.bookings.id, b.id));
        await audit(tx, { actorId: u.id, action: "booking.issued", entityType: "booking", entityId: b.id, entityRef: ref,
          summary: `Issued ${ref}${v.ticketNumbers ? ` · ticket ${v.ticketNumbers}` : ""}${chk.delegationId ? " (under delegation)" : ""}` });
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

async function loadBooking(id: string) {
  const [b] = await db.select().from(schema.bookings).where(eq(schema.bookings.id, id));
  if (!b) throw new Error("Sale not found");
  return b;
}

export async function issueBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  const tickets = optStr(fd, "ticketNumbers");
  const pnr = optStr(fd, "pnr");
  try {
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      if (b.status !== "pending_issue" && b.status !== "returned") throw new Error("This sale is not waiting to issue");
      const chk = await issueCheck(tx, u, b);
      if (!chk.ok) throw new Error(chk.reason);
      if (b.serviceType === "flight" && !tickets) throw new Error("Enter the ticket number(s)");
      await tx.update(schema.bookings).set({ status: "issued", issuedBy: u.id, issuedAt: new Date(), ticketNumbers: tickets ?? b.ticketNumbers, pnr: pnr?.toUpperCase() ?? b.pnr, issuedUnderDelegation: chk.delegationId, returnNote: null, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await audit(tx, { actorId: u.id, action: "booking.issued", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `Issued ${b.ref}${tickets ? ` · ticket ${tickets}` : ""}${chk.delegationId ? " (under delegation)" : ""}` });
      await flash(`${b.ref} issued`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  const back = str(fd, "back");
  redirect(back || `/adminwork/sales/${id}`);
}

export async function returnBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), note = str(fd, "note");
  if (!note) return { error: "Say what needs fixing so the preparer knows" };
  try {
    const b = await loadBooking(id);
    const chk = await issueCheck(db, u, b);
    if (!chk.ok && !can(u, "issue.delegate")) throw new Error("Only issuers can send a sale back");
    if (b.status !== "pending_issue") throw new Error("Only sales waiting to issue can be sent back");
    await db.transaction(async (tx) => {
      await tx.update(schema.bookings).set({ status: "returned", returnNote: note, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await tx.insert(schema.remarks).values({ entityType: "booking", entityId: id, userId: u.id, body: note });
      await audit(tx, { actorId: u.id, action: "booking.returned", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Sent ${b.ref} back: "${note}"` });
    });
    await flash(`${b.ref} sent back to the preparer`);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(str(fd, "back") || `/adminwork/sales/${id}`);
}

export async function resubmitBooking(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  try {
    const b = await loadBooking(id);
    if (b.status !== "returned") throw new Error("Only sent-back sales can be resubmitted");
    if (b.preparedBy !== u.id && !can(u, "sales.edit")) throw new Error("Only the preparer can resubmit");
    const patch = {
      pnr: optStr(fd, "pnr")?.toUpperCase() ?? b.pnr,
      netCost: fd.get("netCost") ? toHalalas(str(fd, "netCost")) : b.netCost,
      sellPrice: fd.get("sellPrice") ? toHalalas(str(fd, "sellPrice")) : b.sellPrice,
    };
    const { diff } = await import("@/lib/audit");
    await db.transaction(async (tx) => {
      await tx.update(schema.bookings).set({ ...patch, status: "pending_issue", updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await audit(tx, { actorId: u.id, action: "booking.resubmitted", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Fixed and resubmitted ${b.ref}`, changes: diff(b, patch) });
    });
    await flash(`${b.ref} resubmitted for issuing`);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

export async function recordPayment(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  try {
    const amount = toHalalas(str(fd, "amount"));
    const method = str(fd, "method");
    if (amount <= 0) throw new Error("Enter the amount received");
    if (!["cash", "mada", "card", "transfer"].includes(method)) throw new Error("Choose how they paid");
    const s = await getSettings();
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, id)).for("update");
      if (!b) throw new Error("Sale not found");
      if (["void", "refunded"].includes(b.status)) throw new Error("This sale is closed");
      const [paid] = await tx.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) }).from(schema.payments).where(eq(schema.payments.bookingId, id));
      if (paid.total + amount > b.sellPrice) throw new Error(`Only ${sar(b.sellPrice - paid.total)} is still owed`);
      await tx.insert(schema.payments).values({ bookingId: id, clientId: b.clientId, account: b.account, method, amount, reference: optStr(fd, "reference"), businessDate: businessDate(new Date(), s.closeHour), recordedBy: u.id });
      await audit(tx, { actorId: u.id, action: "payment.recorded", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Received ${sar(amount)} by ${method} for ${b.ref} into ${b.account} account` });
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
  try {
    const b = await loadBooking(id);
    const own = b.preparedBy === u.id && b.status !== "issued";
    if (!own && !can(u, "sales.edit")) throw new Error("You can't void this sale");
    if (["void", "refunded"].includes(b.status)) throw new Error("Already closed");
    const [paid] = await db.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) }).from(schema.payments).where(eq(schema.payments.bookingId, id));
    if (paid.total > 0) throw new Error("Money was received for this sale. Request a refund instead");
    await db.transaction(async (tx) => {
      await tx.update(schema.bookings).set({ status: "void", returnNote: reason, updatedAt: new Date() }).where(eq(schema.bookings.id, id));
      await tx.update(schema.approvalRequests).set({ status: "cancelled", decidedAt: new Date() }).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.status, "pending")));
      await audit(tx, { actorId: u.id, action: "booking.voided", entityType: "booking", entityId: id, entityRef: b.ref, summary: `Voided ${b.ref}: "${reason}"` });
    });
    await flash(`${b.ref} voided`);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}

export async function requestRefund(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), reason = str(fd, "reason");
  if (!reason) return { error: "Explain the refund so directors can decide" };
  try {
    const b = await loadBooking(id);
    if (b.status !== "issued") throw new Error("Only issued sales can be refunded");
    await db.transaction(async (tx) => {
      const [open] = await tx.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.kind, "refund"), eq(schema.approvalRequests.status, "pending")));
      if (open) throw new Error(`A refund request (${open.ref}) is already open`);
      const r = await createApproval(tx, { kind: "refund", entityType: "booking", entityId: id, title: `Refund ${b.ref} · ${b.passengers}`, amount: b.sellPrice, reason, requestedBy: u.id });
      await flash(`Refund request ${r.ref} sent`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/sales/${id}`);
}
