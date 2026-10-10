import "server-only";
import { and, eq, or } from "drizzle-orm";
import { ReportRequest, type PersonRef } from "@mada/shared";
import { db } from "@/db";
import { appMessages } from "@/db/app-schema";
import { appBlocks, appCircleInvites, appFollows, appFriendships, appReports } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { membership } from "./circles";
import { err, liveUser, peopleByIds } from "./common";
import { getPost } from "./posts";

/*
 * Reports and blocks (App Store rules for user content). A report goes to a person within 24 hours. A block works
 * both ways at once: no friendship, no follows, no invites, they can't find or message you, and they aren't told.
 */

export async function report(me: string, raw: unknown, ipHash: string | null) {
  const r = ReportRequest.parse(raw);
  let targetUserId: string | null = null;
  if (r.targetKind === "user") {
    if (r.targetId === me || !(await liveUser(r.targetId))) throw new AppError("NOT_FOUND");
    targetUserId = r.targetId;
  } else if (r.targetKind === "post") {
    targetUserId = (await getPost(me, r.targetId)).author.id;
    if (targetUserId === me) throw err("VALIDATION", "circles.err.self");
  } else if (r.targetKind === "circle") {
    await membership(r.targetId, me);
  } else {
    const [m] = await db.select().from(appMessages).where(eq(appMessages.id, r.targetId));
    if (!m || m.threadKind !== "circle") throw new AppError("NOT_FOUND");
    await membership(m.threadId, me);
    targetUserId = m.authorUserId;
  }
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(appReports).values({ reporterId: me, targetKind: r.targetKind, targetId: r.targetId, targetUserId, reason: r.reason, note: r.note ?? null }).returning({ id: appReports.id });
    await appAuditLog(tx, { actorKind: "user", actorId: me, action: "report.created", entityType: r.targetKind, entityId: r.targetId, summary: `Reported a ${r.targetKind}: ${r.reason}`, data: { reportId: row!.id }, ipHash });
  });
  if (r.block && targetUserId && targetUserId !== me) await block(me, targetUserId, ipHash);
}

export async function block(me: string, other: string, ipHash: string | null) {
  if (other === me) throw err("VALIDATION", "circles.err.self");
  if (!(await liveUser(other))) throw new AppError("NOT_FOUND");
  await db.transaction(async (tx) => {
    await tx.insert(appBlocks).values({ blockerId: me, blockedId: other }).onConflictDoNothing();
    await tx.delete(appFriendships).where(or(and(eq(appFriendships.requesterId, me), eq(appFriendships.addresseeId, other)), and(eq(appFriendships.requesterId, other), eq(appFriendships.addresseeId, me))));
    await tx.delete(appFollows).where(or(and(eq(appFollows.followerId, me), eq(appFollows.followeeId, other)), and(eq(appFollows.followerId, other), eq(appFollows.followeeId, me))));
    await tx.update(appCircleInvites).set({ status: "cancelled", respondedAt: new Date() })
      .where(and(eq(appCircleInvites.status, "pending"), or(and(eq(appCircleInvites.inviterId, me), eq(appCircleInvites.inviteeUserId, other)), and(eq(appCircleInvites.inviterId, other), eq(appCircleInvites.inviteeUserId, me)))));
    await appAuditLog(tx, { actorKind: "user", actorId: me, action: "user.blocked", entityType: "user", entityId: other, summary: "Blocked someone", ipHash });
  });
}

export async function unblock(me: string, other: string) {
  await db.delete(appBlocks).where(and(eq(appBlocks.blockerId, me), eq(appBlocks.blockedId, other)));
}

export async function listBlocks(me: string): Promise<PersonRef[]> {
  const rows = await db.select({ id: appBlocks.blockedId }).from(appBlocks).where(eq(appBlocks.blockerId, me));
  const people = await peopleByIds(rows.map((r) => r.id));
  return rows.map((r) => people.get(r.id)!);
}
