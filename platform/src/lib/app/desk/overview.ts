import "server-only";
import { and, gte, inArray, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appOrderCosts } from "@/db/app-schema-finance";
import { deskTickets } from "@/db/app-schema-desk";
import { riyadhDate } from "@/lib/dates";
import { getSettings } from "@/lib/settings";
import { supplierBalances, type SupplierBalance } from "@/lib/app/finance/balances";
import { riyadhMidnight } from "./agent-admin";
import { loadRota } from "./agents";
import { pageDropoffs } from "./dropoffs";
import { performanceReport, type Metrics } from "./performance";
import { available, onShift } from "./routing";
import { TICKET_PRIORITIES, type TicketPriority } from "./sla";
import { ageBand, TICKET_AGES, type TicketAge } from "./tickets";

/*
 * The desk overview for leads (DESK-PLAN.md U8). Every number is the count or sum behind a list the desk already has,
 * read with that list's own rule, so a click lands on exactly that many rows:
 *
 *   backlog          running tickets (new or open) by priority and by age   → Tickets ?p= / ?age=
 *   SLA today        Performance's SLA hit for today, against the target     → Performance ?r=today
 *   CSAT this week   Performance's CSAT over the last 7 days                 → Performance
 *   funnel today     searches → pay sheets → paid → confirmed                → the overview's own funnel list
 *   drop-offs today  open drop-offs from today: count and value              → Drop-offs ?day=
 *   revenue          gross and margin today and month to date                → App revenue & margin ?from=&to=
 *   balances         each supplier's balance and days left                   → Supplier balances
 *   on duty          agents on shift and switched on, against the rota now  → Rota & time
 *
 * One round trip per group of widgets; the groups run at once.
 */

const DAY = 86_400_000;
export const D = "/adminwork/desk";

/* ───────── the funnel: one rule for the count and the list ───────── */

export const FUNNEL_STEPS = ["searches", "sheets", "paid", "confirmed"] as const;
export type FunnelStep = (typeof FUNNEL_STEPS)[number];
/** A payment that went through (held on the card or taken), whatever happened after. */
export const PAID_STATUSES = ["authorized", "captured", "partially_refunded", "refunded"] as const;

const inDay = (c: ReturnType<typeof sql>, day: string) =>
  sql`(${c} >= (${day}::date)::timestamp AT TIME ZONE 'Asia/Riyadh' AND ${c} < ((${day}::date + 1)::timestamp AT TIME ZONE 'Asia/Riyadh'))`;

/** Every funnel row on a Riyadh day: step, id, who, when, value (halalas) and a line about it. */
const FUNNEL = (day: string) => sql`
  SELECT CASE WHEN l.kind = 'pay_sheet' THEN 'sheets' ELSE 'searches' END AS step, l.id::text AS id, l.user_id, l.at, coalesce(l.value, 0)::bigint AS value, l.summary AS what
  FROM app_search_log l WHERE l.kind IN ('flight', 'stay', 'pay_sheet') AND ${inDay(sql`l.at`, day)}
  UNION ALL
  SELECT 'paid', p.id::text, p.owner_id, p.created_at, p.amount::bigint,
    coalesce((SELECT o.snapshot->>'title' FROM app_orders o WHERE o.payment_id = p.id LIMIT 1), p.label, 'Payment')
  FROM app_payments p WHERE p.status IN (${sql.join(PAID_STATUSES.map((s) => sql`${s}`), sql`, `)}) AND ${inDay(sql`p.created_at`, day)}
  UNION ALL
  SELECT 'confirmed', o.id::text, o.owner_id, c.at, (o.total + o.extra)::bigint, coalesce(o.snapshot->>'title', o.kind)
  FROM app_orders o
  CROSS JOIN LATERAL (SELECT coalesce((SELECT min(e.created_at) FROM app_order_events e WHERE e.order_id = o.id AND e.kind = 'confirmed'), o.updated_at) AS at) c
  WHERE o.status = 'confirmed' AND ${inDay(sql`c.at`, day)}`;

export type FunnelCounts = Record<FunnelStep, { n: number; value: number }>;

export async function funnelCounts(day: string): Promise<FunnelCounts> {
  const res = await db.execute(sql`SELECT step, count(*)::int AS n, coalesce(sum(value), 0)::bigint AS v FROM (${FUNNEL(day)}) f GROUP BY step`);
  const out = Object.fromEntries(FUNNEL_STEPS.map((s) => [s, { n: 0, value: 0 }])) as FunnelCounts;
  for (const r of res as unknown as { step: FunnelStep; n: number; v: string | number }[]) out[r.step] = { n: r.n, value: Number(r.v) };
  return out;
}

export type FunnelRow = { id: string; userId: string; userName: string | null; phone: string | null; at: Date; value: number; what: string };

/** The rows behind one funnel step, newest first, 50 at a time, with their count. */
export async function funnelRows(step: FunnelStep, day: string, o: { limit?: number; offset?: number } = {}) {
  const res = await db.execute(sql`
    WITH f AS (SELECT * FROM (${FUNNEL(day)}) x WHERE step = ${step})
    SELECT 'n' AS t, count(*)::int AS n, NULL::json AS row FROM f
    UNION ALL (SELECT 'r', 0, json_build_object('id', f.id, 'user_id', f.user_id, 'user_name', u.name, 'phone', u.phone, 'at', f.at, 'value', f.value, 'what', f.what)
      FROM f JOIN app_users u ON u.id = f.user_id ORDER BY f.at DESC LIMIT ${o.limit ?? 50} OFFSET ${o.offset ?? 0})`);
  const all = res as unknown as { t: string; n: number; row: Record<string, unknown> | null }[];
  return {
    total: all.find((x) => x.t === "n")?.n ?? 0,
    rows: all.filter((x) => x.t === "r").map(({ row: r }): FunnelRow => ({
      id: String(r!.id), userId: String(r!.user_id), userName: (r!.user_name as string | null) ?? null, phone: (r!.phone as string | null) ?? null,
      at: new Date(String(r!.at)), value: Number(r!.value ?? 0), what: String(r!.what ?? ""),
    })),
  };
}

/* ───────── the widget groups ───────── */

export type Backlog = { total: number; byPriority: Record<TicketPriority, number>; byAge: Record<TicketAge, number>; cells: Record<TicketPriority, Record<TicketAge, number>> };

/** Running tickets (new or open; a ticket waiting on someone else has its clock stopped) by priority and age. */
export async function backlog(): Promise<Backlog> {
  const rows = await db.select({ priority: deskTickets.priority, age: ageBand, n: sql<number>`count(*)::int` }).from(deskTickets)
    .where(inArray(deskTickets.status, ["new", "open"])).groupBy(deskTickets.priority, ageBand);
  const zeroAges = () => Object.fromEntries(TICKET_AGES.map((a) => [a, 0])) as Record<TicketAge, number>;
  const cells = Object.fromEntries(TICKET_PRIORITIES.map((p) => [p, zeroAges()])) as Backlog["cells"];
  const byPriority = Object.fromEntries(TICKET_PRIORITIES.map((p) => [p, 0])) as Record<TicketPriority, number>;
  const byAge = zeroAges();
  let total = 0;
  for (const r of rows) {
    const p = (TICKET_PRIORITIES as readonly string[]).includes(r.priority) ? (r.priority as TicketPriority) : "normal";
    cells[p][r.age] += r.n; byPriority[p] += r.n; byAge[r.age] += r.n; total += r.n;
  }
  return { total, byPriority, byAge, cells };
}

/** Performance's numbers for today (SLA) and the last 7 days (CSAT): the same report and range the Performance page reads. */
export async function service(now = new Date()): Promise<{ today: Metrics; week: Metrics; byDay: { start: Date; m: Metrics }[] }> {
  const to = new Date(riyadhMidnight(now).getTime() + DAY);
  const r = await performanceReport({ from: new Date(to.getTime() - 7 * DAY), to, by: "day" });
  return { today: r.series[r.series.length - 1]!.m, week: r.team, byDay: r.series.map((s) => ({ start: s.start, m: s.m })) };
}

export type Money2 = { gross: number; margin: number; net: number; lines: number };
/** App revenue today and month to date: the revenue page's sums over app_order_costs, both in one query. */
export async function revenue(today: string): Promise<{ today: Money2; mtd: Money2; from: string }> {
  const from = `${today.slice(0, 7)}-01`;
  const day = sql`${appOrderCosts.businessDate} = ${today}`;
  const [r] = await db.select({
    tg: sql<number>`coalesce(sum(${appOrderCosts.sell}) FILTER (WHERE ${day}),0)::bigint`.mapWith(Number),
    tv: sql<number>`coalesce(sum(${appOrderCosts.vat}) FILTER (WHERE ${day}),0)::bigint`.mapWith(Number),
    tc: sql<number>`coalesce(sum(${appOrderCosts.netSar}) FILTER (WHERE ${day}),0)::bigint`.mapWith(Number),
    tn: sql<number>`count(*) FILTER (WHERE ${day})::int`,
    mg: sql<number>`coalesce(sum(${appOrderCosts.sell}),0)::bigint`.mapWith(Number),
    mv: sql<number>`coalesce(sum(${appOrderCosts.vat}),0)::bigint`.mapWith(Number),
    mc: sql<number>`coalesce(sum(${appOrderCosts.netSar}),0)::bigint`.mapWith(Number),
    mn: sql<number>`count(*)::int`,
  }).from(appOrderCosts).where(and(gte(appOrderCosts.businessDate, from), lte(appOrderCosts.businessDate, today)));
  const m = (g: number, v: number, c: number, n: number): Money2 => ({ gross: g, net: g - v, margin: g - v - c, lines: n });
  return { today: m(r!.tg, r!.tv, r!.tc, r!.tn), mtd: m(r!.mg, r!.mv, r!.mc, r!.mn), from };
}

export type Duty = { onDuty: number; rostered: number; online: number; people: { id: string; name: string; status: string; onShift: boolean; available: boolean }[] };
/** Who is on now against the rota: on shift and switched on, out of everyone rostered now (and anyone online off-rota). */
export async function duty(now = new Date()): Promise<Duty> {
  const rota = await loadRota(now);
  const people = rota.agents.filter((a) => a.active).map((a) => ({ id: a.id, name: a.displayName, status: a.status, onShift: onShift(a.id, rota.shifts, now), available: available(a, rota.shifts, now) }))
    .filter((p) => p.onShift || p.status !== "offline");
  return { onDuty: people.filter((p) => p.available).length, rostered: people.filter((p) => p.onShift).length, online: people.filter((p) => p.status === "online").length, people };
}

export type Overview = Awaited<ReturnType<typeof deskOverview>>;

/** Everything on the overview. Supplier balances only for people who see app finance. */
export async function deskOverview(o: { finance: boolean; now?: Date }) {
  const now = o.now ?? new Date();
  const today = riyadhDate(now);
  const [b, svc, funnel, drops, rev, bal, d, s] = await Promise.all([
    backlog(), service(now), funnelCounts(today), pageDropoffs({ day: today, limit: 1 }),
    o.finance ? revenue(today) : Promise.resolve(null),
    o.finance ? supplierBalances().catch(() => [] as SupplierBalance[]) : Promise.resolve(null),
    duty(now), getSettings(),
  ]);
  return {
    today, backlog: b, sla: { today: svc.today, target: s.deskSlaTargetBps / 10_000 }, csat: svc.week, byDay: svc.byDay, funnel,
    dropoffs: { n: drops.total, value: drops.value, payment: drops.counts.payment }, revenue: rev, balances: bal, duty: d,
  };
}

/** Where each number goes. */
export const overviewHref = {
  priority: (p: string) => `${D}/tickets?p=${p}`,
  age: (a: string) => `${D}/tickets?age=${a}`,
  cell: (p: string, a: string) => `${D}/tickets?p=${p}&age=${a}`,
  backlog: () => `${D}/tickets`,
  slaToday: () => `${D}/performance?r=today`,
  csat: () => `${D}/performance`,
  funnel: (step: FunnelStep) => `${D}/overview/funnel?step=${step}`,
  dropoffs: (day: string) => `${D}/drop-offs?day=${day}`,
  revenue: (from: string, to: string) => `${D}/finance?from=${from}&to=${to}`,
  balances: () => `${D}/finance/balances`,
  rota: () => `${D}/rota`,
};

/** The Ops dashboard's line for desk leads: running tickets, urgent ones, and those past their promise. One query. */
export async function deskBriefing(): Promise<{ open: number; urgent: number; late: number }> {
  const [r] = await db.select({
    open: sql<number>`count(*)::int`,
    urgent: sql<number>`count(*) FILTER (WHERE ${deskTickets.priority} = 'urgent' OR coalesce((${deskTickets.meta}->>'urgent')::boolean, false))::int`,
    late: sql<number>`count(*) FILTER (WHERE ${deskTickets.pausedAt} IS NULL AND ${deskTickets.dueAt} < now())::int`,
  }).from(deskTickets).where(inArray(deskTickets.status, ["new", "open"]));
  return { open: r?.open ?? 0, urgent: r?.urgent ?? 0, late: r?.late ?? 0 };
}
