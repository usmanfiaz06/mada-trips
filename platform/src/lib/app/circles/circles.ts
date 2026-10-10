import "server-only";
import { and, asc, desc, eq, inArray, ne, sql } from "drizzle-orm";
import {
  CreateCircleRequest, CoverKey, SharedCard, planById, t,
  type CircleDetail, type CircleMessage, type CircleSummary, type IncomingInvite, type MessageAuthor, type SysEvent, type UpdateCircleRequest,
} from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appCircles, appMessages } from "@/db/app-schema";
import { appCircleDetails, appCircleInvites, appCircleSplitShares, appCircleVotes } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { circleTrip, err, graphOf, isBlocked, liveUser, notify, peopleByIds, relationOf, type Db } from "./common";

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
  return d ?? { circleId, cover: null, dest: null, dm: false, dmKey: null, pinnedPlan: null, pinnedBy: null, createdAt: new Date() };
}

/* ───────────── messages: writing and reading ───────────── */

export async function addMessage(tx: Db, circleId: string, m: { author: "user" | "mada" | "agent"; userId?: string | null; agentName?: string | null; body: string; card?: Card | null; at?: Date }) {
  const [row] = await tx.insert(appMessages).values({
    threadKind: "circle", threadId: circleId, authorKind: m.author, authorUserId: m.userId ?? null, authorName: m.agentName ?? null,
    body: m.body.slice(0, 4000), card: m.card ?? null, ...(m.at ? { createdAt: m.at } : {}),
  }).returning();
  await tx.update(appCircles).set({ updatedAt: new Date() }).where(eq(appCircles.id, circleId));
  return row!;
}
/** A line like "Abdullah joined". Words are chosen by each reader's app (it says "You joined" to Abdullah). */
export function sysMessage(tx: Db, circleId: string, event: SysEvent, actor: string | null, users: string[] = [], extra: { text?: string; amount?: number; fallback?: string } = {}) {
  return addMessage(tx, circleId, { author: "mada", body: extra.fallback ?? event, card: { t: "sys", event, actor, users, text: extra.text ?? null, amount: extra.amount ?? null } });
}

export async function toMessages(rows: MessageRow[], tx: Db = db): Promise<CircleMessage[]> {
  if (!rows.length) return [];
  const voteIds = rows.filter((r) => (r.card as Card | null)?.t === "vote").map((r) => r.id);
  const splitIds = rows.filter((r) => (r.card as Card | null)?.t === "split").map((r) => r.id);
  const votes = voteIds.length ? await tx.select().from(appCircleVotes).where(inArray(appCircleVotes.messageId, voteIds)).orderBy(asc(appCircleVotes.createdAt)) : [];
  const shares = splitIds.length ? await tx.select().from(appCircleSplitShares).where(inArray(appCircleSplitShares.messageId, splitIds)) : [];
  const people = await peopleByIds(rows.map((r) => r.authorUserId).filter((x): x is string => !!x), tx);
  return rows.map((r) => {
    const c = (r.card ?? {}) as Card;
    const kind = (["sys", "vote", "split", "card", "mada"].includes(String(c.t)) ? c.t : r.authorKind === "mada" ? "mada" : "text") as CircleMessage["kind"];
    const author: MessageAuthor = r.authorKind === "user" && r.authorUserId
      ? { kind: "user", id: r.authorUserId, name: people.get(r.authorUserId)?.short ?? t("circles.someone") }
      : r.authorKind === "agent" ? { kind: "agent", id: r.authorOpsUserId ?? "agent", name: r.authorName ?? "", photoUrl: null } : { kind: "mada" };
    const msg: CircleMessage = {
      id: r.id, circleId: r.threadId, author, body: r.body, createdAt: r.createdAt.toISOString(), kind,
      sys: null, vote: null, split: null, card: null, mada: null,
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
        settled: sh.length > 0 && sh.every((s) => !!s.paidAt),
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

export async function listCircles(userId: string): Promise<{ circles: CircleSummary[]; incoming: IncomingInvite[] }> {
  const mine = await db.select({ id: appCircles.id, name: appCircles.name, tripId: appCircles.tripId, createdBy: appCircles.createdBy, createdAt: appCircles.createdAt, updatedAt: appCircles.updatedAt, role: appCircleMembers.role, muted: appCircleMembers.muted, lastReadAt: appCircleMembers.lastReadAt })
    .from(appCircleMembers).innerJoin(appCircles, eq(appCircles.id, appCircleMembers.circleId))
    .where(eq(appCircleMembers.userId, userId)).orderBy(desc(appCircles.updatedAt));
  const incoming = await incomingInvites(userId);
  if (!mine.length) return { circles: [], incoming };
  const ids = mine.map((c) => c.id);
  const [members, dets, invited, lasts, unread] = await Promise.all([
    db.select().from(appCircleMembers).where(inArray(appCircleMembers.circleId, ids)).orderBy(asc(appCircleMembers.joinedAt)),
    db.select().from(appCircleDetails).where(inArray(appCircleDetails.circleId, ids)),
    db.select({ circleId: appCircleInvites.circleId, n: sql<number>`count(*)::int` }).from(appCircleInvites)
      .where(and(inArray(appCircleInvites.circleId, ids), eq(appCircleInvites.status, "pending"), eq(appCircleInvites.channel, "app"), sql`${appCircleInvites.expiresAt} > now()`)).groupBy(appCircleInvites.circleId),
    db.execute<{ id: string }>(sql`SELECT DISTINCT ON (thread_id) id FROM app_messages WHERE thread_kind = 'circle' AND thread_id IN ${ids} AND NOT (card->>'t' = 'mada' AND card->>'kind' = 'welcome') ORDER BY thread_id, created_at DESC, id DESC`),
    db.execute<{ thread_id: string; n: number }>(sql`SELECT m.thread_id, count(*)::int AS n FROM app_messages m JOIN app_circle_members cm ON cm.circle_id = m.thread_id AND cm.user_id = ${userId}
      WHERE m.thread_kind = 'circle' AND m.thread_id IN ${ids} AND m.created_at > coalesce(cm.last_read_at, cm.joined_at) AND m.author_user_id IS DISTINCT FROM ${userId} GROUP BY m.thread_id`),
  ]);
  const lastRows = lasts.length ? await db.select().from(appMessages).where(inArray(appMessages.id, lasts.map((l) => l.id))) : [];
  const lastMsgs = await toMessages(lastRows);
  const people = await peopleByIds(members.map((m) => m.userId));
  const trips = new Map(await Promise.all(mine.filter((c) => c.tripId).map(async (c) => [c.id, await circleTrip(c.tripId)] as const)));
  const circles = mine.map((c): CircleSummary => {
    const ms = members.filter((m) => m.circleId === c.id);
    const d = dets.find((x) => x.circleId === c.id);
    const others = ms.filter((m) => m.userId !== userId);
    const dm = !!d?.dm;
    const last = lastMsgs.find((m) => m.circleId === c.id) ?? null;
    return {
      id: c.id, name: dm ? (people.get(others[0]?.userId ?? "")?.short ?? c.name) : c.name, imageUrl: null, tripId: c.tripId, role: c.role === "admin" ? "admin" : "member",
      memberCount: ms.length, muted: c.muted, unread: unread.find((u) => u.thread_id === c.id)?.n ?? 0, createdAt: c.createdAt.toISOString(),
      cover: CoverKey.safeParse(d?.cover).success ? (d!.cover as CircleSummary["cover"]) : null, dest: d?.dest ?? null, dm, trip: trips.get(c.id) ?? null,
      adminId: ms.find((m) => m.role === "admin")?.userId ?? null,
      preview: ms.slice(0, 3).map((m) => people.get(m.userId)!), invitedCount: invited.find((i) => i.circleId === c.id)?.n ?? 0,
      last, fresh: !c.lastReadAt && c.createdBy !== userId && !dm,
    };
  });
  return { circles, incoming };
}

export async function incomingInvites(userId: string): Promise<IncomingInvite[]> {
  const rows = await db.select({ id: appCircleInvites.id, inviterId: appCircleInvites.inviterId, circleId: appCircleInvites.circleId, createdAt: appCircleInvites.createdAt, name: appCircles.name })
    .from(appCircleInvites).innerJoin(appCircles, eq(appCircles.id, appCircleInvites.circleId))
    .where(and(eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.status, "pending"), sql`${appCircleInvites.expiresAt} > now()`))
    .orderBy(desc(appCircleInvites.createdAt));
  if (!rows.length) return [];
  const g = await graphOf(userId);
  const visible = rows.filter((r) => !g.blocked.has(r.inviterId));
  const people = await peopleByIds(visible.map((r) => r.inviterId));
  const out: IncomingInvite[] = [];
  for (const r of visible) {
    const d = await details(r.circleId!);
    const count = (await memberIds(r.circleId!)).length;
    out.push({ inviteId: r.id, from: people.get(r.inviterId)!, circle: { id: r.circleId!, name: r.name, cover: (d.cover as IncomingInvite["circle"]["cover"]) ?? null, memberCount: count }, sentAt: r.createdAt.toISOString() });
  }
  return out;
}

export async function circleDetail(circleId: string, userId: string): Promise<CircleDetail> {
  await membership(circleId, userId);
  const { circles } = await listCircles(userId);
  const circle = circles.find((c) => c.id === circleId);
  if (!circle) throw new AppError("NOT_FOUND");
  const members = await db.select().from(appCircleMembers).where(eq(appCircleMembers.circleId, circleId)).orderBy(asc(appCircleMembers.joinedAt));
  const invites = await db.select().from(appCircleInvites)
    .where(and(eq(appCircleInvites.circleId, circleId), eq(appCircleInvites.status, "pending"), eq(appCircleInvites.channel, "app"), sql`${appCircleInvites.expiresAt} > now()`))
    .orderBy(asc(appCircleInvites.createdAt));
  const people = await peopleByIds([...members.map((m) => m.userId), ...invites.map((i) => i.inviteeUserId!).filter(Boolean)]);
  const g = await graphOf(userId);
  const d = await details(circleId);
  return {
    circle,
    members: members.map((m) => ({ ...people.get(m.userId)!, role: m.role === "admin" ? "admin" : "member", relation: relationOf(g, userId, m.userId), joinedAt: m.joinedAt.toISOString() })),
    invited: invites.filter((i) => i.inviteeUserId).map((i) => ({ inviteId: i.id, person: people.get(i.inviteeUserId!)!, sentAt: i.createdAt.toISOString(), remindedAt: i.remindedAt?.toISOString() ?? null })),
    pinned: d.pinnedPlan && planById(d.pinnedPlan) ? { kind: "plan", id: d.pinnedPlan, by: d.pinnedBy } : null,
    reads: members.filter((m) => m.lastReadAt).map((m) => ({ userId: m.userId, at: m.lastReadAt!.toISOString() })),
  };
}

/* ───────────── making and changing circles ───────────── */

/** People someone may add to a circle: anyone on Mada who hasn't blocked them, or been blocked. */
export async function assertInvitable(userId: string, others: string[], tx: Db = db) {
  for (const o of others) {
    if (o === userId) throw err("VALIDATION", "circles.err.self");
    if (!(await liveUser(o, tx)) || (await isBlocked(userId, o, tx))) throw new AppError("NOT_FOUND");
  }
}

export async function createCircleInvites(tx: Db, circleId: string, circleName: string, inviterId: string, userIds: string[]) {
  if (!userIds.length) return;
  const inviter = (await peopleByIds([inviterId], tx)).get(inviterId)!;
  const expiresAt = new Date(Date.now() + 14 * 86_400_000);
  for (const u of userIds) {
    await tx.insert(appCircleInvites).values({ kind: "circle", circleId, inviterId, inviteeUserId: u, channel: "app", expiresAt });
    await notify(tx, u, "circle.invite", ["notify.circles.invite.title", { name: inviter.short }], ["notify.circles.invite.body", { circle: circleName }], "/circles", { circleId });
  }
}

export async function createCircle(userId: string, raw: unknown, ipHash: string | null): Promise<CircleDetail> {
  const input = CreateCircleRequest.parse(raw);
  const invite = [...new Set(input.invite)];
  await assertInvitable(userId, invite);
  const id = await db.transaction(async (tx) => {
    const dupe = await tx.select({ id: appCircles.id }).from(appCircles).innerJoin(appCircleMembers, eq(appCircleMembers.circleId, appCircles.id))
      .leftJoin(appCircleDetails, eq(appCircleDetails.circleId, appCircles.id))
      .where(and(eq(appCircleMembers.userId, userId), sql`lower(${appCircles.name}) = lower(${input.name})`, sql`coalesce(${appCircleDetails.dm}, false) = false`)).limit(1);
    if (dupe.length) throw err("VALIDATION", "circles.err.dupeName", { name: t("circles.err.dupeName") });
    const [c] = await tx.insert(appCircles).values({ name: input.name, createdBy: userId }).returning({ id: appCircles.id });
    await tx.insert(appCircleDetails).values({ circleId: c!.id, cover: input.cover ?? null, dest: input.dest ?? null });
    await tx.insert(appCircleMembers).values({ circleId: c!.id, userId, role: "admin", lastReadAt: new Date() });
    await sysMessage(tx, c!.id, "created", userId);
    if (invite.length) {
      await createCircleInvites(tx, c!.id, input.name, userId, invite);
      await sysMessage(tx, c!.id, "invited", userId, invite);
    }
    await addMessage(tx, c!.id, { author: "mada", body: "welcome", card: { t: "mada", kind: "welcome" } });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "circle.created", entityType: "circle", entityId: c!.id, summary: `Made a circle and invited ${invite.length}`, ipHash });
    return c!.id;
  });
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
    if (patch.cover !== undefined) det.cover = patch.cover;
    if (patch.dest !== undefined) det.dest = patch.dest;
    if (patch.pin !== undefined) {
      if (patch.pin && !planById(patch.pin.id)) throw new AppError("VALIDATION", { fields: { pin: "Unknown plan" } });
      det.pinnedPlan = patch.pin?.id ?? null;
      det.pinnedBy = patch.pin ? userId : null;
      if (patch.pin && patch.pin.id !== d.pinnedPlan) await sysMessage(tx, circleId, "pinned", userId, [], { text: planById(patch.pin.id)!.title });
    }
    if (Object.keys(det).length) await tx.insert(appCircleDetails).values({ circleId, ...det }).onConflictDoUpdate({ target: appCircleDetails.circleId, set: det });
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
