import "server-only";
import { and, desc, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { accountNameTx, isValidAccount } from "./accounts";
import { nextRef } from "./refs";
import { sar } from "./money";
import { riyadhDate } from "./dates";

type Q = Tx | typeof db;

/** A team member's commission setup: whether it's on, the default rate/basis, and the first date they earn it. */
export async function setMemberCommission(tx: Tx, memberId: string, opts: { enabled: boolean; rateBps: number; basis: "profit" | "revenue"; from: string | null }, actorId: string) {
  const [m] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, memberId));
  if (!m) throw new Error("Team member not found");
  const rateBps = Math.max(0, Math.min(5000, Math.round(opts.rateBps)));
  await tx.update(schema.users).set({ commissionEnabled: opts.enabled, commissionBps: rateBps, commissionBasis: opts.basis === "revenue" ? "revenue" : "profit", commissionFrom: opts.from })
    .where(eq(schema.users.id, memberId));
  await audit(tx, { actorId, action: "commission.config", entityType: "user", entityId: memberId, entityRef: m.name,
    summary: `${opts.enabled ? "Enabled" : "Disabled"} commission for ${m.name}${opts.enabled ? ` · ${rateBps / 100}% of ${opts.basis}${opts.from ? ` from ${opts.from}` : ""}` : ""}` });
}

export type CommissionSaleRow = { id: string; ref: string; date: string; serviceType: string; client: string; revenue: number; margin: number; paid: boolean };

/** Sales credited to a member in [from, to], each flagged whether a commission payout already covers it. */
export async function memberCommissionView(q: Q, userId: string, from: string, to: string) {
  const rows = await q.execute<{ id: string; ref: string; business_date: string; service_type: string; client: string; sell_price: number; net_cost: number; covered: boolean }>(sql`
    SELECT b.id, b.ref, b.business_date, b.service_type, cl.name AS client, b.sell_price::bigint, b.net_cost::bigint,
      (b.commission_payment_id IS NOT NULL) AS covered
    FROM bookings b JOIN clients cl ON cl.id = b.client_id
    WHERE COALESCE(b.sold_by, b.prepared_by) = ${userId} AND b.business_date BETWEEN ${from} AND ${to}
      AND b.status NOT IN ('void','refunded','draft')
    ORDER BY b.business_date, b.ref`);
  const sales: CommissionSaleRow[] = rows.map((r) => ({ id: r.id, ref: r.ref, date: r.business_date, serviceType: r.service_type, client: r.client,
    revenue: Number(r.sell_price), margin: Number(r.sell_price) - Number(r.net_cost), paid: r.covered }));
  const unpaid = sales.filter((s) => !s.paid);
  const paid = sales.filter((s) => s.paid);
  const totalOf = (list: CommissionSaleRow[]) => ({ revenue: list.reduce((a, s) => a + s.revenue, 0), margin: list.reduce((a, s) => a + s.margin, 0) });
  return { sales, unpaid, paid, unpaidTotals: totalOf(unpaid), paidTotals: totalOf(paid) };
}

/** Record a commission payout for a member over a period. Pays only the sales not already covered, reserving
 *  them at once so they can't be double-paid, and sends it to a director to approve before any money moves. */
export async function recordCommissionPayment(tx: Tx, opts: {
  memberId: string; periodStart: string; periodEnd: string; basis: "profit" | "revenue"; rateBps: number; account: string; note?: string | null; requestedBy: string;
}) {
  const [m] = await tx.select().from(schema.users).where(eq(schema.users.id, opts.memberId));
  if (!m) throw new Error("Team member not found");
  if (!m.commissionEnabled) throw new Error("Commission isn't turned on for this person. Enable it first");
  if (!(await isValidAccount(opts.account))) throw new Error("Choose which bank account pays the commission");
  const rateBps = Math.max(0, Math.min(5000, Math.round(opts.rateBps)));
  if (rateBps <= 0) throw new Error("Enter a commission rate");
  // Respect the member's eligibility start date.
  const start = m.commissionFrom && m.commissionFrom > opts.periodStart ? m.commissionFrom : opts.periodStart;
  if (start > opts.periodEnd) throw new Error("This person earns commission only from a later date than the period you picked");

  // Lock the unpaid, eligible sales so a second payout can't grab the same ones.
  const bookings = await tx.select({ id: schema.bookings.id, sell: schema.bookings.sellPrice, net: schema.bookings.netCost }).from(schema.bookings)
    .where(and(sql`COALESCE(${schema.bookings.soldBy}, ${schema.bookings.preparedBy}) = ${opts.memberId}`,
      gte(schema.bookings.businessDate, start), lte(schema.bookings.businessDate, opts.periodEnd),
      sql`${schema.bookings.status} NOT IN ('void','refunded','draft')`, isNull(schema.bookings.commissionPaymentId)))
    .for("update");
  if (!bookings.length) throw new Error("No unpaid sales for this person in this period — nothing to pay");
  const base = opts.basis === "revenue" ? bookings.reduce((s, b) => s + b.sell, 0) : bookings.reduce((s, b) => s + (b.sell - b.net), 0);
  const amount = Math.floor((Math.max(0, base) * rateBps) / 10000);
  if (amount <= 0) throw new Error("This works out to zero commission — check the basis and rate");

  const ref = await nextRef(tx, "CM");
  const [pay] = await tx.insert(schema.commissionPayments).values({
    ref, memberId: opts.memberId, periodStart: start, periodEnd: opts.periodEnd, basis: opts.basis, rateBps,
    baseAmount: base, amount, salesCount: bookings.length, account: opts.account, status: "pending_approval",
    note: opts.note ?? null, requestedBy: opts.requestedBy,
  }).returning();
  // Reserve the sales to this payout immediately (cleared again if it's rejected).
  await tx.update(schema.bookings).set({ commissionPaymentId: pay.id, updatedAt: new Date() }).where(inArray(schema.bookings.id, bookings.map((b) => b.id)));
  const req = await createApproval(tx, { kind: "commission", entityType: "commission", entityId: pay.id,
    title: `Commission to ${m.name} · ${sar(amount)}`, amount,
    reason: `${rateBps / 100}% of ${opts.basis} on ${bookings.length} sales (${start} → ${opts.periodEnd})${opts.note ? ` · ${opts.note}` : ""}`,
    requestedBy: opts.requestedBy, payload: { memberId: opts.memberId } });
  await tx.update(schema.commissionPayments).set({ approvalId: req.id }).where(eq(schema.commissionPayments.id, pay.id));
  await audit(tx, { actorId: opts.requestedBy, action: "commission.requested", entityType: "commission", entityId: pay.id, entityRef: ref,
    summary: `Recorded commission ${ref} for ${m.name}: ${sar(amount)} (${rateBps / 100}% of ${opts.basis}, ${bookings.length} sales); sent to the directors` });
  return { ref, amount, count: bookings.length };
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** Apply a director's decision on a commission payout. */
export async function finalizeCommissionPayment(tx: Tx, req: Req, ok: boolean, actorId: string) {
  const [pay] = await tx.select().from(schema.commissionPayments).where(and(eq(schema.commissionPayments.id, req.entityId), eq(schema.commissionPayments.status, "pending_approval")));
  if (!pay) return;
  const [m] = await tx.select({ name: schema.users.name }).from(schema.users).where(eq(schema.users.id, pay.memberId));
  const label = `${pay.periodStart} → ${pay.periodEnd}`;
  if (!ok) {
    // Release the reserved sales so they can be paid in a future payout.
    await tx.update(schema.bookings).set({ commissionPaymentId: null, updatedAt: new Date() }).where(eq(schema.bookings.commissionPaymentId, pay.id));
    await tx.update(schema.commissionPayments).set({ status: "cancelled" }).where(eq(schema.commissionPayments.id, pay.id));
    await audit(tx, { actorId: null, action: "commission.rejected", entityType: "commission", entityId: pay.id, entityRef: pay.ref, summary: `${req.ref} rejected: commission to ${m?.name ?? "member"} not paid` });
    return;
  }
  await tx.update(schema.commissionPayments).set({ status: "paid", paidOn: riyadhDate() }).where(eq(schema.commissionPayments.id, pay.id));
  // Real money out of the chosen bank, so the bank balance and the P&L both reflect it.
  if (pay.account) {
    await tx.insert(schema.bankTransactions).values({ account: pay.account, direction: "out", kind: "commission", amount: pay.amount,
      note: `Commission ${pay.ref} · ${m?.name ?? "member"} · ${label}`, txnDate: riyadhDate(), recordedBy: pay.requestedBy });
  }
  await audit(tx, { actorId: null, action: "commission.paid", entityType: "commission", entityId: pay.id, entityRef: pay.ref,
    summary: `Paid commission ${pay.ref} to ${m?.name ?? "member"}: ${sar(pay.amount)} from ${pay.account ? await accountNameTx(tx, pay.account) : "a company bank"}` });
}

export type CommissionHistoryRow = typeof schema.commissionPayments.$inferSelect & { memberName: string | null; byName: string | null };

/** Commission payouts, newest first. Pass a memberId to see one person's. */
export async function commissionHistory(q: Q = db, memberId?: string): Promise<CommissionHistoryRow[]> {
  const member = schema.users;
  const rows = await q.select({ c: schema.commissionPayments, memberName: member.name }).from(schema.commissionPayments)
    .leftJoin(member, eq(member.id, schema.commissionPayments.memberId))
    .where(memberId ? eq(schema.commissionPayments.memberId, memberId) : sql`true`)
    .orderBy(desc(schema.commissionPayments.createdAt));
  const names = new Map((await q.select({ id: schema.users.id, name: schema.users.name }).from(schema.users)).map((u) => [u.id, u.name]));
  return rows.map((r) => ({ ...r.c, memberName: r.memberName, byName: names.get(r.c.requestedBy) ?? null }));
}
