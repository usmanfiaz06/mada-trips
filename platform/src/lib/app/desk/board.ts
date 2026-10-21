import "server-only";
import { asc, eq, sql, type SQL } from "drizzle-orm";
import { db, schema } from "@/db";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appSupplierBookings } from "@/db/app-schema-hotelbeds";
import { appPayments, appRequests, appSegments, appTrips, appUsers } from "@/db/app-schema";
import { appSearchLog } from "@/db/app-schema-dropoffs";
import { appAgents } from "@/db/app-schema-desk";
import { riyadhDate } from "@/lib/dates";
import { ORDER_KINDS, PAGE_SIZE } from "./adapters";
import { shortRef, travellerName } from "./core";

/*
 * The live board (DESK-PLAN.md §4.2.3): every booking across products on one lifecycle, so the desk can see where
 * everything is, not only what is waiting. A board item is an app order (flights, stays, packages, eSIMs, shares and
 * paid quotes), a request with no order behind it yet (Umrah, visas, cars, things to do…), or a signed-in traveller's
 * latest search in the last day with no order after it. Each lands in exactly one tab: boardStage() says which, and
 * STAGE_SQL is the same rule in SQL so the tabs filter and page in the database (keep the two in step; a test checks).
 */

export const BOARD_TABS = ["searching", "held", "paid", "confirmed", "travelling", "done", "problem"] as const;
export type BoardTab = (typeof BOARD_TABS)[number];

export type StageInput = {
  source: "order" | "request" | "search";
  status: string;
  /** The order's payment status (app_payments), if it has one. */
  pay?: string | null;
  /** An eSIM order's first eSIM status (app_esims). */
  esim?: string | null;
  /** Trip or booked dates, YYYY-MM-DD. */
  start?: string | null;
  end?: string | null;
  /** A flight on the trip was cancelled or diverted. */
  disrupted?: boolean;
};

const ORDER_PROBLEM = ["declined", "ticketing_failed"];
const ORDER_HELD = ["requires_action", "payment_requested"];
const ORDER_PAID = ["pending_agent", "held", "price_locked", "issuing", "needs_answer", "fare_changed"];
const REQUEST_SEARCHING = ["queued", "sent", "reviewing", "needs_answer"];
const REQUEST_HELD = ["quoted", "awaiting_payment"];
const ESIM_DONE = ["used_up", "expired", "refunded"];
const ESIM_LIVE = ["installed", "active"];

/** Confirmed: the dates (or an eSIM's own state) decide whether they are travelling or done. */
function afterConfirmed(x: StageInput, today: string, fallback: BoardTab): BoardTab {
  if (x.esim) return ESIM_DONE.includes(x.esim) ? "done" : ESIM_LIVE.includes(x.esim) ? "travelling" : "confirmed";
  const end = x.end ?? x.start;
  if (end && end < today) return "done";
  if (x.disrupted) return "problem";
  if (x.start && x.start <= today) return "travelling";
  return x.start ? "confirmed" : fallback;
}

/** The one tab a board item sits in. Anything the board doesn't recognise is a problem, so it is looked at. */
export function boardStage(x: StageInput, today: string): BoardTab {
  if (x.source === "search") return "searching";
  const s = x.status;
  if (x.source === "order") {
    if (ORDER_PROBLEM.includes(s) || x.pay === "failed" || x.esim === "stuck") return "problem";
    if (s === "cancelled") return "done";
    if (ORDER_HELD.includes(s)) return "held";
    if (ORDER_PAID.includes(s)) return x.disrupted ? "problem" : "paid";
    if (s === "confirmed") return afterConfirmed(x, today, "confirmed");
    return "problem";
  }
  if (s === "cancelled") return "done";
  if (REQUEST_SEARCHING.includes(s)) return "searching";
  if (REQUEST_HELD.includes(s)) return "held";
  if (s === "with_agent") return x.disrupted ? "problem" : "paid";
  if (s === "confirmed" || s === "done") return afterConfirmed(x, today, s === "done" ? "done" : "confirmed");
  return "problem";
}

/** How long an item may sit in a tab before the board calls it stuck (minutes). */
export const STUCK_MINUTES: Partial<Record<BoardTab, number>> = { held: 60, paid: 30, problem: 15 };
export const isStuck = (tab: BoardTab, since: Date, now = new Date()) => {
  const m = STUCK_MINUTES[tab];
  return m !== undefined && now.getTime() - since.getTime() > m * 60_000;
};

export const BOARD_PRODUCTS = ["flight", "stay", "package", "esim", "transfer", "activity", "umrah", "visa", "share", "request"] as const;
export type BoardProduct = (typeof BOARD_PRODUCTS)[number];
const REQUEST_PRODUCT: Record<string, BoardProduct> = { flight: "flight", stay: "stay", trip: "package", umrah: "umrah", visa: "visa", car: "transfer", activity: "activity", restaurant: "activity" };

/** What was booked, as the board's product filter names it. */
export function productOf(source: StageInput["source"], kind: string, requestKind?: string | null): BoardProduct {
  if (source === "order") {
    if (kind === "trip") return "flight";
    if (kind === "stay" || kind === "package" || kind === "esim" || kind === "share") return kind;
    return REQUEST_PRODUCT[requestKind ?? ""] ?? "request";
  }
  return REQUEST_PRODUCT[kind] ?? (source === "search" ? "flight" : "request");
}

export const BOARD_SUPPLIERS = ["mada", "tbo", "hotelbeds", "esimaccess", "airalo", "mock"] as const;

/* ───────── the same rules in SQL ───────── */

const list = (xs: readonly string[]) => sql.join(xs.map((x) => sql`${x}`), sql`, `);
const AFTER = (today: string, fallback: SQL) => sql`CASE
  WHEN esim IS NOT NULL THEN CASE WHEN esim IN (${list(ESIM_DONE)}) THEN 'done' WHEN esim IN (${list(ESIM_LIVE)}) THEN 'travelling' ELSE 'confirmed' END
  WHEN coalesce(end_d, start_d) < ${today}::date THEN 'done'
  WHEN disrupted THEN 'problem'
  WHEN start_d <= ${today}::date THEN 'travelling'
  WHEN start_d IS NOT NULL THEN 'confirmed'
  ELSE ${fallback} END`;
const STAGE_SQL = (today: string) => sql`CASE
  WHEN source = 'search' THEN 'searching'
  WHEN source = 'order' THEN CASE
    WHEN status IN (${list(ORDER_PROBLEM)}) OR pay = 'failed' OR esim = 'stuck' THEN 'problem'
    WHEN status = 'cancelled' THEN 'done'
    WHEN status IN (${list(ORDER_HELD)}) THEN 'held'
    WHEN status IN (${list(ORDER_PAID)}) THEN CASE WHEN disrupted THEN 'problem' ELSE 'paid' END
    WHEN status = 'confirmed' THEN ${AFTER(today, sql`'confirmed'`)}
    ELSE 'problem' END
  ELSE CASE
    WHEN status = 'cancelled' THEN 'done'
    WHEN status IN (${list(REQUEST_SEARCHING)}) THEN 'searching'
    WHEN status IN (${list(REQUEST_HELD)}) THEN 'held'
    WHEN status = 'with_agent' THEN CASE WHEN disrupted THEN 'problem' ELSE 'paid' END
    WHEN status IN ('confirmed', 'done') THEN ${AFTER(today, sql`CASE WHEN status = 'done' THEN 'done' ELSE 'confirmed' END`)}
    ELSE 'problem' END
  END`;
const PRODUCT_SQL = sql`CASE
  WHEN source = 'order' AND kind = 'trip' THEN 'flight'
  WHEN source = 'order' AND kind IN ('stay', 'package', 'esim', 'share') THEN kind
  ELSE CASE coalesce(request_kind, kind) ${sql.join(Object.entries(REQUEST_PRODUCT).map(([k, v]) => sql`WHEN ${k} THEN ${v}`), sql` `)}
    ELSE CASE WHEN source = 'search' THEN 'flight' ELSE 'request' END END
  END`;
const STUCK_SQL = sql`(${sql.join(Object.entries(STUCK_MINUTES).map(([tab, m]) => sql`(stage = ${tab} AND since < now() - ${`${m} minutes`}::interval)`), sql` OR `)})`;

/** A YYYY-MM-DD string from a JSON field, or null (never a cast error on a bad value). */
const isoDay = (e: SQL) => sql`CASE WHEN (${e}) ~ '^\\d{4}-\\d{2}-\\d{2}$' THEN (${e})::date END`;
const disruptedOn = (trip: SQL) => sql`EXISTS (SELECT 1 FROM ${appSegments} s WHERE s.trip_id = ${trip} AND s.status IN ('cancelled', 'diverted'))`;

/** Every board item, one row each, before staging. Columns are what STAGE_SQL, PRODUCT_SQL and the page read. */
const ITEMS = sql`
  SELECT 'order' AS source, o.id::text AS id, o.request_id::text AS request_id, o.owner_id AS user_id, o.kind, rq.kind AS request_kind, o.status,
    p.status AS pay, e.status AS esim, e.id::text AS esim_id,
    coalesce(tr.start_date, ${isoDay(sql`o.snapshot->'search'->>'depart'`)}, ${isoDay(sql`o.snapshot->'search'->>'checkIn'`)}) AS start_d,
    coalesce(tr.end_date, ${isoDay(sql`o.snapshot->'search'->>'return'`)},
      ${isoDay(sql`o.snapshot->'search'->>'checkIn'`)} + CASE WHEN (o.snapshot->'search'->>'nights') ~ '^\\d+$' THEN (o.snapshot->'search'->>'nights')::int END) AS end_d,
    ${disruptedOn(sql`o.trip_id`)} AS disrupted,
    o.created_at, o.updated_at AS since, (o.total + o.extra)::bigint AS value,
    coalesce(o.snapshot->>'title', o.lines->0->>'text', o.kind) AS summary, coalesce(o.ref, '') AS ref, o.supplier_ref,
    coalesce(e.supplier, sb.supplier, CASE WHEN position('.' in coalesce(o.snapshot->>'flightSupplierId', '')) > 1 THEN split_part(o.snapshot->>'flightSupplierId', '.', 1) END,
      o.snapshot->'stay'->'hotel'->>'supplier', 'mada') AS supplier,
    rq.agent_ops_user_id AS agent_id, coalesce(rq.agent_name, o.agent_name) AS agent_name
  FROM ${appOrders} o
  LEFT JOIN ${appRequests} rq ON rq.id = o.request_id
  LEFT JOIN ${appPayments} p ON p.id = o.payment_id
  LEFT JOIN ${appTrips} tr ON tr.id = o.trip_id
  LEFT JOIN LATERAL (SELECT id, status, supplier FROM ${appEsims} WHERE order_id = o.id ORDER BY idx LIMIT 1) e ON true
  LEFT JOIN LATERAL (SELECT supplier FROM ${appSupplierBookings} WHERE source_kind = 'order' AND source_id = o.id ORDER BY created_at DESC LIMIT 1) sb ON true
  UNION ALL
  SELECT 'request', r.id::text, r.id::text, r.owner_id, r.kind, r.kind, r.status,
    p.status, NULL, NULL, tr.start_date, tr.end_date, ${disruptedOn(sql`r.trip_id`)},
    r.created_at, r.updated_at, coalesce(qt.total, p.amount, 0)::bigint, r.summary, '', NULL, 'mada', r.agent_ops_user_id, r.agent_name
  FROM ${appRequests} r
  LEFT JOIN ${appTrips} tr ON tr.id = r.trip_id
  LEFT JOIN LATERAL (SELECT status, amount FROM ${appPayments} WHERE request_id = r.id ORDER BY created_at DESC LIMIT 1) p ON true
  LEFT JOIN LATERAL (SELECT total FROM app_quotes WHERE request_id = r.id ORDER BY (status = 'withdrawn'), created_at DESC LIMIT 1) qt ON true
  WHERE r.kind NOT IN ('change', 'cancel', 'refund') AND NOT EXISTS (SELECT 1 FROM ${appOrders} x WHERE x.request_id = r.id)
  UNION ALL
  SELECT * FROM (SELECT DISTINCT ON (l.user_id) 'search', l.id::text, NULL::text, l.user_id, l.kind, NULL::text, 'searching',
    NULL::text, NULL::text, NULL::text, NULL::date, NULL::date, false,
    l.at, l.at, coalesce(l.value, 0)::bigint, l.summary, '', NULL::text, NULL::text, NULL::uuid, NULL::text
  FROM ${appSearchLog} l
  WHERE l.kind IN ('flight', 'stay') AND l.at > now() - interval '24 hours'
    AND NOT EXISTS (SELECT 1 FROM ${appOrders} x WHERE x.owner_id = l.user_id AND x.created_at > l.at)
  ORDER BY l.user_id, l.at DESC) s`;

export type BoardFilter = { tab?: string; q?: string; product?: string; supplier?: string; agent?: string; from?: string; to?: string; stuck?: boolean; limit?: number; offset?: number };
export type BoardRow = {
  source: StageInput["source"]; id: string; requestId: string | null; userId: string; kind: string; requestKind: string | null; status: string;
  pay: string | null; esim: string | null; esimId: string | null; start: string | null; end: string | null; disrupted: boolean;
  createdAt: Date; since: Date; value: number; summary: string; ref: string; supplierRef: string | null; supplier: string | null;
  agentName: string | null; stage: BoardTab; product: BoardProduct; stuck: boolean; userName: string; phone: string | null;
};

const day = (s?: string) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null);

/** One tab of the board, filtered and searched, 50 at a time, with the count behind every tab and the stuck count. */
export async function pageBoard(f: BoardFilter = {}, now = new Date()) {
  const today = riyadhDate(now);
  const limit = Math.min(Math.max(f.limit ?? PAGE_SIZE, 1), 200);
  const offset = Math.max(f.offset ?? 0, 0);
  const tab: BoardTab = (BOARD_TABS as readonly string[]).includes(f.tab ?? "") ? (f.tab as BoardTab) : "paid";
  const q = (f.q ?? "").trim().slice(0, 80);
  const like = `%${q.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  const from = day(f.from), to = day(f.to);
  const where: SQL[] = [sql`true`];
  if (q) where.push(sql`(b.summary ILIKE ${like} OR u.name ILIKE ${like} OR u.phone ILIKE ${like} OR b.ref ILIKE ${like} OR b.supplier_ref ILIKE ${like})`);
  if (f.product && (BOARD_PRODUCTS as readonly string[]).includes(f.product)) where.push(sql`b.product = ${f.product}`);
  if (f.supplier && (BOARD_SUPPLIERS as readonly string[]).includes(f.supplier)) where.push(sql`b.supplier = ${f.supplier}`);
  if (f.agent && /^[0-9a-f-]{36}$/i.test(f.agent)) where.push(sql`b.agent_id = ${f.agent}::uuid`);
  if (from) where.push(sql`b.created_at >= (${from}::date)::timestamp AT TIME ZONE 'Asia/Riyadh'`);
  if (to) where.push(sql`b.created_at < ((${to}::date + 1)::timestamp AT TIME ZONE 'Asia/Riyadh')`);
  if (f.stuck) where.push(sql`b.stuck`);
  const res = await db.execute(sql`
    WITH items AS (${ITEMS}),
    staged AS (SELECT *, ${STAGE_SQL(today)} AS stage, ${PRODUCT_SQL} AS product FROM items),
    b AS (SELECT staged.*, ${STUCK_SQL} AS stuck FROM staged),
    f AS (SELECT b.*, u.name AS user_name, u.phone FROM b JOIN ${appUsers} u ON u.id = b.user_id WHERE ${sql.join(where, sql` AND `)}),
    shown AS (SELECT * FROM f WHERE stage = ${tab})
    SELECT 'c' AS t, stage AS k, count(*)::int AS n, count(*) FILTER (WHERE stuck)::int AS s, 0::bigint AS v, NULL::json AS row FROM f GROUP BY stage
    UNION ALL SELECT 's', '', count(*)::int, count(*) FILTER (WHERE stuck)::int, coalesce(sum(value), 0)::bigint, NULL FROM shown
    UNION ALL (SELECT 'r', '', 0, 0, 0, row_to_json(shown) FROM shown
      ORDER BY stuck DESC, CASE WHEN stage IN ('held', 'paid', 'problem') THEN since END ASC NULLS LAST, created_at DESC LIMIT ${limit} OFFSET ${offset})`);
  const all = res as unknown as { t: string; k: string; n: number; s: number; v: string | number; row: Record<string, unknown> | null }[];
  const counts = Object.fromEntries(BOARD_TABS.map((k) => [k, 0])) as Record<BoardTab, number>;
  const stuckBy = { ...counts };
  for (const c of all.filter((x) => x.t === "c")) { counts[c.k as BoardTab] = c.n; stuckBy[c.k as BoardTab] = c.s; }
  const sum = all.find((x) => x.t === "s");
  const rows = all.filter((x) => x.t === "r").map((x) => toRow(x.row!));
  return { tab, rows, total: sum?.n ?? 0, value: Number(sum?.v ?? 0), stuck: sum?.s ?? 0, counts, stuckBy, today };
}

function toRow(r: Record<string, unknown>): BoardRow {
  const d = (v: unknown) => (v ? String(v).slice(0, 10) : null);
  const stage = r.stage as BoardTab, start = d(r.start_d), end = d(r.end_d);
  // Travelling since the first day, done since the last (Riyadh time); everywhere else, since the last change.
  const since = stage === "travelling" && start ? new Date(`${start}T00:00:00+03:00`) : stage === "done" && end && !r.esim ? new Date(`${end}T23:59:00+03:00`) : new Date(String(r.since));
  return {
    source: r.source as BoardRow["source"], id: String(r.id), requestId: (r.request_id as string | null) ?? null, userId: String(r.user_id), kind: String(r.kind),
    requestKind: (r.request_kind as string | null) ?? null, status: String(r.status), pay: (r.pay as string | null) ?? null, esim: (r.esim as string | null) ?? null,
    esimId: (r.esim_id as string | null) ?? null, start, end, disrupted: !!r.disrupted, createdAt: new Date(String(r.created_at)),
    since, value: Number(r.value ?? 0), summary: String(r.summary ?? ""), ref: String(r.ref || (r.source === "order" ? shortRef(String(r.id), "O") : r.source === "request" ? shortRef(String(r.id)) : "")),
    supplierRef: (r.supplier_ref as string | null) ?? null, supplier: (r.supplier as string | null) ?? null, agentName: (r.agent_name as string | null) ?? null,
    stage, product: r.product as BoardProduct, stuck: !!r.stuck, userName: travellerName(r.user_name as string | null), phone: (r.phone as string | null) ?? null,
  };
}

/** Where a board row opens: the desk's order or request page, the eSIM, or else the customer. */
export function boardHref(r: Pick<BoardRow, "source" | "requestId" | "requestKind" | "kind" | "esimId" | "userId">) {
  const D = "/adminwork/desk";
  if (r.esimId) return `${D}/esims/${r.esimId}`;
  if (r.requestId) return (ORDER_KINDS as readonly string[]).includes(r.requestKind ?? "") ? `${D}/orders/${r.requestId}` : `${D}/requests/${r.requestId}`;
  return customerHref(r.userId);
}
export const customerHref = (userId: string) => `/adminwork/desk/customers/${userId}`;

/** The people the agent filter offers: every desk agent, by their Ops login. */
export async function boardAgents() {
  return db.select({ id: appAgents.opsUserId, name: appAgents.displayName, login: schema.users.name }).from(appAgents)
    .innerJoin(schema.users, eq(schema.users.id, appAgents.opsUserId)).where(eq(appAgents.active, true)).orderBy(asc(appAgents.displayName));
}
