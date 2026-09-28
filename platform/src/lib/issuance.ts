import "server-only";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import type { CurrentUser } from "./auth";
import { businessDate } from "./dates";

export async function activeDelegation(q: Tx | typeof db, userId: string) {
  const [d] = await q.select().from(schema.delegations)
    .where(and(eq(schema.delegations.userId, userId), isNull(schema.delegations.revokedAt), gt(schema.delegations.expiresAt, new Date())))
    .orderBy(sql`${schema.delegations.createdAt} desc`).limit(1);
  return d ?? null;
}

export async function canSeeIssuance(u: CurrentUser) {
  return u.permissions.has("issue.unlimited") || u.permissions.has("issue.delegate") || !!(await activeDelegation(db, u.id));
}

type B = { channel: string; sellPrice: number; serviceType: string };

/** Can this user issue this booking, and if not, why not? Flights need issuing authority (TTP). */
export async function issueCheck(q: Tx | typeof db, u: CurrentUser, b: B): Promise<{ ok: true; delegationId: string | null } | { ok: false; reason: string }> {
  if (u.permissions.has("issue.unlimited")) return { ok: true, delegationId: null };
  if (b.serviceType !== "flight" && u.permissions.has("sales.create")) return { ok: true, delegationId: null };
  const d = await activeDelegation(q, u.id);
  if (!d) return { ok: false, reason: "Ticket issuing needs Bader or a delegated issuer" };
  if (d.scope === "retail" && b.channel !== "retail") return { ok: false, reason: "Your issuing rights cover retail sales only" };
  if (b.sellPrice > d.maxTicket) return { ok: false, reason: `Above your per-ticket issuing limit` };
  const today = businessDate();
  const [used] = await q.select({ total: sql<number>`coalesce(sum(${schema.bookings.sellPrice}),0)::bigint`.mapWith(Number) })
    .from(schema.bookings)
    .where(and(eq(schema.bookings.issuedBy, u.id), eq(schema.bookings.issuedUnderDelegation, d.id), sql`(${schema.bookings.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date = ${today}`));
  if ((used?.total ?? 0) + b.sellPrice > d.dailyCap) return { ok: false, reason: "This would pass your daily issuing cap" };
  return { ok: true, delegationId: d.id };
}
