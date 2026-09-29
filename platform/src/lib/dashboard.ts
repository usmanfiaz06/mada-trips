import "server-only";
import { and, desc, eq, gte, inArray, lte, notInArray, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import type { CurrentUser } from "./auth";
import { addDays, businessDate, cycleFor, daysBetween, riyadhDate } from "./dates";
import { myUrgentTasks } from "./tasks";
import { cashPosition, computeSettlement, receivables } from "./finance";
import { getSettings } from "./settings";
import { pendingForUser } from "./approvals";
import { canSeeIssuance, issueCheck } from "./issuance";

export async function dashboardData(u: CurrentUser, view: "current" | "prev" = "current") {
  const s = await getSettings();
  const today = businessDate(new Date(), s.closeHour);
  const current = cycleFor(today, s.cutoffDay);
  const cycle = view === "prev" ? cycleFor(addDays(current.start, -1), s.cutoffDay) : current;
  const days = daysBetween(cycle.start, cycle.end) + 1;
  const todayIdx = view === "prev" ? days - 1 : daysBetween(cycle.start, today);
  const seeAll = u.permissions.has("sales.view_all");
  const mine = seeAll ? undefined : eq(schema.bookings.preparedBy, u.id);

  const cycleBookings = await db.select({
    id: schema.bookings.id, ref: schema.bookings.ref, businessDate: schema.bookings.businessDate, sell: schema.bookings.sellPrice,
    net: schema.bookings.netCost, channel: schema.bookings.channel, passengers: schema.bookings.passengers, description: schema.bookings.description,
  }).from(schema.bookings)
    .where(and(gte(schema.bookings.businessDate, cycle.start), lte(schema.bookings.businessDate, cycle.end), notInArray(schema.bookings.status, ["void", "draft"]), mine))
    .orderBy(schema.bookings.createdAt);

  // Last 14 business days of margin, for the dot columns.
  const from14 = addDays(today, -13);
  const daily = await db.select({
    d: schema.bookings.businessDate,
    margin: sql<number>`coalesce(sum(${schema.bookings.sellPrice} - ${schema.bookings.netCost}),0)::bigint`.mapWith(Number),
    sales: sql<number>`count(*)::int`,
  }).from(schema.bookings)
    .where(and(gte(schema.bookings.businessDate, from14), lte(schema.bookings.businessDate, today), notInArray(schema.bookings.status, ["void", "draft"]), mine))
    .groupBy(schema.bookings.businessDate);
  const last14 = Array.from({ length: 14 }, (_, i) => {
    const d = addDays(from14, i);
    const r = daily.find((x) => x.d === d);
    return { d, margin: r?.margin ?? 0, sales: r?.sales ?? 0 };
  });

  const todayRows = cycleBookings.filter((b) => b.businessDate === today);

  const [waiting, issuer, finance] = await Promise.all([
    db.transaction((tx) => pendingForUser(tx, u.id)),
    canSeeIssuance(u),
    u.permissions.has("finance.view") ? (async () => {
      const [cash, rec, est] = await Promise.all([
        cashPosition(),
        receivables(),
        db.transaction((tx) => computeSettlement(tx, current.start, current.end, {}, s.iataReserveHeld, s.repaymentPctBps, s.iataBuffer, undefined, true)),
      ]);
      const [nextBsp] = await db.select().from(schema.bspObligations).where(eq(schema.bspObligations.status, "upcoming")).orderBy(schema.bspObligations.dueDate).limit(1);
      return { cash, rec, est, nextBsp: nextBsp ?? null };
    })() : Promise.resolve(null),
  ]);

  // Only what this person can actually issue, so the list is always actionable.
  const queued = issuer ? await db.select().from(schema.bookings).where(eq(schema.bookings.status, "pending_issue")).orderBy(schema.bookings.createdAt).limit(30) : [];
  const allowed = await Promise.all(queued.map((b) => issueCheck(db, u, b)));
  const issueQueue = queued.filter((_, i) => allowed[i].ok).slice(0, 5)
    .map((b) => ({ id: b.id, ref: b.ref, passengers: b.passengers, description: b.description, sell: b.sellPrice, createdAt: b.createdAt, channel: b.channel }));

  const closesToVerify = u.permissions.has("close.verify")
    ? await db.select().from(schema.dailyCloses).where(eq(schema.dailyCloses.status, "submitted")).orderBy(desc(schema.dailyCloses.businessDate)).limit(4) : [];

  const activity = await db.select({ e: schema.auditEvents, name: schema.users.name })
    .from(schema.auditEvents).leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
    .where(and(u.permissions.has("activity.view") ? undefined : eq(schema.auditEvents.actorId, u.id), sql`${schema.auditEvents.action} NOT LIKE 'auth.%'`))
    .orderBy(desc(schema.auditEvents.at)).limit(7);

  // Things the agent must finish before 10 PM.
  const myOpenToday = await db.execute<{ id: string; ref: string; issue: string }>(sql`
    SELECT b.id, b.ref,
      CASE WHEN b.service_type = 'flight' AND (b.pnr IS NULL OR b.pnr = '') THEN 'missing_pnr'
           WHEN b.status = 'pending_issue' THEN 'pending_issue'
           ELSE 'unpaid' END AS issue
    FROM bookings b
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.business_date = ${today} AND b.prepared_by = ${u.id} AND b.status NOT IN ('void','draft','refunded')
      AND ((b.service_type = 'flight' AND (b.pnr IS NULL OR b.pnr = '')) OR b.status = 'pending_issue' OR (NOT b.on_credit AND coalesce(p.paid,0) < b.sell_price))
    LIMIT 8`);

  // This person's commission for the current cycle: earned (fully paid and cleared) and still on the way.
  const [me] = await db.select({ rate: schema.users.commissionBps }).from(schema.users).where(eq(schema.users.id, u.id));
  const comm = await db.execute<{ earned: number; pending: number; n: number }>(sql`
    SELECT
      coalesce(SUM(CASE WHEN p.paid >= b.sell_price AND p.last_cleared BETWEEN ${current.start} AND ${current.end}
        THEN floor(GREATEST(b.sell_price - b.net_cost, 0) * b.commission_bps / 10000) ELSE 0 END),0)::bigint AS earned,
      coalesce(SUM(CASE WHEN NOT (p.paid >= b.sell_price AND p.last_cleared IS NOT NULL) OR p.paid IS NULL
        THEN floor(GREATEST(b.sell_price - b.net_cost, 0) * b.commission_bps / 10000) ELSE 0 END),0)::bigint AS pending,
      count(*) FILTER (WHERE p.paid >= b.sell_price AND p.last_cleared BETWEEN ${current.start} AND ${current.end})::int AS n
    FROM bookings b
    LEFT JOIN (SELECT booking_id, SUM(amount) FILTER (WHERE cleared_on IS NOT NULL) AS paid, MAX(cleared_on) AS last_cleared FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    WHERE b.prepared_by = ${u.id} AND b.status IN ('issued','pending_issue') AND b.recognized_cycle_id IS NULL AND b.commission_bps > 0`);
  const commission = { rate: me?.rate ?? 0, earned: Number(comm[0]?.earned ?? 0), pending: Number(comm[0]?.pending ?? 0), sales: comm[0]?.n ?? 0 };

  const myTasks = await myUrgentTasks(u.id, riyadhDate());

  const myExpenses = await db.select({ n: sql<number>`count(*)::int` }).from(schema.expenses)
    .where(and(eq(schema.expenses.submittedBy, u.id), inArray(schema.expenses.status, ["pending"])));

  return {
    s, today, cycle, current, view, days, todayIdx, cycleBookings, todayRows, last14, waiting, issuer, issueQueue, finance,
    closesToVerify, activity, commission, myTasks, myOpenToday: [...myOpenToday].filter((o) => !issueQueue.some((q) => q.id === o.id)), myPendingExpenses: myExpenses[0]?.n ?? 0,
  };
}
