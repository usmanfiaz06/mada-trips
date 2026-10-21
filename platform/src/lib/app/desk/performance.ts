import "server-only";
import { and, asc, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appRefunds } from "@/db/app-schema";
import { appAgents, deskTickets } from "@/db/app-schema-desk";

/*
 * Performance (DESK-PLAN.md §4.2 screen 13, U7): per agent and for the team, over a date range, by day or week.
 * Every number comes from desk_tickets (and the refund approvals in the audit log), attributed to the ticket's owner:
 *
 *   volume          tickets opened in the range
 *   handled         tickets resolved in the range
 *   first response  first_response_at − opened_at, for first responses in the range (median and p90, minutes)
 *   resolution      resolved_at − opened_at, for tickets resolved in the range (median and p90, minutes)
 *   SLA hit %       of tickets resolved in the range: never escalated, and answered (or resolved) by their due time
 *   CSAT            average and count of the one-tap ratings given in the range (1–5)
 *   reopen rate     of tickets resolved in the range, the share reopened at least once
 *   refunds         refunds approved in the range by the agent: count and SAR
 *
 * Merged tickets count once, in the ticket they were merged into. summarise() is pure: the tests count by hand.
 */

const DAY = 86400_000;
export type PerfTicket = {
  ownerAgentId: string | null; openedAt: Date; firstResponseAt: Date | null; resolvedAt: Date | null; dueAt: Date;
  escalationLevel: number; csat: number | null; csatAt: Date | null; reopenedCount: number;
};
export type PerfRefund = { agentId: string | null; amount: number; at: Date };
export type Metrics = {
  volume: number; handled: number; firstResponse: { median: number | null; p90: number | null; n: number }; resolution: { median: number | null; p90: number | null; n: number };
  slaHit: number | null; slaN: number; csat: number | null; csatN: number; reopenRate: number | null; refunds: number; refundSar: number;
};
export type Bucket = "day" | "week";

/** The middle value (the mean of the two middle ones for an even count). */
export function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b), m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}
/** Nearest rank: the smallest value with at least p% of the values at or below it. */
export function percentile(xs: number[], p: number): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]!;
}
export const slaHit = (t: PerfTicket) => t.escalationLevel === 0 && (t.firstResponseAt ?? t.resolvedAt ?? new Date(8.64e15)) <= t.dueAt;

const within = (d: Date | null, from: Date, to: Date): d is Date => !!d && d >= from && d < to;
const mins = (a: Date, b: Date) => (b.getTime() - a.getTime()) / 60_000;

export function metrics(tickets: PerfTicket[], refunds: PerfRefund[], from: Date, to: Date): Metrics {
  const opened = tickets.filter((t) => within(t.openedAt, from, to));
  const resolved = tickets.filter((t) => within(t.resolvedAt, from, to));
  const fr = tickets.filter((t) => within(t.firstResponseAt, from, to)).map((t) => mins(t.openedAt, t.firstResponseAt!));
  const res = resolved.map((t) => mins(t.openedAt, t.resolvedAt!));
  const rated = tickets.filter((t) => t.csat != null && within(t.csatAt, from, to));
  const rf = refunds.filter((r) => within(r.at, from, to));
  const hits = resolved.filter(slaHit).length;
  return {
    volume: opened.length, handled: resolved.length,
    firstResponse: { median: median(fr), p90: percentile(fr, 90), n: fr.length },
    resolution: { median: median(res), p90: percentile(res, 90), n: res.length },
    slaHit: resolved.length ? hits / resolved.length : null, slaN: resolved.length,
    csat: rated.length ? rated.reduce((n, t) => n + t.csat!, 0) / rated.length : null, csatN: rated.length,
    reopenRate: resolved.length ? resolved.filter((t) => t.reopenedCount > 0).length / resolved.length : null,
    refunds: rf.length, refundSar: rf.reduce((n, r) => n + r.amount, 0),
  };
}

/** Riyadh days (or Sunday-to-Saturday weeks) from `from` to `to`, as [start, end) instants. */
export function buckets(from: Date, to: Date, by: Bucket): { start: Date; end: Date }[] {
  const out: { start: Date; end: Date }[] = [];
  let s = from;
  if (by === "week") {
    const dow = new Date(from.getTime() + 3 * 3600_000).getUTCDay();
    s = new Date(from.getTime() - dow * DAY);
  }
  const step = by === "week" ? 7 * DAY : DAY;
  for (; s < to; s = new Date(s.getTime() + step)) out.push({ start: new Date(Math.max(s.getTime(), from.getTime())), end: new Date(Math.min(s.getTime() + step, to.getTime())) });
  return out;
}

/** The whole report: team and per agent over the range, and the team by day or week. */
export function summarise(tickets: PerfTicket[], refunds: PerfRefund[], agentIds: string[], from: Date, to: Date, by: Bucket) {
  return {
    team: metrics(tickets, refunds, from, to),
    agents: agentIds.map((id) => ({ id, m: metrics(tickets.filter((t) => t.ownerAgentId === id), refunds.filter((r) => r.agentId === id), from, to) })),
    series: buckets(from, to, by).map((b) => ({ ...b, m: metrics(tickets, refunds, b.start, b.end) })),
  };
}

/** Reads what the range needs, then summarise(). `onlyAgentId` limits it to one agent (own stats without desk.reports). */
export async function performanceReport(o: { from: Date; to: Date; by: Bucket; onlyAgentId?: string | null }) {
  const f = o.from.toISOString(), t = o.to.toISOString();
  const inRange = (c: unknown) => sql`(${c} >= ${f}::timestamptz AND ${c} < ${t}::timestamptz)`;
  const own = o.onlyAgentId ? eq(deskTickets.ownerAgentId, o.onlyAgentId) : undefined;
  const [tickets, refunds, agents] = await Promise.all([
    db.select({
      ownerAgentId: deskTickets.ownerAgentId, openedAt: deskTickets.openedAt, firstResponseAt: deskTickets.firstResponseAt, resolvedAt: deskTickets.resolvedAt, dueAt: deskTickets.dueAt,
      escalationLevel: deskTickets.escalationLevel, csat: deskTickets.csat, csatAt: deskTickets.csatAt, reopenedCount: deskTickets.reopenedCount,
    }).from(deskTickets).where(and(isNull(deskTickets.mergedIntoId), own, or(inRange(deskTickets.openedAt), inRange(deskTickets.firstResponseAt), inRange(deskTickets.resolvedAt), inRange(deskTickets.csatAt)))),
    db.select({ agentId: appAgents.id, amount: appRefunds.amount, at: schema.auditEvents.at }).from(schema.auditEvents)
      .innerJoin(appRefunds, sql`${appRefunds.id}::text = ${schema.auditEvents.entityId}`)
      .leftJoin(appAgents, eq(appAgents.opsUserId, schema.auditEvents.actorId))
      .where(and(eq(schema.auditEvents.action, "desk.refund.approved"), inRange(schema.auditEvents.at), o.onlyAgentId ? eq(appAgents.id, o.onlyAgentId) : undefined)),
    db.select({ id: appAgents.id, name: appAgents.displayName, active: appAgents.active }).from(appAgents).where(o.onlyAgentId ? eq(appAgents.id, o.onlyAgentId) : undefined).orderBy(asc(appAgents.displayName)),
  ]);
  const r = summarise(tickets, refunds.map((x) => ({ agentId: x.agentId, amount: Number(x.amount), at: x.at })), agents.map((a) => a.id), o.from, o.to, o.by);
  const names = new Map(agents.map((a) => [a.id, a]));
  return { ...r, agents: r.agents.map((x) => ({ ...x, name: names.get(x.id)!.name, active: names.get(x.id)!.active })).filter((x) => x.active || x.m.volume || x.m.handled || x.m.csatN || x.m.refunds) };
}
