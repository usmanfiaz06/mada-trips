import "server-only";
import { and, eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { ACCOUNT } from "./labels";
import { sar } from "./money";
import { riyadhDate } from "./dates";

type Booking = typeof schema.bookings.$inferSelect;

/**
 * Record how a booking's supplier cost is being settled.
 *  - bank: paid from a company account now → cash out of that bank, booking marked paid.
 *  - partner: a partner fronted it → the other directors must approve; once they do, it's owed back to that partner.
 */
export async function recordSupplierPayment(tx: Tx, b: Booking, opts: {
  source: "bank" | "partner"; account?: string | null; partnerId?: string | null; method?: string; reference?: string | null; recordedBy: string;
}) {
  if (b.netCost <= 0) throw new Error("This booking has no supplier cost to pay");
  if (b.supplierPaid) throw new Error("The supplier is already paid for this booking");
  const [openSp] = await tx.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.bookingId, b.id), eq(schema.supplierPayments.status, "pending_approval")));
  if (openSp) throw new Error("A supplier payment for this booking is already waiting for approval");
  const amount = b.netCost;
  const method = opts.method === "cash" ? "cash" : "transfer";

  if (opts.source === "bank") {
    if (!opts.account || !["retail", "corporate"].includes(opts.account)) throw new Error("Choose which bank paid the supplier");
    await tx.insert(schema.supplierPayments).values({ bookingId: b.id, supplier: b.supplier ?? "—", amount, source: "bank", account: opts.account, method, reference: opts.reference ?? null, status: "settled", paidOn: riyadhDate(), recordedBy: opts.recordedBy });
    await tx.update(schema.bookings).set({ supplierPaid: true, updatedAt: new Date() }).where(eq(schema.bookings.id, b.id));
    await audit(tx, { actorId: opts.recordedBy, action: "supplier.paid", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `Paid supplier ${b.supplier ?? ""} SAR ${sar(amount)} for ${b.ref} from ${ACCOUNT[opts.account]}` });
    return { pending: false };
  }

  // Partner fronted it: needs the other directors' approval before it lands on their ledger.
  if (!opts.partnerId) throw new Error("Choose which partner paid");
  const [p] = await tx.select().from(schema.partners).where(eq(schema.partners.id, opts.partnerId));
  if (!p) throw new Error("Choose which partner paid");
  const [sp] = await tx.insert(schema.supplierPayments).values({ bookingId: b.id, supplier: b.supplier ?? "—", amount, source: "partner", partnerId: p.id, method: "cash", reference: opts.reference ?? null, status: "pending_approval", paidOn: riyadhDate(), recordedBy: opts.recordedBy }).returning();
  const req = await createApproval(tx, { kind: "supplier", entityType: "booking", entityId: b.id, title: `${p.name} paid supplier ${b.supplier ?? ""} · ${b.ref}`, amount, reason: `Supplier cost for ${b.ref} fronted by ${p.name}`, requestedBy: opts.recordedBy, payload: { partnerId: p.id } });
  await tx.update(schema.supplierPayments).set({ approvalId: req.id }).where(eq(schema.supplierPayments.id, sp.id));
  await audit(tx, { actorId: opts.recordedBy, action: "supplier.requested", entityType: "booking", entityId: b.id, entityRef: b.ref, summary: `Recorded that ${p.name} paid supplier ${b.supplier ?? ""} SAR ${sar(amount)} for ${b.ref}; sent to the other directors` });
  return { pending: true };
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** Applied when the directors decide a partner-fronted supplier payment. */
export async function finalizeSupplierPayment(tx: Tx, req: Req, ok: boolean, actorId: string) {
  const [sp] = await tx.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.approvalId, req.id), eq(schema.supplierPayments.status, "pending_approval")));
  if (!sp) return;
  const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, sp.bookingId));
  if (!ok) {
    await tx.update(schema.supplierPayments).set({ status: "cancelled" }).where(eq(schema.supplierPayments.id, sp.id));
    await audit(tx, { actorId: null, action: "supplier.rejected", entityType: "booking", entityId: sp.bookingId, entityRef: b?.ref ?? null, summary: `${req.ref} rejected: supplier payment not recorded` });
    return;
  }
  await tx.update(schema.supplierPayments).set({ status: "settled" }).where(eq(schema.supplierPayments.id, sp.id));
  await tx.update(schema.bookings).set({ supplierPaid: true, updatedAt: new Date() }).where(eq(schema.bookings.id, sp.bookingId));
  if (sp.partnerId) {
    await tx.insert(schema.ledgerEntries).values({ partnerId: sp.partnerId, type: "expense", amount: sp.amount, description: `Supplier cost for ${b?.ref ?? "booking"} · ${sp.supplier}`, sourceType: "supplier", sourceId: sp.bookingId, entryDate: riyadhDate(), createdBy: actorId });
    await audit(tx, { actorId: null, action: "ledger.credited", entityType: "booking", entityId: sp.bookingId, entityRef: b?.ref ?? null, summary: `SAR ${sar(sp.amount)} added to partner ledger: supplier cost for ${b?.ref ?? ""}` });
  }
}
