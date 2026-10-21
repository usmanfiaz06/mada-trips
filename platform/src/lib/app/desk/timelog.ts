import "server-only";
import { and, asc, gt, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import { db } from "@/db";
import { appAgentShifts, appAgents, deskTickets } from "@/db/app-schema-desk";
import { appAgentPresenceLog } from "@/db/app-schema-agents";
import { riyadhMidnight } from "./agent-admin";

/*
 * Time logs (DESK-PLAN.md §4.2 screen 12): per agent per Riyadh day, how long they were online and away (from the
 * presence log the header switch writes), how long they were rostered, whether they started late, and how many
 * tickets they handled (resolved while theirs). The arithmetic is pure so the tests can count it by hand.
 */

const DAY = 86400_000;
export const LATE_AFTER_MINUTES = 10;

export type Interval = { status: string; startedAt: Date; endedAt: Date | null };
export type ShiftSpan = { startsAt: Date; endsAt: Date };
export type DayLog = { day: string; onlineMin: number; awayMin: number; rosteredMin: number; lateMin: number | null; handled: number };

/** Minutes of [a, b) that fall inside [from, to). */
const overlap = (a: Date, b: Date, from: Date, to: Date) => Math.max(0, Math.min(b.getTime(), to.getTime()) - Math.max(a.getTime(), from.getTime())) / 60_000;
/** The Riyadh date (YYYY-MM-DD) of an instant. */
export const riyadhDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * Each day from `from` (a Riyadh midnight) for `days` days: online and away minutes from the intervals (an open one
 * runs to `now`), rostered minutes from the shifts, and how late they switched on after the first shift of the day
 * started (null: no shift, or never online during it).
 */
export function dayLogs(intervals: Interval[], shifts: ShiftSpan[], handledAt: Date[], from: Date, days: number, now: Date): DayLog[] {
  const out: DayLog[] = [];
  for (let i = 0; i < days; i++) {
    const a = new Date(from.getTime() + i * DAY), b = new Date(a.getTime() + DAY);
    let onlineMin = 0, awayMin = 0, rosteredMin = 0;
    for (const iv of intervals) {
      const end = iv.endedAt ?? now;
      if (iv.status === "online") onlineMin += overlap(iv.startedAt, end, a, b);
      else if (iv.status === "away") awayMin += overlap(iv.startedAt, end, a, b);
    }
    const dayShifts = shifts.filter((s) => s.startsAt >= a && s.startsAt < b).sort((x, y) => x.startsAt.getTime() - y.startsAt.getTime());
    for (const s of shifts) rosteredMin += overlap(s.startsAt, s.endsAt, a, b);
    let lateMin: number | null = null;
    const first = dayShifts[0];
    if (first && first.startsAt <= now) {
      // When they were first online during that shift (already online at its start counts as on time).
      const on = intervals.filter((iv) => iv.status === "online" && iv.startedAt < first.endsAt && (iv.endedAt ?? now) > first.startsAt)
        .map((iv) => Math.max(iv.startedAt.getTime(), first.startsAt.getTime())).sort((x, y) => x - y)[0];
      if (on !== undefined) lateMin = Math.round((on - first.startsAt.getTime()) / 60_000);
    }
    out.push({ day: riyadhDay(a), onlineMin: Math.round(onlineMin), awayMin: Math.round(awayMin), rosteredMin: Math.round(rosteredMin), lateMin, handled: handledAt.filter((h) => h >= a && h < b).length });
  }
  return out;
}

/** Every agent's day logs for the `days` Riyadh days that end today (or end on `until`). */
export async function timeLogs(o: { days?: number; until?: Date; now?: Date } = {}) {
  const now = o.now ?? new Date();
  const days = Math.max(1, Math.min(o.days ?? 7, 31));
  const from = new Date(riyadhMidnight(o.until ?? now).getTime() - (days - 1) * DAY);
  const to = new Date(from.getTime() + days * DAY);
  const [agents, intervals, shifts, handled] = await Promise.all([
    db.select({ id: appAgents.id, name: appAgents.displayName, active: appAgents.active, status: appAgents.status }).from(appAgents).orderBy(asc(appAgents.displayName)),
    db.select().from(appAgentPresenceLog).where(and(lt(appAgentPresenceLog.startedAt, to), or(isNull(appAgentPresenceLog.endedAt), gt(appAgentPresenceLog.endedAt, from)))),
    db.select({ agentId: appAgentShifts.agentId, startsAt: appAgentShifts.startsAt, endsAt: appAgentShifts.endsAt }).from(appAgentShifts).where(and(lt(appAgentShifts.startsAt, to), gt(appAgentShifts.endsAt, from))),
    db.select({ agentId: deskTickets.ownerAgentId, at: deskTickets.resolvedAt }).from(deskTickets)
      .where(and(isNotNull(deskTickets.ownerAgentId), sql`${deskTickets.resolvedAt} >= ${from.toISOString()}::timestamptz AND ${deskTickets.resolvedAt} < ${to.toISOString()}::timestamptz`, sql`${deskTickets.mergedIntoId} IS NULL`)),
  ]);
  const ids = new Set([...intervals.map((i) => i.agentId), ...shifts.map((s) => s.agentId), ...handled.map((h) => h.agentId!)]);
  return {
    from, days, now,
    rows: agents.filter((a) => a.active || ids.has(a.id)).map((a) => {
      const logs = dayLogs(intervals.filter((i) => i.agentId === a.id), shifts.filter((s) => s.agentId === a.id), handled.filter((h) => h.agentId === a.id).map((h) => h.at!), from, days, now);
      const sum = (k: "onlineMin" | "awayMin" | "rosteredMin" | "handled") => logs.reduce((n, d) => n + d[k], 0);
      return { agent: a, logs, total: { onlineMin: sum("onlineMin"), awayMin: sum("awayMin"), rosteredMin: sum("rosteredMin"), handled: sum("handled"), lateDays: logs.filter((d) => (d.lateMin ?? 0) > LATE_AFTER_MINUTES).length } };
    }),
  };
}

/** The rota as a week grid: Riyadh days from `from` (a Riyadh midnight), every shift that starts on each day. */
export async function weekGrid(from: Date) {
  const to = new Date(from.getTime() + 7 * DAY);
  const shifts = await db.select().from(appAgentShifts).where(and(lt(appAgentShifts.startsAt, to), gt(appAgentShifts.startsAt, new Date(from.getTime() - 1)))).orderBy(asc(appAgentShifts.startsAt));
  const agents = await db.select().from(appAgents).where(shifts.length ? or(inArray(appAgents.id, shifts.map((s) => s.agentId)), sql`${appAgents.active}`) : sql`${appAgents.active}`).orderBy(asc(appAgents.displayName));
  const days = Array.from({ length: 7 }, (_, i) => new Date(from.getTime() + i * DAY));
  return { from, days, agents, shifts };
}
