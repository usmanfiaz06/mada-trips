import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { accountNameTx, isValidAccount } from "./accounts";
import { sar } from "./money";
import { riyadhDate } from "./dates";

type Q = Tx | typeof db;
type Portal = typeof schema.portals.$inferSelect;

/* ─────────────── Balances ─────────────── */

// A portal's live balance = funds in − funds out (settled ledger) − sales drawn from it (settled, still live).
// Positive = prepaid funds we hold; negative = credit used and owed. Pending (unapproved) entries don't count.
export async function portalBalances(q: Q = db) {
  const portals = await q.select().from(schema.portals).orderBy(schema.portals.sort, schema.portals.name);
  const led = await q.select({
    portalId: schema.portalLedger.portalId, direction: schema.portalLedger.direction,
    total: sql<number>`coalesce(sum(${schema.portalLedger.amount}),0)::bigint`.mapWith(Number),
  }).from(schema.portalLedger).where(eq(schema.portalLedger.status, "settled")).groupBy(schema.portalLedger.portalId, schema.portalLedger.direction);
  // A voided/refunded sale returns its funds to the portal, so its usage drops out of the balance.
  const live = sql`NOT EXISTS (SELECT 1 FROM ${schema.bookings} bx WHERE bx.id = ${schema.supplierPayments.bookingId} AND bx.status IN ('void','refunded'))`;
  const use = await q.select({
    portalId: schema.supplierPayments.portalId,
    total: sql<number>`coalesce(sum(${schema.supplierPayments.amount}),0)::bigint`.mapWith(Number),
  }).from(schema.supplierPayments).where(and(eq(schema.supplierPayments.source, "portal"), eq(schema.supplierPayments.status, "settled"), live)).groupBy(schema.supplierPayments.portalId);
  // Usage still awaiting approval — shown as "pending" so the balance the directors will see is clear.
  const pend = await q.select({
    portalId: schema.supplierPayments.portalId,
    total: sql<number>`coalesce(sum(${schema.supplierPayments.amount}),0)::bigint`.mapWith(Number),
  }).from(schema.supplierPayments).where(and(eq(schema.supplierPayments.source, "portal"), eq(schema.supplierPayments.status, "pending_approval"), live)).groupBy(schema.supplierPayments.portalId);

  return portals.map((p) => {
    const io = (d: string) => led.find((r) => r.portalId === p.id && r.direction === d)?.total ?? 0;
    const used = use.find((r) => r.portalId === p.id)?.total ?? 0;
    const pending = pend.find((r) => r.portalId === p.id)?.total ?? 0;
    const balance = io("in") - io("out") - used;
    // Headroom = how much more can be spent before hitting the credit floor (−creditLimit).
    return { ...p, balance, pending, headroom: balance + p.creditLimit };
  });
}

export async function portalById(q: Q, id: string): Promise<Portal | undefined> {
  const [p] = await q.select().from(schema.portals).where(eq(schema.portals.id, id));
  return p;
}

/** One portal's statement — every movement, most recent first: deposits, sales drawn, refunds, penalties. */
export async function portalStatement(q: Q, portalId: string, limit = 60) {
  const rows = await q.execute<{ date: string; kind: string; label: string; ref: string | null; amount: number; status: string; by: string | null }>(sql`
    (SELECT l.entry_date::text AS date, l.kind, coalesce(l.note, l.kind) AS label, l.reference AS ref,
            (CASE WHEN l.direction='in' THEN l.amount ELSE -l.amount END)::bigint AS amount, l.status, u.name AS by
       FROM portal_ledger l LEFT JOIN users u ON u.id = l.recorded_by WHERE l.portal_id = ${portalId} AND l.status <> 'cancelled')
    UNION ALL
    (SELECT sp.paid_on::text, 'usage', coalesce(b.ref,'sale'), sp.supplier, -sp.amount::bigint, sp.status, u.name
       FROM supplier_payments sp JOIN bookings b ON b.id = sp.booking_id LEFT JOIN users u ON u.id = sp.recorded_by
       WHERE sp.source='portal' AND sp.portal_id = ${portalId} AND sp.status <> 'cancelled' AND b.status NOT IN ('void','refunded'))
    ORDER BY date DESC LIMIT ${limit}`);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/* ─────────────── Managing portals ─────────────── */

export async function addPortal(tx: Tx, opts: { name: string; creditLimit: number; notes?: string | null; createdBy: string }) {
  const name = opts.name.trim();
  if (!name) throw new Error("Give the portal a name");
  if (opts.creditLimit < 0) throw new Error("Credit limit can't be negative");
  const [{ n }] = await tx.select({ n: sql<number>`count(*)::int`.mapWith(Number) }).from(schema.portals);
  const [p] = await tx.insert(schema.portals).values({ name, creditLimit: opts.creditLimit, notes: opts.notes ?? null, sort: n, createdBy: opts.createdBy }).returning();
  await audit(tx, { actorId: opts.createdBy, action: "portal.added", entityType: "portal", entityId: p.id, entityRef: name, summary: `Added B2B portal ${name}${opts.creditLimit > 0 ? ` with a SAR ${sar(opts.creditLimit)} credit line` : ""}` });
  return p;
}

export async function updatePortal(tx: Tx, id: string, opts: { name?: string; creditLimit?: number; active?: boolean; notes?: string | null }, actorId: string) {
  const [p] = await tx.select().from(schema.portals).where(eq(schema.portals.id, id));
  if (!p) throw new Error("Portal not found");
  const set: Partial<Portal> = {};
  if (opts.name !== undefined && opts.name.trim() && opts.name.trim() !== p.name) set.name = opts.name.trim();
  if (opts.creditLimit !== undefined && opts.creditLimit >= 0 && opts.creditLimit !== p.creditLimit) set.creditLimit = opts.creditLimit;
  if (opts.active !== undefined && opts.active !== p.active) set.active = opts.active;
  if (opts.notes !== undefined) set.notes = opts.notes;
  if (Object.keys(set).length === 0) return;
  await tx.update(schema.portals).set(set).where(eq(schema.portals.id, id));
  await audit(tx, { actorId, action: "portal.updated", entityType: "portal", entityId: id, entityRef: set.name ?? p.name, summary: `Updated portal ${set.name ?? p.name}` });
}

/* ─────────────── Funding (deposit / credit repayment) & adjustments — director-approved ─────────────── */

/**
 * Deposit money into a portal, or repay used credit — same movement either way (money leaves a company bank,
 * or a partner fronts it; the portal's balance goes up). Recorded as pending and settled once a director
 * approves it. A partner-funded deposit is owed back to that partner, like a partner-fronted supplier cost.
 */
export async function recordFund(tx: Tx, opts: { portalId: string; source: "bank" | "partner"; account?: string | null; partnerId?: string | null; amount: number; reference?: string | null; note?: string | null; recordedBy: string }) {
  const p = await portalById(tx, opts.portalId);
  if (!p || !p.active) throw new Error("Choose a portal");
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) throw new Error("Enter how much is being deposited");
  if (opts.source === "bank") {
    if (!opts.account || !(await isValidAccount(opts.account))) throw new Error("Choose which bank the deposit comes from");
  } else {
    if (!opts.partnerId) throw new Error("Choose which partner is funding it");
    const [pt] = await tx.select().from(schema.partners).where(eq(schema.partners.id, opts.partnerId));
    if (!pt) throw new Error("Choose which partner is funding it");
  }
  const [entry] = await tx.insert(schema.portalLedger).values({
    portalId: p.id, kind: "fund", direction: "in", amount: opts.amount, source: opts.source,
    account: opts.source === "bank" ? opts.account : null, partnerId: opts.source === "partner" ? opts.partnerId : null,
    status: "pending_approval", reference: opts.reference ?? null, note: opts.note ?? null, entryDate: riyadhDate(), recordedBy: opts.recordedBy,
  }).returning();
  const from = opts.source === "bank" ? await accountNameTx(tx, opts.account!) : "a partner";
  const req = await createApproval(tx, {
    kind: "portal", entityType: "portal", entityId: p.id, title: `Deposit SAR ${sar(opts.amount)} to ${p.name} from ${from}`,
    amount: opts.amount, reason: opts.note ?? null, requestedBy: opts.recordedBy,
    payload: { ledgerId: entry.id, partnerId: opts.source === "partner" ? opts.partnerId : undefined },
  });
  await tx.update(schema.portalLedger).set({ approvalId: req.id }).where(eq(schema.portalLedger.id, entry.id));
  await audit(tx, { actorId: opts.recordedBy, action: "portal.fund_requested", entityType: "portal", entityId: p.id, entityRef: p.name, summary: `Recorded a SAR ${sar(opts.amount)} deposit to ${p.name} from ${from}; sent for approval` });
  return { pending: true };
}

/** A manual correction to a portal's balance (reconciliation), director-approved. */
export async function recordAdjustment(tx: Tx, opts: { portalId: string; direction: "in" | "out"; amount: number; note: string; recordedBy: string }) {
  const p = await portalById(tx, opts.portalId);
  if (!p) throw new Error("Choose a portal");
  if (!Number.isFinite(opts.amount) || opts.amount <= 0) throw new Error("Enter an amount");
  if (!opts.note.trim()) throw new Error("Add a note explaining the adjustment");
  const [entry] = await tx.insert(schema.portalLedger).values({
    portalId: p.id, kind: "adjustment", direction: opts.direction, amount: opts.amount,
    status: "pending_approval", note: opts.note.trim(), entryDate: riyadhDate(), recordedBy: opts.recordedBy,
  }).returning();
  const req = await createApproval(tx, {
    kind: "portal", entityType: "portal", entityId: p.id,
    title: `Adjust ${p.name} ${opts.direction === "in" ? "+" : "−"}SAR ${sar(opts.amount)}`, amount: opts.amount, reason: opts.note.trim(), requestedBy: opts.recordedBy,
    payload: { ledgerId: entry.id },
  });
  await tx.update(schema.portalLedger).set({ approvalId: req.id }).where(eq(schema.portalLedger.id, entry.id));
  await audit(tx, { actorId: opts.recordedBy, action: "portal.adjust_requested", entityType: "portal", entityId: p.id, entityRef: p.name, summary: `Requested a ${opts.direction === "in" ? "+" : "−"}SAR ${sar(opts.amount)} adjustment to ${p.name}` });
  return { pending: true };
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** Applied when a director decides a portal fund / adjustment. */
export async function finalizePortalEntry(tx: Tx, req: Req, ok: boolean, actorId: string) {
  const payload = req.payload as { ledgerId?: string } | null;
  if (!payload?.ledgerId) return;
  const [entry] = await tx.select().from(schema.portalLedger).where(and(eq(schema.portalLedger.id, payload.ledgerId), eq(schema.portalLedger.status, "pending_approval")));
  if (!entry) return;
  const p = await portalById(tx, entry.portalId);
  if (!ok) {
    await tx.update(schema.portalLedger).set({ status: "cancelled" }).where(eq(schema.portalLedger.id, entry.id));
    await audit(tx, { actorId: null, action: "portal.entry_rejected", entityType: "portal", entityId: entry.portalId, entityRef: p?.name ?? null, summary: `${req.ref} rejected: ${entry.kind} not recorded` });
    return;
  }
  await tx.update(schema.portalLedger).set({ status: "settled" }).where(eq(schema.portalLedger.id, entry.id));
  // A partner who fronted a deposit is now owed it back (Partner Equity Ledger), like a fronted supplier cost.
  if (entry.kind === "fund" && entry.source === "partner" && entry.partnerId) {
    await tx.insert(schema.ledgerEntries).values({ partnerId: entry.partnerId, type: "expense", amount: entry.amount, description: `Deposit to ${p?.name ?? "portal"}`, sourceType: "portal", sourceId: entry.portalId, entryDate: riyadhDate(), createdBy: actorId });
    await audit(tx, { actorId: null, action: "ledger.credited", entityType: "portal", entityId: entry.portalId, entityRef: p?.name ?? null, summary: `SAR ${sar(entry.amount)} added to partner ledger: deposit to ${p?.name ?? "portal"}` });
  }
  await audit(tx, { actorId: null, action: "portal.settled", entityType: "portal", entityId: entry.portalId, entityRef: p?.name ?? null, summary: `${req.ref} approved: ${entry.kind} of SAR ${sar(entry.amount)} on ${p?.name ?? "portal"}` });
}

/**
 * A cancellation penalty the platform kept on a refunded portal-funded booking: it reduces the portal balance
 * and is a real cost. Called from the refund approval once it is granted (no separate approval).
 */
export async function recordPortalPenalty(tx: Tx, booking: { id: string; ref: string }, fee: number, actorId: string | null, recordedBy: string) {
  if (fee <= 0) return;
  const [sp] = await tx.select().from(schema.supplierPayments).where(and(eq(schema.supplierPayments.bookingId, booking.id), eq(schema.supplierPayments.source, "portal"), eq(schema.supplierPayments.status, "settled")));
  if (!sp?.portalId) return;
  await tx.insert(schema.portalLedger).values({ portalId: sp.portalId, kind: "penalty", direction: "out", amount: fee, bookingId: booking.id, status: "settled", note: `Cancellation fee · ${booking.ref}`, entryDate: riyadhDate(), recordedBy });
  const p = await portalById(tx, sp.portalId);
  await audit(tx, { actorId, action: "portal.penalty", entityType: "booking", entityId: booking.id, entityRef: booking.ref, summary: `${p?.name ?? "Portal"} kept SAR ${sar(fee)} on ${booking.ref}` });
}
