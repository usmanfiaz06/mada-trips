import "server-only";
import { and, eq, inArray, sql } from "drizzle-orm";
import { t, type RefundView, type TripRequestView } from "@mada/shared";
import { db } from "@/db";
import { appQuotes, appRefunds, appRequests } from "@/db/app-schema";
import { appRefundGroups, appRefundItems } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { toRefundView } from "./money";
import { canTakeBack, toRequestView } from "./requests";

/*
 * Take back what you sent (owner audit, item 31): a request, a change, an "ask anyway" refund, until the desk has it
 * (assigned to someone, or answered with a yes or a no). Nothing is deleted: the row is marked withdrawn, its open
 * quote is withdrawn, the desk sees "Withdrawn by the traveller", and each one is audited.
 */

const tooLate = () => new AppError("VALIDATION", { message: t("tb.tooLate") });

export async function takeBackRequest(ownerId: string, id: string, ipHash: string | null): Promise<TripRequestView> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  return db.transaction(async (tx) => {
    const [r] = await tx.select().from(appRequests).where(and(eq(appRequests.id, id), eq(appRequests.ownerId, ownerId))).for("update");
    if (!r) throw new AppError("NOT_FOUND");
    if (!canTakeBack(r)) throw tooLate();
    const at = new Date();
    const [u] = await tx.update(appRequests).set({ status: "cancelled", updatedAt: at, details: sql`${appRequests.details} || ${JSON.stringify({ withdrawn: true, withdrawnAt: at.toISOString() })}::jsonb` })
      .where(eq(appRequests.id, id)).returning();
    await tx.update(appQuotes).set({ status: "withdrawn" }).where(and(eq(appQuotes.requestId, id), eq(appQuotes.status, "open")));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.withdrawn", entityType: "app_request", entityId: id, summary: `Took back: ${r.summary}`, data: { was: r.status }, ipHash });
    return toRequestView(u!);
  });
}

/** An "ask anyway" refund (nothing credited, nothing cancelled) while the desk hasn't decided. */
export async function takeBackRefund(ownerId: string, id: string, ipHash: string | null): Promise<RefundView> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  return db.transaction(async (tx) => {
    const [g] = await tx.select().from(appRefundGroups).where(and(eq(appRefundGroups.id, id), eq(appRefundGroups.ownerId, ownerId))).for("update");
    if (!g) throw new AppError("NOT_FOUND");
    if (!(g.anyway && g.stage === "requested")) throw tooLate();
    const at = new Date();
    const [u] = await tx.update(appRefundGroups).set({ stage: "withdrawn", updatedAt: at }).where(eq(appRefundGroups.id, id)).returning();
    // Each payment's refund row (what the desk's Refunds list reads) is marked too, never deleted.
    const items = await tx.select({ refundId: appRefundItems.refundId }).from(appRefundItems).where(eq(appRefundItems.groupId, id));
    if (items.length) await tx.update(appRefunds).set({ stage: "withdrawn", updatedAt: at }).where(and(inArray(appRefunds.id, items.map((x) => x.refundId)), eq(appRefunds.stage, "requested")));
    // The desk's request for it closes with it.
    await tx.update(appRequests).set({ status: "cancelled", updatedAt: at, details: sql`${appRequests.details} || ${JSON.stringify({ withdrawn: true, withdrawnAt: at.toISOString() })}::jsonb` })
      .where(and(eq(appRequests.ownerId, ownerId), eq(appRequests.kind, "refund"), sql`${appRequests.details}->>'clientKey' = ${g.clientKey}`));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "refund.withdrawn", entityType: "app_refund_group", entityId: id, summary: `Took back the refund request: ${g.title}`, ipHash });
    return toRefundView(u!);
  });
}
