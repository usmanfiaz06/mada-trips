import "server-only";
import { assertNotLimited } from "../limits";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  CreateCircleRequest, REACTIONS, SharedCard, isLocale, planById, t,
  type CircleDetail, type CircleMessage, type CircleSummary, type IncomingInvite, type MessageAuthor, type PersonRef, type SysEvent, type UpdateCircleRequest,
} from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appCircles, appMessages, appNotifications, appTrips, appUsers } from "@/db/app-schema";
import { appCircleDetails, appCircleInvites, appCircleReactions, appCircleSplitShares, appCircleVotes, appBlocks, appFriendships } from "@/db/app-schema-circles";
import { appAuditLog, auditInsert } from "../audit";
import { atOnce } from "../batch";
import { withCopy } from "../notify-copy";
import { AppError } from "../http";
import { coverColumns, coverFor, dropReplacedUpload, settleCovers, settled } from "./covers";
import { err, graphOf, liveUser, peopleByIds, relationOf, tripLine, type Db } from "./common";

/*
 * Circles: who is in one, what it is called, where it's going, and its chat's building blocks. Every read and write
 * checks membership first; a circle you aren't in doesn't exist for you (404, never 403, so ids can't be probed).
 */

export type MessageRow = typeof appMessages.$inferSelect;
type Card = Record<string, unknown> & { t?: string };

export async function membership(circleId: string, userId: string, tx: Db = db) {
  const [m] = await tx.select({ role: appCircleMembers.role, muted: appCircleMembers.muted, lastReadAt: appCircleMembers.lastReadAt, joinedAt: appCircleMembers.joinedAt, name: appCircles.name, tripId: appCircles.tripId, createdBy: appCircles.createdBy })
    .from(appCircleMembers).innerJoin(appCircles, eq(appCircles.id, appCircleMembers.circleId))
    .where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, userId)));
  if (!m) throw err("NOT_FOUND", "circles.err.notMember");
  return m;
}
export async function requireAdmin(circleId: string, userId: string, tx: Db = db) {
  const m = await membership(circleId, userId, tx);
  if (m.role !== "admin") throw err("FORBIDDEN", "circles.err.adminOnly");
  return m;
}
export async function memberIds(circleId: string, tx: Db = db): Promise<string[]> {
  const rows = await tx.select({ id: appCircleMembers.userId }).from(appCircleMembers).where(eq(appCircleMembers.circleId, circleId)).orderBy(asc(appCircleMembers.joinedAt));
  return rows.map((r) => r.id);
}
export async function details(circleId: string, tx: Db = db) {
  const [d] = await tx.select().from(appCircleDetails).where(eq(appCircleDetails.circleId, circleId));
  return d ?? { circleId, cover: null, coverKind: null, coverIcon: null, coverColor: null, coverFileId: null, coverStatus: null, coverBy: null, coverAutoApproveAt: null, coverCheckedAt: null, coverCheckedBy: null, coverNote: null, dest: null, dm: false, dmKey: null, pinnedPlan: null, pinnedBy: null, createdAt: new Date() };
}

/* ───────────── messages: writing and reading ───────────── */

/** Message times in whole milliseconds, strictly increasing in this process, so a chat's order is its insert order
 *  and a cursor (which carries milliseconds) never skips or repeats a message. */
let lastAt = 0;
const nextAt = () => { lastAt = Math.max(Date.now(), lastAt + 1); return new Date(lastAt); };

export async function addMessage(tx: Db, circleId: string, m: { author: "user" | "mada" | "agent"; userId?: string | null; agentName?: string | null; body: string; card?: Card | null; at?: Date }) {
  const [row] = await tx.insert(appMessages).values({
    threadKind: "circle", threadId: circleId, authorKind: m.author, authorUserId: m.userId ?? null, authorName: m.agentName ?? null,
    body: m.body.slice(0, 4000), card: m.card ?? null, createdAt: m.at ?? nextAt(),
  }).returning();
  await tx.update(appCircles).set({ updatedAt: new Date() }).where(eq(appCircles.id, circleId));
  return row!;
}
/** A system line as writes (the message and the circle's updated_at), to send with others in one statement. */
export function sysMessageWrites(tx: Db, circleId: string, event: SysEvent, actor: string | null, users: string[] = []) {
  return [
    tx.insert(appMessages).values({ threadKind: "circle", threadId: circleId, authorKind: "mada", body: event, card: { t: "sys", event, actor, users, text: null, amount: null }, createdAt: nextAt() }),
    tx.update(appCircles).set({ updatedAt: new Date() }).where(eq(appCircles.id, circleId)),
  ];
}
/** A line like "Abdullah joined". Words are chosen by each reader's app (it says "You joined" to Abdullah). */
export function sysMessage(tx: Db, circleId: string, event: SysEvent, actor: string | null, users: string[] = [], extra: { text?: string; amount?: number; fallback?: string } = {}) {
  return addMessage(tx, circleId, { author: "mada", body: extra.fallback ?? event, card: { t: "sys", event, actor, users, text: extra.text ?? null, amount: extra.amount ?? null } });
}

export async function toMessages(rows: MessageRow[], tx: Db = db): Promise<CircleMessage[]> {
  if (!rows.length) return [];
  const voteIds = rows.filter((r) => (r.card as Card | null)?.t === "vote").map((r) => r.id);
  const splitIds = rows.filter((r) => (r.card as Card | null)?.t === "split").map((r) => r.id);
  // Independent reads, side by side (each is a round trip to the database).
  const [votes, shares, people, reacts] = await Promise.all([
    voteIds.length ? tx.select().from(appCircleVotes).where(inArray(appCircleVotes.messageId, voteIds)).orderBy(asc(appCircleVotes.createdAt)) : Promise.resolve([]),
    splitIds.length ? tx.select().from(appCircleSplitShares).where(inArray(appCircleSplitShares.messageId, splitIds)) : Promise.resolve([]),
    peopleByIds(rows.map((r) => r.authorUserId).filter((x): x is string => !!x), tx),
    tx.select().from(appCircleReactions).where(inArray(appCircleReactions.messageId, rows.map((r) => r.id))).orderBy(asc(appCircleReactions.createdAt)),
  ]);
  const order = REACTIONS as readonly string[];
  const reactionsOf = (mid: string) => {
    const mine = reacts.filter((x) => x.messageId === mid);
    return [...new Set(mine.map((x) => x.emoji))].sort((a, b) => order.indexOf(a) - order.indexOf(b))
      .map((emoji) => ({ emoji, ids: mine.filter((x) => x.emoji === emoji).map((x) => x.userId) }));
  };
  return rows.map((r) => {
    const c = (r.card ?? {}) as Card;
    const kind = (["sys", "vote", "split", "card", "mada"].includes(String(c.t)) ? c.t : r.authorKind === "mada" ? "mada" : "text") as CircleMessage["kind"];
    const author: MessageAuthor = r.authorKind === "user" && r.authorUserId
      ? { kind: "user", id: r.authorUserId, name: people.get(r.authorUserId)?.short ?? t("circles.someone") }
      : r.authorKind === "agent" ? { kind: "agent", id: r.authorOpsUserId ?? "agent", name: r.authorName ?? "", photoUrl: null } : { kind: "mada" };
    const msg: CircleMessage = {
      id: r.id, circleId: r.threadId, author, body: r.body, createdAt: r.createdAt.toISOString(), kind,
      sys: null, vote: null, split: null, card: null, mada: null, reactions: reactionsOf(r.id),
    };
    if (kind === "sys") msg.sys = { event: c.event as SysEvent, actor: (c.actor as string | null) ?? null, users: (c.users as string[]) ?? [], text: (c.text as string | null) ?? null, amount: (c.amount as number | null) ?? null };
    if (kind === "vote") {
      const opts = (c.options as { id: string; label: string }[]) ?? [];
      const mine = votes.filter((v) => v.messageId === r.id);
      msg.vote = { q: String(c.q ?? r.body), kind: (c.kind as "dates" | "places" | "any") ?? "any", closed: !!c.closed, winner: (c.winner as string | null) ?? null, options: opts.map((o) => ({ ...o, votes: mine.filter((v) => v.optionId === o.id).map((v) => v.userId) })) };
    }
    if (kind === "split") {
      const sh = shares.filter((s) => s.messageId === r.id);
      const order = (c.order as string[] | undefined) ?? sh.map((s) => s.key);
      sh.sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key));
      msg.split = {
        what: String(c.what ?? r.body), total: Number(c.total ?? 0), paidBy: String(c.paidBy), mode: (c.mode as "equal" | "family" | "custom") ?? "equal", reminded: !!c.remindedAt && Date.now() - Date.parse(String(c.remindedAt)) < 20 * 3600_000,
        settled: sh.length > 0 && sh.every((s) => !!s.paidAt), withdrawn: !!c.withdrawn,
        shares: sh.map((s) => ({ key: s.key, ids: s.userIds, amount: Number(s.amount), paid: !!s.paidAt, paidAt: s.paidAt?.toISOString() ?? null })),
      };
    }
    if (kind === "card") { const p = SharedCard.safeParse(c.card); msg.card = p.success ? p.data : null; }
    if (kind === "mada") {
      msg.mada = {
        kind: (c.kind as "welcome" | "answer" | "result" | "tie") ?? "answer", list: (c.list as string[]) ?? [], foot: (c.foot as string | null) ?? null,
        actions: (c.actions as never[]) ?? [], askWhere: !!c.askWhere, ref: (c.ref as string | null) ?? null, done: !!c.done,
      };
    }
    return msg;
  });
}

/* ───────────── list and detail ───────────── */

export async function listCircles(userId: string, opts: { only?: string } = {}): Promise<{ circles: CircleSummary[]; incoming: IncomingInvite[] }> {
  return (await circleSummaries(userId, opts)).out;
}

/**
 * The circles list, in three rounds of reads run side by side (the database is far from the functions on staging, so
 * every sequential query costs ~0.45 s). `only`: just that circle, and no incoming invites (the circle screen).
 */
async function circleSummaries(userId: string, opts: { only?: string } = {}) {
  const mineQ = db.select({ id: appCircles.id, name: appCircles.name, tripId: appCircles.tripId, createdBy: appCircles.createdBy, createdAt: appCircles.createdAt, updatedAt: appCircles.updatedAt, role: appCircleMembers.role, muted: appCircleMembers.muted, lastReadAt: appCircleMembers.lastReadAt })
    .from(appCircleMembers).innerJoin(appCircles, eq(appCircles.id, appCircleMembers.circleId))
    .where(opts.only ? and(eq(appCircleMembers.userId, userId), eq(appCircleMembers.circleId, opts.only)) : eq(appCircleMembers.userId, userId)).orderBy(desc(appCircles.updatedAt));
  const rest = (ids: string[]) => Promise.all([
    db.select().from(appCircleMembers).where(inArray(appCircleMembers.circleId, ids)).orderBy(asc(appCircleMembers.joinedAt)),
    db.select().from(appCircleDetails).where(inArray(appCircleDetails.circleId, ids)),
    db.select({ circleId: appCircleInvites.circleId, n: sql<number>`count(*)::int` }).from(appCircleInvites)
      .where(and(inArray(appCircleInvites.circleId, ids), eq(appCircleInvites.status, "pending"), eq(appCircleInvites.channel, "app"), sql`${appCircleInvites.expiresAt} > now()`)).groupBy(appCircleInvites.circleId),
    // Each circle's last message (not Mada's welcome), whole rows in one query.
    db.selectDistinctOn([appMessages.threadId]).from(appMessages)
      .where(and(eq(appMessages.threadKind, "circle"), inArray(appMessages.threadId, ids), sql`NOT (coalesce(${appMessages.card}->>'t', '') = 'mada' AND coalesce(${appMessages.card}->>'kind', '') = 'welcome')`))
      .orderBy(appMessages.threadId, desc(appMessages.createdAt), desc(appMessages.id)),
    db.execute<{ thread_id: string; n: number }>(sql`SELECT m.thread_id, count(*)::int AS n FROM app_messages m JOIN app_circle_members cm ON cm.circle_id = m.thread_id AND cm.user_id = ${userId}
      WHERE m.thread_kind = 'circle' AND m.thread_id IN ${ids} AND m.created_at > coalesce(cm.last_read_at, cm.joined_at) AND m.author_user_id IS DISTINCT FROM ${userId} AND coalesce(m.card->>'t', '') <> 'sys' AND coalesce(m.card->>'kind', '') <> 'welcome' GROUP BY m.thread_id`),
    db.select({ id: appTrips.id, city: appTrips.city, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips)
      .where(inArray(appTrips.id, db.select({ id: sql<string>`${appCircles.tripId}` }).from(appCircles).where(inArray(appCircles.id, ids)))),
  ]);
  let mine: Awaited<typeof mineQ>, incoming: IncomingInvite[] = [], got: Awaited<ReturnType<typeof rest>>;
  if (opts.only) {
    // One circle (its screen): its id is known, so everything is read in one round; none of it is used unless the
    // person is a member (mine), so nothing about a circle they aren't in leaves this function.
    [mine, , got] = await Promise.all([mineQ, settleCovers(), rest([opts.only])]);
    if (!mine.length) return { out: { circles: [] as CircleSummary[], incoming }, members: [], dets: [], people: new Map<string, PersonRef>() };
  } else {
    // Incoming invites take two rounds of their own: they run alongside the list, not before it.
    const incomingP = incomingInvites(userId);
    incomingP.catch(() => {});
    [mine] = await Promise.all([mineQ, settleCovers()]);
    if (!mine.length) return { out: { circles: [] as CircleSummary[], incoming: await incomingP }, members: [], dets: [], people: new Map<string, PersonRef>() };
    [got, incoming] = await Promise.all([rest(mine.map((c) => c.id)), incomingP]);
  }
  const [members, rawDets, invited, lastRows, unread, tripRows] = got;
  const dets = rawDets.map((d) => settled(d));
  const [lastMsgs, people] = await Promise.all([toMessages(lastRows), peopleByIds(members.map((m) => m.userId))]);
  const trips = new Map(tripRows.map((x) => [x.id, tripLine(x.city, x.startDate, x.endDate)]));
  const circles = mine.map((c): CircleSummary => {
    const ms = members.filter((m) => m.circleId === c.id);
    const d = dets.find((x) => x.circleId === c.id);
    const others = ms.filter((m) => m.userId !== userId);
    const dm = !!d?.dm;
    const last = lastMsgs.find((m) => m.circleId === c.id) ?? null;
    return {
      id: c.id, name: dm ? (people.get(others[0]?.userId ?? "")?.short ?? c.name) : c.name, imageUrl: null, tripId: c.tripId, role: c.role === "admin" ? "admin" : "member",
      memberCount: ms.length, muted: c.muted, unread: unread.find((u) => u.thread_id === c.id)?.n ?? 0, createdAt: c.createdAt.toISOString(),
      cover: dm ? null : coverFor(c.id, d, userId), dest: d?.dest ?? null, dm, trip: (c.tripId && trips.get(c.tripId)) || null,
      adminId: ms.find((m) => m.role === "admin")?.userId ?? null,
      preview: ms.slice(0, 3).map((m) => people.get(m.userId)!), invitedCount: invited.find((i) => i.circleId === c.id)?.n ?? 0,
      last, fresh: !c.lastReadAt && c.createdBy !== userId && !dm,
    };
  });
  return { out: { circles, incoming }, members, dets, people };
}

export async function incomingInvites(userId: string): Promise<IncomingInvite[]> {
  const rows = await db.select({ id: appCircleInvites.id, inviterId: appCircleInvites.inviterId, circleId: appCircleInvites.circleId, createdAt: appCircleInvites.createdAt, name: appCircles.name })
    .from(appCircleInvites).innerJoin(appCircles, eq(appCircles.id, appCircleInvites.circleId))
    .where(and(eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.status, "pending"), sql`${appCircleInvites.expiresAt} > now()`))
    .orderBy(desc(appCircleInvites.createdAt));
  if (!rows.length) return [];
  const circleIds = [...new Set(rows.map((r) => r.circleId!))];
  const [g, people, dets, counts] = await Promise.all([
    graphOf(userId),
    peopleByIds(rows.map((r) => r.inviterId)),
    db.select().from(appCircleDetails).where(inArray(appCircleDetails.circleId, circleIds)),
    db.select({ circleId: appCircleMembers.circleId, n: sql<number>`count(*)::int` }).from(appCircleMembers).where(inArray(appCircleMembers.circleId, circleIds)).groupBy(appCircleMembers.circleId),
  ]);
  return rows.filter((r) => !g.blocked.has(r.inviterId)).map((r) => ({
    inviteId: r.id, from: people.get(r.inviterId)!,
    circle: { id: r.circleId!, name: r.name, cover: coverFor(r.circleId!, dets.find((d) => d.circleId === r.circleId) ?? null, userId), memberCount: counts.find((c) => c.circleId === r.circleId)?.n ?? 0 },
    sentAt: r.createdAt.toISOString(),
  }));
}

export async function circleDetail(circleId: string, userId: string): Promise<CircleDetail> {
  // Membership is checked by the summary itself (only circles this person is in); the rest is read alongside it.
  const [sum, invites, g, fam] = await Promise.all([
    circleSummaries(userId, { only: circleId }),
    db.select().from(appCircleInvites)
      .where(and(eq(appCircleInvites.circleId, circleId), eq(appCircleInvites.status, "pending"), eq(appCircleInvites.channel, "app"), sql`${appCircleInvites.expiresAt} > now()`))
      .orderBy(asc(appCircleInvites.createdAt)),
    graphOf(userId),
    familyOfCircle(circleId),
  ]);
  const circle = sum.out.circles.find((c) => c.id === circleId);
  if (!circle) throw err("NOT_FOUND", "circles.err.notMember");
  const members = sum.members.filter((m) => m.circleId === circleId);
  const d = sum.dets.find((x) => x.circleId === circleId);
  const invitees = invites.map((i) => i.inviteeUserId).filter((x): x is string => !!x);
  const people = new Map(sum.people);
  const missing = invitees.filter((id) => !people.has(id));
  if (missing.length) for (const [k, v] of await peopleByIds(missing)) people.set(k, v);
  return {
    circle,
    members: members.map((m) => ({ ...people.get(m.userId)!, role: m.role === "admin" ? "admin" : "member", relation: relationOf(g, userId, m.userId), joinedAt: m.joinedAt.toISOString(), family: fam(m.userId, members.map((x) => x.userId)) })),
    invited: invites.filter((i) => i.inviteeUserId).map((i) => ({ inviteId: i.id, person: people.get(i.inviteeUserId!)!, sentAt: i.createdAt.toISOString(), remindedAt: i.remindedAt?.toISOString() ?? null })),
    pinned: d?.pinnedPlan && planById(d.pinnedPlan) ? { kind: "plan", id: d.pinnedPlan, by: d.pinnedBy } : null,
    reads: members.filter((m) => m.lastReadAt).map((m) => ({ userId: m.userId, at: m.lastReadAt!.toISOString() })),
  };
}

/**
 * Family groups in a circle, read in one query alongside the rest (members aren't known yet, so the ties are
 * between any two of its members). Same rule as familyOfFn in messages.ts: the earliest member heads each group.
 */
async function familyOfCircle(circleId: string) {
  const inCircle = sql`(SELECT user_id FROM app_circle_members WHERE circle_id = ${circleId})`;
  const ties = await db.select({ a: appFriendships.requesterId, b: appFriendships.addresseeId }).from(appFriendships)
    .where(and(eq(appFriendships.status, "accepted"), sql`${appFriendships.requesterId} IN ${inCircle}`, sql`${appFriendships.addresseeId} IN ${inCircle}`,
      or(eq(appFriendships.requesterTag, "family"), eq(appFriendships.addresseeTag, "family"))));
  return (who: string, members: string[]) => {
    const parent = new Map(members.map((m) => [m, m]));
    const find = (x: string): string => (parent.get(x) === x ? x : find(parent.get(x)!));
    for (const m of members) {
      const family = ties.flatMap((x) => (x.a === m ? [x.b] : x.b === m ? [x.a] : []));
      for (const o of family) if (parent.has(o)) { const a = find(m); const b = find(o); if (a !== b) parent.set(members.indexOf(a) < members.indexOf(b) ? b : a, members.indexOf(a) < members.indexOf(b) ? a : b); }
    }
    return parent.has(who) ? find(who) : who;
  };
}

/* ───────────── making and changing circles ───────────── */

/** People someone may add to a circle: anyone on Mada who hasn't blocked them, or been blocked. Two queries, together. */
export async function assertInvitable(userId: string, others: string[], tx: Db = db) {
  if (!others.length) return;
  if (others.includes(userId)) throw err("VALIDATION", "circles.err.self");
  const [live, blocks] = await Promise.all([
    tx.select({ id: appUsers.id }).from(appUsers).where(and(inArray(appUsers.id, others), isNull(appUsers.deletedAt))),
    tx.select({ a: appBlocks.blockerId, b: appBlocks.blockedId }).from(appBlocks)
      .where(or(and(eq(appBlocks.blockerId, userId), inArray(appBlocks.blockedId, others)), and(inArray(appBlocks.blockerId, others), eq(appBlocks.blockedId, userId)))),
  ]);
  const ok = new Set(live.map((u) => u.id));
  for (const b of blocks) ok.delete(b.a === userId ? b.b : b.a);
  if (others.some((o) => !ok.has(o))) throw new AppError("NOT_FOUND");
}

/** App invites to a circle and each person's inbox line (in their own language): a few multi-row writes, not one per person. */
export async function createCircleInvites(tx: Db, circleId: string, circleName: string, inviterId: string, userIds: string[]) {
  if (!userIds.length) return;
  const writes = invitesWrites(circleId, circleName, userIds, await inviteContext(inviterId, userIds, tx), tx);
  for (const w of writes) await w;
}

/** Who sends the invites (as invitees see them) and each invitee's language: read once, alongside other reads. */
async function inviteContext(inviterId: string, userIds: string[], tx: Db = db) {
  const [people, locales] = await Promise.all([
    peopleByIds([inviterId], tx),
    userIds.length ? tx.select({ id: appUsers.id, locale: appUsers.locale }).from(appUsers).where(inArray(appUsers.id, userIds)) : Promise.resolve([]),
  ]);
  return { inviter: people.get(inviterId)!, locales };
}

function invitesWrites(circleId: string, circleName: string, userIds: string[], ctx: Awaited<ReturnType<typeof inviteContext>>, tx: Db = db) {
  if (!userIds.length) return [];
  const expiresAt = new Date(Date.now() + 14 * 86_400_000);
  return [
    tx.insert(appCircleInvites).values(userIds.map((u) => ({ kind: "circle", circleId, inviterId: ctx.inviter.id, inviteeUserId: u, channel: "app", expiresAt }))),
    tx.insert(appNotifications).values(userIds.map((u) => {
      const l = ctx.locales.find((x) => x.id === u)?.locale ?? "en";
      const locale = isLocale(l) ? l : "en";
      return {
        userId: u, kind: "circle.invite", level: "passive", href: "/circles",
        title: t("notify.circles.invite.title", { name: ctx.inviter.short }, locale).slice(0, 64), body: t("notify.circles.invite.body", { circle: circleName }, locale),
        data: withCopy({ circleId }, { title: ["notify.circles.invite.title", { name: ctx.inviter.short }], body: ["notify.circles.invite.body", { circle: circleName }] }),
      };
    })),
  ];
}

export async function createCircle(userId: string, raw: unknown, ipHash: string | null): Promise<CircleDetail> {
  const input = CreateCircleRequest.parse(raw);
  const invite = [...new Set(input.invite)];
  // The checks and reads don't depend on each other: one round trip for all of them.
  const [, , dupe, coverCols, ctx] = await Promise.all([
    assertNotLimited(userId), // the desk paused Circles for this account (limits.ts)
    assertInvitable(userId, invite),
    db.select({ id: appCircles.id }).from(appCircles).innerJoin(appCircleMembers, eq(appCircleMembers.circleId, appCircles.id))
      .leftJoin(appCircleDetails, eq(appCircleDetails.circleId, appCircles.id))
      .where(and(eq(appCircleMembers.userId, userId), sql`lower(${appCircles.name}) = lower(${input.name})`, sql`coalesce(${appCircleDetails.dm}, false) = false`)).limit(1),
    coverColumns(input.cover ?? null, userId, null),
    invite.length ? inviteContext(userId, invite) : Promise.resolve(null),
  ]);
  if (dupe.length) throw err("VALIDATION", "circles.err.dupeName", { name: t("circles.err.dupeName") });
  const id = randomUUID();
  // The opening lines, in order: made, invited, Mada's welcome (a new circle's updated_at is now already).
  const sys = (event: SysEvent, users: string[] = []) => ({ threadKind: "circle", threadId: id, authorKind: "mada", body: event, card: { t: "sys", event, actor: userId, users, text: null, amount: null }, createdAt: nextAt() });
  // Everything the new circle is, in one statement (atomic, and one round trip instead of nine).
  await atOnce([
    db.insert(appCircles).values({ id, name: input.name, createdBy: userId }),
    db.insert(appCircleDetails).values({ circleId: id, ...coverCols, dest: input.dest ?? null }),
    db.insert(appCircleMembers).values({ circleId: id, userId, role: "admin", lastReadAt: new Date() }),
    db.insert(appMessages).values([
      sys("created"),
      ...(invite.length ? [sys("invited", invite)] : []),
      { threadKind: "circle", threadId: id, authorKind: "mada", body: "welcome", card: { t: "mada", kind: "welcome" }, createdAt: nextAt() },
    ]),
    ...(ctx ? invitesWrites(id, input.name, invite, ctx) : []),
    auditInsert({ actorKind: "user", actorId: userId, action: "circle.created", entityType: "circle", entityId: id, summary: `Made a circle and invited ${invite.length}`, ipHash }),
  ]);
  return circleDetail(id, userId);
}

export async function updateCircle(circleId: string, userId: string, patch: UpdateCircleRequest): Promise<CircleDetail> {
  const m = await membership(circleId, userId);
  const d = await details(circleId);
  if ((patch.name !== undefined || patch.cover !== undefined) && m.role !== "admin") throw err("FORBIDDEN", "circles.err.adminOnly");
  await db.transaction(async (tx) => {
    if (patch.name !== undefined && patch.name !== m.name) {
      await tx.update(appCircles).set({ name: patch.name, updatedAt: new Date() }).where(eq(appCircles.id, circleId));
      await sysMessage(tx, circleId, "renamed", userId, [], { text: patch.name });
    }
    const det: Partial<typeof appCircleDetails.$inferInsert> = {};
    if (patch.cover !== undefined) Object.assign(det, await coverColumns(patch.cover, userId, d, tx));
    if (patch.dest !== undefined) det.dest = patch.dest;
    if (patch.pin !== undefined) {
      if (patch.pin && !planById(patch.pin.id)) throw new AppError("VALIDATION", { fields: { pin: "Unknown plan" } });
      det.pinnedPlan = patch.pin?.id ?? null;
      det.pinnedBy = patch.pin ? userId : null;
      if (patch.pin && patch.pin.id !== d.pinnedPlan) await sysMessage(tx, circleId, "pinned", userId, [], { text: planById(patch.pin.id)!.title });
    }
    if (Object.keys(det).length) await tx.insert(appCircleDetails).values({ circleId, ...det }).onConflictDoUpdate({ target: appCircleDetails.circleId, set: det });
    if (patch.cover !== undefined) await dropReplacedUpload(tx, d, det);
    const mem: Partial<typeof appCircleMembers.$inferInsert> = {};
    if (patch.muted !== undefined) mem.muted = patch.muted;
    if (patch.read) mem.lastReadAt = new Date();
    if (Object.keys(mem).length) await tx.update(appCircleMembers).set(mem).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, userId)));
  });
  return circleDetail(circleId, userId);
}

async function dropCircle(tx: Db, circleId: string) {
  await tx.delete(appMessages).where(and(eq(appMessages.threadKind, "circle"), eq(appMessages.threadId, circleId)));
  await tx.delete(appCircles).where(eq(appCircles.id, circleId));
}

/** Delete for everyone: the admin only. Bookings stay with whoever made them (they live on trips, not here). */
export async function deleteCircle(circleId: string, userId: string, ipHash: string | null) {
  await requireAdmin(circleId, userId);
  await db.transaction(async (tx) => {
    const n = (await memberIds(circleId, tx)).length;
    await dropCircle(tx, circleId);
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "circle.deleted", entityType: "circle", entityId: circleId, summary: `Deleted a circle for all ${n}`, ipHash });
  });
}

/** Leave. The next person in becomes admin. The last one out deletes the circle and its invites. */
export async function leaveCircle(circleId: string, userId: string): Promise<{ deleted: boolean }> {
  const m = await membership(circleId, userId);
  return db.transaction(async (tx) => {
    const others = (await memberIds(circleId, tx)).filter((id) => id !== userId);
    if (!others.length) { await dropCircle(tx, circleId); return { deleted: true }; }
    await tx.delete(appCircleMembers).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, userId)));
    if (m.role === "admin") await tx.update(appCircleMembers).set({ role: "admin" }).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, others[0]!)));
    await sysMessage(tx, circleId, "left", userId);
    if (m.role === "admin") await sysMessage(tx, circleId, "admin", null, [others[0]!]);
    return { deleted: false };
  });
}

export async function makeAdmin(circleId: string, userId: string, target: string) {
  await requireAdmin(circleId, userId);
  await membership(circleId, target);
  await db.transaction(async (tx) => {
    await tx.update(appCircleMembers).set({ role: "member" }).where(and(eq(appCircleMembers.circleId, circleId), ne(appCircleMembers.userId, target)));
    await tx.update(appCircleMembers).set({ role: "admin" }).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, target)));
    await sysMessage(tx, circleId, "admin", userId, [target]);
  });
}

export async function removeMember(circleId: string, userId: string, target: string) {
  await requireAdmin(circleId, userId);
  if (target === userId) throw err("VALIDATION", "circles.err.self");
  await membership(circleId, target);
  await db.transaction(async (tx) => {
    await tx.delete(appCircleMembers).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, target)));
    await sysMessage(tx, circleId, "removed", userId, [target]);
  });
}

/** The one conversation between two friends. Made the first time either of them opens it. */
export async function openDm(userId: string, other: string): Promise<string> {
  await assertNotLimited(userId); // the desk paused Circles for this account (limits.ts)
  if (other === userId) throw err("VALIDATION", "circles.err.self");
  const g = await graphOf(userId);
  if (g.blocked.has(other) || !(await liveUser(other))) throw new AppError("NOT_FOUND");
  if (!g.friends.has(other)) throw err("FORBIDDEN", "circles.err.blocked");
  const key = [userId, other].sort().join(":");
  const [found] = await db.select({ id: appCircleDetails.circleId }).from(appCircleDetails).where(eq(appCircleDetails.dmKey, key));
  if (found) return found.id;
  const people = await peopleByIds([userId, other]);
  return db.transaction(async (tx) => {
    const [c] = await tx.insert(appCircles).values({ name: `${people.get(userId)!.short} and ${people.get(other)!.short}`, createdBy: userId }).returning({ id: appCircles.id });
    await tx.insert(appCircleDetails).values({ circleId: c!.id, dm: true, dmKey: key });
    await tx.insert(appCircleMembers).values([{ circleId: c!.id, userId, role: "admin" }, { circleId: c!.id, userId: other, role: "admin" }]);
    await sysMessage(tx, c!.id, "dm", null, [userId, other]);
    return c!.id;
  });
}

export const isDm = async (circleId: string, tx: Db = db) => (await details(circleId, tx)).dm;
