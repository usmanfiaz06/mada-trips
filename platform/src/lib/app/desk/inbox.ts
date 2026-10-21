import "server-only";
import { contactOf } from "./flight-quotes";
import { cache } from "react";
import { CALLBACK_MINUTES } from "@mada/shared";
import { and, eq, inArray, ne, sql } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { appDeskItems, appDeskModeration, deskTicketEvents, deskTickets } from "@/db/app-schema-desk";
import { appMessages, appRefunds, appRequests, appSegments, appTrips } from "@/db/app-schema";
import { appReports } from "@/db/app-schema-circles";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { appEsims } from "@/db/app-schema-esim";
import { riyadhDate } from "@/lib/dates";
import { loadRota, primaryAgents, type Agent } from "./agents";
import { destinationOf, listConversations, listOrders, listRefunds, listRequests, orderStageCounts, type OrderStage } from "./adapters";
import { listModeration } from "./moderation";
import { listRecovery } from "./recovery";
import { assertCap, deskAudit, DeskError, type DeskActor } from "./core";
import { disruptedToday } from "./disruptions";
import { esimsNeedingDesk } from "../esim/ops";
import { routeFor, type Route } from "./routing";
import { compareUrgency, DESK_KINDS, slaFor, type DeskKind, type Sla } from "./sla";
import { CONTACT_LABEL, contactPreferenceOf } from "../booking/requests";

const reachOf = (details: unknown) => { const c = contactPreferenceOf(details); return c ? { label: CONTACT_LABEL[c.preference], window: c.window } : null; };

/*
 * The desk's one queue. Every source (orders, ticketing, chats, quotes, refunds, disruptions, moderation) becomes an
 * item with a promise (SLA) and an owner worked out from the rota, then everything is sorted by urgency. Each item
 * names its source, and lib/app/desk/tickets.ts keeps exactly one ticket per open source; a person's decisions
 * (a hand assignment, an escalation) live on that ticket.
 */

/** What a ticket can be opened for: one row per source while it's open (desk_tickets.source_kind/source_id). */
export type SourceKind = "order" | "request" | "chat" | "refund" | "esim" | "disruption" | "moderation" | "recovery";

export type InboxItem = {
  key: string; kind: DeskKind; id: string; source: { kind: SourceKind; id: string }; title: string; sub: string; note: string; tag?: string | null;
  /** How the traveller asked to be reached (Ask chat): an English key the desk translates, and a call's best time. */
  reach?: { label: string; window: string | null } | null; link?: { label: string; href: string } | null; userId: string | null; userName: string;
  href: string; sla: Sla; route: Route; agentName: string | null; escalated: boolean; escalationNote: string | null; amount: number | null;
  /** Urgent help waiting on a call-back: above everything else, whatever its promise says. */
  urgent?: boolean;
};
export type InboxFilter = "mine" | "team" | "unassigned" | "escalated";

const cut = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function sources(now: Date) {
  const [orders, requests, chats, refunds, disrupted, moderation, recovery, esims] = await Promise.all([
    listOrders({ stage: "open" }), listRequests({ open: true }), listConversations(300), listRefunds("requested"), disruptedToday(now), listModeration("open"), listRecovery("open"),
    esimsNeedingDesk().catch(() => []),
  ]);
  type Raw = Omit<InboxItem, "key" | "route" | "agentName" | "escalated" | "escalationNote" | "source">;
  const raw: (Raw & { source: InboxItem["source"] })[] = [];
  for (const o of orders) {
    const st: OrderStage = o.stage;
    if (st === "awaiting") {
      const opened = o.desk.question?.answeredAt ? new Date(o.desk.question.answeredAt) : o.createdAt;
      const call = contactOf(o.details);
      raw.push({ kind: "order", id: o.id, source: { kind: "order", id: o.id }, title: o.summary, note: "Confirm the order", sub: `${o.ref} · ${o.userName}`, userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("order", opened, now), amount: o.total,
        tag: call && !call.confirmedAt ? "Phone not verified" : null });
    } else if (st === "failed") {
      raw.push({ kind: "ticketing", id: o.id, source: { kind: "order", id: o.id }, title: o.summary, note: "Ticketing failed", sub: `${o.ref} · ${o.userName}${o.order?.problem ? ` · ${o.order.problem}` : ""}`,
        userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("ticketing", o.order?.updatedAt ?? o.updatedAt, now), amount: o.total });
    } else if (st === "held") {
      const failed = o.payment?.status === "failed";
      raw.push({ kind: "ticketing", id: o.id, source: { kind: "order", id: o.id }, title: o.summary, note: failed ? "Payment capture didn't go through" : "Issue tickets", sub: `${o.ref} · ${o.userName}${o.desk.heldPnr ? ` · PNR ${o.desk.heldPnr}` : ""}`,
        userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("ticketing", o.desk.heldAt ? new Date(o.desk.heldAt) : o.updatedAt, now, { targetMinutes: failed ? 5 : undefined }), amount: o.total });
    }
  }
  for (const r of requests) {
    // Cancellations and refunds are decided in the refunds queue, not quoted.
    if ((r.status === "sent" || r.status === "reviewing") && r.kind !== "cancel" && r.kind !== "refund") {
      const place = r.kind === "destination" ? destinationOf(r.details) : null;
      raw.push({ kind: "request", id: r.id, source: { kind: "request", id: r.id }, title: place ? `${place.name}${place.country ? `, ${place.country}` : ""}` : r.summary, note: "Needs a quote", sub: `${r.ref} · ${r.userName}${place?.airports.length ? ` · ${place.airports.join(" ")}` : ""}`,
        userId: r.ownerId, userName: r.userName, href: `/adminwork/desk/requests/${r.id}`, sla: slaFor("request", r.createdAt, now, { due: r.promisedBy }), amount: null,
        tag: place ? "Destination" : r.kind === "flight" ? "Flights" : r.kind === "activity" ? "Activity" : null, link: place ? { label: "City guide", href: place.guideUrl } : null, reach: reachOf(r.details) });
    } else if (r.status === "with_agent") {
      raw.push({ kind: "request", id: r.id, source: { kind: "request", id: r.id }, title: r.summary, note: "Paid, finish it", sub: `${r.ref} · ${r.userName}`, userId: r.ownerId, userName: r.userName, href: `/adminwork/desk/requests/${r.id}`, sla: slaFor("request", r.updatedAt, now, { targetMinutes: 24 * 60 }), amount: null });
    }
  }
  for (const c of chats) {
    if (!c.waitingSince && !c.urgentSince) continue;
    // Urgent help: Mada promised a call-back within 10 minutes of the traveller asking.
    if (c.urgentSince) {
      raw.push({ kind: "chat", id: `${c.kind}:${c.id}`, source: { kind: "chat", id: `${c.kind}:${c.id}` }, title: cut(c.lastBody || "Photo"), note: "Call back now", sub: `${c.userName}${c.summary ? ` · ${cut(c.summary, 40)}` : ""}`, userId: c.userId, userName: c.userName,
        href: `/adminwork/desk/chats?t=${c.kind}:${c.id}`, sla: slaFor("chat", c.urgentSince, now, { targetMinutes: CALLBACK_MINUTES }), amount: null, tag: "Urgent", urgent: true });
      continue;
    }
    if (!c.waitingSince) continue;
    raw.push({ kind: "chat", id: `${c.kind}:${c.id}`, source: { kind: "chat", id: `${c.kind}:${c.id}` }, title: cut(c.lastBody || "Photo"), note: "Waiting for a reply", sub: `${c.userName}${c.summary ? ` · ${cut(c.summary, 40)}` : ""}`, userId: c.userId, userName: c.userName,
      href: `/adminwork/desk/chats?t=${c.kind}:${c.id}`, sla: slaFor("chat", c.waitingSince, now), amount: null });
  }
  for (const f of refunds) {
    raw.push({ kind: "refund", id: f.id, source: { kind: "refund", id: f.id }, title: f.summary ?? f.ref, note: "Refund to decide", sub: `${f.ref} · ${f.userName} · ${f.payment.method === "tabby" || f.payment.method === "tamara" ? f.payment.method[0]!.toUpperCase() + f.payment.method.slice(1) : f.payment.label ?? f.payment.method}`,
      userId: f.userId, userName: f.userName, href: `/adminwork/desk/refunds?focus=${f.id}`, sla: slaFor("refund", f.createdAt, now), amount: f.amount });
  }
  for (const d of disrupted) {
    raw.push({ kind: "disruption", id: `${d.flightNumber}:${d.date}`, source: { kind: "disruption", id: `${d.flightNumber}:${d.date}` }, title: `${d.flightNumber} · ${d.route}`, note: d.status === "cancelled" ? "Cancelled" : d.status === "diverted" ? "Diverted" : "Delayed", sub: `${d.userIds.size} account${d.userIds.size === 1 ? "" : "s"} · ${d.names.slice(0, 3).join(", ")}`,
      userId: d.userIds.size === 1 ? [...d.userIds][0]! : null, userName: d.names[0] ?? "", href: `/adminwork/desk/disruptions?focus=${d.flightNumber}:${d.date}`, sla: slaFor("disruption", d.changedAt, now), amount: null });
  }
  for (const m of moderation) {
    const unsafe = m.kind === "report" && m.reason === "unsafe";
    raw.push({ kind: "moderation", id: m.id, source: { kind: "moderation", id: m.id }, title: m.kind === "tip" ? `${m.snapshot.place ?? ""}${m.snapshot.city ? ` · ${m.snapshot.city}` : ""}` : cut(m.snapshot.text ?? m.snapshot.name ?? m.targetKind, 70), note: m.kind === "tip" ? "Tip to review" : unsafe ? "Unsafe report" : "Report to review", sub: m.kind === "tip" ? `${m.authorName} · ${cut(m.snapshot.text ?? "", 60)}` : `${m.reporterName} → ${m.authorName}`,
      userId: m.authorUserId, userName: m.authorName, href: `/adminwork/desk/moderation?focus=${m.id}`, sla: slaFor("moderation", m.createdAt, now, { targetMinutes: unsafe ? 30 : undefined }), amount: null });
  }
  // A paid eSIM that didn't come: waiting on our supplier balance (urgent, a time was promised) or no answer.
  for (const e of esims) {
    const plan = e.plan as { coverage?: { name?: string } };
    const low = e.problem === "low_balance";
    raw.push({ kind: "ticketing", id: e.id, source: { kind: "esim", id: e.id }, title: `eSIM · ${plan.coverage?.name ?? ""}`, note: low ? "Top up the eSIM balance" : "eSIM not delivered", sub: `${e.ref ?? ""} · ${e.name ?? ""}${low && e.dueAt ? ` · promised by ${e.dueAt.toISOString().slice(11, 16)} UTC` : e.problem ? ` · ${cut(e.problem, 50)}` : ""}`,
      userId: e.ownerId, userName: e.name ?? "", href: `/adminwork/desk/esims/${e.id}`, sla: slaFor("ticketing", e.updatedAt, now, { due: low ? e.dueAt : undefined, targetMinutes: low ? undefined : 15 }), amount: e.total, tag: "eSIM", urgent: low || undefined });
  }
  for (const r of recovery) {
    raw.push({ kind: "recovery", id: r.id, source: { kind: "recovery", id: r.id }, title: r.name, note: r.account ? "Move an account" : "No account matches", sub: `${r.oldMasked} → ${r.newMasked}`,
      userId: r.matchedUserId, userName: r.account?.shortName ?? r.name, href: `/adminwork/desk/recovery?focus=${r.id}`, sla: slaFor("recovery", r.createdAt, now), amount: null });
  }
  return raw;
}

/** A person's decisions about each item: its open ticket's when there is one, else the older app_desk_items row. */
async function decisions(ids: string[]) {
  if (!ids.length) return new Map<string, { agentId: string | null; escalatedAt: Date | null; note: string | null }>();
  const [tickets, items] = await Promise.all([
    db.select({ sourceKind: deskTickets.sourceKind, sourceId: deskTickets.sourceId, owner: deskTickets.ownerAgentId, reason: deskTickets.ownerReason, escalatedAt: deskTickets.escalatedAt, note: deskTickets.escalationNote })
      .from(deskTickets).where(and(inArray(deskTickets.sourceId, ids), ne(deskTickets.status, "closed"))),
    db.select().from(appDeskItems).where(inArray(appDeskItems.itemId, ids)),
  ]);
  const out = new Map<string, { agentId: string | null; escalatedAt: Date | null; note: string | null }>();
  for (const o of items) out.set(o.itemId, { agentId: o.assignedAgentId, escalatedAt: o.escalatedAt, note: o.escalationNote });
  // The SLA clock's own escalations (escalation_note empty) don't count here: the item shows late by its clock already.
  for (const t of tickets) out.set(t.sourceId!, { agentId: t.reason === "manual" ? t.owner : null, escalatedAt: t.note ? t.escalatedAt : null, note: t.note });
  return out;
}

/** The whole queue, routed and sorted. Cached per request so the sidebar count and the page share one read. */
export const deskInbox = cache(async (now: Date = new Date()) => {
  const [raw, rota] = await Promise.all([sources(now), loadRota(now)]);
  const [made, primary] = await Promise.all([decisions(raw.map((r) => r.source.id)), primaryAgents(raw.map((r) => r.userId).filter((x): x is string => !!x))]);
  const name = (id: string | null) => (id ? rota.agents.find((a) => a.id === id)?.displayName ?? null : null);
  const items: InboxItem[] = raw.map((r) => {
    const o = made.get(r.source.id);
    const route = routeFor(r.userId ? primary.get(r.userId) ?? null : null, rota.agents, rota.shifts, now, o?.agentId);
    return { ...r, key: `${r.kind}:${r.id}`, route, agentName: name(route.agentId), escalated: !!o?.escalatedAt, escalationNote: o?.note ?? null };
  });
  return { items: items.sort(compareUrgency), rota };
});

export function filterInbox(items: InboxItem[], filter: InboxFilter, me: Agent | null) {
  switch (filter) {
    case "mine": return items.filter((i) => !!me && i.route.agentId === me.id);
    case "unassigned": return items.filter((i) => !i.route.agentId);
    case "escalated": return items.filter((i) => i.escalated || i.sla.state === "breached");
    default: return items;
  }
}

export function inboxCounts(items: InboxItem[], me: Agent | null) {
  const by = Object.fromEntries(DESK_KINDS.map((k) => [k, items.filter((i) => i.kind === k).length])) as Record<DeskKind, number>;
  return {
    all: items.length, mine: filterInbox(items, "mine", me).length, unassigned: filterInbox(items, "unassigned", me).length,
    escalated: filterInbox(items, "escalated", me).length, breached: items.filter((i) => i.sla.state === "breached").length, by,
  };
}


const KIND_SET = new Set<string>(DESK_KINDS);
function checkKey(kind: string, id: string) {
  if (!KIND_SET.has(kind) || !id || id.length > 120) throw new DeskError("Unknown item", "NOT_FOUND");
}

/** The same decision on the item's open ticket, with its event (the ticket page shows it in the timeline). */
async function onTicket(tx: Tx, actor: DeskActor, sourceId: string, set: Partial<typeof deskTickets.$inferInsert>, ev: { kind: string; from?: string | null; to?: string | null; body?: string | null }) {
  const rows = await tx.update(deskTickets).set({ ...set, updatedAt: new Date(), lastActivityAt: new Date() })
    .where(and(eq(deskTickets.sourceId, sourceId), ne(deskTickets.status, "closed"))).returning({ id: deskTickets.id, status: deskTickets.status });
  for (const r of rows) {
    // Taking or giving it to someone opens a new ticket.
    if (set.ownerAgentId && r.status === "new") await tx.update(deskTickets).set({ status: "open" }).where(eq(deskTickets.id, r.id));
    await tx.insert(deskTicketEvents).values({ ticketId: r.id, actorId: actor.id, kind: ev.kind, from: ev.from ?? null, to: ev.to ?? null, body: ev.body ?? null });
  }
}

/** Hand a piece of work to someone (or back to the rota with null). */
export async function reassign(actor: DeskActor, kind: string, id: string, agentId: string | null) {
  assertCap(actor, "desk.act");
  checkKey(kind, id);
  await db.transaction(async (tx) => {
    const { agents } = await loadRota();
    const to = agentId ? agents.find((a) => a.id === agentId) : null;
    if (agentId && (!to || !to.active)) throw new DeskError("Choose someone on the desk");
    const [prev] = await tx.select().from(appDeskItems).where(and(eq(appDeskItems.itemKind, kind), eq(appDeskItems.itemId, id))).for("update");
    const fromName = prev?.assignedAgentId ? agents.find((a) => a.id === prev.assignedAgentId)?.displayName ?? null : null;
    const values = { assignedAgentId: agentId, assignedBy: actor.id, assignedAt: new Date(), updatedAt: new Date() };
    if (prev) await tx.update(appDeskItems).set(values).where(and(eq(appDeskItems.itemKind, kind), eq(appDeskItems.itemId, id)));
    else await tx.insert(appDeskItems).values({ itemKind: kind, itemId: id, ...values });
    await onTicket(tx, actor, id, { ownerAgentId: agentId, ownerReason: agentId ? "manual" : "queue" },
      { kind: "assigned", from: fromName, to: to?.displayName ?? null, body: to ? null : "Back on the rota" });
    await deskAudit(tx, actor, { action: "desk.item.reassigned", entityType: kind, entityId: id, ref: kind,
      summary: to ? `Gave this ${kind} to ${to.displayName}` : `Put this ${kind} back on the rota`, data: { agent: { from: fromName, to: to?.displayName ?? null } } });
  });
}

export async function escalate(actor: DeskActor, kind: string, id: string, note: string | null, on = true) {
  assertCap(actor, "desk.act");
  checkKey(kind, id);
  const text = note?.trim() || null;
  if (on && (!text || text.length < 3)) throw new DeskError("Say what's needed, for whoever picks it up");
  await db.transaction(async (tx) => {
    const [prev] = await tx.select().from(appDeskItems).where(and(eq(appDeskItems.itemKind, kind), eq(appDeskItems.itemId, id))).for("update");
    const values = on ? { escalatedAt: new Date(), escalatedBy: actor.id, escalationNote: text, updatedAt: new Date() } : { escalatedAt: null, escalatedBy: null, escalationNote: null, updatedAt: new Date() };
    if (prev) await tx.update(appDeskItems).set(values).where(and(eq(appDeskItems.itemKind, kind), eq(appDeskItems.itemId, id)));
    else if (on) await tx.insert(appDeskItems).values({ itemKind: kind, itemId: id, ...values });
    await onTicket(tx, actor, id, on ? { escalatedAt: new Date(), escalationNote: text } : { escalatedAt: null, escalationNote: null, escalationLevel: 0 },
      { kind: "escalated", to: on ? "escalated" : "cleared", body: text });
    await deskAudit(tx, actor, { action: on ? "desk.item.escalated" : "desk.item.deescalated", entityType: kind, entityId: id, ref: kind,
      summary: on ? `Escalated this ${kind}: ${text}` : `Cleared the escalation on this ${kind}` });
  });
}

/** Who has one item now, and whether it's escalated: for the side card on a detail page. */
export async function itemRoute(_kind: string, id: string, userId: string | null) {
  const rota = await loadRota();
  const [made, primary] = await Promise.all([decisions([id]), primaryAgents(userId ? [userId] : [])]);
  const o = made.get(id);
  const route = routeFor(userId ? primary.get(userId) ?? null : null, rota.agents, rota.shifts, rota.now, o?.agentId);
  return { route, agents: rota.agents.filter((a) => a.active), escalated: !!o?.escalatedAt, escalationNote: o?.note ?? null, primaryId: userId ? primary.get(userId) ?? null : null };
}

export type DeskNavCounts = { queue: number; chats: number; orders: number; requests: number; refunds: number; disruptions: number; moderation: number; recovery: number; esims: number };

/**
 * The sidebar's numbers, from count queries only: every Ops page renders the sidebar, so this must not rebuild the
 * queue (deskInbox reads every source and routes it). "queue" is everything open on the desk, the inbox's "Whole team".
 */
export const deskNavCounts = cache(async (now: Date = new Date()): Promise<DeskNavCounts> => {
  const today = riyadhDate(now);
  const [stages, res] = await Promise.all([orderStageCounts(), db.execute(sql`SELECT
    (SELECT count(*)::int FROM ${appRequests} WHERE (${appRequests.kind} NOT IN ('flight','stay','trip','cancel','refund') AND ${appRequests.status} IN ('sent','reviewing'))
      OR (${appRequests.kind} NOT IN ('flight','stay','trip') AND ${appRequests.status} = 'with_agent')
      OR (${appRequests.kind} = 'flight' AND ${appRequests.details}->>'source' = 'ask' AND ${appRequests.status} IN ('sent','reviewing'))) AS requests,
    (SELECT count(*)::int FROM (SELECT thread_kind, thread_id, max(created_at) FILTER (WHERE author_kind = 'user') AS u, max(created_at) FILTER (WHERE author_kind = 'agent') AS a
      FROM ${appMessages} WHERE thread_kind IN ('support','request') GROUP BY 1, 2) x WHERE x.u > coalesce(x.a, 'epoch')) AS chats,
    (SELECT count(*)::int FROM ${appRefunds} WHERE ${appRefunds.stage} = 'requested') AS refunds,
    (SELECT count(DISTINCT ${appSegments.flightNumber})::int FROM ${appSegments} JOIN ${appTrips} ON ${appTrips.id} = ${appSegments.tripId}
      WHERE ${appSegments.departLocal}::date = ${today}::date AND ${appSegments.status} IN ('delayed','cancelled','diverted') AND ${appTrips.status} <> 'cancelled') AS disruptions,
    ((SELECT count(*)::int FROM ${appDeskModeration} WHERE ${appDeskModeration.status} = 'open') + (SELECT count(*)::int FROM ${appReports} WHERE ${appReports.status} = 'open')) AS moderation,
    (SELECT count(*)::int FROM ${appRecoveryRequests} WHERE ${appRecoveryRequests.status} = 'open') AS recovery,
    (SELECT count(*)::int FROM ${appEsims} WHERE ${appEsims.status} = 'stuck' AND ${appEsims.idx} = 0) AS esims,
    (SELECT count(*)::int FROM ${deskTickets} WHERE ${deskTickets.kind} = 'manual' AND ${deskTickets.status} IN ('new','open')) AS manual`)]);
  const { manual, ...c } = (res as unknown as (Omit<DeskNavCounts, "queue" | "orders"> & { manual: number })[])[0]!;
  const orders = (stages.awaiting ?? 0) + (stages.held ?? 0) + (stages.failed ?? 0);
  // The queue also holds the tickets people opened by hand.
  return { ...c, orders, queue: orders + c.requests + c.chats + c.refunds + c.disruptions + c.moderation + c.recovery + c.esims + manual };
});
