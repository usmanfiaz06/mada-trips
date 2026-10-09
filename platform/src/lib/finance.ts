import "server-only";
import { and, eq, gte, isNotNull, isNull, lte, ne, or, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { openBspTotal } from "./bsp";

type Q = Tx | typeof db;

/** What each partner is owed back (advances + verified personal expenses − repayments). */
export async function partnerBalances(q: Q = db) {
  const partners = await q.select().from(schema.partners).orderBy(schema.partners.sort);
  // A supplier cost a partner fronted stops being owed once its booking is voided/refunded: the supplier
  // returns the money, so the cost drops off the partner's ledger (mirrors the bank side in cashPosition).
  const liveLedger = sql`NOT (${schema.ledgerEntries.sourceType} = 'supplier' AND EXISTS (
    SELECT 1 FROM ${schema.bookings} bx WHERE bx.id = ${schema.ledgerEntries.sourceId} AND bx.status IN ('void','refunded')))`;
  const rows = await q.select({
    partnerId: schema.ledgerEntries.partnerId, type: schema.ledgerEntries.type,
    total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}),0)::bigint`.mapWith(Number),
  }).from(schema.ledgerEntries).where(liveLedger).groupBy(schema.ledgerEntries.partnerId, schema.ledgerEntries.type);
  return partners.map((p) => {
    const get = (t: string) => rows.find((r) => r.partnerId === p.id && r.type === t)?.total ?? 0;
    const lent = get("advance") + get("expense");
    const repaid = get("repayment");
    return { ...p, lent, repaid, outstanding: lent - repaid, dividends: get("dividend") };
  });
}

/** Cash in each bank account from what the platform knows has cleared or been paid out. */
export async function cashPosition(q: Q = db) {
  const accounts = await q.select().from(schema.bankAccounts);
  // A voided or refunded sale leaves the books: its received money no longer counts as cash on hand.
  const notVoided = sql`(${schema.payments.bookingId} IS NULL OR NOT EXISTS (SELECT 1 FROM ${schema.bookings} bx WHERE bx.id = ${schema.payments.bookingId} AND bx.status IN ('void','refunded')))`;
  const inflow = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(isNotNull(schema.payments.clearedOn), notVoided)).groupBy(schema.payments.account);
  const uncleared = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(isNull(schema.payments.clearedOn), notVoided)).groupBy(schema.payments.account);
  const exp = await q.select({ account: schema.expenses.paidBy, total: sql<number>`coalesce(sum(${schema.expenses.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.expenses).where(and(eq(schema.expenses.status, "approved"), ne(schema.expenses.paidBy, "partner"))).groupBy(schema.expenses.paidBy);
  const bsp = await q.select({ account: schema.bspObligations.account, total: sql<number>`coalesce(sum(${schema.bspObligations.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspObligations).where(eq(schema.bspObligations.status, "paid")).groupBy(schema.bspObligations.account);
  // Supplier costs paid out of a company bank. A void or refunded sale leaves the books: the supplier
  // returns the money, so that payment no longer counts against the bank (mirrors how a cancelled sale's
  // received money drops out of inflow above). If the supplier keeps a cancellation fee, record that fee
  // as an expense so the bank still reflects the real net.
  const suppLive = sql`NOT EXISTS (SELECT 1 FROM ${schema.bookings} bx WHERE bx.id = ${schema.supplierPayments.bookingId} AND bx.status IN ('void','refunded'))`;
  const supp = await q.select({ account: schema.supplierPayments.account, total: sql<number>`coalesce(sum(${schema.supplierPayments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.supplierPayments).where(and(eq(schema.supplierPayments.status, "settled"), eq(schema.supplierPayments.source, "bank"), suppLive)).groupBy(schema.supplierPayments.account);
  // IATA BSP closings paid out of a company bank.
  const bspPaid = await q.select({ account: schema.bspClosings.account, total: sql<number>`coalesce(sum(${schema.bspClosings.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspClosings).where(and(eq(schema.bspClosings.status, "paid"), eq(schema.bspClosings.source, "bank"))).groupBy(schema.bspClosings.account);
  // Manual deposits / withdrawals / transfers.
  const txnIn = await q.select({ account: schema.bankTransactions.account, total: sql<number>`coalesce(sum(${schema.bankTransactions.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bankTransactions).where(eq(schema.bankTransactions.direction, "in")).groupBy(schema.bankTransactions.account);
  const txnOut = await q.select({ account: schema.bankTransactions.account, total: sql<number>`coalesce(sum(${schema.bankTransactions.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bankTransactions).where(eq(schema.bankTransactions.direction, "out")).groupBy(schema.bankTransactions.account);
  const payouts = await q.select({ figures: schema.settlementCycles.figures }).from(schema.settlementCycles).where(eq(schema.settlementCycles.status, "paid"));

  const pick = (list: { account: string | null; total: number }[], k: string) => list.find((r) => r.account === k)?.total ?? 0;
  const out = accounts.map((a) => {
    const paidOut = payouts.reduce((s, p) => {
      const f = p.figures as SettlementFigures;
      return s + (f.payoutAccount === a.key ? f.repayments.reduce((x, r) => x + r.amount, 0) + f.dividends.reduce((x, d) => x + d.amount, 0) : 0);
    }, 0);
    const balance = a.openingBalance + pick(inflow, a.key) + pick(txnIn, a.key) - pick(txnOut, a.key) - pick(exp, a.key) - pick(bsp, a.key) - pick(supp, a.key) - pick(bspPaid, a.key) - paidOut;
    return { ...a, balance, uncleared: pick(uncleared, a.key) };
  });
  const legacyBsp = await q.select({ total: sql<number>`coalesce(sum(${schema.bspObligations.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspObligations).where(eq(schema.bspObligations.status, "upcoming"));
  const openBsp = await openBspTotal(q);
  return { accounts: out, total: out.reduce((s, a) => s + a.balance, 0), upcomingBsp: (legacyBsp[0]?.total ?? 0) + openBsp };
}

/** Money owed by clients: issued bookings not yet fully paid. */
export async function receivables(q: Q = db) {
  const rows = await q.execute<{ client_id: string; name: string; type: string; credit_limit: number; owed: number; overdue: number; count: number }>(sql`
    SELECT c.id AS client_id, c.name, c.type, c.credit_limit::bigint AS credit_limit,
      SUM(b.sell_price - coalesce(p.paid,0))::bigint AS owed,
      SUM(CASE WHEN b.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date THEN b.sell_price - coalesce(p.paid,0) ELSE 0 END)::bigint AS overdue,
      COUNT(*)::int AS count
    FROM bookings b
    JOIN clients c ON c.id = b.client_id
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status IN ('issued','pending_issue','awaiting_credit','returned') AND b.sell_price > coalesce(p.paid,0)
    GROUP BY c.id ORDER BY owed DESC`);
  return rows.map((r) => ({ ...r, credit_limit: Number(r.credit_limit), owed: Number(r.owed), overdue: Number(r.overdue) }));
}

export async function clientExposure(q: Q, clientId: string) {
  const r = await q.execute<{ owed: number }>(sql`
    SELECT coalesce(SUM(b.sell_price - coalesce(p.paid,0)),0)::bigint AS owed FROM bookings b
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.client_id = ${clientId} AND b.status IN ('issued','pending_issue','awaiting_credit','returned')`);
  return Number(r[0]?.owed ?? 0);
}

/** Supplier costs the company still owes: bookings whose supplier hasn't been paid. "Money we owe." */
export async function payables(q: Q = db) {
  const rows = await q.execute<{ id: string; ref: string; supplier: string | null; net_cost: number; status: string; client: string; business_date: string; pending: boolean }>(sql`
    SELECT b.id, b.ref, b.supplier, b.net_cost::bigint, b.status, c.name AS client, b.business_date,
      EXISTS (SELECT 1 FROM supplier_payments sp WHERE sp.booking_id = b.id AND sp.status = 'pending_approval') AS pending
    FROM bookings b JOIN clients c ON c.id = b.client_id
    WHERE b.net_cost > 0 AND b.supplier_paid = false AND b.via_bsp = false AND b.status NOT IN ('void','refunded','draft')
    ORDER BY b.business_date ASC, b.ref ASC`);
  return rows.map((r) => ({ ...r, net_cost: Number(r.net_cost), supplier: r.supplier ?? "—" }));
}

/** Client money still to collect: unpaid issued/booked sales, soonest due first, overdue flagged. */
export async function collections(q: Q, opts: { team?: string } = {}) {
  const rows = await q.execute<{ id: string; ref: string; client: string; phone: string | null; owed: number; due_date: string | null; overdue: boolean; status: string; preparer: string }>(sql`
    SELECT b.id, b.ref, c.name AS client, c.phone, (b.sell_price - coalesce(p.paid,0))::bigint AS owed,
      b.due_date, (b.due_date IS NOT NULL AND b.due_date < (now() AT TIME ZONE 'Asia/Riyadh')::date) AS overdue, b.status, u.name AS preparer
    FROM bookings b
    JOIN clients c ON c.id = b.client_id
    JOIN users u ON u.id = b.prepared_by
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status IN ('issued','pending_issue') AND b.sell_price > coalesce(p.paid,0)
      ${opts.team ? sql`AND u.team = ${opts.team}` : sql``}
    ORDER BY (b.due_date IS NULL), b.due_date ASC, owed DESC`);
  return rows.map((r) => ({ ...r, owed: Number(r.owed) }));
}

export type Movement = { date: string; kind: "receipt" | "supplier" | "bsp" | "expense" | "deposit" | "withdrawal" | "transfer"; label: string; ref: string | null; amount: number; cleared: boolean; by: string | null };

/** Money in and out of one bank account, most recent first — the account's statement. */
export async function bankMovements(q: Q, account: string, limit = 40): Promise<Movement[]> {
  const rows = await q.execute<Movement>(sql`
    (SELECT p.collected_at::date::text AS date, 'receipt' AS kind, c.name AS label, b.ref, p.amount::bigint AS amount, (p.cleared_on IS NOT NULL) AS cleared, NULL::text AS by
       FROM payments p JOIN clients c ON c.id = p.client_id LEFT JOIN bookings b ON b.id = p.booking_id
       WHERE p.account = ${account} AND (b.id IS NULL OR b.status NOT IN ('void','refunded')))
    UNION ALL
    (SELECT sp.paid_on::text, 'supplier', sp.supplier, b.ref, -sp.amount::bigint, true, NULL
       FROM supplier_payments sp JOIN bookings b ON b.id = sp.booking_id
       WHERE sp.source = 'bank' AND sp.account = ${account} AND sp.status = 'settled' AND b.status NOT IN ('void','refunded'))
    UNION ALL
    (SELECT coalesce(o.paid_on::text, o.due_date::text), 'bsp', o.period, NULL, -o.amount::bigint, true, NULL
       FROM bsp_obligations o WHERE o.account = ${account} AND o.status = 'paid')
    UNION ALL
    (SELECT coalesce(bc.paid_on::text, bc.due_date::text), 'bsp', 'IATA BSP', NULL, -bc.amount::bigint, true, NULL
       FROM bsp_closings bc WHERE bc.account = ${account} AND bc.status = 'paid' AND bc.source = 'bank')
    UNION ALL
    (SELECT e.expense_date::text, 'expense', e.description, e.ref, -e.amount::bigint, true, NULL
       FROM expenses e WHERE e.paid_by = ${account} AND e.status = 'approved')
    UNION ALL
    (SELECT bt.txn_date::text, bt.kind, coalesce(bt.note, bt.kind), NULL, (CASE WHEN bt.direction='in' THEN bt.amount ELSE -bt.amount END)::bigint, true, pt.name
       FROM bank_transactions bt LEFT JOIN partners pt ON pt.id = bt.partner_id WHERE bt.account = ${account})
    ORDER BY date DESC LIMIT ${limit}`);
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

/* ─────────────── Day-25 settlement ─────────────── */

export type SettlementInputs = { reserveTopUp: number; repaymentPctBps: number; payoutAccount: "retail" | "corporate" };
export type SettlementFigures = {
  start: string; end: string;
  clearedByAccount: { retail: number; corporate: number };
  rolledOver: number;
  bookingIds: string[]; bookingCount: number; expenseIds?: string[];
  revenue: number; directCost: number; grossProfit: number;
  overheads: number; overheadsByCategory: Record<string, number>;
  commissions: { userId: string; name: string; amount: number; bookings: number }[];
  netProfit: number;
  waterfall: { key: "overheads" | "reserve" | "repayment" | "dividend"; amount: number; remainingAfter: number }[];
  suggestedReserve: number; upcomingBsp: number; reserveHeldBefore: number;
  repayments: { partnerId: string; name: string; amount: number; outstandingBefore: number }[];
  dividends: { partnerId: string; name: string; equityBps: number; amount: number }[];
  shortfall: number;
  payoutAccount: "retail" | "corporate";
};

/** Split `pool` by equity among partners still owed money, never paying anyone more than they're owed. */
export function repayByEquity(pool: number, partners: { id: string; name: string; equityBps: number; outstanding: number }[]) {
  const pay = new Map(partners.map((p) => [p.id, 0]));
  let left = pool;
  for (let guard = 0; guard < 10 && left > 0; guard++) {
    const open = partners.filter((p) => p.outstanding - (pay.get(p.id) ?? 0) > 0);
    if (!open.length) break;
    // By equity; if everyone still owed has 0% equity, equally (never divide by zero).
    const weight = (p: { equityBps: number }) => (open.some((q) => q.equityBps > 0) ? p.equityBps : 1);
    const w = open.reduce((s, p) => s + weight(p), 0);
    let given = 0;
    const shares = open.map((p, i) => {
      const raw = i === open.length - 1 ? left - open.slice(0, -1).reduce((s, q) => s + Math.floor((left * weight(q)) / w), 0) : Math.floor((left * weight(p)) / w);
      return [p, Math.min(raw, p.outstanding - (pay.get(p.id) ?? 0))] as const;
    });
    for (const [p, amt] of shares) { pay.set(p.id, (pay.get(p.id) ?? 0) + amt); given += amt; }
    if (given === 0) break;
    left -= given;
  }
  return partners.map((p) => ({ partnerId: p.id, name: p.name, amount: pay.get(p.id) ?? 0, outstandingBefore: p.outstanding }));
}

export async function computeSettlement(q: Q, start: string, end: string, inputs: Partial<SettlementInputs>, reserveHeld: number, defaultRepaymentBps: number, iataBuffer: number, excludeCycleId?: string, cycleOnly = false): Promise<SettlementFigures> {
  // Voided/refunded sales' money never counts as cleared cash for the settlement.
  const liveReceipt = sql`(${schema.payments.bookingId} IS NULL OR NOT EXISTS (SELECT 1 FROM ${schema.bookings} bx WHERE bx.id = ${schema.payments.bookingId} AND bx.status IN ('void','refunded')))`;
  const cleared = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(gte(schema.payments.clearedOn, start), lte(schema.payments.clearedOn, end), liveReceipt)).groupBy(schema.payments.account);
  const rolled = await q.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(gte(schema.payments.businessDate, start), lte(schema.payments.businessDate, end), sql`(${schema.payments.clearedOn} IS NULL OR ${schema.payments.clearedOn} > ${end})`, liveReceipt));

  // A booking is counted in the first cycle after it is issued, fully paid and cleared by the cut-off, whenever that happens
  // (paid in one cycle and issued in the next still counts, in the next). Each booking is counted exactly once.
  const mine = excludeCycleId ? sql`OR b.recognized_cycle_id = ${excludeCycleId}` : sql``;
  const settled = await q.execute<{ id: string; sell_price: number; net_cost: number; prepared_by: string; commission_bps: number; preparer: string }>(sql`
    SELECT b.id, b.sell_price::bigint, b.net_cost::bigint, b.prepared_by, b.commission_bps, u.name AS preparer FROM bookings b
    JOIN users u ON u.id = b.prepared_by
    JOIN (SELECT booking_id, SUM(amount) AS paid, MAX(cleared_on) AS last_cleared FROM payments WHERE cleared_on IS NOT NULL AND cleared_on <= ${end} GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status = 'issued' AND p.paid >= b.sell_price AND (b.recognized_cycle_id IS NULL ${mine})`);
  void cycleOnly;
  const revenue = settled.reduce((s, b) => s + Number(b.sell_price), 0);
  const directCost = settled.reduce((s, b) => s + Number(b.net_cost), 0);
  const grossProfit = revenue - directCost;

  // Overheads: every approved expense up to the cut-off that no signed cycle has counted yet, so one approved late still counts.
  const expRows = await q.select({ id: schema.expenses.id, category: schema.expenses.category, amount: schema.expenses.amount })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), eq(schema.expenses.isStartup, false), lte(schema.expenses.expenseDate, end),
      excludeCycleId ? or(isNull(schema.expenses.recognizedCycleId), eq(schema.expenses.recognizedCycleId, excludeCycleId)) : isNull(schema.expenses.recognizedCycleId)));
  const expByCat = new Map<string, number>();
  for (const e of expRows) expByCat.set(e.category, (expByCat.get(e.category) ?? 0) + Number(e.amount));
  const exp = [...expByCat].map(([category, total]) => ({ category, total }));
  // Team commission: a share of the margin on each settled sale, at the rate frozen on the sale.
  const commissionMap = new Map<string, { userId: string; name: string; amount: number; bookings: number }>();
  for (const b of settled) {
    const amount = Math.floor((Math.max(0, Number(b.sell_price) - Number(b.net_cost)) * Number(b.commission_bps)) / 10000);
    if (amount <= 0) continue;
    const c = commissionMap.get(b.prepared_by) ?? { userId: b.prepared_by, name: b.preparer, amount: 0, bookings: 0 };
    c.amount += amount; c.bookings += 1;
    commissionMap.set(b.prepared_by, c);
  }
  const commissions = [...commissionMap.values()].sort((a, b) => b.amount - a.amount);
  const commissionTotal = commissions.reduce((s, c) => s + c.amount, 0);
  const overheads = exp.reduce((s, e) => s + e.total, 0) + commissionTotal;
  const netProfit = grossProfit - overheads;

  const upcoming = await q.select({ total: sql<number>`coalesce(sum(${schema.bspObligations.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspObligations).where(eq(schema.bspObligations.status, "upcoming"));
  const upcomingBsp = upcoming[0]?.total ?? 0;
  const suggestedReserve = Math.max(0, upcomingBsp + iataBuffer - reserveHeld);

  const payoutAccount = inputs.payoutAccount ?? "retail";
  const waterfall: SettlementFigures["waterfall"] = [];
  let remaining = grossProfit;
  const p1 = Math.min(overheads, Math.max(remaining, 0));
  remaining -= overheads;
  waterfall.push({ key: "overheads", amount: p1, remainingAfter: remaining });

  const reserveWanted = inputs.reserveTopUp ?? suggestedReserve;
  const p2 = Math.max(0, Math.min(reserveWanted, remaining));
  remaining -= p2;
  waterfall.push({ key: "reserve", amount: p2, remainingAfter: remaining });

  const balances = await partnerBalances(q);
  const repBps = inputs.repaymentPctBps ?? defaultRepaymentBps;
  const totalOutstanding = balances.reduce((s, b) => s + Math.max(0, b.outstanding), 0);
  const pool = Math.max(0, Math.min(Math.floor((Math.max(remaining, 0) * repBps) / 10000), totalOutstanding));
  const repayments = repayByEquity(pool, balances.map((b) => ({ id: b.id, name: b.name, equityBps: b.equityBps, outstanding: Math.max(0, b.outstanding) })));
  const p3 = repayments.reduce((s, r) => s + r.amount, 0);
  remaining -= p3;
  waterfall.push({ key: "repayment", amount: p3, remainingAfter: remaining });

  const divPool = Math.max(0, remaining);
  const { splitByBps } = await import("./money");
  const parts = splitByBps(divPool, balances.map((b) => b.equityBps));
  const dividends = balances.map((b, i) => ({ partnerId: b.id, name: b.name, equityBps: b.equityBps, amount: parts[i] }));
  waterfall.push({ key: "dividend", amount: divPool, remainingAfter: remaining - divPool });

  const pickAcc = (k: string) => cleared.find((c) => c.account === k)?.total ?? 0;
  return {
    start, end, clearedByAccount: { retail: pickAcc("retail"), corporate: pickAcc("corporate") },
    rolledOver: rolled[0]?.total ?? 0,
    bookingIds: settled.map((b) => b.id), bookingCount: settled.length, expenseIds: expRows.map((e) => e.id),
    revenue, directCost, grossProfit, overheads,
    overheadsByCategory: { ...Object.fromEntries(exp.map((e) => [e.category, e.total])), ...(commissionTotal ? { commission: commissionTotal } : {}) },
    commissions,
    netProfit, waterfall, suggestedReserve, upcomingBsp, reserveHeldBefore: reserveHeld,
    repayments, dividends, shortfall: netProfit < 0 ? -netProfit : 0, payoutAccount,
  };
}

