import "server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appPosts } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { isProductionDeploy } from "../config";
import { AppError } from "../http";

/*
 * Every tip is checked before it shows (FLOWS.md §8b). A tip starts "pending". The desk approves or rejects it with
 * decide(); the desk's screens list the queue with pendingQueue().
 *
 *   APP_MODERATION=auto     (the default outside production) a clean tip is approved by itself after a short delay,
 *                           APP_MODERATION_DELAY_SECONDS (20 by default); a tip that trips the blocklist waits for a person.
 *   APP_MODERATION=manual   (the default in production) every tip waits for a person.
 */

export const moderationMode = (): "auto" | "manual" => {
  const m = process.env.APP_MODERATION;
  if (m === "auto" || m === "manual") return m;
  return isProductionDeploy() ? "manual" : "auto";
};
const delaySeconds = () => Math.max(0, Number(process.env.APP_MODERATION_DELAY_SECONDS ?? 20) || 0);

/** Words and shapes that send a tip to a person instead of through: contact details, links, abuse. Small on purpose. */
const BLOCKLIST = [
  /\b(?:\+?966|0)?5\d{8}\b/, // a phone number
  /[\w.+-]+@[\w-]+\.[\w.]+/, // an email address
  /\bhttps?:\/\/|www\./i, // a link
  /\b(?:whatsapp me|call me|dm me|snap(?:chat)?|telegram)\b/i,
  /\b(?:fuck|shit|bitch|bastard|slut|whore|kill|scam|fraud|nude|sex)\w*/i,
  /\b(?:room|flat|apartment|house|villa)\s*(?:no\.?|number|#)\s*\d+/i, // someone's address
];

/** Why a text needs a person to look at it, or null when it's clean. */
export function screen(text: string): string | null {
  for (const re of BLOCKLIST) if (re.test(text)) return `matched ${re.source.slice(0, 40)}`;
  return null;
}

/** The fields a new tip starts with. */
export function initialModeration(text: string) {
  const flagged = screen(text);
  const auto = moderationMode() === "auto" && !flagged;
  return { status: "pending" as const, flagged, autoApproveAt: auto ? new Date(Date.now() + delaySeconds() * 1000) : null };
}

/** Approve clean tips whose wait is over (auto mode). Cheap; called before reading a feed. */
export async function settleDue() {
  if (moderationMode() !== "auto") return 0;
  const done = await db.update(appPosts).set({ status: "approved", moderatedAt: new Date(), moderatedBy: "auto" })
    .where(and(eq(appPosts.status, "pending"), isNull(appPosts.flagged), isNull(appPosts.deletedAt), lte(appPosts.autoApproveAt, new Date())))
    .returning({ id: appPosts.id });
  return done.length;
}

/** The queue a person works through, oldest first. */
export async function pendingQueue(limit = 50) {
  return db.select({ id: appPosts.id, authorId: appPosts.authorId, city: appPosts.city, place: appPosts.place, body: appPosts.body, hasPhoto: appPosts.hasPhoto, photoConsent: appPosts.photoConsent, flagged: appPosts.flagged, createdAt: appPosts.createdAt })
    .from(appPosts).where(and(eq(appPosts.status, "pending"), isNull(appPosts.deletedAt), sql`(${appPosts.flagged} IS NOT NULL OR ${appPosts.autoApproveAt} IS NULL)`))
    .orderBy(asc(appPosts.createdAt)).limit(limit);
}

/** A person's decision on a tip. Recorded in the audit trail with who decided. */
export async function decide(postId: string, decision: "approve" | "reject", by: { kind: "agent" | "system"; id: string }, note?: string) {
  return db.transaction(async (tx) => {
    const [p] = await tx.update(appPosts).set({ status: decision === "approve" ? "approved" : "rejected", moderatedAt: new Date(), moderatedBy: by.id, moderationNote: note ?? null })
      .where(and(eq(appPosts.id, postId), isNull(appPosts.deletedAt))).returning({ id: appPosts.id, authorId: appPosts.authorId });
    if (!p) throw new AppError("NOT_FOUND");
    await appAuditLog(tx, { actorKind: by.kind, actorId: by.id, action: `post.${decision}d`, entityType: "post", entityId: postId, summary: `Tip ${decision}d${note ? `: ${note.slice(0, 120)}` : ""}` });
    return p;
  });
}
