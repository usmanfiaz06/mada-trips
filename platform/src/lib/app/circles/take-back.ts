import "server-only";
import { and, eq } from "drizzle-orm";
import type { CircleMessage } from "@mada/shared";
import { db } from "@/db";
import { appMessages } from "@/db/app-schema";
import { appCircleSplitShares } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { membership, toMessages } from "./circles";
import { err } from "./common";

/**
 * Take back a split you posted, while nobody else has paid a share (owner audit, item 31). The card stays in the chat
 * marked "Taken back", its shares are kept as they were (never deleted), nobody can pay it any more, and it's audited.
 * A booking's pay link (a split made for an order) can't be taken back here: the order says what happens to it.
 */
export async function takeBackSplit(circleId: string, userId: string, messageId: string, ipHash: string | null): Promise<CircleMessage[]> {
  await membership(circleId, userId);
  const rows = await db.transaction(async (tx) => {
    const [m] = await tx.select().from(appMessages).where(and(eq(appMessages.id, messageId), eq(appMessages.threadId, circleId), eq(appMessages.threadKind, "circle"))).for("update");
    const c = (m?.card ?? null) as Record<string, unknown> | null;
    if (!m || c?.t !== "split") throw new AppError("NOT_FOUND");
    if (m.authorUserId !== userId && c.paidBy !== userId) throw new AppError("FORBIDDEN");
    if (c.withdrawn) return [m];
    if (c.orderId) throw err("VALIDATION", "tb.split.order");
    const shares = await tx.select().from(appCircleSplitShares).where(eq(appCircleSplitShares.messageId, messageId));
    if (shares.some((s) => s.paidAt && !s.userIds.includes(String(c.paidBy)))) throw err("VALIDATION", "tb.split.paid");
    const at = new Date().toISOString();
    const [u] = await tx.update(appMessages).set({ card: { ...c, withdrawn: true, cancelled: true, withdrawnAt: at } }).where(eq(appMessages.id, messageId)).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "circle.split_withdrawn", entityType: "circle_message", entityId: messageId, summary: `Took back a split: ${String(c.what)}`, data: { circleId, total: c.total }, ipHash });
    return [u!];
  });
  return toMessages(rows);
}
