import "server-only";
import { and, asc, eq, isNull, lte, sql } from "drizzle-orm";
import { db } from "@/db";
import { appPosts } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { isProductionDeploy } from "../config";
import { AppError } from "../http";
import { flagOf, holdFromFlag, screenContent, type ScreenInput } from "@mada/shared/moderation";
import { t, type CopyKey } from "@mada/shared";
import { appNotifications } from "@/db/app-schema";
import { localeOfUser } from "../locale";
import { withCopy } from "../notify-copy";
import { notify, type Db } from "./common";

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

/**
 * Why a text needs a person to look at it ("code: what", app_posts.flagged), or null when it's clean. The rules live
 * in @mada/shared/moderation: contact details, links, a home address, abuse and profanity in English, Arabic and
 * Arabizi, scam words, places Mada doesn't list (bars, nightclubs, adult venues, gambling, alcohol-led) by keyword and
 * by category, and the same text posted again.
 */
export function screen(text: string, opts: Omit<ScreenInput, "text"> = {}): string | null {
  const h = screenContent({ text, ...opts });
  return h ? flagOf(h) : null;
}

/** The copy key that tells an author, plainly, why their words wait for a person. */
export function heldWhyKey(flag: string | null | undefined): CopyKey | null {
  const h = holdFromFlag(flag);
  if (h) return `mod.held.${h.code}` as CopyKey;
  return flag ? "mod.held.title" : null;
}

/** The fields a new tip starts with. A hold (text or photo) always waits for a person. */
export function initialModeration(text: string, opts: Omit<ScreenInput, "text"> & { imageFlag?: string | null } = {}) {
  const { imageFlag, ...rest } = opts;
  const flagged = screen(text, rest) ?? imageFlag ?? null;
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

/**
 * A person's decision on a tip, optionally with the words edited first (a phone number taken out, a typo fixed).
 * Recorded in the audit trail with who decided. The author is told: "Your tip is up", or why it didn't go up.
 */
export async function decide(postId: string, decision: "approve" | "reject", by: { kind: "agent" | "system"; id: string }, note?: string, edit?: { place?: string; body?: string }) {
  return db.transaction(async (tx) => {
    const set: Partial<typeof appPosts.$inferInsert> = { status: decision === "approve" ? "approved" : "rejected", moderatedAt: new Date(), moderatedBy: by.id, moderationNote: note ?? null };
    const edited = !!(edit && (edit.place?.trim() || edit.body?.trim()));
    if (edit?.place?.trim()) set.place = edit.place.trim().slice(0, 120);
    if (edit?.body?.trim()) set.body = edit.body.trim().slice(0, 1000);
    const [p] = await tx.update(appPosts).set(set)
      .where(and(eq(appPosts.id, postId), isNull(appPosts.deletedAt))).returning({ id: appPosts.id, authorId: appPosts.authorId, place: appPosts.place });
    if (!p) throw new AppError("NOT_FOUND");
    await appAuditLog(tx, { actorKind: by.kind, actorId: by.id, action: `post.${decision}d`, entityType: "post", entityId: postId, summary: `Tip ${decision}d${edited ? " after an edit" : ""}${note ? `: ${note.slice(0, 120)}` : ""}`, data: edited ? { edit } : null });
    if (by.kind === "agent") {
      if (decision === "approve") await notify(tx, p.authorId, "post.approved", ["notify.mod.approved.title"], ["notify.mod.approved.body", { place: p.place }], `/tip/${p.id}`, { postId: p.id });
      else await notify(tx, p.authorId, "post.rejected", ["notify.mod.rejected.title"], ["notify.mod.rejected.body", { reason: note ?? "" }], null, { postId: p.id });
    }
    return p;
  });
}

/** The reporter hears back: "Thanks, we removed it", or that it stays and why. */
export async function tellReporter(tx: Db, reporterId: string | null, targetKind: string, removed: boolean) {
  if (!reporterId) return;
  const what = { k: `mod.what.${["post", "message", "user", "circle"].includes(targetKind) ? targetKind : "post"}` as CopyKey };
  const [lw, title, body] = removed ? [what, "notify.mod.removed.title", "notify.mod.removed.body"] as const : [what, "notify.mod.kept.title", "notify.mod.kept.body"] as const;
  const locale = await localeOfUser(reporterId, tx);
  const vars = { what: t(lw.k, undefined, locale) };
  await tx.insert(appNotifications).values({
    userId: reporterId, kind: "other", level: "passive", title: t(title, undefined, locale).slice(0, 64), body: t(body, vars, locale), href: null,
    data: withCopy({ report: true }, { title: [title], body: [body, { what: lw }] }),
  });
}
