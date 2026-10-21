import "server-only";
import { and, asc, desc, eq, ilike, inArray, isNotNull, ne, or, sql, type SQL } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { appAgents, appDeskItems, appDeskNotes, deskTicketEvents, deskTicketLinks, deskTickets } from "@/db/app-schema-desk";
import { appRequests, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appSupportThreads } from "@/db/app-schema-wallet";
import type { CurrentUser } from "@/lib/auth";
import { agentForOps, type Agent } from "./agents";
import { getThread, sendAgentReply } from "./adapters";
import { assertCap, deskAudit, DeskError, has, travellerName, type DeskActor } from "./core";
import { deskInbox, type InboxFilter, type InboxItem, type SourceKind } from "./inbox";
import { CHAT_NEXT_REPLY_MINUTES, escalationLevel, MANUAL_SLA_MINUTES, TICKET_PRIORITIES, type TicketPriority } from "./sla";
import { applyMove, CLOSE_AFTER_HOURS, OPEN_STATUSES, PAUSED_STATUSES, parseTicketRef, startClock, ticketRef, type TicketMove, type TicketStatus } from "./ticket-state";
import { openThread } from "../support/threads";

/*
 * Desk tickets (DESK-PLAN.md §4.4): one per open thing on the desk. syncTickets() keeps them in step with the live
 * sources the queue reads (inbox.ts): a new source opens a ticket, a source that no longer needs the desk resolves
 * it (or leaves it waiting on the traveller), and a resolved ticket whose source comes back reopens. People open
 * tickets by hand from anything, and work them here: assign, reply, notes, priority, wait, resolve, reopen, merge.
 * Every change is a desk_ticket_events row and lands in both audit trails.
 */

export type Ticket = typeof deskTickets.$inferSelect;
export type TicketEvent = typeof deskTicketEvents.$inferSelect;
export type LinkKind = SourceKind | "ask_thread" | "customer" | "ticket";
export const LINK_KINDS: readonly LinkKind[] = ["order", "request", "chat", "refund", "esim", "disruption", "moderation", "recovery", "ask_thread", "customer", "ticket"];

const DAY = 86_400_000;
const REQUEST_DONE = ["confirmed", "done", "cancelled", "declined", "expired", "closed"];
const REQUEST_WAITING = ["needs_answer", "quoted", "awaiting_payment"];
const ORDER_WAITING = ["needs_answer", "fare_changed", "payment_requested"];

export { ticketRef, parseTicketRef };
export const ticketHref = (t: { number: number }) => `/adminwork/desk/tickets/${ticketRef(t.number)}`;

type Ev = { kind: string; from?: string | null; to?: string | null; body?: string | null; data?: Record<string, unknown> | null };
const event = (tx: Tx | typeof db, ticketId: string, actorId: string | null, e: Ev) =>
  tx.insert(deskTicketEvents).values({ ticketId, actorId, kind: e.kind, from: e.from ?? null, to: e.to ?? null, body: e.body ?? null, data: e.data ?? null });

const audit = (tx: Tx, actor: DeskActor, t: Ticket, action: string, summary: string, data?: Record<string, unknown>) =>
  deskAudit(tx, actor, { action: `desk.ticket.${action}`, entityType: "ticket", entityId: t.id, ref: ticketRef(t.number), summary: `${ticketRef(t.number)}: ${summary}`, data: data ?? null });

/* ═════════════ keeping tickets in step with the queue ═════════════ */

/** The clock an item's own promise sets: a chat's next reply after the first is due within 30 minutes, not 10. */
function itemClock(i: InboxItem, t: Ticket | null) {
  const target = i.kind === "chat" && !i.urgent && t?.firstResponseAt ? CHAT_NEXT_REPLY_MINUTES : i.sla.target;
  const due = target === i.sla.target ? i.sla.dueAt : new Date(i.sla.openedAt.getTime() + target * 60_000);
  return { slaStartedAt: i.sla.openedAt, slaMinutes: target, dueAt: due };
}

const fields = (i: InboxItem) => ({
  kind: i.kind, subject: i.title.slice(0, 200), detail: i.sub.slice(0, 300), need: i.note, href: i.href, amount: i.amount,
  meta: { tag: i.tag ?? null, reach: i.reach ?? null, link: i.link ?? null, urgent: !!i.urgent },
});
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

/** When a source left the queue, what that means for its ticket: the traveller has the next move, or it's finished. */
async function goneMoves(tickets: Ticket[]): Promise<Map<string, TicketMove>> {
  const out = new Map<string, TicketMove>();
  const reqIds = tickets.filter((t) => t.sourceKind === "order" || t.sourceKind === "request").map((t) => t.sourceId!);
  const [reqs, orders] = reqIds.length ? await Promise.all([
    db.select({ id: appRequests.id, status: appRequests.status }).from(appRequests).where(inArray(appRequests.id, reqIds)),
    db.select({ requestId: appOrders.requestId, status: appOrders.status }).from(appOrders).where(inArray(appOrders.requestId, reqIds)).orderBy(desc(appOrders.createdAt)),
  ]) : [[], []];
  for (const t of tickets) {
    if (t.sourceKind === "chat") { out.set(t.id, "reply"); continue; } // someone answered the traveller
    if (t.sourceKind === "order" || t.sourceKind === "request") {
      const r = reqs.find((x) => x.id === t.sourceId);
      const o = orders.find((x) => x.requestId === t.sourceId);
      const waiting = !!r && !REQUEST_DONE.includes(r.status) && (REQUEST_WAITING.includes(r.status) || (!!o && ORDER_WAITING.includes(o.status)));
      out.set(t.id, waiting ? "wait_customer" : "resolve");
      continue;
    }
    out.set(t.id, "resolve");
  }
  return out;
}

export type SyncResult = { created: number; updated: number; reopened: number; waiting: number; resolved: number; closed: number };

/**
 * Upserts a ticket for every item the queue shows, and moves the tickets whose source no longer needs the desk.
 * Safe to run from many requests at once: one runs, the others skip (an advisory lock), and the unique index on an
 * open ticket's source makes a second ticket for the same thing impossible. This is also the backfill: the first run
 * after the migration makes the tickets for everything already open, carrying over app_desk_items' decisions.
 */
export async function syncTickets(now = new Date()): Promise<SyncResult | null> {
  const { items } = await deskInbox(now);
  return db.transaction(async (tx) => {
    const lock = await tx.execute(sql`SELECT pg_try_advisory_xact_lock(hashtext('desk_tickets_sync')) AS ok`);
    if (!(lock as unknown as { ok: boolean }[])[0]?.ok) return null;
    const res: SyncResult = { created: 0, updated: 0, reopened: 0, waiting: 0, resolved: 0, closed: 0 };
    const live = await tx.select().from(deskTickets).where(ne(deskTickets.status, "closed"));
    const links = live.length ? await tx.select({ ticketId: deskTicketLinks.ticketId, kind: deskTicketLinks.entityKind, id: deskTicketLinks.entityId }).from(deskTicketLinks)
      .where(inArray(deskTicketLinks.ticketId, live.map((t) => t.id))) : [];
    // A source's ticket: its own, or the ticket it was merged into (which carries its link).
    const bySource = new Map<string, Ticket>();
    for (const l of links) { const t = live.find((x) => x.id === l.ticketId); if (t) bySource.set(`${l.kind}:${l.id}`, t); }
    for (const t of live) if (t.sourceId) bySource.set(`${t.sourceKind}:${t.sourceId}`, t);
    const legacy = items.length ? await tx.select().from(appDeskItems).where(inArray(appDeskItems.itemId, items.map((i) => i.source.id))) : [];

    const touched = new Set<string>();
    for (const i of items) {
      const key = `${i.source.kind}:${i.source.id}`;
      const t = bySource.get(key);
      if (!t) {
        const prev = legacy.find((x) => x.itemId === i.source.id);
        const [row] = await tx.insert(deskTickets).values({
          ...fields(i), sourceKind: i.source.kind, sourceId: i.source.id, customerId: i.userId, priority: i.urgent ? "urgent" : prev?.escalatedAt ? "high" : "normal",
          ownerAgentId: i.route.agentId, ownerReason: i.route.reason, status: i.route.reason === "manual" ? "open" : "new",
          openedAt: i.sla.openedAt, ...itemClock(i, null), escalatedAt: prev?.escalatedAt ?? null, escalationNote: prev?.escalationNote ?? null, lastActivityAt: i.sla.openedAt,
        }).onConflictDoNothing().returning();
        if (!row) continue;
        await tx.insert(deskTicketLinks).values([{ ticketId: row.id, entityKind: i.source.kind, entityId: i.source.id }, ...(i.userId ? [{ ticketId: row.id, entityKind: "customer", entityId: i.userId }] : [])]).onConflictDoNothing();
        await event(tx, row.id, null, { kind: "created", to: row.status, body: i.note });
        bySource.set(key, row); touched.add(row.id); res.created += 1;
        continue;
      }
      touched.add(t.id);
      const own = t.sourceKind === i.source.kind && t.sourceId === i.source.id;
      const set: Partial<typeof deskTickets.$inferInsert> = {};
      if (own) {
        const f = fields(i);
        for (const k of Object.keys(f) as (keyof typeof f)[]) if (!same(t[k], f[k])) Object.assign(set, { [k]: f[k] });
        if (!t.customerId && i.userId) set.customerId = i.userId;
      }
      if (t.ownerReason !== "manual" && (t.ownerAgentId !== i.route.agentId || t.ownerReason !== i.route.reason)) Object.assign(set, { ownerAgentId: i.route.agentId, ownerReason: i.route.reason });
      let status = t.status as TicketStatus;
      if (status !== "new" && status !== "open") {
        const patch = applyMove({ ...t, status }, "source_live", now);
        await event(tx, t.id, null, { kind: status === "resolved" ? "reopened" : "status", from: status, to: patch.status!, body: i.note });
        if (status === "resolved") res.reopened += 1;
        Object.assign(set, patch); status = patch.status!;
      }
      if (own) {
        // The source's promise is the ticket's clock. A new clock (the traveller wrote again) starts unescalated.
        const c = itemClock(i, t);
        if (Math.abs(c.dueAt.getTime() - (set.dueAt ?? t.dueAt).getTime()) > 1000 || c.slaMinutes !== t.slaMinutes) {
          Object.assign(set, c, { pausedAt: null });
          if (c.slaStartedAt.getTime() !== t.slaStartedAt.getTime() && !t.escalationNote) Object.assign(set, { escalationLevel: 0, escalatedAt: null });
        }
      }
      if (Object.keys(set).length) {
        await tx.update(deskTickets).set({ ...set, updatedAt: now, ...(set.status ? { lastActivityAt: now } : {}) }).where(eq(deskTickets.id, t.id));
        res.updated += 1;
      }
    }

    // Sources that left the queue.
    const gone = live.filter((t) => t.sourceId && !touched.has(t.id) && OPEN_STATUSES.includes(t.status as TicketStatus));
    const moves = await goneMoves(gone);
    for (const t of gone) {
      let move = moves.get(t.id)!;
      // Nothing heard for a week while waiting on the traveller: done.
      if (t.status === "waiting_customer" && t.pausedAt && now.getTime() - t.pausedAt.getTime() > 7 * DAY) move = "resolve";
      const st = t.status as TicketStatus;
      if ((move === "reply" || move === "wait_customer") && (st === "waiting_customer" || st === "waiting_supplier")) continue;
      const patch = applyMove({ ...t, status: st }, move, now);
      await tx.update(deskTickets).set({ ...patch, updatedAt: now, lastActivityAt: now }).where(eq(deskTickets.id, t.id));
      await event(tx, t.id, null, { kind: "status", from: st, to: patch.status!, body: move === "resolve" ? "Finished where it was worked" : move === "reply" ? "Answered in the chat" : "Waiting on the traveller" });
      if (patch.status === "resolved") res.resolved += 1; else res.waiting += 1;
    }

    // Resolved and quiet for 72 hours: closed for good.
    const closing = live.filter((t) => t.status === "resolved" && !touched.has(t.id) && t.resolvedAt && now.getTime() - t.resolvedAt.getTime() > CLOSE_AFTER_HOURS * 3_600_000);
    for (const t of closing) {
      await tx.update(deskTickets).set({ ...applyMove({ ...t, status: "resolved" }, "close", now), updatedAt: now }).where(eq(deskTickets.id, t.id));
      await event(tx, t.id, null, { kind: "status", from: "resolved", to: "closed", body: "Quiet for 72 hours" });
      res.closed += 1;
    }
    return res;
  });
}

/**
 * The SLA clock's escalations: a running ticket past its promise goes to level 1 (the lead is told), and at twice
 * its target to level 2 (the partners are told). Each level is written once, with its event. Cheap: one UPDATE.
 */
export async function sweepEscalations(now = new Date()) {
  const at = sql`${now.toISOString()}::timestamptz`;
  const level = sql`CASE WHEN ${at} - ${deskTickets.dueAt} >= greatest(interval '1 minute', ${deskTickets.dueAt} - ${deskTickets.slaStartedAt}) THEN 2 ELSE 1 END`;
  const rows = await db.update(deskTickets).set({ escalationLevel: level, escalatedAt: sql`coalesce(${deskTickets.escalatedAt}, ${at})`, updatedAt: now })
    .where(and(inArray(deskTickets.status, ["new", "open"]), sql`${deskTickets.pausedAt} IS NULL`, sql`${deskTickets.dueAt} < ${at}`, sql`${deskTickets.escalationLevel} < ${level}`))
    .returning({ id: deskTickets.id, level: deskTickets.escalationLevel });
  if (rows.length) await db.insert(deskTicketEvents).values(rows.map((r) => ({
    ticketId: r.id, actorId: null, kind: "escalated", to: `level ${r.level}`, at: now,
    body: r.level >= 2 ? "Twice past its promise: the partners are told" : "Past its promise: the lead is told",
  })));
  return rows;
}

/** The scheduled run (lib/app/jobs.ts "desk"): the sync, then the escalation sweep. */
export async function deskTicketsJob(now = new Date()): Promise<Record<string, number>> {
  const synced = await syncTickets(now);
  const escalated = await sweepEscalations(now);
  return { ...(synced ?? { skipped: 1 }), escalated: escalated.length };
}

/* ═════════════ reading ═════════════ */

const customer = sql<string | null>`(SELECT ${appUsers.name} FROM ${appUsers} WHERE ${appUsers.id} = ${deskTickets.customerId})`;
const ownerName = sql<string | null>`(SELECT ${appAgents.displayName} FROM ${appAgents} WHERE ${appAgents.id} = ${deskTickets.ownerAgentId})`;
const late = (now: Date) => sql`(${deskTickets.pausedAt} IS NULL AND ${deskTickets.dueAt} < ${now.toISOString()}::timestamptz)`;

function search(q: string): SQL | undefined {
  const s = q.trim();
  if (!s) return undefined;
  const n = parseTicketRef(s);
  if (n) return eq(deskTickets.number, n);
  const like = `%${s.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
  return or(ilike(deskTickets.subject, like), ilike(deskTickets.detail, like), ilike(deskTickets.need, like), sql`${customer} ILIKE ${like}`, ilike(deskTickets.category, like));
}

export type QueueRow = Ticket & { customerName: string | null; ownerName: string | null };

/**
 * My queue: the open tickets (new or open; a ticket waiting on someone else has its clock stopped), filtered and
 * paged in SQL, most urgent first: urgent help, then late, then due soon (the last quarter of the window), escalated
 * ahead within each band, then by due time.
 */
export async function deskQueue(o: { filter: InboxFilter; kind?: string; q?: string; me: Agent | null; limit?: number; offset?: number; now?: Date; sync?: boolean }) {
  const now = o.now ?? new Date();
  if (o.sync !== false) {
    await syncTickets(now).catch((e) => console.error("[desk] ticket sync failed", e instanceof Error ? e.message : e));
    await sweepEscalations(now).catch(() => []);
  }
  const at = sql`${now.toISOString()}::timestamptz`;
  const running = inArray(deskTickets.status, ["new", "open"]);
  const mine = o.me ? eq(deskTickets.ownerAgentId, o.me.id) : sql`false`;
  const unassigned = sql`${deskTickets.ownerAgentId} IS NULL`;
  const escalated = or(isNotNull(deskTickets.escalatedAt), late(now))!;
  const byFilter = o.filter === "mine" ? mine : o.filter === "unassigned" ? unassigned : o.filter === "escalated" ? escalated : undefined;
  const where = and(running, byFilter, o.kind ? eq(deskTickets.kind, o.kind) : undefined, search(o.q ?? ""));
  const band = sql`CASE WHEN ${deskTickets.dueAt} < ${at} THEN 0 WHEN ${deskTickets.dueAt} - ${at} <= greatest(interval '1 minute', (${deskTickets.dueAt} - ${deskTickets.slaStartedAt}) / 4) THEN 1 ELSE 2 END`;
  const [rows, [tot], counts, kinds] = await Promise.all([
    db.select({ t: deskTickets, customerName: customer, ownerName }).from(deskTickets).where(where)
      .orderBy(sql`coalesce((${deskTickets.meta}->>'urgent')::boolean, false) DESC`, band, sql`${deskTickets.escalatedAt} IS NULL`, asc(deskTickets.dueAt))
      .limit(o.limit ?? 50).offset(o.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(deskTickets).where(where),
    db.select({
      all: sql<number>`count(*)::int`, mine: sql<number>`count(*) FILTER (WHERE ${mine})::int`, unassigned: sql<number>`count(*) FILTER (WHERE ${unassigned})::int`,
      escalated: sql<number>`count(*) FILTER (WHERE ${escalated})::int`, breached: sql<number>`count(*) FILTER (WHERE ${late(now)})::int`,
      soon: sql<number>`count(*) FILTER (WHERE ${band} = 1)::int`,
    }).from(deskTickets).where(running),
    db.select({ kind: deskTickets.kind, n: sql<number>`count(*)::int` }).from(deskTickets).where(running).groupBy(deskTickets.kind),
  ]);
  return {
    rows: rows.map((r) => ({ ...r.t, customerName: r.customerName ? travellerName(r.customerName) : null, ownerName: r.ownerName })) as QueueRow[],
    total: tot?.n ?? 0, counts: { ...counts[0]!, by: Object.fromEntries(kinds.map((k) => [k.kind, k.n])) as Record<string, number> },
  };
}

export const TICKET_TABS: Record<string, readonly TicketStatus[] | null> = {
  open: ["new", "open"], waiting: ["waiting_customer", "waiting_supplier"], resolved: ["resolved"], closed: ["closed"], all: null,
};

/** How long a ticket has been open, in the bands the desk overview counts the backlog by (Tickets ?age=). */
export const TICKET_AGES = ["1h", "4h", "24h", "older"] as const;
export type TicketAge = (typeof TICKET_AGES)[number];
/** The band of a ticket's age as SQL, against the database's clock: the overview and the list read the same one. */
export const ageBand = sql<TicketAge>`CASE WHEN now() - ${deskTickets.openedAt} < interval '1 hour' THEN '1h' WHEN now() - ${deskTickets.openedAt} < interval '4 hours' THEN '4h'
  WHEN now() - ${deskTickets.openedAt} < interval '24 hours' THEN '24h' ELSE 'older' END`;

/** The Tickets list: every ticket, by status tab, with search and filters, 50 to a page. */
export async function listTickets(o: { tab?: string; q?: string; priority?: string; owner?: "me" | "none" | string; customerId?: string; age?: string; me?: Agent | null; limit?: number; offset?: number } = {}) {
  const tab = o.tab && o.tab in TICKET_TABS ? o.tab : "open";
  const st = TICKET_TABS[tab];
  const owner = o.owner === "me" ? (o.me ? eq(deskTickets.ownerAgentId, o.me.id) : sql`false`) : o.owner === "none" ? sql`${deskTickets.ownerAgentId} IS NULL` : o.owner ? eq(deskTickets.ownerAgentId, o.owner) : undefined;
  const base = and((TICKET_PRIORITIES as readonly string[]).includes(o.priority ?? "") ? eq(deskTickets.priority, o.priority!) : undefined, owner,
    o.customerId ? eq(deskTickets.customerId, o.customerId) : undefined, (TICKET_AGES as readonly string[]).includes(o.age ?? "") ? sql`${ageBand} = ${o.age}` : undefined, search(o.q ?? ""));
  const where = and(st ? inArray(deskTickets.status, [...st]) : undefined, base);
  const [rows, [tot], byStatus] = await Promise.all([
    db.select({ t: deskTickets, customerName: customer, ownerName }).from(deskTickets).where(where)
      .orderBy(tab === "open" ? asc(deskTickets.dueAt) : desc(deskTickets.lastActivityAt)).limit(o.limit ?? 50).offset(o.offset ?? 0),
    db.select({ n: sql<number>`count(*)::int` }).from(deskTickets).where(where),
    db.select({ status: deskTickets.status, n: sql<number>`count(*)::int` }).from(deskTickets).where(base).groupBy(deskTickets.status),
  ]);
  const n = (s: readonly string[] | null) => byStatus.filter((b) => !s || s.includes(b.status)).reduce((a, b) => a + b.n, 0);
  return {
    tab, total: tot?.n ?? 0, counts: Object.fromEntries(Object.entries(TICKET_TABS).map(([k, s]) => [k, n(s)])) as Record<string, number>,
    rows: rows.map((r) => ({ ...r.t, customerName: r.customerName ? travellerName(r.customerName) : null, ownerName: r.ownerName })) as QueueRow[],
  };
}

/** Where each linked thing lives on the desk. */
export function linkHref(kind: string, id: string): string | null {
  const D = "/adminwork/desk";
  switch (kind) {
    case "order": return `${D}/orders/${id}`;
    case "request": return `${D}/requests/${id}`;
    case "chat": return `${D}/chats?t=${id}`;
    case "refund": return `${D}/refunds?focus=${id}`;
    case "esim": return `${D}/esims/${id}`;
    case "disruption": return `${D}/disruptions?focus=${id}`;
    case "moderation": return `${D}/moderation?focus=${id}`;
    case "recovery": return `${D}/recovery?focus=${id}`;
    case "customer": return `${D}/customers/${id}`;
    case "ask_thread": return `${D}/ask/${id}`;
    default: return null;
  }
}

/**
 * The thread a ticket's replies go to: its chat, its order's or request's thread, or the first chat, order or request
 * linked to it (a ticket opened from one). Null when only the customer's support chat could take them.
 */
function threadOf(t: Ticket, links: { entityKind: string; entityId: string }[] = []): { kind: "request" | "support"; id: string } | null {
  const own = t.sourceId ? [{ entityKind: t.sourceKind!, entityId: t.sourceId }] : [];
  for (const l of [...own, ...links]) {
    if (l.entityKind === "chat") {
      const [k, id] = l.entityId.split(":");
      if ((k === "support" || k === "request") && id) return { kind: k, id };
    }
    if (l.entityKind === "order" || l.entityKind === "request") return { kind: "request", id: l.entityId };
  }
  return null;
}

const linksOf = (id: string) => db.select({ entityKind: deskTicketLinks.entityKind, entityId: deskTicketLinks.entityId }).from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, id)).orderBy(asc(deskTicketLinks.createdAt));

async function findTicket(refOrId: string, tx: Tx | typeof db = db, lock = false) {
  const n = parseTicketRef(refOrId);
  const where = n ? eq(deskTickets.number, n) : /^[0-9a-f-]{36}$/i.test(refOrId) ? eq(deskTickets.id, refOrId) : null;
  if (!where) return null;
  const q = tx.select().from(deskTickets).where(where);
  const [t] = lock ? await q.for("update") : await q;
  return t ?? null;
}

/** Everything the ticket page shows. */
export async function getTicket(refOrId: string) {
  const t = await findTicket(refOrId);
  if (!t) return null;
  const merged = await db.select({ id: deskTickets.id, number: deskTickets.number, subject: deskTickets.subject }).from(deskTickets).where(eq(deskTickets.mergedIntoId, t.id));
  const ids = [t.id, ...merged.map((m) => m.id)];
  let thread = threadOf(t, await linksOf(t.id));
  if (!thread && t.customerId) {
    const [st] = await db.select({ id: appSupportThreads.id }).from(appSupportThreads).where(and(eq(appSupportThreads.userId, t.customerId), sql`${appSupportThreads.tripId} IS NULL`));
    if (st) thread = { kind: "support", id: st.id };
  }
  const [events, links, notes, user, owner, into, conv] = await Promise.all([
    db.select({ e: deskTicketEvents, name: schema.users.name }).from(deskTicketEvents).leftJoin(schema.users, eq(schema.users.id, deskTicketEvents.actorId))
      .where(inArray(deskTicketEvents.ticketId, ids)).orderBy(desc(deskTicketEvents.at)).limit(100),
    db.select().from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, t.id)).orderBy(asc(deskTicketLinks.createdAt)),
    db.select({ n: appDeskNotes, name: schema.users.name }).from(appDeskNotes).innerJoin(schema.users, eq(schema.users.id, appDeskNotes.opsUserId))
      .where(inArray(appDeskNotes.ticketId, ids)).orderBy(asc(appDeskNotes.createdAt)),
    t.customerId ? db.select().from(appUsers).where(eq(appUsers.id, t.customerId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    t.ownerAgentId ? db.select().from(appAgents).where(eq(appAgents.id, t.ownerAgentId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    t.mergedIntoId ? db.select({ number: deskTickets.number }).from(deskTickets).where(eq(deskTickets.id, t.mergedIntoId)).then((r) => r[0] ?? null) : Promise.resolve(null),
    thread ? getThread(thread.kind, thread.id) : Promise.resolve(null),
  ]);
  const threadNotes = conv?.notes ?? [];
  const allNotes = [...threadNotes, ...notes.filter((n) => !threadNotes.some((x) => x.n.id === n.n.id))];
  return { ticket: t, ref: ticketRef(t.number), events, links, notes: allNotes, messages: conv?.messages ?? [], thread, user, owner, merged, mergedInto: into ? ticketRef(into.number) : null };
}
export type TicketFull = NonNullable<Awaited<ReturnType<typeof getTicket>>>;

/** Open tickets about one thing (an order, a chat, a customer…): the "Tickets" card on that thing's page. */
export async function ticketsFor(kind: LinkKind, id: string) {
  const rows = await db.select({ t: deskTickets }).from(deskTicketLinks).innerJoin(deskTickets, eq(deskTickets.id, deskTicketLinks.ticketId))
    .where(and(eq(deskTicketLinks.entityKind, kind), eq(deskTicketLinks.entityId, id), ne(deskTickets.status, "closed")))
    .orderBy(desc(deskTickets.lastActivityAt)).limit(10);
  return rows.map((r) => r.t);
}

/* ═════════════ working a ticket ═════════════ */

const isManager = (a: DeskActor) => has(a, "desk.tickets.manage");

async function withTicket<T>(actor: DeskActor, id: string, fn: (tx: Tx, t: Ticket) => Promise<T>) {
  assertCap(actor, "desk.act");
  return db.transaction(async (tx) => {
    const t = await findTicket(id, tx, true);
    if (!t) throw new DeskError("Ticket not found", "NOT_FOUND");
    return fn(tx, t);
  });
}

async function move(tx: Tx, actor: DeskActor, t: Ticket, m: TicketMove, now: Date, body?: string | null) {
  let patch;
  try { patch = applyMove({ ...t, status: t.status as TicketStatus }, m, now); } catch { throw new DeskError("That can't be done to this ticket now", "CONFLICT"); }
  const [row] = await tx.update(deskTickets).set({ ...patch, updatedAt: now, lastActivityAt: now }).where(eq(deskTickets.id, t.id)).returning();
  if (patch.status !== t.status) await event(tx, t.id, actor.id, { kind: m === "reopen" || (t.status === "resolved" && patch.status === "open") ? "reopened" : "status", from: t.status, to: patch.status!, body: body ?? null });
  return row!;
}

/** A source ticket can't be resolved while its source still needs the desk: the sync would only reopen it. */
async function sourceStillLive(t: Ticket) {
  if (!t.sourceId) return false;
  const { items } = await deskInbox();
  return items.some((i) => i.source.kind === t.sourceKind && i.source.id === t.sourceId);
}

export type NewTicket = { subject: string; note?: string | null; priority?: string; category?: string | null; customerId?: string | null; about?: { kind: LinkKind; id: string } | null };

/** The customer behind something a ticket can be opened from. */
async function customerOf(kind: LinkKind, id: string): Promise<string | null> {
  if (kind === "customer") return id;
  if (kind === "order" || kind === "request") return (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, id)))[0]?.o ?? null;
  if (kind === "chat") {
    const [k, tid] = id.split(":");
    if ((k === "support" || k === "request") && tid) return (await getThread(k, tid)).user?.id ?? null;
  }
  return null;
}

/** The traveller a blank ticket is for, by phone (any format, matched on its digits) or email. */
export async function findCustomer(text: string): Promise<string | null> {
  const s = text.trim();
  if (!s) return null;
  if (s.includes("@")) return (await db.select({ id: appUsers.id }).from(appUsers).where(sql`lower(${appUsers.email}) = ${s.toLowerCase()}`).limit(1))[0]?.id ?? null;
  const digits = s.replace(/\D/g, "").replace(/^0+/, "");
  if (digits.length < 7) return null;
  return (await db.select({ id: appUsers.id }).from(appUsers).where(sql`regexp_replace(${appUsers.phone}, '[^0-9]', '', 'g') LIKE ${`%${digits}`}`).limit(1))[0]?.id ?? null;
}

/** A ticket opened by hand, blank or from something (an order, a chat, a customer…). It's due by its priority. */
export async function createTicket(actor: DeskActor, v: NewTicket, now = new Date()) {
  assertCap(actor, "desk.act");
  const subject = v.subject.trim();
  if (subject.length < 3) throw new DeskError("Say what the ticket is about");
  if (subject.length > 200) throw new DeskError("Keep the subject under 200 characters");
  const priority = ((TICKET_PRIORITIES as readonly string[]).includes(v.priority ?? "") ? v.priority : "normal") as TicketPriority;
  if (v.about && !LINK_KINDS.includes(v.about.kind)) throw new DeskError("Unknown item", "NOT_FOUND");
  const customerId = v.customerId ?? (v.about ? await customerOf(v.about.kind, v.about.id) : null);
  const me = await agentForOps(actor.id);
  return db.transaction(async (tx) => {
    const [t] = await tx.insert(deskTickets).values({
      kind: "manual", subject, customerId, priority, category: v.category?.trim() || null, href: v.about ? linkHref(v.about.kind, v.about.id) : null,
      need: "Ticket", status: me ? "open" : "new", ownerAgentId: me?.id ?? null, ownerReason: me ? "manual" : "queue", openedAt: now, createdBy: actor.id, lastActivityAt: now,
      ...startClock(now, MANUAL_SLA_MINUTES[priority]),
    }).returning();
    const links = [...(v.about ? [{ entityKind: v.about.kind, entityId: v.about.id }] : []), ...(customerId && v.about?.kind !== "customer" ? [{ entityKind: "customer", entityId: customerId }] : [])];
    if (links.length) await tx.insert(deskTicketLinks).values(links.map((l) => ({ ...l, ticketId: t!.id, createdBy: actor.id }))).onConflictDoNothing();
    await event(tx, t!.id, actor.id, { kind: "created", to: t!.status, body: v.about ? `Opened from this ${v.about.kind.replace("_", " ")}` : null, data: v.about ? { about: v.about } : null });
    const note = v.note?.trim();
    if (note) {
      await tx.insert(appDeskNotes).values({ threadKind: "ticket", threadId: t!.id, ticketId: t!.id, opsUserId: actor.id, body: note.slice(0, 2000) });
      await event(tx, t!.id, actor.id, { kind: "note", body: note.slice(0, 200) });
    }
    await audit(tx, actor, t!, "created", `Opened "${subject}"`, { priority, about: v.about ?? null });
    return t!;
  });
}

/**
 * Give a ticket to someone, or back to the rota (null). Anyone on the desk can take an unowned or rota-routed ticket,
 * or hand on their own; moving someone else's needs desk.tickets.manage.
 */
export async function assignTicket(actor: DeskActor, id: string, agentId: string | null, now = new Date()) {
  const me = await agentForOps(actor.id);
  return withTicket(actor, id, async (tx, t) => {
    const theirs = t.ownerReason === "manual" && t.ownerAgentId && t.ownerAgentId !== me?.id;
    if (theirs && !isManager(actor)) throw new DeskError("Only a lead can move someone else's ticket", "FORBIDDEN");
    if (t.status === "closed") throw new DeskError("This ticket is closed", "CONFLICT");
    const to = agentId ? (await tx.select().from(appAgents).where(eq(appAgents.id, agentId)))[0] : null;
    if (agentId && (!to || !to.active)) throw new DeskError("Choose someone on the desk");
    const from = t.ownerAgentId ? (await tx.select({ n: appAgents.displayName }).from(appAgents).where(eq(appAgents.id, t.ownerAgentId)))[0]?.n ?? null : null;
    let row = t;
    if (agentId && t.status === "new") row = await move(tx, actor, t, "assign", now);
    await tx.update(deskTickets).set({ ownerAgentId: agentId, ownerReason: agentId ? "manual" : "queue", updatedAt: now, lastActivityAt: now }).where(eq(deskTickets.id, t.id));
    // Keep the item's own record in step, for the pages that read it (the queue's routing, the order's "Who has it").
    if (t.sourceId) {
      const values = { assignedAgentId: agentId, assignedBy: actor.id, assignedAt: now, updatedAt: now };
      await tx.insert(appDeskItems).values({ itemKind: t.kind, itemId: t.sourceId, ...values }).onConflictDoUpdate({ target: [appDeskItems.itemKind, appDeskItems.itemId], set: values });
    }
    await event(tx, t.id, actor.id, { kind: "assigned", from, to: to?.displayName ?? null, body: to ? null : "Back on the rota" });
    await audit(tx, actor, t, "assigned", to ? `Gave it to ${to.displayName}` : "Put it back on the rota", { agent: { from, to: to?.displayName ?? null } });
    return { ...row, ownerAgentId: agentId };
  });
}

/** "Take it": the signed-in agent becomes the owner. */
export async function takeTicket(actor: DeskActor, id: string) {
  const me = await agentForOps(actor.id);
  if (!me || !me.active) throw new DeskError("Set up your desk profile first (Team & rota)");
  return assignTicket(actor, id, me.id);
}

export async function setPriority(actor: DeskActor, id: string, priority: string, now = new Date()) {
  if (!(TICKET_PRIORITIES as readonly string[]).includes(priority)) throw new DeskError("Choose a priority");
  return withTicket(actor, id, async (tx, t) => {
    if (t.priority === priority) return t;
    const set: Partial<Ticket> = { priority, updatedAt: now, lastActivityAt: now };
    // A ticket opened by hand is due by its priority: the new target counts from when its clock started.
    if (!t.sourceId && OPEN_STATUSES.includes(t.status as TicketStatus)) {
      const mins = MANUAL_SLA_MINUTES[priority as TicketPriority];
      Object.assign(set, { slaMinutes: mins, dueAt: new Date(t.dueAt.getTime() + (mins - t.slaMinutes) * 60_000) });
    }
    const [row] = await tx.update(deskTickets).set(set).where(eq(deskTickets.id, t.id)).returning();
    await event(tx, t.id, actor.id, { kind: "priority", from: t.priority, to: priority });
    await audit(tx, actor, t, "priority", `Priority ${t.priority} → ${priority}`);
    return row!;
  });
}

export async function setDetails(actor: DeskActor, id: string, v: { category?: string | null; tags?: string[]; subject?: string }, now = new Date()) {
  return withTicket(actor, id, async (tx, t) => {
    const set: Partial<Ticket> = { updatedAt: now };
    if (v.category !== undefined) set.category = v.category?.trim().slice(0, 60) || null;
    if (v.tags) set.tags = [...new Set(v.tags.map((x) => x.trim().toLowerCase()).filter(Boolean))].slice(0, 10).map((x) => x.slice(0, 30));
    if (v.subject !== undefined && !t.sourceId) {
      const s = v.subject.trim();
      if (s.length < 3 || s.length > 200) throw new DeskError("Say what the ticket is about");
      set.subject = s;
    }
    await tx.update(deskTickets).set(set).where(eq(deskTickets.id, t.id));
    if (set.category !== undefined && set.category !== t.category) await event(tx, t.id, actor.id, { kind: "category", from: t.category, to: set.category });
    if (set.tags && !same(set.tags, t.tags)) await event(tx, t.id, actor.id, { kind: "tags", from: t.tags.join(", ") || null, to: set.tags.join(", ") || null });
    await audit(tx, actor, t, "edited", "Edited the ticket's details");
  });
}

/** The status moves an agent makes by hand: wait on the customer or a supplier, resume, resolve, reopen, close. */
export const MANUAL_MOVES = ["wait_customer", "wait_supplier", "supplier_answered", "customer_replied", "resolve", "reopen", "close"] as const;
export type ManualMove = (typeof MANUAL_MOVES)[number];

export async function moveTicket(actor: DeskActor, id: string, m: ManualMove, note?: string | null, now = new Date()) {
  if (!MANUAL_MOVES.includes(m)) throw new DeskError("That can't be done to this ticket now", "CONFLICT");
  const t0 = await findTicket(id);
  if (!t0) throw new DeskError("Ticket not found", "NOT_FOUND");
  if ((m === "resolve" || m === "close") && (await sourceStillLive(t0))) {
    throw new DeskError(t0.sourceKind === "chat" ? "The traveller is still waiting: reply first, then resolve" : "This still needs the desk: finish it on its own page and the ticket resolves itself", "CONFLICT");
  }
  return withTicket(actor, id, async (tx, t) => {
    const text = note?.trim().slice(0, 500) || null;
    const row = await move(tx, actor, t, m, now, text);
    const what: Record<ManualMove, string> = { wait_customer: "Waiting on the customer", wait_supplier: "Waiting on a supplier", supplier_answered: "The supplier answered", customer_replied: "Back with us", resolve: "Resolved", reopen: "Reopened", close: "Closed" };
    await audit(tx, actor, t, m, `${what[m]}${text ? `: ${text}` : ""}`);
    return row;
  });
}

/** A note on the ticket for the team. Never shown to the traveller. */
export async function addTicketNote(actor: DeskActor, id: string, body: string, now = new Date()) {
  const text = body.trim();
  if (!text) throw new DeskError("Write the note first");
  if (text.length > 2000) throw new DeskError("Keep notes under 2,000 characters");
  return withTicket(actor, id, async (tx, t) => {
    await tx.insert(appDeskNotes).values({ threadKind: "ticket", threadId: t.id, ticketId: t.id, opsUserId: actor.id, body: text });
    await tx.update(deskTickets).set({ lastActivityAt: now, updatedAt: now }).where(eq(deskTickets.id, t.id));
    await event(tx, t.id, actor.id, { kind: "note", body: text.slice(0, 200) });
    await audit(tx, actor, t, "note", `Added an internal note: "${text.length > 100 ? `${text.slice(0, 99)}…` : text}"`);
  });
}

/**
 * A reply to the traveller from the ticket, in their thread (the chat, the order's or request's thread, or their
 * support chat, opened if they have none). The first reply sets first_response_at; the ticket then waits on them.
 */
export async function replyOnTicket(actor: DeskActor, id: string, v: { body: string; attachment?: { id: string; filename: string; mime: string; size: number } | null }, now = new Date()) {
  assertCap(actor, "desk.act");
  const t = await findTicket(id);
  if (!t) throw new DeskError("Ticket not found", "NOT_FOUND");
  if (t.status === "closed") throw new DeskError("This ticket is closed", "CONFLICT");
  let thread = threadOf(t, await linksOf(t.id));
  if (!thread) {
    if (!t.customerId) throw new DeskError("This ticket has no traveller to write to: add a note instead");
    const st = await openThread(t.customerId, { about: t.subject });
    thread = { kind: "support", id: st.id };
    await db.insert(deskTicketLinks).values({ ticketId: t.id, entityKind: "chat", entityId: `support:${st.id}`, createdBy: actor.id }).onConflictDoNothing();
  }
  const m = await sendAgentReply(actor, thread.kind, thread.id, v);
  await repliedOn(actor, [t], now);
  return m;
}

/** An agent replied to the traveller: stamp the first response, and a chat's ticket now waits on the traveller. */
async function repliedOn(actor: DeskActor, tickets: Ticket[], now: Date) {
  for (const t0 of tickets) {
    await db.transaction(async (tx) => {
      const t = await findTicket(t0.id, tx, true);
      if (!t || t.status === "closed") return;
      const chatLike = !t.sourceId || t.sourceKind === "chat";
      if (chatLike && t.status !== "resolved") { await move(tx, actor, t, "reply", now); }
      else if (!t.firstResponseAt) await tx.update(deskTickets).set({ firstResponseAt: now, lastActivityAt: now, updatedAt: now }).where(eq(deskTickets.id, t.id));
      await event(tx, t.id, actor.id, { kind: "reply", data: t.firstResponseAt ? null : { first: true } });
    });
  }
}

/** After a reply in a thread from the chats or an order's page: the tickets that thread belongs to. */
export async function ticketsRepliedOnThread(actor: DeskActor, kind: "request" | "support", threadId: string, now = new Date()) {
  const key = `${kind}:${threadId}`;
  const linked = await db.selectDistinct({ t: deskTickets }).from(deskTickets).leftJoin(deskTicketLinks, eq(deskTicketLinks.ticketId, deskTickets.id))
    .where(and(ne(deskTickets.status, "closed"), or(
      and(eq(deskTickets.sourceKind, "chat"), eq(deskTickets.sourceId, key)),
      kind === "request" ? eq(deskTickets.sourceId, threadId) : undefined,
      and(eq(deskTicketLinks.entityKind, "chat"), eq(deskTicketLinks.entityId, key)),
      kind === "request" ? and(inArray(deskTicketLinks.entityKind, ["order", "request"]), eq(deskTicketLinks.entityId, threadId)) : undefined,
    )));
  if (linked.length) await repliedOn(actor, linked.map((r) => r.t), now);
  return linked.length;
}

/**
 * Merge one ticket into another (a traveller wrote twice about the same thing): its links and notes move to the
 * target, which links back to it; it closes with merged_into_id set. Needs desk.tickets.manage.
 */
export async function mergeTickets(actor: DeskActor, fromId: string, intoRef: string, now = new Date()) {
  assertCap(actor, "desk.tickets.manage");
  return db.transaction(async (tx) => {
    const from = await findTicket(fromId, tx, true);
    const into = await findTicket(intoRef, tx, true);
    if (!from || !into) throw new DeskError("Ticket not found", "NOT_FOUND");
    if (from.id === into.id) throw new DeskError("Choose a different ticket to merge into");
    if (from.status === "closed" || into.status === "closed") throw new DeskError("A closed ticket can't be merged", "CONFLICT");
    const links = await tx.select().from(deskTicketLinks).where(eq(deskTicketLinks.ticketId, from.id));
    const moved = [...links.map((l) => ({ ...l, ticketId: into.id })), { ticketId: into.id, entityKind: "ticket", entityId: from.id, label: ticketRef(from.number), createdBy: actor.id, createdAt: now }];
    await tx.insert(deskTicketLinks).values(moved).onConflictDoNothing();
    await tx.delete(deskTicketLinks).where(eq(deskTicketLinks.ticketId, from.id));
    await tx.update(appDeskNotes).set({ ticketId: into.id }).where(eq(appDeskNotes.ticketId, from.id));
    const rank = (p: string) => TICKET_PRIORITIES.indexOf(p as TicketPriority);
    await tx.update(deskTickets).set({
      customerId: into.customerId ?? from.customerId, priority: rank(from.priority) < rank(into.priority) ? from.priority : into.priority,
      firstResponseAt: into.firstResponseAt ?? from.firstResponseAt, lastActivityAt: now, updatedAt: now,
    }).where(eq(deskTickets.id, into.id));
    await tx.update(deskTickets).set({ ...applyMove({ ...from, status: from.status as TicketStatus }, "merge", now), mergedIntoId: into.id, updatedAt: now, lastActivityAt: now }).where(eq(deskTickets.id, from.id));
    await event(tx, from.id, actor.id, { kind: "merged", from: from.status, to: ticketRef(into.number), body: `Merged into ${ticketRef(into.number)}` });
    await event(tx, into.id, actor.id, { kind: "merged", to: ticketRef(into.number), from: ticketRef(from.number), body: `${ticketRef(from.number)} merged in` });
    await audit(tx, actor, from, "merged", `Merged into ${ticketRef(into.number)}`, { into: into.id, links: links.length });
    return into;
  });
}

/* ═════════════ the lead's bell ═════════════ */

export type TicketAlert = { id: string; ref: string; subject: string; level: number; note: string | null; dueAt: Date; ownerName: string | null };

/**
 * Late and escalated tickets, for the people who manage tickets (leads and partners), in the header bell. Runs the
 * escalation sweep first, so a ticket that just went past its promise shows on the next page anyone opens.
 */
export async function escalationAlerts(u: CurrentUser, now = new Date(), limit = 6): Promise<TicketAlert[]> {
  if (!u.permissions.has("desk.tickets.manage")) return [];
  await sweepEscalations(now).catch(() => []);
  const rows = await db.select({ t: deskTickets, ownerName }).from(deskTickets)
    .where(and(inArray(deskTickets.status, ["new", "open"]), or(sql`${deskTickets.escalationLevel} >= 1`, isNotNull(deskTickets.escalationNote))))
    .orderBy(desc(deskTickets.escalationLevel), asc(deskTickets.dueAt)).limit(limit);
  return rows.map(({ t, ownerName: o }) => ({ id: t.id, ref: ticketRef(t.number), subject: t.subject, level: Math.max(t.escalationLevel, escalationLevel(t, now)), note: t.escalationNote, dueAt: t.dueAt, ownerName: o }));
}

export { PAUSED_STATUSES, OPEN_STATUSES };
