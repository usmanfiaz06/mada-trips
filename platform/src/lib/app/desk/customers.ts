import "server-only";
import { and, asc, desc, eq, inArray, isNull, or, sql, type SQL } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import {
  appAudit, appDevices, appInvoices, appMessages, appPayments, appPeople, appRefunds, appRequests, appSegments, appTrips, appUsers,
} from "@/db/app-schema";
import { appAgentAssignments, appAgents, appDeskBlocks } from "@/db/app-schema-desk";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appAskMemory, appAskThreads } from "@/db/app-schema-ask";
import { appSupportThreads } from "@/db/app-schema-wallet";
import { addCredit, getCredit } from "@/lib/app/credit";
import { decryptField, passportAad } from "@/lib/app/crypto";
import { contactPreferenceOf } from "@/lib/app/booking/requests";
import { createApproval } from "@/lib/approvals";
import { getSettings } from "@/lib/settings";
import { riyadhDate } from "@/lib/dates";
import { likeContains } from "@/lib/security";
import { assertCap, deskAudit, DeskError, sarText, shortRef, travellerName, type DeskActor } from "./core";
import { blockTraveller, revealPassport, unblockTraveller } from "./adapters";

/*
 * Customer 360 for the desk (DESK-PLAN.md §4.2.6, unit U3): one page per app account, and the search that finds it by
 * name, phone, email, PNR, booking ref or ICCID. Everything here reads the app_ tables; the only writes are goodwill
 * credit, block and unblock, a passport look and an Ask transcript read, and each of those lands in both audit trails.
 *
 * Access follows the owner's defaults (§7): support agents see passports masked to the last three characters and only
 * the Ask transcripts that were handed to the desk or belong to a customer with an open item; leads (desk.admin) read
 * any, and desk.issue reveals a full passport. Goodwill up to the Rules & limits amount goes on at once with
 * desk.refund; anything larger goes to Ops Approvals for a lead.
 */

export const PAGE_SIZE = 50;
export const CUSTOMER_FILTERS = ["all", "open", "blocked", "credit", "new"] as const;
export type CustomerFilter = (typeof CUSTOMER_FILTERS)[number];
export const CUSTOMER_TABS = ["overview", "bookings", "payments", "credit", "esims", "requests", "chats", "memory", "audit"] as const;
export type CustomerTab = (typeof CUSTOMER_TABS)[number];

/* ───────────── what a search term can be ───────────── */

/** The digits of a phone as people type it (0500…, 966 50…, +966 50 000 4127), without the country code or a leading 0. */
export function phoneDigits(q: string): string | null {
  if (!/^[+\d\s().-]+$/.test(q.trim())) return null;
  let d = q.replace(/\D/g, "");
  if (d.startsWith("00")) d = d.slice(2);
  if (d.startsWith("966")) d = d.slice(3);
  if (d.startsWith("0")) d = d.slice(1);
  return d.length >= 4 ? d : null;
}

/** "R-7B21C4", "O-7b21c4" or a bare 6+ hex: the start of a request's id, as shortRef prints it. */
export function refHex(q: string): string | null {
  const s = q.trim();
  const m = s.match(/^[ROF]-([0-9a-f]{6})$/i);
  if (m) return m[1]!.toLowerCase();
  // Bare, it has to look like an id: hex only, with both letters and digits (so a phone or a word isn't one).
  return /^[0-9a-f]{6,32}$/i.test(s) && /\d/.test(s) && /[a-f]/i.test(s) ? s.toLowerCase() : null;
}

/** A supplier code (PNR, booking ref) is 5 to 12 letters and digits. */
const codeOf = (q: string) => (/^[a-z0-9]{5,12}$/i.test(q.trim()) ? q.trim().toUpperCase() : null);
/** ICCIDs are 18 to 22 digits; people paste the last few. */
const iccidOf = (q: string) => { const d = q.replace(/\s/g, ""); return /^\d{6,22}$/.test(d) ? d : null; };

/** Which customers match the term, as one condition on app_users u. */
function matchCustomer(q: string): SQL {
  const like = likeContains(q.trim());
  const phone = phoneDigits(q), hex = refHex(q), code = codeOf(q), iccid = iccidOf(q);
  const parts: SQL[] = [
    sql`u.name ILIKE ${like}`,
    sql`lower(u.email) LIKE lower(${like})`,
    sql`EXISTS (SELECT 1 FROM app_people p WHERE p.owner_id = u.id AND p.deleted_at IS NULL AND (p.given_names || ' ' || p.surname) ILIKE ${like})`,
  ];
  if (phone) parts.push(sql`regexp_replace(coalesce(u.phone, ''), '\\D', '', 'g') LIKE ${`%${phone}%`}`);
  if (code) parts.push(
    sql`EXISTS (SELECT 1 FROM app_trips t WHERE t.owner_id = u.id AND upper(t.booking_ref) = ${code})`,
    sql`EXISTS (SELECT 1 FROM app_segments s JOIN app_trips t ON t.id = s.trip_id WHERE t.owner_id = u.id AND upper(s.pnr) = ${code})`,
    sql`EXISTS (SELECT 1 FROM app_orders o WHERE o.owner_id = u.id AND (upper(o.ref) = ${code} OR upper(o.supplier_ref) = ${code}))`,
    sql`EXISTS (SELECT 1 FROM app_requests r WHERE r.owner_id = u.id AND (upper(r.details->'desk'->>'pnr') = ${code} OR upper(r.details->'desk'->>'heldPnr') = ${code}))`,
  );
  if (hex) parts.push(
    sql`EXISTS (SELECT 1 FROM app_requests r WHERE r.owner_id = u.id AND replace(r.id::text, '-', '') LIKE ${`${hex}%`})`,
    sql`EXISTS (SELECT 1 FROM app_orders o WHERE o.owner_id = u.id AND replace(o.id::text, '-', '') LIKE ${`${hex}%`})`,
  );
  if (iccid) parts.push(sql`EXISTS (SELECT 1 FROM app_esims e WHERE e.owner_id = u.id AND e.iccid LIKE ${`%${iccid}%`})`);
  return sql`(${sql.join(parts, sql` OR `)})`;
}

/* ───────────── the numbers every row and the profile show ───────────── */

const OPEN_REQUEST = sql.raw(`('sent','reviewing','needs_answer','quoted','awaiting_payment','with_agent')`);
const OPEN_ORDER = sql.raw(`('pending_agent','held','price_locked','issuing','needs_answer','fare_changed','ticketing_failed')`);

/** Money kept: captured payments less what went back (approved or sent refunds). Halalas. */
const LIFETIME = sql`(
  coalesce((SELECT sum(p.amount) FROM app_payments p WHERE p.owner_id = u.id AND p.status IN ('captured','partially_refunded','refunded')), 0)
  - coalesce((SELECT sum(f.amount) FROM app_refunds f JOIN app_payments p ON p.id = f.payment_id WHERE p.owner_id = u.id AND f.stage IN ('approved','sent')), 0))`;
const CREDIT = sql`coalesce((SELECT sum(c.amount) FROM app_credit_ledger c WHERE c.user_id = u.id), 0)`;
const BOOKINGS = sql`(
  (SELECT count(*) FROM app_orders o WHERE o.owner_id = u.id AND o.status NOT IN ('draft','declined'))
  + (SELECT count(*) FROM app_requests r WHERE r.owner_id = u.id AND r.kind IN ('flight','stay','trip') AND r.status IN ('with_agent','confirmed','done')
     AND NOT EXISTS (SELECT 1 FROM app_orders o WHERE o.request_id = r.id)))`;
/** Things the desk still owes this customer: open requests and orders, refunds to decide, stuck eSIMs, unanswered chats. */
const OPEN_ITEMS = sql`(
  (SELECT count(*) FROM app_requests r WHERE r.owner_id = u.id AND r.status IN ${OPEN_REQUEST})
  + (SELECT count(*) FROM app_orders o WHERE o.owner_id = u.id AND o.request_id IS NULL AND o.status IN ${OPEN_ORDER})
  + (SELECT count(*) FROM app_refunds f JOIN app_payments p ON p.id = f.payment_id WHERE p.owner_id = u.id AND f.stage = 'requested')
  + (SELECT count(*) FROM app_esims e WHERE e.owner_id = u.id AND e.status = 'stuck')
  + (SELECT count(*) FROM app_support_threads st WHERE st.user_id = u.id AND
      (SELECT max(m.created_at) FROM app_messages m WHERE m.thread_kind = 'support' AND m.thread_id = st.id AND m.author_kind = 'user')
      > coalesce((SELECT max(m.created_at) FROM app_messages m WHERE m.thread_kind = 'support' AND m.thread_id = st.id AND m.author_kind = 'agent'), 'epoch')))`;
const BLOCKED = sql`EXISTS (SELECT 1 FROM app_desk_blocks b WHERE b.user_id = u.id AND b.lifted_at IS NULL)`;

const FILTER_SQL: Record<CustomerFilter, SQL> = {
  all: sql`true`, open: sql`${OPEN_ITEMS} > 0`, blocked: BLOCKED, credit: sql`${CREDIT} > 0`, new: sql`u.created_at > now() - interval '30 days'`,
};

export type CustomerRow = {
  id: string; name: string; phone: string | null; email: string | null; locale: string; createdAt: Date; deleted: boolean;
  blocked: boolean; agentName: string | null; bookings: number; lifetime: number; credit: number; open: number;
};

/** The customers list: search, a filter tab, a language, pages of 50 from SQL. */
export async function pageCustomers(opts: { q?: string; f?: string; lang?: string; limit?: number; offset?: number } = {}) {
  const f: CustomerFilter = (CUSTOMER_FILTERS as readonly string[]).includes(opts.f ?? "") ? (opts.f as CustomerFilter) : "all";
  const q = opts.q?.trim() ?? "";
  const base = and(
    q.length >= 2 ? matchCustomer(q) : undefined,
    opts.lang === "ar" || opts.lang === "en" ? sql`u.locale = ${opts.lang}` : undefined,
  ) ?? sql`true`;
  const limit = Math.min(opts.limit ?? PAGE_SIZE, 200), offset = Math.max(opts.offset ?? 0, 0);
  const [counts] = await db.execute<Record<CustomerFilter, number>>(sql`
    SELECT count(*)::int AS "all", count(*) FILTER (WHERE ${FILTER_SQL.open})::int AS "open", count(*) FILTER (WHERE ${BLOCKED})::int AS "blocked",
      count(*) FILTER (WHERE ${FILTER_SQL.credit})::int AS "credit", count(*) FILTER (WHERE ${FILTER_SQL.new})::int AS "new"
    FROM app_users u WHERE ${base}`);
  const rows = await db.execute<{ id: string; name: string; phone: string | null; email: string | null; locale: string; created_at: string | Date; deleted_at: string | Date | null;
    blocked: boolean; agent_name: string | null; bookings: number; lifetime: string; credit: string; open: number }>(sql`
    SELECT u.id, u.name, u.phone, u.email, u.locale, u.created_at, u.deleted_at, ${BLOCKED} AS blocked,
      (SELECT a.display_name FROM app_agent_assignments aa JOIN app_agents a ON a.id = aa.agent_id WHERE aa.user_id = u.id) AS agent_name,
      ${BOOKINGS}::int AS bookings, ${LIFETIME}::bigint AS lifetime, ${CREDIT}::bigint AS credit, ${OPEN_ITEMS}::int AS open
    FROM app_users u WHERE ${base} AND ${FILTER_SQL[f]}
    ORDER BY ${q ? sql`(lower(u.name) = lower(${q})) DESC,` : sql``} u.created_at DESC, u.id
    LIMIT ${limit} OFFSET ${offset}`);
  const c = counts ?? { all: 0, open: 0, blocked: 0, credit: 0, new: 0 };
  return {
    filter: f, total: c[f] ?? 0, counts: c,
    rows: rows.map((r): CustomerRow => ({
      id: r.id, name: r.name || "Traveller", phone: r.phone, email: r.email, locale: r.locale, createdAt: new Date(r.created_at), deleted: !!r.deleted_at,
      blocked: !!r.blocked, agentName: r.agent_name, bookings: Number(r.bookings), lifetime: Number(r.lifetime), credit: Number(r.credit), open: Number(r.open),
    })),
  };
}

/* ───────────── ⌘K ───────────── */

export type QuickHit = { id: string; kind: "customer" | "order" | "request" | "esim"; label: string; hint: string; href: string };
const D = "/adminwork/desk";

/** The command palette's desk results: customers, orders and requests by ref or PNR, eSIMs by ICCID. */
export async function quickSearch(q: string): Promise<QuickHit[]> {
  const term = q.trim();
  if (term.length < 2) return [];
  const code = codeOf(term), hex = refHex(term), iccid = iccidOf(term);
  const [people, requests, orders, esims] = await Promise.all([
    db.execute<{ id: string; name: string; phone: string | null; email: string | null }>(sql`
      SELECT u.id, u.name, u.phone, u.email FROM app_users u WHERE ${matchCustomer(term)} ORDER BY (lower(u.name) = lower(${term})) DESC, u.created_at DESC LIMIT 5`),
    code || hex ? db.execute<{ id: string; kind: string; summary: string; name: string; pnr: string | null }>(sql`
      SELECT r.id, r.kind, r.summary, u.name, coalesce(r.details->'desk'->>'pnr', r.details->'desk'->>'heldPnr', t.booking_ref) AS pnr
      FROM app_requests r JOIN app_users u ON u.id = r.owner_id LEFT JOIN app_trips t ON t.id = r.trip_id
      WHERE ${sql.join([
        ...(hex ? [sql`replace(r.id::text, '-', '') LIKE ${`${hex}%`}`] : []),
        ...(code ? [sql`upper(r.details->'desk'->>'pnr') = ${code}`, sql`upper(r.details->'desk'->>'heldPnr') = ${code}`, sql`upper(t.booking_ref) = ${code}`,
          sql`EXISTS (SELECT 1 FROM app_segments s WHERE s.trip_id = r.trip_id AND upper(s.pnr) = ${code})`,
          sql`EXISTS (SELECT 1 FROM app_orders o WHERE o.request_id = r.id AND (upper(o.ref) = ${code} OR upper(o.supplier_ref) = ${code}))`] : []),
      ], sql` OR `)} ORDER BY r.created_at DESC LIMIT 4`) : Promise.resolve([]),
    code || hex ? db.execute<{ id: string; owner_id: string; kind: string; ref: string | null; supplier_ref: string | null; name: string; esim: string | null }>(sql`
      SELECT o.id, o.owner_id, o.kind, o.ref, o.supplier_ref, u.name, (SELECT e.id FROM app_esims e WHERE e.order_id = o.id ORDER BY e.idx LIMIT 1) AS esim
      FROM app_orders o JOIN app_users u ON u.id = o.owner_id
      WHERE o.request_id IS NULL AND (${sql.join([
        ...(hex ? [sql`replace(o.id::text, '-', '') LIKE ${`${hex}%`}`] : []),
        ...(code ? [sql`upper(o.ref) = ${code}`, sql`upper(o.supplier_ref) = ${code}`] : []),
      ], sql` OR `)}) ORDER BY o.created_at DESC LIMIT 3`) : Promise.resolve([]),
    iccid ? db.execute<{ id: string; iccid: string; status: string; name: string }>(sql`
      SELECT e.id, e.iccid, e.status, u.name FROM app_esims e JOIN app_users u ON u.id = e.owner_id WHERE e.iccid LIKE ${`%${iccid}%`} ORDER BY e.created_at DESC LIMIT 3`) : Promise.resolve([]),
  ]);
  const orderKind = (k: string) => k === "flight" || k === "stay" || k === "trip";
  return [
    ...people.map((p): QuickHit => ({ id: p.id, kind: "customer", label: p.name || "Traveller", hint: p.phone ?? p.email ?? "", href: `${D}/customers/${p.id}` })),
    ...requests.map((r): QuickHit => ({ id: r.id, kind: orderKind(r.kind) ? "order" : "request", label: `${shortRef(r.id, orderKind(r.kind) ? "O" : "R")} · ${travellerName(r.name)}`, hint: r.pnr ?? r.summary, href: `${D}/${orderKind(r.kind) ? "orders" : "requests"}/${r.id}` })),
    ...orders.map((o): QuickHit => ({ id: o.id, kind: "order", label: `${o.ref ?? shortRef(o.id, "O")} · ${travellerName(o.name)}`, hint: o.supplier_ref ?? o.kind, href: o.esim ? `${D}/esims/${o.esim}` : `${D}/customers/${o.owner_id}?tab=bookings` })),
    ...esims.map((e): QuickHit => ({ id: e.id, kind: "esim", label: `${e.iccid} · ${travellerName(e.name)}`, hint: e.status, href: `${D}/esims/${e.id}` })),
  ];
}

/* ───────────── the profile ───────────── */

/** Masked as support agents see it: dots, then the last three characters (§7 default 1). */
export function maskPassport(full: string | null | undefined, stored?: string | null): string | null {
  if (full && full.length >= 4) return `${"•".repeat(Math.min(6, full.length - 3))}${full.slice(-3)}`;
  return stored ?? null;
}

function maskedOf(p: typeof appPeople.$inferSelect) {
  if (!p.passportNumberEnc) return p.passportNumberMasked;
  try { return maskPassport(decryptField(p.passportNumberEnc, passportAad(p.id)), p.passportNumberMasked); } catch { return p.passportNumberMasked; }
}

/** The header, the stat tiles, the overview tab and the rail: who they are and what is open. */
export async function getCustomer(id: string) {
  const [u] = await db.select().from(appUsers).where(eq(appUsers.id, id));
  if (!u) return null;
  const [people, blocks, agent, devices, nums, lastReq, opens, trip, lastChat] = await Promise.all([
    db.select().from(appPeople).where(and(eq(appPeople.ownerId, id), isNull(appPeople.deletedAt))).orderBy(desc(appPeople.isSelf), asc(appPeople.createdAt)),
    db.select({ b: appDeskBlocks, by: schema.users.name }).from(appDeskBlocks).leftJoin(schema.users, eq(schema.users.id, appDeskBlocks.blockedBy)).where(eq(appDeskBlocks.userId, id)).orderBy(desc(appDeskBlocks.createdAt)),
    db.select({ id: appAgents.id, name: appAgents.displayName }).from(appAgentAssignments).innerJoin(appAgents, eq(appAgents.id, appAgentAssignments.agentId)).where(eq(appAgentAssignments.userId, id)).then((r) => r[0] ?? null),
    db.select({ platform: appDevices.platform, name: appDevices.name, appVersion: appDevices.appVersion, lastSeenAt: appDevices.lastSeenAt }).from(appDevices).where(and(eq(appDevices.userId, id), isNull(appDevices.disabledAt))).orderBy(desc(appDevices.lastSeenAt)),
    db.execute<{ lifetime: string; credit: string; bookings: number; open: number }>(sql`SELECT ${LIFETIME}::bigint AS lifetime, ${CREDIT}::bigint AS credit, ${BOOKINGS}::int AS bookings, ${OPEN_ITEMS}::int AS open FROM app_users u WHERE u.id = ${id}`).then((r) => r[0]!),
    db.select({ details: appRequests.details }).from(appRequests).where(eq(appRequests.ownerId, id)).orderBy(desc(appRequests.createdAt)).limit(10),
    openItems(id),
    db.select().from(appTrips).where(and(eq(appTrips.ownerId, id), sql`coalesce(${appTrips.endDate}, ${appTrips.startDate}) >= ${riyadhDate()}`, sql`${appTrips.status} <> 'cancelled'`)).orderBy(asc(appTrips.startDate)).limit(1).then((r) => r[0] ?? null),
    db.select({ body: appMessages.body, authorKind: appMessages.authorKind, createdAt: appMessages.createdAt, threadId: appMessages.threadId })
      .from(appMessages).innerJoin(appSupportThreads, and(eq(appMessages.threadKind, "support"), eq(appSupportThreads.id, appMessages.threadId)))
      .where(eq(appSupportThreads.userId, id)).orderBy(desc(appMessages.createdAt)).limit(1).then((r) => r[0] ?? null),
  ]);
  const contact = lastReq.map((r) => contactPreferenceOf(r.details)).find(Boolean) ?? null;
  const active = blocks.find((b) => !b.b.liftedAt) ?? null;
  const today = riyadhDate();
  const household = people.map((p) => ({
    id: p.id, isSelf: p.isSelf, name: `${p.givenNames} ${p.surname}`.trim() || u.name, relation: p.relation, dateOfBirth: p.dateOfBirth, nationality: p.nationality,
    passportMasked: maskedOf(p), passportExpiry: p.passportExpiry, hasPassport: !!p.passportNumberEnc,
    expiresSoon: !!p.passportExpiry && new Date(p.passportExpiry).getTime() - new Date(today).getTime() < 182 * 86400_000,
  }));
  return {
    user: u, household, agent, devices, contact, trip, lastChat, open: opens,
    block: active ? { reason: active.b.reason, at: active.b.createdAt, by: active.by } : null, blocks,
    stats: { lifetime: Number(nums.lifetime), credit: Number(nums.credit), bookings: Number(nums.bookings), open: Number(nums.open) },
    flags: {
      blocked: !!active, deleted: !!u.deletedAt, notificationsOff: u.notifications === "declined", unverified: !u.phoneVerified && !u.emailVerified,
      passportsExpiring: household.filter((h) => h.expiresSoon).length,
    },
  };
}
export type Customer = NonNullable<Awaited<ReturnType<typeof getCustomer>>>;

export type OpenItem = { kind: "request" | "order" | "refund" | "esim" | "chat"; id: string; title: string; status: string; at: Date; href: string };

/** What the desk still owes this customer, oldest first: the rail's next action is the first of these. */
export async function openItems(userId: string): Promise<OpenItem[]> {
  const [reqs, orders, refunds, esims, chats] = await Promise.all([
    db.select({ id: appRequests.id, kind: appRequests.kind, summary: appRequests.summary, status: appRequests.status, at: appRequests.createdAt }).from(appRequests)
      .where(and(eq(appRequests.ownerId, userId), sql`${appRequests.status} IN ${OPEN_REQUEST}`)),
    db.select({ id: appOrders.id, kind: appOrders.kind, status: appOrders.status, at: appOrders.createdAt, esim: sql<string | null>`(SELECT e.id FROM app_esims e WHERE e.order_id = ${appOrders.id} ORDER BY e.idx LIMIT 1)` }).from(appOrders)
      .where(and(eq(appOrders.ownerId, userId), isNull(appOrders.requestId), sql`${appOrders.status} IN ${OPEN_ORDER}`)),
    db.select({ id: appRefunds.id, amount: appRefunds.amount, at: appRefunds.createdAt }).from(appRefunds).innerJoin(appPayments, eq(appPayments.id, appRefunds.paymentId))
      .where(and(eq(appPayments.ownerId, userId), eq(appRefunds.stage, "requested"))),
    db.select({ id: appEsims.id, at: appEsims.createdAt, plan: appEsims.plan }).from(appEsims).where(and(eq(appEsims.ownerId, userId), eq(appEsims.status, "stuck"))),
    db.execute<{ id: string; about: string; since: string | Date }>(sql`
      SELECT st.id, st.about, (SELECT min(m.created_at) FROM app_messages m WHERE m.thread_kind = 'support' AND m.thread_id = st.id AND m.author_kind = 'user'
        AND m.created_at > coalesce((SELECT max(a.created_at) FROM app_messages a WHERE a.thread_kind = 'support' AND a.thread_id = st.id AND a.author_kind = 'agent'), 'epoch')) AS since
      FROM app_support_threads st WHERE st.user_id = ${userId}`),
  ]);
  const orderKind = (k: string) => k === "flight" || k === "stay" || k === "trip";
  return [
    ...reqs.map((r): OpenItem => ({ kind: orderKind(r.kind) ? "order" : "request", id: r.id, title: r.summary, status: r.status, at: r.at, href: `${D}/${orderKind(r.kind) ? "orders" : "requests"}/${r.id}` })),
    ...orders.map((o): OpenItem => ({ kind: "order", id: o.id, title: o.kind, status: o.status, at: o.at, href: o.esim ? `${D}/esims/${o.esim}` : `${D}/customers/${userId}?tab=bookings` })),
    ...refunds.map((f): OpenItem => ({ kind: "refund", id: f.id, title: sarText(f.amount), status: "requested", at: f.at, href: `${D}/refunds?focus=${f.id}` })),
    ...esims.map((e): OpenItem => ({ kind: "esim", id: e.id, title: String((e.plan as { name?: string }).name ?? "eSIM"), status: "stuck", at: e.at, href: `${D}/esims/${e.id}` })),
    ...chats.filter((c) => c.since).map((c): OpenItem => ({ kind: "chat", id: c.id, title: c.about, status: "waiting", at: new Date(c.since), href: `${D}/chats?t=support:${c.id}` })),
  ].sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ───────────── the tabs ───────────── */

export async function customerBookings(userId: string) {
  const [orders, legacy, trips] = await Promise.all([
    db.select({ o: appOrders, esim: sql<string | null>`(SELECT e.id FROM app_esims e WHERE e.order_id = ${appOrders.id} ORDER BY e.idx LIMIT 1)` }).from(appOrders)
      .where(eq(appOrders.ownerId, userId)).orderBy(desc(appOrders.createdAt)).limit(200),
    db.select().from(appRequests).where(and(eq(appRequests.ownerId, userId), inArray(appRequests.kind, ["flight", "stay", "trip"]),
      sql`NOT EXISTS (SELECT 1 FROM app_orders o WHERE o.request_id = ${appRequests.id})`)).orderBy(desc(appRequests.createdAt)).limit(200),
    db.select().from(appTrips).where(eq(appTrips.ownerId, userId)).orderBy(desc(appTrips.startDate)).limit(100),
  ]);
  const segs = trips.length ? await db.select({ tripId: appSegments.tripId, pnr: appSegments.pnr, flight: appSegments.flightNumber, from: appSegments.fromAirport, to: appSegments.toAirport })
    .from(appSegments).where(inArray(appSegments.tripId, trips.map((t) => t.id))).orderBy(asc(appSegments.sort)) : [];
  return {
    orders: [
      ...orders.map(({ o, esim }) => ({ id: o.id, ref: o.ref ?? shortRef(o.requestId ?? o.id, "O"), kind: o.kind, status: o.status, engine: true, total: o.total, supplierRef: o.supplierRef, createdAt: o.createdAt,
        href: o.requestId ? `${D}/orders/${o.requestId}` : esim ? `${D}/esims/${esim}` : null, title: o.lines[0]?.text ?? o.kind })),
      ...legacy.map((r) => ({ id: r.id, ref: shortRef(r.id, "O"), kind: r.kind, status: r.status, engine: false, total: null as number | null, supplierRef: (r.details as { desk?: { pnr?: string } }).desk?.pnr ?? null, createdAt: r.createdAt,
        href: `${D}/orders/${r.id}`, title: r.summary })),
    ].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()),
    trips: trips.map((t) => ({ ...t, segments: segs.filter((s) => s.tripId === t.id) })),
  };
}

export async function customerPayments(userId: string) {
  const [payments, invoices] = await Promise.all([
    db.select().from(appPayments).where(eq(appPayments.ownerId, userId)).orderBy(desc(appPayments.createdAt)).limit(200),
    db.select().from(appInvoices).where(eq(appInvoices.ownerId, userId)).orderBy(desc(appInvoices.issuedAt)).limit(100),
  ]);
  const refunds = payments.length ? await db.select().from(appRefunds).where(inArray(appRefunds.paymentId, payments.map((p) => p.id))).orderBy(desc(appRefunds.createdAt)) : [];
  return { payments, refunds, invoices };
}

export const customerCredit = (userId: string) => getCredit(userId);

export async function customerEsims(userId: string) {
  return db.select().from(appEsims).where(eq(appEsims.ownerId, userId)).orderBy(desc(appEsims.createdAt)).limit(100);
}

export async function customerRequests(userId: string) {
  // Bookings are on their own tab; a flight asked for in Ask stays a request here until it's paid and has an order.
  return db.select().from(appRequests).where(and(eq(appRequests.ownerId, userId), or(
    sql`${appRequests.kind} NOT IN ('flight','stay','trip')`,
    sql`${appRequests.details}->>'source' = 'ask' AND NOT EXISTS (SELECT 1 FROM app_orders o WHERE o.request_id = ${appRequests.id})`,
  ))).orderBy(desc(appRequests.createdAt)).limit(200);
}

export async function customerMemory(userId: string) {
  return db.select().from(appAskMemory).where(eq(appAskMemory.ownerId, userId)).orderBy(desc(appAskMemory.createdAt)).limit(200);
}

/* ───────────── conversations, and who may read Ask ───────────── */

/**
 * Who may read an Ask transcript (§7 default 5): a lead (desk.admin) reads any; an agent with desk.ask.read reads
 * one that was handed to the desk, or any of a customer who has something open with us. Nobody else.
 */
export function askAccess(perms: ReadonlySet<string>, t: { handedOff: boolean; customerHasOpen: boolean }): "lead" | "handoff" | "open_item" | null {
  if (perms.has("desk.admin")) return "lead";
  if (!perms.has("desk.ask.read")) return null;
  if (t.handedOff) return "handoff";
  return t.customerHasOpen ? "open_item" : null;
}

// handed_off_at survives a fold that drops the talk_to_human call from the history; a taken-over thread counts too (desk/ask.ts).
const HANDED = sql<boolean>`(${appAskThreads.handedOffAt} IS NOT NULL OR ${appAskThreads.mode} = 'agent' OR position('talk_to_human' in ${appAskThreads.messages}::text) > 0)`;

export async function customerChats(actor: DeskActor, userId: string, hasOpen: boolean) {
  const [support, requests, ask] = await Promise.all([
    db.execute<{ id: string; about: string; status: string; n: number; last_at: string | Date | null; last_body: string | null }>(sql`
      SELECT st.id, st.about, st.status, (SELECT count(*)::int FROM app_messages m WHERE m.thread_kind = 'support' AND m.thread_id = st.id) AS n,
        lm.created_at AS last_at, lm.body AS last_body
      FROM app_support_threads st LEFT JOIN LATERAL (SELECT created_at, body FROM app_messages m WHERE m.thread_kind = 'support' AND m.thread_id = st.id ORDER BY created_at DESC LIMIT 1) lm ON true
      WHERE st.user_id = ${userId} ORDER BY lm.created_at DESC NULLS LAST`),
    db.execute<{ id: string; kind: string; summary: string; n: number; last_at: string | Date | null }>(sql`
      SELECT r.id, r.kind, r.summary, count(m.id)::int AS n, max(m.created_at) AS last_at FROM app_requests r
      JOIN app_messages m ON m.thread_kind = 'request' AND m.thread_id = r.id WHERE r.owner_id = ${userId} GROUP BY r.id ORDER BY max(m.created_at) DESC LIMIT 50`),
    db.select({ id: appAskThreads.id, lang: appAskThreads.lang, turns: appAskThreads.turns, summary: appAskThreads.summary, createdAt: appAskThreads.createdAt, updatedAt: appAskThreads.updatedAt, handedOff: HANDED })
      .from(appAskThreads).where(eq(appAskThreads.ownerId, userId)).orderBy(desc(appAskThreads.updatedAt)).limit(50),
  ]);
  const d = (x: string | Date | null) => (x ? new Date(x) : null);
  return {
    support: support.map((s) => ({ id: s.id, about: s.about, status: s.status, messages: s.n, lastAt: d(s.last_at), lastBody: s.last_body })),
    requests: requests.map((r) => ({ id: r.id, kind: r.kind, summary: r.summary, messages: r.n, lastAt: d(r.last_at) })),
    // The list says a thread exists and whether this person may open it; the words only come through readAskThread.
    ask: ask.map((a) => ({ ...a, access: askAccess(actor.permissions, { handedOff: !!a.handedOff, customerHasOpen: hasOpen }) })),
  };
}

export type AskLine = { who: "me" | "mada"; text: string; cards?: string[] };

/** One Ask transcript, read-only, for someone allowed to read it. Every read is in both audit trails. */
export async function readAskThread(actor: DeskActor, userId: string, threadId: string) {
  assertCap(actor, "desk.view");
  const [th] = await db.select({ id: appAskThreads.id, ownerId: appAskThreads.ownerId, transcript: appAskThreads.transcript, lang: appAskThreads.lang, turns: appAskThreads.turns,
    summary: appAskThreads.summary, createdAt: appAskThreads.createdAt, updatedAt: appAskThreads.updatedAt, handedOff: HANDED }).from(appAskThreads).where(eq(appAskThreads.id, threadId));
  if (!th || th.ownerId !== userId) throw new DeskError("Not found", "NOT_FOUND");
  const hasOpen = (await openItems(userId)).length > 0;
  const why = askAccess(actor.permissions, { handedOff: !!th.handedOff, customerHasOpen: hasOpen });
  if (!why) throw new DeskError("Ask conversations open to the desk once they're handed over, or while the customer has something open with us", "FORBIDDEN");
  await db.transaction((tx) => deskAudit(tx, actor, {
    action: "desk.ask.read", entityType: "app_user", entityId: userId, ref: "Ask Mada",
    summary: `Read an Ask Mada conversation (${th.turns} turns${why === "lead" ? ", as lead" : why === "handoff" ? ", handed to the desk" : ", customer has an open item"})`, data: { threadId, why },
  }));
  const lines = (th.transcript as AskLine[]).filter((l) => l && (l.who === "me" || l.who === "mada") && typeof l.text === "string")
    .map((l) => ({ who: l.who, text: l.text, cards: Array.isArray(l.cards) ? l.cards.filter((c) => typeof c === "string") : [] }));
  return { ...th, lines, why };
}

/* ───────────── audit history ───────────── */

export type AuditLine = { id: string; at: Date; who: string; source: "traveller" | "desk" | "system"; action: string; summary: string };

/** What happened to this customer's records: the app's own audit (their actions and the system's) and the desk's log. */
export async function customerAudit(userId: string, limit = 100): Promise<AuditLine[]> {
  const [people, reqs, payments] = await Promise.all([
    db.select({ id: appPeople.id }).from(appPeople).where(eq(appPeople.ownerId, userId)),
    db.select({ id: appRequests.id }).from(appRequests).where(eq(appRequests.ownerId, userId)),
    db.select({ id: appPayments.id }).from(appPayments).where(eq(appPayments.ownerId, userId)),
  ]);
  const ids = [userId, ...people.map((p) => p.id), ...reqs.map((r) => r.id), ...payments.map((p) => p.id)];
  const [app, desk] = await Promise.all([
    db.select({ a: appAudit, opsName: schema.users.name }).from(appAudit).leftJoin(schema.users, and(eq(appAudit.actorKind, "agent"), sql`${schema.users.id}::text = ${appAudit.actorId}`))
      .where(or(and(eq(appAudit.actorKind, "user"), eq(appAudit.actorId, userId)), inArray(appAudit.entityId, ids), sql`${appAudit.data}->>'userId' = ${userId}`))
      .orderBy(desc(appAudit.createdAt)).limit(limit),
    db.select({ e: schema.auditEvents, name: schema.users.name }).from(schema.auditEvents).leftJoin(schema.users, eq(schema.users.id, schema.auditEvents.actorId))
      .where(and(eq(schema.auditEvents.entityType, "desk"), inArray(schema.auditEvents.entityId, ids))).orderBy(desc(schema.auditEvents.at)).limit(limit),
  ]);
  // A desk action writes both trails; the desk's line (with the agent's Ops name) is the one kept.
  const deskKeys = new Set(desk.map((d) => `${d.e.action}|${d.e.entityId}|${Math.round(d.e.at.getTime() / 2000)}`));
  return [
    ...desk.map(({ e, name }): AuditLine => ({ id: `d${e.id}`, at: e.at, who: name ?? "System", source: "desk", action: e.action, summary: e.summary })),
    ...app.filter(({ a }) => !(a.actorKind === "agent" && deskKeys.has(`${a.action}|${a.entityId}|${Math.round(a.createdAt.getTime() / 2000)}`)))
      .map(({ a, opsName }): AuditLine => ({ id: `a${a.id}`, at: a.createdAt, who: a.actorKind === "user" ? "Traveller" : a.actorKind === "agent" ? opsName ?? "Agent" : "System",
        source: a.actorKind === "user" ? "traveller" : a.actorKind === "agent" ? "desk" : "system", action: a.action, summary: a.summary })),
  ].sort((x, y) => y.at.getTime() - x.at.getTime()).slice(0, limit);
}

/* ───────────── actions from the profile ───────────── */

/** The full passport number of someone in this customer's household, for desk.issue. Logged by revealPassport. */
export async function revealCustomerPassport(actor: DeskActor, userId: string, personId: string) {
  assertCap(actor, "desk.issue");
  const [p] = await db.select({ ownerId: appPeople.ownerId }).from(appPeople).where(eq(appPeople.id, personId));
  if (!p || p.ownerId !== userId) throw new DeskError("That traveller isn't in this household", "FORBIDDEN");
  return revealPassport(actor, personId);
}

export const blockCustomer = blockTraveller;
export const unblockCustomer = unblockTraveller;

/** Goodwill already given today (Riyadh) by this person on the desk, from the Ops log. Halalas. */
async function goodwillToday(tx: Tx, actorId: string) {
  const [r] = await tx.execute<{ s: string | null }>(sql`
    SELECT sum((changes->>'amount')::bigint) AS s FROM audit_events
    WHERE actor_id = ${actorId} AND action = 'desk.credit.added' AND changes->>'kind' = 'goodwill'
      AND (at AT TIME ZONE 'Asia/Riyadh')::date = ${riyadhDate()}::date`);
  return Number(r?.s ?? 0);
}

export type GoodwillResult = { applied: true; balance: number } | { applied: false; approvalRef: string; reason: "over_limit" | "over_daily" | "no_right" };

/**
 * Goodwill credit from the profile. A lead gives any amount; desk.refund gives up to the limit per credit and per day
 * (Rules & limits); anything else is sent to Ops Approvals, where a lead approves it and it lands then.
 */
export async function giveGoodwill(actor: DeskActor, userId: string, v: { amount: number; note: string }): Promise<GoodwillResult> {
  assertCap(actor, "desk.act");
  if (!Number.isInteger(v.amount) || v.amount <= 0) throw new DeskError("Enter an amount");
  if (v.amount > 10_000_00) throw new DeskError("Goodwill is capped at SAR 10,000. Use a refund for more");
  const note = v.note.trim();
  if (note.length < 5) throw new DeskError("Say why, in a few words the traveller will read");
  return db.transaction(async (tx) => {
    const [u] = await tx.select({ id: appUsers.id, name: appUsers.name, deletedAt: appUsers.deletedAt }).from(appUsers).where(eq(appUsers.id, userId));
    if (!u || u.deletedAt) throw new DeskError("Customer not found", "NOT_FOUND");
    const s = await getSettings(tx);
    const lead = actor.permissions.has("desk.admin");
    const today = lead ? 0 : await goodwillToday(tx, actor.id);
    const reason = lead ? null : !actor.permissions.has("desk.refund") ? "no_right" : v.amount > s.deskGoodwillLimit ? "over_limit" : today + v.amount > s.deskAgentDailyLimit ? "over_daily" : null;
    if (!reason) {
      const r = await addCredit(tx, { userId, amount: v.amount, kind: "goodwill", note: note.slice(0, 200), actor: { kind: "agent", id: actor.id } });
      await deskAudit(tx, actor, { action: "desk.credit.added", entityType: "app_user", entityId: userId, ref: travellerName(u.name),
        summary: `Gave ${travellerName(u.name)} ${sarText(v.amount)} goodwill credit: ${note.slice(0, 120)}`, data: { amount: v.amount, kind: "goodwill" } }, { app: false });
      return { applied: true as const, balance: r.balance };
    }
    let req;
    try {
      req = await createApproval(tx, { kind: "goodwill", entityType: "app_user", entityId: userId, title: `Goodwill credit for ${travellerName(u.name)}: ${note.slice(0, 80)}`,
        amount: v.amount, reason: note.slice(0, 300), requestedBy: actor.id, payload: { userId, amount: v.amount, note: note.slice(0, 200) } });
    } catch (e) { throw new DeskError(e instanceof Error ? e.message : "No lead is available to approve this", "CONFLICT"); }
    await deskAudit(tx, actor, { action: "desk.credit.requested", entityType: "app_user", entityId: userId, ref: req.ref,
      summary: `Asked a lead to approve ${sarText(v.amount)} goodwill credit for ${travellerName(u.name)} (${req.ref})`, data: { amount: v.amount, approvalId: req.id, reason } });
    return { applied: false as const, approvalRef: req.ref, reason };
  });
}

/** Ops Approvals decided a goodwill request (lib/approvals.ts applyOutcome): on yes, the credit lands now. */
export async function applyGoodwillApproval(tx: Tx, req: typeof schema.approvalRequests.$inferSelect, ok: boolean, actorId: string) {
  if (!ok) return;
  const p = req.payload as { userId?: string; amount?: number; note?: string } | null;
  if (!p?.userId || !Number.isInteger(p.amount) || (p.amount ?? 0) <= 0) return;
  // decide() resolves a request once, under a row lock, so this runs once per approval.
  await addCredit(tx, { userId: p.userId, amount: p.amount!, kind: "goodwill", note: `${p.note ?? "Goodwill"} (${req.ref})`.slice(0, 200), actor: { kind: "agent", id: actorId } });
  await tx.insert(schema.auditEvents).values({ actorId, action: "desk.credit.added", entityType: "desk", entityId: p.userId, entityRef: req.ref,
    summary: `${sarText(p.amount!)} goodwill credit added after ${req.ref} was approved`, changes: { amount: p.amount, kind: "goodwill", approvalId: req.id } });
}
