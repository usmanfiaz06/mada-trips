import "server-only";
import { and, eq, gt, gte, isNotNull, isNull, lt, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import type { CurrentUser } from "./auth";
import { addDays, businessDate } from "./dates";
import { getSettings } from "./settings";

export async function activeDelegation(q: Tx | typeof db, userId: string, lock = false) {
  const base = q.select().from(schema.delegations)
    .where(and(eq(schema.delegations.userId, userId), isNull(schema.delegations.revokedAt), gt(schema.delegations.expiresAt, new Date())))
    .orderBy(sql`${schema.delegations.createdAt} desc`).limit(1);
  const [d] = lock ? await base.for("update") : await base;
  return d ?? null;
}

export async function canSeeIssuance(u: CurrentUser) {
  return u.permissions.has("issue.unlimited") || u.permissions.has("issue.delegate") || !!(await activeDelegation(db, u.id));
}

/** Riyadh business day as a time window: from the previous day's close (e.g. 22:00) to this day's close. */
export function businessDayWindow(bd: string, closeHour: number) {
  const hh = String(closeHour).padStart(2, "0");
  return { from: new Date(`${addDays(bd, -1)}T${hh}:00:00+03:00`), to: new Date(`${bd}T${hh}:00:00+03:00`) };
}

/** Total a person issued under delegation in the current business day (all their delegations, so re-granting doesn't reset it). */
export async function issuedTodayBy(q: Tx | typeof db, userId: string, closeHour: number) {
  const w = businessDayWindow(businessDate(new Date(), closeHour), closeHour);
  const [used] = await q.select({ total: sql<number>`coalesce(sum(${schema.bookings.sellPrice}),0)::bigint`.mapWith(Number) })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.issuedBy, userId), isNotNull(schema.bookings.issuedUnderDelegation), gte(schema.bookings.issuedAt, w.from), lt(schema.bookings.issuedAt, w.to)));
  return used?.total ?? 0;
}

type B = { channel: string; sellPrice: number; serviceType: string; preparedBy: string };

/** Whether this person works on this sale's team (or sees every team). */
export async function sameTeam(q: Tx | typeof db, u: CurrentUser, preparedBy: string) {
  if (u.permissions.has("sales.view_all")) return true;
  const [p] = await q.select({ team: schema.users.team }).from(schema.users).where(eq(schema.users.id, preparedBy));
  return p?.team === u.team;
}

/**
 * Can this user issue this booking, and if not, why not? Flights need issuing authority (TTP).
 * Call inside a transaction when about to issue: the delegation row is locked so parallel issues can't pass the daily cap together.
 */
export async function issueCheck(q: Tx | typeof db, u: CurrentUser, b: B, opts: { lock?: boolean } = {}): Promise<{ ok: true; delegationId: string | null } | { ok: false; reason: string }> {
  if (u.permissions.has("issue.unlimited")) return { ok: true, delegationId: null };
  // Hotels, visas and other services are confirmed by the team that sold them.
  if (b.serviceType !== "flight" && u.permissions.has("sales.create")) {
    return (await sameTeam(q, u, b.preparedBy)) ? { ok: true, delegationId: null } : { ok: false, reason: "This sale belongs to another team" };
  }
  const d = await activeDelegation(q, u.id, opts.lock);
  if (!d) return { ok: false, reason: "Ticket issuing needs Bader or a delegated issuer" };
  if (d.scope === "retail" && b.channel !== "retail") return { ok: false, reason: "Your issuing rights cover retail sales only" };
  if (b.sellPrice > d.maxTicket) return { ok: false, reason: `Above your per-ticket issuing limit` };
  const { closeHour } = await getSettings(q as Tx);
  const used = await issuedTodayBy(q, u.id, closeHour);
  if (used + b.sellPrice > d.dailyCap) return { ok: false, reason: "This would pass your daily issuing cap" };
  return { ok: true, delegationId: d.id };
}
