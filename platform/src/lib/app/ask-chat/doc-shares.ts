import "server-only";
import { and, eq, isNull, lte, inArray } from "drizzle-orm";
import { endingOf, firstNameOf, nameIn, rangeLabel, t, type AskShare, type ChatShareCard, type Lang } from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appPeople, appTrips, appUsers } from "@/db/app-schema";
import { appFriendships } from "@/db/app-schema-circles";
import { appDocShareRequests } from "@/db/app-schema-ask";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { notify } from "../trips/notify";

/*
 * "Share your passport for this trip?" (docs/app/ASK-INTEGRATED.md §5.4, §12.2). A companion with their own Mada account
 * keeps their passport in their own wallet. The trip owner asks (request_document_share shows a card; the request goes
 * only on the owner's tap, since it tells the companion about the trip), the companion answers with a tap in their app,
 * and the owner then sees the passport only as its last two characters and expiry, until the trip ends + 7 days.
 * Nothing is copied into the owner's household.
 */

const DAY = 86_400_000;
type ShareRow = typeof appDocShareRequests.$inferSelect;

async function firstName(userId: string): Promise<string> {
  const [u] = await db.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, userId));
  return firstNameOf(u?.name ?? "") || "";
}

/** A friend, or someone in one of the caller's circles. Nobody else can be asked. */
export async function knows(ownerId: string, userId: string): Promise<boolean> {
  if (ownerId === userId) return false;
  const [f] = await db.select({ id: appFriendships.id }).from(appFriendships).where(and(eq(appFriendships.status, "accepted"),
    inArray(appFriendships.requesterId, [ownerId, userId]), inArray(appFriendships.addresseeId, [ownerId, userId]))).limit(1);
  if (f) return true;
  const mine = await db.select({ circleId: appCircleMembers.circleId }).from(appCircleMembers).where(eq(appCircleMembers.userId, ownerId));
  if (!mine.length) return false;
  const [c] = await db.select({ circleId: appCircleMembers.circleId }).from(appCircleMembers)
    .where(and(eq(appCircleMembers.userId, userId), inArray(appCircleMembers.circleId, mine.map((m) => m.circleId)))).limit(1);
  return !!c;
}

async function tripLine(tripId: string | null, lang: Lang): Promise<string | null> {
  if (!tripId) return null;
  const [tr] = await db.select({ city: appTrips.city, title: appTrips.title, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(eq(appTrips.id, tripId));
  if (!tr) return null;
  return `${tr.title ?? nameIn(tr.city, lang)} · ${rangeLabel(tr.startDate, tr.endDate, lang)}`;
}

export async function shareCard(row: ShareRow, lang: Lang): Promise<ChatShareCard> {
  return { type: "doc_share", shareId: row.id, name: (await firstName(row.toUserId)) || "-", trip: await tripLine(row.tripId, lang), status: row.status as ChatShareCard["status"] };
}

/** The card for asking a companion (no request is sent yet): one draft per trip and person, reused. */
export async function draftShare(ownerId: string, input: { tripId: string; userId: string; threadId: string | null }): Promise<ShareRow> {
  const [trip] = await db.select({ id: appTrips.id, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, input.tripId), eq(appTrips.ownerId, ownerId)));
  if (!trip) throw new AppError("NOT_FOUND");
  if (!(await knows(ownerId, input.userId))) throw new AppError("NOT_FOUND");
  const [open] = await db.select().from(appDocShareRequests).where(and(eq(appDocShareRequests.ownerId, ownerId), eq(appDocShareRequests.tripId, trip.id), eq(appDocShareRequests.toUserId, input.userId), inArray(appDocShareRequests.status, ["draft", "sent", "shared"]))).limit(1);
  if (open) return open;
  const expiresAt = new Date(Date.parse(`${trip.endDate ?? trip.startDate}T23:59:59+03:00`) + 7 * DAY);
  const [row] = await db.insert(appDocShareRequests).values({ ownerId, toUserId: input.userId, tripId: trip.id, threadId: input.threadId, expiresAt }).returning();
  return row!;
}

async function ownShare(userId: string, id: string): Promise<ShareRow> {
  const [row] = await db.select().from(appDocShareRequests).where(eq(appDocShareRequests.id, id));
  if (!row || (row.ownerId !== userId && row.toUserId !== userId)) throw new AppError("NOT_FOUND");
  // The companion never sees a draft: it isn't a request until the owner sends it.
  if (row.toUserId === userId && row.ownerId !== userId && row.status === "draft") throw new AppError("NOT_FOUND");
  return row;
}

async function selfPassport(userId: string) {
  const [p] = await db.select({ id: appPeople.id, masked: appPeople.passportNumberMasked, expiry: appPeople.passportExpiry }).from(appPeople)
    .where(and(eq(appPeople.ownerId, userId), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt)));
  return p ?? null;
}

/** The request as the caller sees it: the other person's first name; once shared, the owner sees the mask and expiry. */
export async function getShare(userId: string, id: string, lang: Lang): Promise<AskShare> {
  const row = await ownShare(userId, id);
  const mine = row.ownerId === userId;
  const status = row.expiresAt.getTime() < Date.now() && row.status !== "declined" ? "expired" : row.status;
  const pp = mine && status === "shared" && row.personId ? (await db.select({ masked: appPeople.passportNumberMasked, expiry: appPeople.passportExpiry }).from(appPeople).where(eq(appPeople.id, row.personId)))[0] : null;
  return {
    id: row.id, status: status as AskShare["status"], name: (await firstName(mine ? row.toUserId : row.ownerId)) || "-",
    trip: await tripLine(row.tripId, lang), until: row.expiresAt.toISOString(), mine,
    ending: pp ? endingOf(pp.masked) : null, validTo: pp?.expiry ?? null,
  };
}

/** The owner's tap sends it; the companion's tap shares or declines. Each step is audited; nothing else changes. */
export async function answerShare(userId: string, id: string, action: "send" | "share" | "decline", lang: Lang, ipHash: string | null): Promise<AskShare> {
  const row = await ownShare(userId, id);
  if (row.expiresAt.getTime() < Date.now()) throw new AppError("NOT_FOUND", { copy: "share.status.expired" });
  const owner = row.ownerId === userId;
  const trip = (await tripLine(row.tripId, lang)) ?? t("share.tripFallback", undefined, lang);
  if (action === "send") {
    if (!owner) throw new AppError("FORBIDDEN");
    if (row.status === "draft") {
      await db.update(appDocShareRequests).set({ status: "sent", sentAt: new Date() }).where(eq(appDocShareRequests.id, id));
      await appAuditLog(db, { actorKind: "user", actorId: userId, action: "document.share_asked", entityType: "app_doc_share_request", entityId: id, summary: "Asked a companion to share their passport for a trip", data: { tripId: row.tripId }, ipHash });
      await notify(row.toUserId, { kind: "other", level: "active", copy: "notify.docShare", vars: { name: (await firstName(row.ownerId)) || "-", trip }, href: `/ask/share/${id}`, data: { shareId: id } });
    }
    return getShare(userId, id, lang);
  }
  if (owner && row.toUserId !== userId) throw new AppError("FORBIDDEN");
  if (row.status !== "sent") return getShare(userId, id, lang);
  if (action === "decline") {
    await db.update(appDocShareRequests).set({ status: "declined", answeredAt: new Date() }).where(eq(appDocShareRequests.id, id));
    await appAuditLog(db, { actorKind: "user", actorId: userId, action: "document.share_declined", entityType: "app_doc_share_request", entityId: id, summary: "Didn't share their passport for a trip", ipHash });
    return getShare(userId, id, lang);
  }
  const pp = await selfPassport(userId);
  if (!pp?.masked || !pp.expiry) throw new AppError("VALIDATION", { copy: "share.screen.noPassport", fields: { passport: "missing" } });
  await db.update(appDocShareRequests).set({ status: "shared", personId: pp.id, answeredAt: new Date() }).where(eq(appDocShareRequests.id, id));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "document.share_given", entityType: "app_doc_share_request", entityId: id, summary: `Shared their passport for a trip until ${row.expiresAt.toISOString().slice(0, 10)}`, data: { tripId: row.tripId }, ipHash });
  await notify(row.ownerId, { kind: "other", level: "active", copy: "notify.docShared", vars: { name: (await firstName(userId)) || "-", trip }, href: row.threadId ? `/ask/${row.threadId}` : null, data: { shareId: id } });
  return getShare(userId, id, lang);
}

/** For documents_on_file: what companions shared (or were asked) for this trip, by their user id. */
export async function sharesFor(ownerId: string, tripId: string | null, userIds: string[]): Promise<Map<string, { status: string; ending: string | null; validTo: string | null; name: string }>> {
  const out = new Map<string, { status: string; ending: string | null; validTo: string | null; name: string }>();
  if (!userIds.length) return out;
  const rows = await db.select().from(appDocShareRequests).where(and(eq(appDocShareRequests.ownerId, ownerId), inArray(appDocShareRequests.toUserId, userIds), ...(tripId ? [eq(appDocShareRequests.tripId, tripId)] : [])));
  for (const r of rows) {
    const expired = r.expiresAt.getTime() < Date.now();
    const pp = !expired && r.status === "shared" && r.personId ? (await db.select({ masked: appPeople.passportNumberMasked, expiry: appPeople.passportExpiry }).from(appPeople).where(eq(appPeople.id, r.personId)))[0] : null;
    out.set(r.toUserId, { status: expired ? "expired" : r.status, ending: pp ? endingOf(pp.masked) : null, validTo: pp?.expiry ?? null, name: (await firstName(r.toUserId)) || "-" });
  }
  return out;
}

/** Shares past their end are marked expired (the documents job). */
export async function expireShares(now = new Date()): Promise<number> {
  const rows = await db.update(appDocShareRequests).set({ status: "expired" }).where(and(inArray(appDocShareRequests.status, ["draft", "sent", "shared"]), lte(appDocShareRequests.expiresAt, now))).returning({ id: appDocShareRequests.id });
  return rows.length;
}
