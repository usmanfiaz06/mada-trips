import "server-only";
import { cache } from "react";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { appDeskItems } from "@/db/app-schema-desk";
import { agentForOps, loadRota, primaryAgents, type Agent } from "./agents";
import { destinationOf, listConversations, listOrders, listRefunds, listRequests, listModeration, type OrderStage } from "./adapters";
import { assertCap, deskAudit, DeskError, type DeskActor } from "./core";
import { disruptedToday } from "./disruptions";
import { routeFor, type Route } from "./routing";
import { compareUrgency, DESK_KINDS, slaFor, type DeskKind, type Sla } from "./sla";

/*
 * The desk's one queue. Every source (orders, ticketing, chats, quotes, refunds, disruptions, moderation) becomes an
 * item with a promise (SLA) and an owner worked out from the rota, then everything is sorted by urgency.
 */

export type InboxItem = {
  key: string; kind: DeskKind; id: string; title: string; sub: string; note: string; tag?: string | null; link?: { label: string; href: string } | null; userId: string | null; userName: string;
  href: string; sla: Sla; route: Route; agentName: string | null; escalated: boolean; escalationNote: string | null; amount: number | null;
};
export type InboxFilter = "mine" | "team" | "unassigned" | "escalated";

const cut = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

async function sources(now: Date) {
  const [orders, requests, chats, refunds, disrupted, moderation] = await Promise.all([
    listOrders({ stage: "open" }), listRequests({ open: true }), listConversations(300), listRefunds("requested"), disruptedToday(now), listModeration("open"),
  ]);
  type Raw = Omit<InboxItem, "key" | "route" | "agentName" | "escalated" | "escalationNote">;
  const raw: Raw[] = [];
  for (const o of orders) {
    const st: OrderStage = o.stage;
    if (st === "awaiting") {
      const opened = o.desk.question?.answeredAt ? new Date(o.desk.question.answeredAt) : o.createdAt;
      raw.push({ kind: "order", id: o.id, title: o.summary, note: "Confirm the order", sub: `${o.ref} · ${o.userName}`, userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("order", opened, now), amount: o.total });
    } else if (st === "failed") {
      raw.push({ kind: "ticketing", id: o.id, title: o.summary, note: "Ticketing failed", sub: `${o.ref} · ${o.userName}${o.order?.problem ? ` · ${o.order.problem}` : ""}`,
        userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("ticketing", o.order?.updatedAt ?? o.updatedAt, now), amount: o.total });
    } else if (st === "held") {
      const failed = o.payment?.status === "failed";
      raw.push({ kind: "ticketing", id: o.id, title: o.summary, note: failed ? "Payment capture didn't go through" : "Issue tickets", sub: `${o.ref} · ${o.userName}${o.desk.heldPnr ? ` · PNR ${o.desk.heldPnr}` : ""}`,
        userId: o.ownerId, userName: o.userName, href: `/adminwork/desk/orders/${o.id}`, sla: slaFor("ticketing", o.desk.heldAt ? new Date(o.desk.heldAt) : o.updatedAt, now, { targetMinutes: failed ? 5 : undefined }), amount: o.total });
    }
  }
  for (const r of requests) {
    // Cancellations and refunds are decided in the refunds queue, not quoted.
    if ((r.status === "sent" || r.status === "reviewing") && r.kind !== "cancel" && r.kind !== "refund") {
      const place = r.kind === "destination" ? destinationOf(r.details) : null;
      raw.push({ kind: "request", id: r.id, title: place ? `${place.name}${place.country ? `, ${place.country}` : ""}` : r.summary, note: "Needs a quote", sub: `${r.ref} · ${r.userName}${place?.airports.length ? ` · ${place.airports.join(" ")}` : ""}`,
        userId: r.ownerId, userName: r.userName, href: `/adminwork/desk/requests/${r.id}`, sla: slaFor("request", r.createdAt, now, { due: r.promisedBy }), amount: null,
        tag: place ? "Destination" : null, link: place ? { label: "City guide", href: place.guideUrl } : null });
    } else if (r.status === "with_agent") {
      raw.push({ kind: "request", id: r.id, title: r.summary, note: "Paid, finish it", sub: `${r.ref} · ${r.userName}`, userId: r.ownerId, userName: r.userName, href: `/adminwork/desk/requests/${r.id}`, sla: slaFor("request", r.updatedAt, now, { targetMinutes: 24 * 60 }), amount: null });
    }
  }
  for (const c of chats) {
    if (!c.waitingSince) continue;
    raw.push({ kind: "chat", id: `${c.kind}:${c.id}`, title: cut(c.lastBody || "Photo"), note: "Waiting for a reply", sub: `${c.userName}${c.summary ? ` · ${cut(c.summary, 40)}` : ""}`, userId: c.userId, userName: c.userName,
      href: `/adminwork/desk/chats?t=${c.kind}:${c.id}`, sla: slaFor("chat", c.waitingSince, now), amount: null });
  }
  for (const f of refunds) {
    raw.push({ kind: "refund", id: f.id, title: f.summary ?? f.ref, note: "Refund to decide", sub: `${f.ref} · ${f.userName} · ${f.payment.method === "tabby" || f.payment.method === "tamara" ? f.payment.method[0]!.toUpperCase() + f.payment.method.slice(1) : f.payment.label ?? f.payment.method}`,
      userId: f.userId, userName: f.userName, href: `/adminwork/desk/refunds?focus=${f.id}`, sla: slaFor("refund", f.createdAt, now), amount: f.amount });
  }
  for (const d of disrupted) {
    raw.push({ kind: "disruption", id: `${d.flightNumber}:${d.date}`, title: `${d.flightNumber} · ${d.route}`, note: d.status === "cancelled" ? "Cancelled" : d.status === "diverted" ? "Diverted" : "Delayed", sub: `${d.userIds.size} account${d.userIds.size === 1 ? "" : "s"} · ${d.names.slice(0, 3).join(", ")}`,
      userId: d.userIds.size === 1 ? [...d.userIds][0]! : null, userName: d.names[0] ?? "", href: `/adminwork/desk/disruptions?focus=${d.flightNumber}:${d.date}`, sla: slaFor("disruption", d.changedAt, now), amount: null });
  }
  for (const m of moderation) {
    const unsafe = m.kind === "report" && m.reason === "unsafe";
    raw.push({ kind: "moderation", id: m.id, title: m.kind === "tip" ? `${m.snapshot.place ?? ""}${m.snapshot.city ? ` · ${m.snapshot.city}` : ""}` : cut(m.snapshot.text ?? m.snapshot.name ?? m.targetKind, 70), note: m.kind === "tip" ? "Tip to review" : unsafe ? "Unsafe report" : "Report to review", sub: m.kind === "tip" ? `${m.authorName} · ${cut(m.snapshot.text ?? "", 60)}` : `${m.reporterName} → ${m.authorName}`,
      userId: m.authorUserId, userName: m.authorName, href: `/adminwork/desk/moderation?focus=${m.id}`, sla: slaFor("moderation", m.createdAt, now, { targetMinutes: unsafe ? 30 : undefined }), amount: null });
  }
  return raw;
}

/** The whole queue, routed and sorted. Cached per request so the sidebar count and the page share one read. */
export const deskInbox = cache(async (now: Date = new Date()) => {
  const [raw, rota] = await Promise.all([sources(now), loadRota(now)]);
  const keys = raw.map((r) => `${r.kind}:${r.id}`);
  const [overrides, primary] = await Promise.all([
    raw.length ? db.select().from(appDeskItems).where(inArray(appDeskItems.itemId, raw.map((r) => r.id))) : Promise.resolve([] as (typeof appDeskItems.$inferSelect)[]),
    primaryAgents(raw.map((r) => r.userId).filter((x): x is string => !!x)),
  ]);
  const name = (id: string | null) => (id ? rota.agents.find((a) => a.id === id)?.displayName ?? null : null);
  const items: InboxItem[] = raw.map((r, i) => {
    const o = overrides.find((x) => x.itemKind === r.kind && x.itemId === r.id);
    const route = routeFor(r.userId ? primary.get(r.userId) ?? null : null, rota.agents, rota.shifts, now, o?.assignedAgentId);
    return { ...r, key: keys[i]!, route, agentName: name(route.agentId), escalated: !!o?.escalatedAt, escalationNote: o?.escalationNote ?? null };
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

/** The sidebar number: what's mine or nobody's yet. */
export async function deskBadge(opsUserId: string) {
  const [{ items }, me] = await Promise.all([deskInbox(), agentForOps(opsUserId)]);
  return items.filter((i) => !i.route.agentId || (me && i.route.agentId === me.id)).length;
}

const KIND_SET = new Set<string>(DESK_KINDS);
function checkKey(kind: string, id: string) {
  if (!KIND_SET.has(kind) || !id || id.length > 120) throw new DeskError("Unknown item", "NOT_FOUND");
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
    await deskAudit(tx, actor, { action: on ? "desk.item.escalated" : "desk.item.deescalated", entityType: kind, entityId: id, ref: kind,
      summary: on ? `Escalated this ${kind}: ${text}` : `Cleared the escalation on this ${kind}` });
  });
}

/** Who has one item now, and whether it's escalated: for the side card on a detail page. */
export async function itemRoute(kind: string, id: string, userId: string | null) {
  const rota = await loadRota();
  const [[o], primary] = await Promise.all([
    db.select().from(appDeskItems).where(and(eq(appDeskItems.itemKind, kind), eq(appDeskItems.itemId, id))),
    primaryAgents(userId ? [userId] : []),
  ]);
  const route = routeFor(userId ? primary.get(userId) ?? null : null, rota.agents, rota.shifts, rota.now, o?.assignedAgentId);
  return { route, agents: rota.agents.filter((a) => a.active), escalated: !!o?.escalatedAt, escalationNote: o?.escalationNote ?? null, primaryId: userId ? primary.get(userId) ?? null : null };
}
