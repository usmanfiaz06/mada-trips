import "server-only";
import { and, eq, gte, lte, ne, sql } from "drizzle-orm";
import { db, schema, type DB, type Tx } from "@/db";
import { cashPosition, receivables, payables, partnerBalances } from "./finance";

type Q = DB | Tx;

/**
 * Where the company stands right now (a balance sheet): what it has (cash in each bank + money clients still
 * owe) against what it owes (suppliers, upcoming IATA/BSP, and partners' capital). Net worth is the difference
 * — negative means the company hasn't yet earned back everything the partners put in.
 */
export type BalanceSheet = {
  cash: { account: string; name: string; balance: number }[]; cashTotal: number; receivable: number; assets: number;
  owedSuppliers: number; owedBsp: number; owedPartners: number; liabilities: number; netWorth: number;
};

/** Net profit (recognised margin − operating expenses) for each of the last `months` calendar months. */
export async function monthlyTrend(q: Q = db, months = 6): Promise<{ ym: string; profit: number }[]> {
  const now = new Date();
  const first = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - (months - 1), 1));
  const from = first.toISOString().slice(0, 10);
  const marginRows = await q.execute<{ ym: string; margin: string }>(sql`
    SELECT to_char(p.last_cleared, 'YYYY-MM') AS ym, coalesce(sum(b.sell_price - b.net_cost),0)::bigint AS margin
    FROM bookings b
    JOIN (SELECT booking_id, SUM(amount) AS paid, MAX(cleared_on) AS last_cleared FROM payments WHERE cleared_on IS NOT NULL GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status = 'issued' AND p.paid >= b.sell_price AND p.last_cleared >= ${from}
    GROUP BY 1`);
  const expRows = await q.execute<{ ym: string; exp: string }>(sql`
    SELECT to_char(expense_date, 'YYYY-MM') AS ym, coalesce(sum(amount),0)::bigint AS exp
    FROM expenses WHERE status = 'approved' AND is_startup = false AND expense_date >= ${from} GROUP BY 1`);
  const m = new Map(marginRows.map((r) => [r.ym, Number(r.margin)]));
  const e = new Map(expRows.map((r) => [r.ym, Number(r.exp)]));
  return Array.from({ length: months }, (_, i) => {
    const d = new Date(Date.UTC(first.getUTCFullYear(), first.getUTCMonth() + i, 1));
    const ym = d.toISOString().slice(0, 7);
    return { ym, profit: (m.get(ym) ?? 0) - (e.get(ym) ?? 0) };
  });
}

export async function balanceSheet(q: Q = db): Promise<BalanceSheet> {
  const [cashPos, recv, pay, partners] = await Promise.all([cashPosition(q), receivables(q), payables(q), partnerBalances(q)]);
  const cash = cashPos.accounts.map((a) => ({ account: a.key, name: a.name, balance: a.balance }));
  const receivable = recv.reduce((s, r) => s + r.owed, 0);
  const assets = cashPos.total + receivable;
  const owedSuppliers = pay.reduce((s, r) => s + r.net_cost, 0);
  const owedBsp = cashPos.upcomingBsp;
  const owedPartners = partners.reduce((s, p) => s + Math.max(0, p.outstanding), 0);
  const liabilities = owedSuppliers + owedBsp + owedPartners;
  return { cash, cashTotal: cashPos.total, receivable, assets, owedSuppliers, owedBsp, owedPartners, liabilities, netWorth: assets - liabilities };
}
const sum = sql<number>`coalesce(sum(amount),0)::bigint`.mapWith(Number);

export type PeriodReport = {
  start: string; end: string;
  pl: {
    revenue: number; directCost: number; grossProfit: number;
    feesEarned: number; feesLost: number;
    expenses: { category: string; total: number }[]; expensesTotal: number;
    commissions: number;
    netProfit: number;
    startupCosts: number; afterStartup: number;
    salesCount: number; refundCount: number;
  };
  flow: {
    in: { key: string; amount: number }[];
    out: { key: string; amount: number }[];
    totalIn: number; totalOut: number; net: number;
    byAccount: { account: string; in: number; out: number; net: number }[];
  };
};

/**
 * Profit & loss and cash flow for a date window [start, end] (inclusive, ISO dates).
 *
 * Profit basis: a sale is recognised when it is fully paid and its last receipt clears — the same rule the
 * Day-25 settlement uses — so revenue lands in the period the money actually cleared. Void/refunded sales
 * carry status 'refunded'/'void' and are excluded, so a refund nulls its own profit. Cancellation fees are
 * the residue of a refund: a fee the client leaves behind is income; a fee the supplier keeps is a loss.
 *
 * Cash basis: every real movement dated inside the window — receipts as they clear, supplier/BSP/expense
 * payments as they are made, manual deposits/withdrawals/transfers, cancellation fees, and settlement payouts.
 */
export async function periodReport(q: Q = db, start: string, end: string): Promise<PeriodReport> {
  const liveBooking = (col: string) => sql.raw(`NOT EXISTS (SELECT 1 FROM bookings bx WHERE bx.id = ${col} AND bx.status IN ('void','refunded'))`);

  // ── Profit & loss ──────────────────────────────────────────────────────────
  // Sales recognised in the window: issued, fully paid, last receipt cleared inside [start, end].
  const sales = await q.execute<{ sell: number; net: number; bps: number }>(sql`
    SELECT b.sell_price::bigint AS sell, b.net_cost::bigint AS net, b.commission_bps AS bps
    FROM bookings b
    JOIN (SELECT booking_id, SUM(amount) AS paid, MAX(cleared_on) AS last_cleared
          FROM payments WHERE cleared_on IS NOT NULL GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status = 'issued' AND p.paid >= b.sell_price AND p.last_cleared BETWEEN ${start} AND ${end}`);
  const revenue = sales.reduce((s, r) => s + Number(r.sell), 0);
  const directCost = sales.reduce((s, r) => s + Number(r.net), 0);
  const grossProfit = revenue - directCost;
  // Commission is no longer an automatic company cost; it's worked out ad-hoc in the commission calculator.
  const commissions = 0;

  // Cancellation fees realised in the window.
  const feeIn = (await q.select({ total: sum }).from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.kind, "refund_fee"), eq(schema.bankTransactions.direction, "in"), gte(schema.bankTransactions.txnDate, start), lte(schema.bankTransactions.txnDate, end))))[0].total;
  const feeOutBank = (await q.select({ total: sum }).from(schema.bankTransactions)
    .where(and(eq(schema.bankTransactions.kind, "refund_fee"), eq(schema.bankTransactions.direction, "out"), gte(schema.bankTransactions.txnDate, start), lte(schema.bankTransactions.txnDate, end))))[0].total;
  const feeOutLedger = (await q.select({ total: sum }).from(schema.ledgerEntries)
    .where(and(eq(schema.ledgerEntries.sourceType, "refund_fee"), gte(schema.ledgerEntries.entryDate, start), lte(schema.ledgerEntries.entryDate, end))))[0].total;
  const feesEarned = feeIn;
  const feesLost = feeOutBank + feeOutLedger;

  // Overheads: approved, non-startup expenses dated in the window (partner-paid included — still a cost).
  const expRows = await q.select({ category: schema.expenses.category, total: sum })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), eq(schema.expenses.isStartup, false), gte(schema.expenses.expenseDate, start), lte(schema.expenses.expenseDate, end)))
    .groupBy(schema.expenses.category);
  const expenses = expRows.map((e) => ({ category: e.category, total: e.total })).sort((a, b) => b.total - a.total);
  const expensesTotal = expenses.reduce((s, e) => s + e.total, 0);

  // Startup / capital costs: one-time investment (partner-paid, booked as capital advances), kept out of
  // operating profit but shown below it so the overall position reflects them.
  const startupCosts = (await q.select({ total: sum }).from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), eq(schema.expenses.isStartup, true), gte(schema.expenses.expenseDate, start), lte(schema.expenses.expenseDate, end))))[0].total;

  const refundCount = (await q.select({ n: sql<number>`count(*)::int` }).from(schema.approvalRequests)
    .where(and(eq(schema.approvalRequests.kind, "refund"), eq(schema.approvalRequests.status, "approved"), gte(schema.approvalRequests.decidedAt, sql`${start}::date`), lte(schema.approvalRequests.decidedAt, sql`${end}::date + 1`))))[0].n;

  const netProfit = grossProfit + feesEarned - feesLost - expensesTotal - commissions;
  const afterStartup = netProfit - startupCosts;

  // ── Cash flow ──────────────────────────────────────────────────────────────
  const byAcc = new Map<string, { in: number; out: number }>();
  const add = (account: string | null, dir: "in" | "out", amount: number) => {
    if (!amount) return;
    const k = account ?? "—";
    const row = byAcc.get(k) ?? { in: 0, out: 0 };
    row[dir] += amount; byAcc.set(k, row);
  };

  const receipts = await q.select({ account: schema.payments.account, total: sum }).from(schema.payments)
    .where(and(gte(schema.payments.clearedOn, start), lte(schema.payments.clearedOn, end), sql`${liveBooking(`payments.booking_id`)}`)).groupBy(schema.payments.account);
  receipts.forEach((r) => add(r.account, "in", r.total));

  const supplierPaid = await q.select({ account: schema.supplierPayments.account, total: sum }).from(schema.supplierPayments)
    .where(and(eq(schema.supplierPayments.source, "bank"), eq(schema.supplierPayments.status, "settled"), gte(schema.supplierPayments.paidOn, start), lte(schema.supplierPayments.paidOn, end), sql`${liveBooking(`supplier_payments.booking_id`)}`)).groupBy(schema.supplierPayments.account);
  supplierPaid.forEach((r) => add(r.account, "out", r.total));

  const bspOb = await q.select({ account: schema.bspObligations.account, total: sum }).from(schema.bspObligations)
    .where(and(eq(schema.bspObligations.status, "paid"), gte(schema.bspObligations.paidOn, start), lte(schema.bspObligations.paidOn, end))).groupBy(schema.bspObligations.account);
  bspOb.forEach((r) => add(r.account, "out", r.total));
  const bspCl = await q.select({ account: schema.bspClosings.account, total: sum }).from(schema.bspClosings)
    .where(and(eq(schema.bspClosings.status, "paid"), eq(schema.bspClosings.source, "bank"), gte(schema.bspClosings.paidOn, start), lte(schema.bspClosings.paidOn, end))).groupBy(schema.bspClosings.account);
  bspCl.forEach((r) => add(r.account, "out", r.total));
  const bspPaid = bspOb.reduce((s, r) => s + r.total, 0) + bspCl.reduce((s, r) => s + r.total, 0);

  const expPaid = await q.select({ account: schema.expenses.paidBy, total: sum }).from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), ne(schema.expenses.paidBy, "partner"), gte(schema.expenses.expenseDate, start), lte(schema.expenses.expenseDate, end))).groupBy(schema.expenses.paidBy);
  expPaid.forEach((r) => add(r.account, "out", r.total));
  const expensesPaid = expPaid.reduce((s, r) => s + r.total, 0);

  // Manual bank movements, split by kind. Transfers net to zero across accounts but matter per account.
  const txns = await q.select({ account: schema.bankTransactions.account, direction: schema.bankTransactions.direction, kind: schema.bankTransactions.kind, total: sum })
    .from(schema.bankTransactions).where(and(gte(schema.bankTransactions.txnDate, start), lte(schema.bankTransactions.txnDate, end)))
    .groupBy(schema.bankTransactions.account, schema.bankTransactions.direction, schema.bankTransactions.kind);
  let deposits = 0, withdrawals = 0, transfersIn = 0, transfersOut = 0;
  for (const r of txns) {
    add(r.account, r.direction as "in" | "out", r.total);
    if (r.kind === "refund_fee") continue; // counted as fees below
    if (r.direction === "in") { if (r.kind === "transfer") transfersIn += r.total; else deposits += r.total; }
    else { if (r.kind === "transfer") transfersOut += r.total; else withdrawals += r.total; }
  }

  // Settlement payouts (repayments + dividends) actually paid in the window.
  const paidCycles = await q.select({ figures: schema.settlementCycles.figures }).from(schema.settlementCycles)
    .where(and(eq(schema.settlementCycles.status, "paid"), gte(sql`${schema.settlementCycles.paidAt}::date`, sql`${start}::date`), lte(sql`${schema.settlementCycles.paidAt}::date`, sql`${end}::date`)));
  let payouts = 0;
  for (const c of paidCycles) {
    const f = c.figures as { payoutAccount?: string; repayments?: { amount: number }[]; dividends?: { amount: number }[] };
    const amt = (f.repayments ?? []).reduce((s, r) => s + r.amount, 0) + (f.dividends ?? []).reduce((s, d) => s + d.amount, 0);
    payouts += amt;
    add(f.payoutAccount ?? "retail", "out", amt);
  }

  const receiptsTotal = receipts.reduce((s, r) => s + r.total, 0);
  const supplierTotal = supplierPaid.reduce((s, r) => s + r.total, 0);

  const inRows = [
    { key: "receipts", amount: receiptsTotal },
    { key: "deposits", amount: deposits },
    { key: "transfersIn", amount: transfersIn },
    { key: "feesKept", amount: feeIn },
  ].filter((r) => r.amount > 0);
  const outRows = [
    { key: "supplier", amount: supplierTotal },
    { key: "bsp", amount: bspPaid },
    { key: "expenses", amount: expensesPaid },
    { key: "withdrawals", amount: withdrawals },
    { key: "transfersOut", amount: transfersOut },
    { key: "supplierFees", amount: feeOutBank },
    { key: "payouts", amount: payouts },
  ].filter((r) => r.amount > 0);
  const totalIn = inRows.reduce((s, r) => s + r.amount, 0);
  const totalOut = outRows.reduce((s, r) => s + r.amount, 0);

  const byAccount = [...byAcc.entries()].map(([account, v]) => ({ account, in: v.in, out: v.out, net: v.in - v.out }))
    .sort((a, b) => a.account.localeCompare(b.account));

  return {
    start, end,
    pl: { revenue, directCost, grossProfit, feesEarned, feesLost, expenses, expensesTotal, commissions, netProfit, startupCosts, afterStartup, salesCount: sales.length, refundCount },
    flow: { in: inRows, out: outRows, totalIn, totalOut, net: totalIn - totalOut, byAccount },
  };
}

export type MemberSales = {
  userId: string; name: string; count: number; revenue: number; margin: number; commission: number;
}[];

/**
 * Sales credited to each team member over a business-day window [start, end]. A sale is credited to its
 * salesperson (sold_by, falling back to the preparer for older sales). Live issued/pending sales only —
 * void and refunded drop out. "margin" is sell − cost; "commission" is what they'd earn at the rate frozen
 * on each sale.
 */
export async function salesByMember(q: Q = db, start: string, end: string): Promise<MemberSales> {
  const rows = await q.execute<{ user_id: string; name: string; count: number; revenue: number; margin: number; commission: number }>(sql`
    SELECT COALESCE(b.sold_by, b.prepared_by) AS user_id, u.name,
      count(*)::int AS count,
      coalesce(sum(b.sell_price),0)::bigint AS revenue,
      coalesce(sum(b.sell_price - b.net_cost),0)::bigint AS margin,
      coalesce(sum(floor(GREATEST(b.sell_price - b.net_cost, 0) * b.commission_bps / 10000)),0)::bigint AS commission
    FROM bookings b
    JOIN users u ON u.id = COALESCE(b.sold_by, b.prepared_by)
    WHERE b.business_date BETWEEN ${start} AND ${end} AND b.status NOT IN ('void','refunded','draft')
    GROUP BY COALESCE(b.sold_by, b.prepared_by), u.name
    ORDER BY revenue DESC`);
  return rows.map((r) => ({ userId: r.user_id, name: r.name, count: Number(r.count), revenue: Number(r.revenue), margin: Number(r.margin), commission: Number(r.commission) }));
}

export type MemberSaleRow = { id: string; ref: string; date: string; serviceType: string; client: string; revenue: number; cost: number; margin: number };

/** Every live sale credited to one team member in [start, end] — the rows the commission calculator totals. */
export async function memberSalesDetail(q: Q = db, userId: string, start: string, end: string): Promise<MemberSaleRow[]> {
  const rows = await q.execute<{ id: string; ref: string; business_date: string; service_type: string; client: string; sell_price: number; net_cost: number }>(sql`
    SELECT b.id, b.ref, b.business_date, b.service_type, cl.name AS client, b.sell_price::bigint, b.net_cost::bigint
    FROM bookings b JOIN clients cl ON cl.id = b.client_id
    WHERE COALESCE(b.sold_by, b.prepared_by) = ${userId} AND b.business_date BETWEEN ${start} AND ${end}
      AND b.status NOT IN ('void','refunded','draft')
    ORDER BY b.business_date, b.ref`);
  return rows.map((r) => ({ id: r.id, ref: r.ref, date: r.business_date, serviceType: r.service_type, client: r.client,
    revenue: Number(r.sell_price), cost: Number(r.net_cost), margin: Number(r.sell_price) - Number(r.net_cost) }));
}
