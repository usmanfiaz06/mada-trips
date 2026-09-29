import "server-only";
import { and, eq, gte, isNotNull, isNull, lte, ne, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";

type Q = Tx | typeof db;

/** What each partner is owed back (advances + verified personal expenses − repayments). */
export async function partnerBalances(q: Q = db) {
  const partners = await q.select().from(schema.partners).orderBy(schema.partners.sort);
  const rows = await q.select({
    partnerId: schema.ledgerEntries.partnerId, type: schema.ledgerEntries.type,
    total: sql<number>`coalesce(sum(${schema.ledgerEntries.amount}),0)::bigint`.mapWith(Number),
  }).from(schema.ledgerEntries).groupBy(schema.ledgerEntries.partnerId, schema.ledgerEntries.type);
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
  const inflow = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(isNotNull(schema.payments.clearedOn)).groupBy(schema.payments.account);
  const uncleared = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(isNull(schema.payments.clearedOn)).groupBy(schema.payments.account);
  const exp = await q.select({ account: schema.expenses.paidBy, total: sql<number>`coalesce(sum(${schema.expenses.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.expenses).where(and(eq(schema.expenses.status, "approved"), ne(schema.expenses.paidBy, "partner"))).groupBy(schema.expenses.paidBy);
  const bsp = await q.select({ account: schema.bspObligations.account, total: sql<number>`coalesce(sum(${schema.bspObligations.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspObligations).where(eq(schema.bspObligations.status, "paid")).groupBy(schema.bspObligations.account);
  const payouts = await q.select({ figures: schema.settlementCycles.figures }).from(schema.settlementCycles).where(eq(schema.settlementCycles.status, "paid"));

  const pick = (list: { account: string; total: number }[], k: string) => list.find((r) => r.account === k)?.total ?? 0;
  const out = accounts.map((a) => {
    const paidOut = payouts.reduce((s, p) => {
      const f = p.figures as SettlementFigures;
      return s + (f.payoutAccount === a.key ? f.repayments.reduce((x, r) => x + r.amount, 0) + f.dividends.reduce((x, d) => x + d.amount, 0) : 0);
    }, 0);
    const balance = a.openingBalance + pick(inflow, a.key) - pick(exp, a.key) - pick(bsp, a.key) - paidOut;
    return { ...a, balance, uncleared: pick(uncleared, a.key) };
  });
  const upcomingBsp = await q.select({ total: sql<number>`coalesce(sum(${schema.bspObligations.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.bspObligations).where(eq(schema.bspObligations.status, "upcoming"));
  return { accounts: out, total: out.reduce((s, a) => s + a.balance, 0), upcomingBsp: upcomingBsp[0]?.total ?? 0 };
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
    WHERE b.status IN ('issued','pending_issue','awaiting_credit') AND b.sell_price > coalesce(p.paid,0)
    GROUP BY c.id ORDER BY owed DESC`);
  return rows.map((r) => ({ ...r, credit_limit: Number(r.credit_limit), owed: Number(r.owed), overdue: Number(r.overdue) }));
}

export async function clientExposure(q: Q, clientId: string) {
  const r = await q.execute<{ owed: number }>(sql`
    SELECT coalesce(SUM(b.sell_price - coalesce(p.paid,0)),0)::bigint AS owed FROM bookings b
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.client_id = ${clientId} AND b.status IN ('issued','pending_issue','awaiting_credit')`);
  return Number(r[0]?.owed ?? 0);
}

/* ─────────────── Day-25 settlement ─────────────── */

export type SettlementInputs = { reserveTopUp: number; repaymentPctBps: number; payoutAccount: "retail" | "corporate" };
export type SettlementFigures = {
  start: string; end: string;
  clearedByAccount: { retail: number; corporate: number };
  rolledOver: number;
  bookingIds: string[]; bookingCount: number;
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
    const w = open.reduce((s, p) => s + p.equityBps, 0);
    let given = 0;
    const shares = open.map((p, i) => {
      const raw = i === open.length - 1 ? left - open.slice(0, -1).reduce((s, q) => s + Math.floor((left * q.equityBps) / w), 0) : Math.floor((left * p.equityBps) / w);
      return [p, Math.min(raw, p.outstanding - (pay.get(p.id) ?? 0))] as const;
    });
    for (const [p, amt] of shares) { pay.set(p.id, (pay.get(p.id) ?? 0) + amt); given += amt; }
    if (given === 0) break;
    left -= given;
  }
  return partners.map((p) => ({ partnerId: p.id, name: p.name, amount: pay.get(p.id) ?? 0, outstandingBefore: p.outstanding }));
}

export async function computeSettlement(q: Q, start: string, end: string, inputs: Partial<SettlementInputs>, reserveHeld: number, defaultRepaymentBps: number, iataBuffer: number, excludeCycleId?: string, cycleOnly = false): Promise<SettlementFigures> {
  const cleared = await q.select({ account: schema.payments.account, total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(gte(schema.payments.clearedOn, start), lte(schema.payments.clearedOn, end))).groupBy(schema.payments.account);
  const rolled = await q.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(and(gte(schema.payments.businessDate, start), lte(schema.payments.businessDate, end), sql`(${schema.payments.clearedOn} IS NULL OR ${schema.payments.clearedOn} > ${end})`));

  // A booking belongs to the cycle in which its last payment cleared (issued, fully paid, cleared by the cut-off).
  // The very first settlement also sweeps in anything that cleared before it, so nothing is ever lost.
  const [{ n: priorCycles }] = await q.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM settlement_cycles WHERE end_date < ${end}`);
  const settled = await q.execute<{ id: string; sell_price: number; net_cost: number; prepared_by: string; commission_bps: number; preparer: string }>(sql`
    SELECT b.id, b.sell_price::bigint, b.net_cost::bigint, b.prepared_by, b.commission_bps, u.name AS preparer FROM bookings b
    JOIN users u ON u.id = b.prepared_by
    JOIN (SELECT booking_id, SUM(amount) AS paid, MAX(cleared_on) AS last_cleared FROM payments WHERE cleared_on IS NOT NULL AND cleared_on <= ${end} GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.status = 'issued' AND p.paid >= b.sell_price
      AND ${Number(priorCycles) === 0 && !cycleOnly ? sql`true` : sql`p.last_cleared >= ${start}`}
      AND (b.recognized_cycle_id IS NULL ${excludeCycleId ? sql`OR b.recognized_cycle_id = ${excludeCycleId}` : sql``})`);
  const revenue = settled.reduce((s, b) => s + Number(b.sell_price), 0);
  const directCost = settled.reduce((s, b) => s + Number(b.net_cost), 0);
  const grossProfit = revenue - directCost;

  const exp = await q.select({ category: schema.expenses.category, total: sql<number>`coalesce(sum(${schema.expenses.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.expenses)
    .where(and(eq(schema.expenses.status, "approved"), eq(schema.expenses.isStartup, false), gte(schema.expenses.expenseDate, start), lte(schema.expenses.expenseDate, end)))
    .groupBy(schema.expenses.category);
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
    bookingIds: settled.map((b) => b.id), bookingCount: settled.length,
    revenue, directCost, grossProfit, overheads,
    overheadsByCategory: { ...Object.fromEntries(exp.map((e) => [e.category, e.total])), ...(commissionTotal ? { commission: commissionTotal } : {}) },
    commissions,
    netProfit, waterfall, suggestedReserve, upcomingBsp, reserveHeldBefore: reserveHeld,
    repayments, dividends, shortfall: netProfit < 0 ? -netProfit : 0, payoutAccount,
  };
}

