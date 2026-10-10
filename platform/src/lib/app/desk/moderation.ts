import "server-only";
import { and, asc, desc, eq, inArray, ne } from "drizzle-orm";
import { db } from "@/db";
import { appUsers } from "@/db/app-schema";
import { appDeskModeration } from "@/db/app-schema-desk";
import { appPosts, appReports } from "@/db/app-schema-circles";
import * as circlesModeration from "@/lib/app/circles/moderation";
import { appDeskBlocks } from "@/db/app-schema-desk";
import { isNull } from "drizzle-orm";
import { clip, engine } from "./adapters";
import { assertCap, deskAudit, DeskError, travellerName, type DeskActor } from "./core";

/*
 * The desk's moderation queue, built on Circles' own moderation (lib/app/circles/moderation.ts): tips come from
 * pendingQueue() (after settleDue() lets clean tips through in auto mode) and are decided with decide().
 * Reports are read from app_reports (Circles has no desk-side review function yet, so the desk closes them here).
 * Items the desk holds itself (app_desk_moderation) are decided here too.
 */

export type ModerationSource = "desk" | "post" | "report";

/**
 * The queue: rows the desk holds (app_desk_moderation), tips waiting in Circles (lib/app/circles/moderation.ts
 * pendingQueue) and open reports (app_reports). Each carries its source so the decision goes back to the right place.
 */
export async function listModeration(status: "open" | "closed" = "open") {
  const open = status === "open";
  const [rows, posts, reports] = await Promise.all([
    db.select({ m: appDeskModeration, authorName: appUsers.name }).from(appDeskModeration)
      .leftJoin(appUsers, eq(appUsers.id, appDeskModeration.authorUserId))
      .where(open ? eq(appDeskModeration.status, "open") : ne(appDeskModeration.status, "open"))
      .orderBy(open ? asc(appDeskModeration.createdAt) : desc(appDeskModeration.decidedAt)).limit(300),
    open ? circlesModeration.settleDue().catch(() => 0).then(() => circlesModeration.pendingQueue(100)).catch(() => []) : Promise.resolve([]),
    db.select().from(appReports).where(open ? eq(appReports.status, "open") : ne(appReports.status, "open")).orderBy(open ? asc(appReports.createdAt) : desc(appReports.reviewedAt)).limit(100).catch(() => []),
  ]);
  type Item = Omit<typeof appDeskModeration.$inferSelect, never> & { source: ModerationSource; authorName: string; reporterName: string; authorBlocked: boolean };
  const userIds = [...new Set([...rows.map((r) => r.m.reporterUserId), ...posts.map((p) => p.authorId), ...reports.flatMap((r) => [r.reporterId, r.targetUserId])].filter((x): x is string => !!x))];
  const names = userIds.length ? await db.select({ id: appUsers.id, name: appUsers.name }).from(appUsers).where(inArray(appUsers.id, userIds)) : [];
  const nm = (id: string | null) => travellerName(names.find((n) => n.id === id)?.name);
  const blocks = await activeBlocks();
  const items: Item[] = [
    ...rows.map(({ m, authorName }) => ({ ...m, source: "desk" as const, authorName: travellerName(authorName), reporterName: nm(m.reporterUserId), authorBlocked: !!m.authorUserId && blocks.has(m.authorUserId) })),
    ...posts.map((p) => ({
      id: p.id, kind: "tip", targetKind: "post", targetId: p.id, authorUserId: p.authorId, reporterUserId: null, reason: null, note: p.flagged ? `Flagged: ${p.flagged}` : null,
      snapshot: { city: p.city, place: p.place, text: p.body }, status: "open", decidedBy: null, decidedAt: null, decisionReason: null, createdAt: p.createdAt,
      source: "post" as const, authorName: nm(p.authorId), reporterName: "", authorBlocked: blocks.has(p.authorId),
    })),
    ...reports.map((r) => ({
      id: r.id, kind: "report", targetKind: r.targetKind, targetId: r.targetId, authorUserId: r.targetUserId, reporterUserId: r.reporterId, reason: r.reason, note: r.note,
      snapshot: {}, status: r.status === "open" ? "open" : r.status === "actioned" ? "removed" : "dismissed", decidedBy: null, decidedAt: r.reviewedAt, decisionReason: null, createdAt: r.createdAt,
      source: "report" as const, authorName: nm(r.targetUserId), reporterName: nm(r.reporterId), authorBlocked: !!r.targetUserId && blocks.has(r.targetUserId),
    })),
  ];
  return items.sort((a, b) => open ? a.createdAt.getTime() - b.createdAt.getTime() : (b.decidedAt?.getTime() ?? 0) - (a.decidedAt?.getTime() ?? 0));
}

export async function activeBlocks() {
  const rows = await db.select({ userId: appDeskBlocks.userId }).from(appDeskBlocks).where(isNull(appDeskBlocks.liftedAt));
  return new Set(rows.map((r) => r.userId));
}

export async function decideModeration(actor: DeskActor, id: string, v: { decision: "approved" | "rejected" | "removed" | "dismissed"; reason?: string | null }, source: ModerationSource = "desk") {
  assertCap(actor, "desk.moderate");
  if ((v.decision === "rejected" || v.decision === "removed") && (v.reason?.trim().length ?? 0) < 5) throw new DeskError("Say why, so the author understands");
  const reason = v.reason?.trim() || undefined;
  if (source === "post") {
    if (v.decision !== "approved" && v.decision !== "rejected") throw new DeskError("Approve or reject a tip");
    await engine(() => circlesModeration.decide(id, v.decision === "approved" ? "approve" : "reject", { kind: "agent", id: actor.id }, reason));
    await db.transaction((tx) => deskAudit(tx, actor, { action: `desk.moderation.${v.decision}`, entityType: "post", entityId: id, ref: "Tip", summary: `${v.decision === "approved" ? "Approved" : "Rejected"} a tip${reason ? `: ${clip(reason, 100)}` : ""}` }, { app: false }));
    return;
  }
  if (source === "report") {
    if (v.decision !== "removed" && v.decision !== "dismissed") throw new DeskError("Remove the content or dismiss the report");
    await db.transaction(async (tx) => {
      const [r] = await tx.select().from(appReports).where(eq(appReports.id, id)).for("update");
      if (!r) throw new DeskError("Not found", "NOT_FOUND");
      if (r.status !== "open") throw new DeskError("Already decided", "CONFLICT");
      await tx.update(appReports).set({ status: v.decision === "removed" ? "actioned" : "dismissed", reviewedAt: new Date() }).where(eq(appReports.id, id));
      if (v.decision === "removed" && r.targetKind === "post") await tx.update(appPosts).set({ status: "rejected", moderatedAt: new Date(), moderatedBy: actor.id, moderationNote: reason ?? null }).where(eq(appPosts.id, r.targetId));
      await deskAudit(tx, actor, { action: `desk.moderation.${v.decision}`, entityType: r.targetKind, entityId: r.targetId, ref: "Report", summary: `${v.decision === "removed" ? "Removed" : "Dismissed"} a report on a ${r.targetKind}${reason ? `: ${clip(reason, 100)}` : ""}`, data: { reportId: id } });
    });
    return;
  }
  await db.transaction(async (tx) => {
    const [m] = await tx.select().from(appDeskModeration).where(eq(appDeskModeration.id, id)).for("update");
    if (!m) throw new DeskError("Not found", "NOT_FOUND");
    if (m.status !== "open") throw new DeskError("Already decided", "CONFLICT");
    if (m.kind === "tip" && v.decision === "dismissed") throw new DeskError("Approve or reject a tip");
    if (m.kind === "report" && v.decision === "approved") throw new DeskError("Remove the content or dismiss the report");
    await tx.update(appDeskModeration).set({ status: v.decision, decidedBy: actor.id, decidedAt: new Date(), decisionReason: v.reason?.trim() || null }).where(eq(appDeskModeration.id, id));
    const what = m.kind === "tip" ? `tip "${clip(m.snapshot.place ?? m.snapshot.text ?? "", 40)}"` : `report on a ${m.targetKind}`;
    await deskAudit(tx, actor, { action: `desk.moderation.${v.decision}`, entityType: m.targetKind, entityId: m.targetId, ref: m.kind === "tip" ? "Tip" : "Report",
      summary: `${v.decision[0]!.toUpperCase()}${v.decision.slice(1)} ${what}${v.reason ? `: ${clip(v.reason, 100)}` : ""}`, data: { moderationId: id } });
  });
}

