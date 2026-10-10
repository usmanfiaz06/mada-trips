import "server-only";
import { createHash } from "node:crypto";
import { and, eq, gt, inArray, isNull, or, sql } from "drizzle-orm";
import { addDays, monthOf, personRef, rangeLabel, t, todayIn, type CopyKey, type PersonRef, type SocialRelation, type Vars } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appNotifications, appPeople, appTrips, appUsers } from "@/db/app-schema";
import { appBlocks, appFollows, appFriendships } from "@/db/app-schema-circles";
import { AppError, resilient } from "../http";

/* Helpers every circles module shares: people as others see them, who knows whom, blocks, limits, and routes. */

export type Db = Tx | typeof db;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A route handler with dynamic params, wrapped like route(): request id, version and maintenance gates,
 * Idempotency-Key on mutations, the error envelope, no caching.
 */
export function routeP<P extends Record<string, string>>(fn: (req: Request, params: P) => Promise<Response>) {
  return (req: Request, ctx: { params: Promise<P> }): Promise<Response> => resilient(req, async () => fn(req, await ctx.params));
}

/** A path id must be a uuid; anything else is simply not found. */
export function uuidParam(v: string | undefined): string {
  if (!v || !UUID.test(v)) throw new AppError("NOT_FOUND");
  return v.toLowerCase();
}
export const isUuid = (v: string) => UUID.test(v);

export const err = (code: "FORBIDDEN" | "NOT_FOUND" | "VALIDATION", copy?: CopyKey, fields?: Record<string, string>) => new AppError(code, { copy, fields });

/** Throws RATE_LIMITED when `used` has reached `limit` in a window of `windowSeconds`. */
export function assertUnder(used: number, limit: number, windowSeconds: number) {
  if (used >= limit) throw new AppError("RATE_LIMITED", { vars: { seconds: windowSeconds }, retryAfter: windowSeconds });
}

export const sha256hex = (s: string) => createHash("sha256").update(s).digest("hex");

/* ───────────── people ───────────── */

/** People as others see them: a full name from their own passport when they've added it, else their first name. */
export async function peopleByIds(ids: string[], tx: Db = db): Promise<Map<string, PersonRef>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  const out = new Map<string, PersonRef>();
  if (!uniq.length) return out;
  const rows = await tx.select({ id: appUsers.id, name: appUsers.name, given: appPeople.givenNames, surname: appPeople.surname })
    .from(appUsers)
    .leftJoin(appPeople, and(eq(appPeople.ownerId, appUsers.id), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt)))
    .where(inArray(appUsers.id, uniq));
  for (const r of rows) {
    const first = r.name || (r.given ?? "").split(/\s+/)[0] || "";
    const full = r.given && r.surname ? `${first || r.given.split(/\s+/)[0]} ${r.surname}` : first;
    const p = personRef(r.id, full || t("circles.someone"));
    out.set(r.id, { ...p, short: first || p.short });
  }
  for (const id of uniq) if (!out.has(id)) out.set(id, personRef(id, t("circles.someone")));
  return out;
}
export async function personOf(id: string, tx: Db = db): Promise<PersonRef> {
  return (await peopleByIds([id], tx)).get(id)!;
}
export async function liveUser(id: string, tx: Db = db) {
  const [u] = await tx.select({ id: appUsers.id, name: appUsers.name, phone: appUsers.phone }).from(appUsers).where(and(eq(appUsers.id, id), isNull(appUsers.deletedAt)));
  return u ?? null;
}

/* ───────────── who knows whom ───────────── */

export type Graph = { friends: Set<string>; family: Set<string>; close: Set<string>; following: Set<string>; blocked: Set<string>; asked: Set<string>; askedMe: Set<string> };

/** Everything about how one person relates to everyone else, in three small queries. */
export async function graphOf(userId: string, tx: Db = db): Promise<Graph> {
  const g: Graph = { friends: new Set(), family: new Set(), close: new Set(), following: new Set(), blocked: new Set(), asked: new Set(), askedMe: new Set() };
  const fr = await tx.select().from(appFriendships).where(or(eq(appFriendships.requesterId, userId), eq(appFriendships.addresseeId, userId)));
  for (const f of fr) {
    const mine = f.requesterId === userId;
    const other = mine ? f.addresseeId : f.requesterId;
    if (f.status === "accepted") {
      g.friends.add(other);
      const tag = mine ? f.requesterTag : f.addresseeTag;
      const theirs = mine ? f.addresseeTag : f.requesterTag;
      if (tag === "family" || theirs === "family") g.family.add(other);
      if (tag === "close") g.close.add(other);
    } else if (mine) g.asked.add(other);
    else g.askedMe.add(other);
  }
  const fo = await tx.select({ id: appFollows.followeeId }).from(appFollows).where(eq(appFollows.followerId, userId));
  fo.forEach((f) => g.following.add(f.id));
  const bl = await tx.select().from(appBlocks).where(or(eq(appBlocks.blockerId, userId), eq(appBlocks.blockedId, userId)));
  bl.forEach((b) => g.blocked.add(b.blockerId === userId ? b.blockedId : b.blockerId));
  for (const b of g.blocked) { g.askedMe.delete(b); g.asked.delete(b); }
  return g;
}

export function relationOf(g: Graph, me: string, other: string): SocialRelation {
  if (other === me) return "you";
  if (g.family.has(other)) return "family";
  if (g.friends.has(other)) return "friend";
  if (g.following.has(other)) return "following";
  return "mada";
}

/** Either side blocked the other. */
export async function isBlocked(a: string, b: string, tx: Db = db): Promise<boolean> {
  const rows = await tx.select({ x: appBlocks.blockerId }).from(appBlocks)
    .where(or(and(eq(appBlocks.blockerId, a), eq(appBlocks.blockedId, b)), and(eq(appBlocks.blockerId, b), eq(appBlocks.blockedId, a)))).limit(1);
  return rows.length > 0;
}

export async function mutualCounts(me: string, others: string[], tx: Db = db): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  const ids = [...new Set(others)].filter((o) => o !== me);
  if (!ids.length) return out;
  const mine = (await graphOf(me, tx)).friends;
  const rows = await tx.select({ r: appFriendships.requesterId, a: appFriendships.addresseeId }).from(appFriendships)
    .where(and(eq(appFriendships.status, "accepted"), or(inArray(appFriendships.requesterId, ids), inArray(appFriendships.addresseeId, ids))));
  for (const id of ids) out.set(id, 0);
  for (const f of rows) {
    for (const [x, y] of [[f.r, f.a], [f.a, f.r]] as const) if (out.has(x) && mine.has(y)) out.set(x, out.get(x)! + 1);
  }
  return out;
}

/* ───────────── trips (read only; the booking screens own them) ───────────── */

const tripLine = (city: string, from: string, to: string | null) => `${city} · ${rangeLabel(from, to)}`;
export const tripDates = (from: string, to: string | null) => rangeLabel(from, to);
/** "Mar 27": a stamp's date. */
export const stampMonth = (iso: string) => `${monthOf(iso).toUpperCase()} ${iso.slice(2, 4)}`;

/** The trip someone is on or going on next: city and dates. */
export async function nextTrip(userId: string, tx: Db = db) {
  const today = todayIn();
  const [trip] = await tx.select({ id: appTrips.id, city: appTrips.city, country: appTrips.country, startDate: appTrips.startDate, endDate: appTrips.endDate })
    .from(appTrips)
    .where(and(eq(appTrips.ownerId, userId), sql`${appTrips.status} <> 'cancelled'`, or(gt(appTrips.endDate, addDays(today, -1)), and(isNull(appTrips.endDate), sql`${appTrips.startDate} >= ${today}`))))
    .orderBy(appTrips.startDate).limit(1);
  return trip ? { ...trip, line: tripLine(trip.city, trip.startDate, trip.endDate), dates: tripDates(trip.startDate, trip.endDate) } : null;
}
export async function circleTrip(tripId: string | null, tx: Db = db) {
  if (!tripId) return null;
  const [trip] = await tx.select({ city: appTrips.city, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(eq(appTrips.id, tripId));
  return trip ? tripLine(trip.city, trip.startDate, trip.endDate) : null;
}

/** Trips taken (finished, not cancelled), for stamps and "places explored". */
export async function pastTrips(userIds: string[], tx: Db = db) {
  if (!userIds.length) return [];
  const today = todayIn();
  return tx.select({ ownerId: appTrips.ownerId, city: appTrips.city, country: appTrips.country, endDate: appTrips.endDate, startDate: appTrips.startDate })
    .from(appTrips)
    .where(and(inArray(appTrips.ownerId, userIds), sql`${appTrips.status} <> 'cancelled'`, sql`coalesce(${appTrips.endDate}, ${appTrips.startDate}) < ${today}`))
    .orderBy(sql`coalesce(${appTrips.endDate}, ${appTrips.startDate}) desc`);
}

/* ───────────── notifications ───────────── */

export async function notify(tx: Db, userId: string, kind: string, title: [CopyKey, Vars?], body: [CopyKey, Vars?], href: string | null, data: Record<string, unknown> | null = null) {
  await tx.insert(appNotifications).values({ userId, kind, level: "passive", title: t(title[0], title[1]), body: t(body[0], body[1]), href, data });
}

export const sar = (halalas: number) => `SAR ${(halalas / 100).toLocaleString("en-US", { minimumFractionDigits: halalas % 100 ? 2 : 0, maximumFractionDigits: 2 })}`;
