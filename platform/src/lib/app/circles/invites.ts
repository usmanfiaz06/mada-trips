import "server-only";
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { and, desc, eq, inArray, isNotNull, ne, or, sql } from "drizzle-orm";
import {
  INVITE_TTL_DAYS, LIMITS, inviteUrl, maskPhone, t,
  type AcceptInviteResponse, type CreateInviteRequest, type InviteLink, type InvitePreview, type InvitesResponse, type PersonRef, type SentInvite,
} from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appCircles, appUsers } from "@/db/app-schema";
import { appCircleInvites, appFriendships } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { pepper } from "../config";
import { decryptField, encryptField, hasDataKey } from "../crypto";
import { AppError } from "../http";
import { suppliers } from "../suppliers";
import { createCircleInvites, details, incomingInvites, memberIds, membership, requireAdmin, assertInvitable, sysMessage } from "./circles";
import { assertUnder, circleTrip, err, graphOf, isBlocked, peopleByIds, sha256hex, type Db } from "./common";
import { currentLocale } from "../resilience/request";

/*
 * Invites. A link's code is "<lookup>-<mac>": the lookup finds the row, the mac (HMAC of the lookup with the server
 * pepper) proves the link came from us. Nothing secret is stored, codes can't be guessed, and the same link can be
 * shown again. Links last 14 days. Circle links let anyone with the link in; Mada links make you friends with the
 * person who sent it. Invites to someone already on Mada are addressed to them and wait for a yes.
 */

const ALPHA = "abcdefghjkmnpqrstuvwxyz23456789";
const rand = (n: number) => Array.from(randomBytes(n), (b) => ALPHA[b % ALPHA.length]).join("");
const mac = (lookup: string) => {
  const h = createHmac("sha256", pepper()).update(`invite:${lookup}`).digest();
  return Array.from(h.subarray(0, 6), (b) => ALPHA[b % ALPHA.length]).join("");
};
export const codeFor = (lookup: string) => `${lookup}-${mac(lookup)}`;
/** The row a code names, or null for anything we didn't issue. */
export function lookupOf(code: string): string | null {
  const m = /^([a-z0-9]{8})-([a-z0-9]{6})$/.exec(code.trim().toLowerCase());
  if (!m) return null;
  const a = Buffer.from(mac(m[1]!));
  const b = Buffer.from(m[2]!);
  return a.length === b.length && timingSafeEqual(a, b) ? m[1]! : null;
}
const expiry = () => new Date(Date.now() + INVITE_TTL_DAYS * 86_400_000);
const link = (lookup: string, expiresAt: Date): InviteLink => ({ code: codeFor(lookup), url: inviteUrl(codeFor(lookup)), expiresAt: expiresAt.toISOString() });
const phoneAad = (inviteId: string) => `app_circle_invites:${inviteId}:phone`;
export const phoneHash = (e164: string) => sha256hex(`${pepper()}:invite-phone:${e164}`);

async function invitesLastHour(userId: string, tx: Db = db) {
  const [r] = await tx.select({ n: sql<number>`count(*)::int` }).from(appCircleInvites)
    .where(and(eq(appCircleInvites.inviterId, userId), sql`${appCircleInvites.createdAt} > now() - interval '1 hour'`));
  return r?.n ?? 0;
}

/** The link to a circle (anyone in it may share it), or to Mada. The same link comes back until it expires. */
export async function linkFor(userId: string, circleId: string | null): Promise<InviteLink> {
  if (circleId) await membership(circleId, userId);
  const [found] = await db.select().from(appCircleInvites)
    .where(and(eq(appCircleInvites.inviterId, userId), eq(appCircleInvites.channel, "link"), eq(appCircleInvites.status, "pending"), isNotNull(appCircleInvites.lookup),
      circleId ? eq(appCircleInvites.circleId, circleId) : and(eq(appCircleInvites.kind, "mada"), sql`${appCircleInvites.circleId} IS NULL`),
      sql`${appCircleInvites.expiresAt} > now() + interval '1 day'`))
    .orderBy(desc(appCircleInvites.createdAt)).limit(1);
  if (found) return link(found.lookup!, found.expiresAt);
  assertUnder(await invitesLastHour(userId), LIMITS.invitesPerHour, 3600);
  const lookup = rand(8);
  const [row] = await db.insert(appCircleInvites).values({ kind: circleId ? "circle" : "mada", circleId, inviterId: userId, channel: "link", lookup, expiresAt: expiry() }).returning();
  return link(lookup, row!.expiresAt);
}

/** Invite a number to Mada by SMS or WhatsApp. Someone already on Mada comes back as a person to add instead. */
export async function inviteByPhone(userId: string, input: Extract<CreateInviteRequest, { phone: string }>, ipHash: string | null): Promise<{ invite: SentInvite | null; onMada: PersonRef | null }> {
  const [u] = await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, input.phone), sql`${appUsers.deletedAt} IS NULL`));
  if (u) {
    if (u.id === userId) throw err("VALIDATION", "circles.err.self");
    if (await isBlocked(userId, u.id)) return { invite: null, onMada: null };
    return { invite: null, onMada: (await peopleByIds([u.id])).get(u.id)! };
  }
  assertUnder(await invitesLastHour(userId), LIMITS.invitesPerHour, 3600);
  const channel = input.channel ?? "sms";
  const lookup = rand(8);
  const me = (await peopleByIds([userId])).get(userId)!;
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appCircleInvites).values({ kind: "mada", inviterId: userId, channel, lookup, phoneHash: phoneHash(input.phone), phoneMasked: maskPhone(input.phone), expiresAt: expiry() }).returning();
    if (hasDataKey()) await tx.update(appCircleInvites).set({ phoneEnc: encryptField(input.phone, phoneAad(r!.id)) }).where(eq(appCircleInvites.id, r!.id));
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "invite.sent", entityType: "invite", entityId: r!.id, summary: `Invited a number to Mada by ${channel}`, ipHash });
    return r!;
  });
  await send(channel, input.phone, me.short, codeFor(lookup), "sms.circles.invite");
  return { invite: toSent(row, new Map()), onMada: null };
}

async function send(channel: string, phone: string, name: string, code: string, key: "sms.circles.invite" | "sms.circles.remind") {
  try {
    if (channel === "whatsapp") await suppliers.whatsapp().sendTemplate(phone, "mada_invite", [name, inviteUrl(code)], currentLocale());
    else await suppliers.sms().send(phone, t(key, { name, url: inviteUrl(code) }));
  } catch (e) {
    console.error("[circles] invite message not sent", (e as Error).message);
  }
}

function toSent(r: typeof appCircleInvites.$inferSelect, people: Map<string, PersonRef>): SentInvite {
  const joined = r.acceptedBy ? people.get(r.acceptedBy) ?? null : null;
  const status = r.status === "accepted" ? "joined" : r.expiresAt.getTime() < Date.now() ? "expired" : "pending";
  return {
    id: r.id, label: joined?.short ?? r.phoneMasked ?? t("circles.someone"), channel: r.channel === "whatsapp" ? "whatsapp" : r.channel === "sms" ? "sms" : "link",
    status, sentAt: r.createdAt.toISOString(), remindedAt: r.remindedAt?.toISOString() ?? null, joined,
  };
}

export async function listInvites(userId: string): Promise<InvitesResponse> {
  const rows = await db.select().from(appCircleInvites)
    .where(and(eq(appCircleInvites.inviterId, userId), eq(appCircleInvites.kind, "mada"), ne(appCircleInvites.status, "cancelled"),
      or(inArray(appCircleInvites.channel, ["sms", "whatsapp"]), and(eq(appCircleInvites.channel, "link"), eq(appCircleInvites.status, "accepted")))))
    .orderBy(desc(appCircleInvites.createdAt)).limit(100);
  const people = await peopleByIds(rows.map((r) => r.acceptedBy).filter((x): x is string => !!x));
  const [own] = await db.select().from(appCircleInvites)
    .where(and(eq(appCircleInvites.inviterId, userId), eq(appCircleInvites.kind, "mada"), eq(appCircleInvites.channel, "link"), eq(appCircleInvites.status, "pending"), isNotNull(appCircleInvites.lookup), sql`${appCircleInvites.expiresAt} > now()`))
    .orderBy(desc(appCircleInvites.createdAt)).limit(1);
  return { sent: rows.map((r) => toSent(r, people)), incoming: await incomingInvites(userId), link: own ? link(own.lookup!, own.expiresAt) : null };
}

/** What anyone with the link sees. Members' first names only; nothing about trips beyond the circle's own line. */
export async function preview(code: string, viewerId: string | null): Promise<InvitePreview> {
  const lookup = lookupOf(code);
  if (!lookup) throw err("NOT_FOUND", "circles.join.notFound");
  const [r] = await db.select().from(appCircleInvites).where(eq(appCircleInvites.lookup, lookup));
  if (!r || (viewerId && (await isBlocked(viewerId, r.inviterId)))) throw err("NOT_FOUND", "circles.join.notFound");
  const from = (await peopleByIds([r.inviterId])).get(r.inviterId)!;
  const status = r.status === "cancelled" || r.status === "declined" ? "cancelled" : r.expiresAt.getTime() < Date.now() ? "expired" : "open";
  let circle: InvitePreview["circle"] = null;
  if (r.circleId) {
    const [c] = await db.select().from(appCircles).where(eq(appCircles.id, r.circleId));
    const ids = await memberIds(r.circleId);
    const people = await peopleByIds(ids.slice(0, 4));
    const d = await details(r.circleId);
    circle = { name: c!.name, cover: (d.cover as "istanbul" | "alula" | "riyadh" | null) ?? null, members: ids.slice(0, 4).map((i) => people.get(i)!), memberCount: ids.length, trip: await circleTrip(c!.tripId) };
  }
  return { code: codeFor(lookup), status, kind: r.circleId ? "circle" : "mada", from, circle };
}

async function befriend(tx: Db, a: string, b: string) {
  const [f] = await tx.select().from(appFriendships)
    .where(or(and(eq(appFriendships.requesterId, a), eq(appFriendships.addresseeId, b)), and(eq(appFriendships.requesterId, b), eq(appFriendships.addresseeId, a))));
  if (f) { if (f.status !== "accepted") await tx.update(appFriendships).set({ status: "accepted", acceptedAt: new Date() }).where(eq(appFriendships.id, f.id)); return; }
  await tx.insert(appFriendships).values({ requesterId: a, addresseeId: b, status: "accepted", acceptedAt: new Date() });
}

async function joinCircle(tx: Db, circleId: string, userId: string, via: { link?: string }) {
  await tx.insert(appCircleMembers).values({ circleId, userId, role: "member" }).onConflictDoNothing();
  await tx.update(appCircleInvites).set({ status: "accepted", acceptedBy: userId, respondedAt: new Date() })
    .where(and(eq(appCircleInvites.circleId, circleId), eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.status, "pending")));
  await sysMessage(tx, circleId, via.link ? "joinedByLink" : "joined", userId, via.link ? [via.link] : []);
}

/** Accept by link code (anyone signed in) or by invite id (the person it was addressed to). */
export async function accept(ref: string, userId: string, isId: boolean): Promise<AcceptInviteResponse> {
  const [r] = isId
    ? await db.select().from(appCircleInvites).where(and(eq(appCircleInvites.id, ref), eq(appCircleInvites.inviteeUserId, userId)))
    : await db.select().from(appCircleInvites).where(eq(appCircleInvites.lookup, lookupOf(ref) ?? "-"));
  if (!r || (await isBlocked(userId, r.inviterId))) throw err("NOT_FOUND", "circles.join.notFound");
  if (r.status === "cancelled" || r.status === "declined" || (isId && r.status !== "pending")) throw err("NOT_FOUND", "circles.err.inviteExpired");
  if (r.expiresAt.getTime() < Date.now()) throw err("NOT_FOUND", "circles.err.inviteExpired");
  if (r.inviterId === userId && !r.circleId) throw err("VALIDATION", "circles.err.self");
  return db.transaction(async (tx) => {
    if (r.circleId) {
      const ids = await memberIds(r.circleId, tx);
      if (ids.includes(userId)) return { circleId: r.circleId, friendId: null, already: true };
      await joinCircle(tx, r.circleId, userId, r.channel === "link" ? { link: r.inviterId } : {});
      return { circleId: r.circleId, friendId: null, already: false };
    }
    const g = await graphOf(userId, tx);
    const already = g.friends.has(r.inviterId);
    await befriend(tx, r.inviterId, userId);
    if (r.channel === "link") await tx.insert(appCircleInvites).values({ kind: "mada", inviterId: r.inviterId, channel: "link", status: "accepted", acceptedBy: userId, respondedAt: new Date(), expiresAt: r.expiresAt });
    else await tx.update(appCircleInvites).set({ status: "accepted", acceptedBy: userId, respondedAt: new Date() }).where(eq(appCircleInvites.id, r.id));
    return { circleId: null, friendId: r.inviterId, already };
  });
}

/** Say no to a circle invite. The person who sent it isn't told; it just stops showing. */
export async function decline(inviteId: string, userId: string) {
  const res = await db.update(appCircleInvites).set({ status: "declined", respondedAt: new Date() })
    .where(and(eq(appCircleInvites.id, inviteId), eq(appCircleInvites.inviteeUserId, userId), eq(appCircleInvites.status, "pending"))).returning({ id: appCircleInvites.id });
  if (!res.length) throw new AppError("NOT_FOUND");
}

async function ownInvite(inviteId: string, userId: string) {
  const [r] = await db.select().from(appCircleInvites).where(eq(appCircleInvites.id, inviteId));
  if (!r) throw new AppError("NOT_FOUND");
  if (r.inviterId !== userId) {
    if (!r.circleId) throw new AppError("NOT_FOUND");
    await requireAdmin(r.circleId, userId);
  }
  return r;
}

/** One reminder a day: a notification on Mada, or the SMS/WhatsApp again for someone not on Mada yet. */
export async function remind(inviteId: string, userId: string) {
  const r = await ownInvite(inviteId, userId);
  if (r.status !== "pending" || r.expiresAt.getTime() < Date.now()) throw err("NOT_FOUND", "circles.err.inviteExpired");
  if (r.remindedAt && Date.now() - r.remindedAt.getTime() < 20 * 3600_000) throw err("VALIDATION", "circles.err.alreadyReminded");
  await db.update(appCircleInvites).set({ remindedAt: new Date() }).where(eq(appCircleInvites.id, r.id));
  if (r.inviteeUserId && r.circleId) {
    const [c] = await db.select({ name: appCircles.name }).from(appCircles).where(eq(appCircles.id, r.circleId));
    const me = (await peopleByIds([userId])).get(userId)!;
    const { notify } = await import("./common");
    await notify(db, r.inviteeUserId, "circle.invite", ["notify.circles.invite.title", { name: me.short }], ["notify.circles.invite.body", { circle: c?.name ?? "" }], "/circles");
  }
  if (r.phoneEnc && r.lookup) {
    const me = (await peopleByIds([userId])).get(userId)!;
    await send(r.channel, decryptField(r.phoneEnc, phoneAad(r.id)), me.short, codeFor(r.lookup), "sms.circles.remind");
  }
}

/** Cancel: the link stops working. The person isn't told. */
export async function cancel(inviteId: string, userId: string) {
  const r = await ownInvite(inviteId, userId);
  await db.transaction(async (tx) => {
    await tx.update(appCircleInvites).set({ status: "cancelled", respondedAt: new Date() }).where(eq(appCircleInvites.id, r.id));
    if (r.circleId && r.inviteeUserId && r.status === "pending") await sysMessage(tx, r.circleId, "cancelledInvite", userId, [r.inviteeUserId]);
  });
}

/** Invite people on Mada to a circle (the admin). */
export async function inviteToCircle(circleId: string, userId: string, userIds: string[]) {
  const m = await requireAdmin(circleId, userId);
  const ids = [...new Set(userIds)];
  await assertInvitable(userId, ids);
  const members = await memberIds(circleId);
  const pending = await db.select({ id: appCircleInvites.inviteeUserId }).from(appCircleInvites)
    .where(and(eq(appCircleInvites.circleId, circleId), eq(appCircleInvites.status, "pending"), sql`${appCircleInvites.expiresAt} > now()`));
  const fresh = ids.filter((i) => !members.includes(i) && !pending.some((p) => p.id === i));
  if (!fresh.length) return;
  assertUnder(await invitesLastHour(userId), LIMITS.invitesPerHour, 3600);
  await db.transaction(async (tx) => {
    await createCircleInvites(tx, circleId, m.name, userId, fresh);
    await sysMessage(tx, circleId, "invited", userId, fresh);
  });
}
