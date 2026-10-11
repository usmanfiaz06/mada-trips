import "server-only";
import { and, asc, eq, inArray, isNull, lte, sql } from "drizzle-orm";
import { CircleCoverInput, COVER_PHOTOS, readCover, type CircleCover, type CircleCoverInput as CoverIn } from "@mada/shared";
import { db } from "@/db";
import { appCircleMembers, appCircles } from "@/db/app-schema";
import { appCircleDetails, appCircleInvites } from "@/db/app-schema-circles";
import { appFiles } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { deleteFile, getFile, readFileBytes, readUpload, storeFile, type StoredFile } from "../documents/storage";
import { AppError } from "../http";
import { assertUnder, err, type Db } from "./common";
import { moderationMode } from "./moderation";

/*
 * A circle's cover: one of Mada's drawings on a colour, a photo we ship, or a photo someone uploaded.
 *
 * Uploads go through the encrypted file store (documents/storage.ts, purpose "cover") and the same check tips get
 * (moderation.ts): pending first; in auto mode a cover is approved by itself after APP_MODERATION_DELAY_SECONDS, in
 * manual mode (production) it waits for the desk (Mada Ops › Desk › Moderation). Until it's approved, and if it's
 * turned down, only the person who added it sees it; everyone else, the invite page and its picture see the cover it
 * replaced (or plain green).
 *
 * Columns (app_circle_details): cover_kind, cover (a photo's id; an older row's key), cover_icon + cover_color, and
 * for an upload cover_file_id, cover_status, cover_by, cover_auto_approve_at, cover_checked_*.
 */

type Details = typeof appCircleDetails.$inferSelect;
type Cols = Pick<Details, "coverKind" | "cover" | "coverIcon" | "coverColor" | "coverFileId" | "coverStatus" | "coverBy">;

const UPLOADS_PER_HOUR = 20;
const delaySeconds = () => Math.max(0, Number(process.env.APP_MODERATION_DELAY_SECONDS ?? 20) || 0);
const isPhoto = (v: string | null): v is keyof typeof COVER_PHOTOS => !!v && v in COVER_PHOTOS;

/** The drawing or photo stored on the row, ignoring any upload: what the rest of the circle sees while one waits. */
export function baseCover(d: Partial<Cols> | null | undefined): CircleCover | null {
  if (!d) return null;
  if (d.coverIcon && d.coverColor) {
    const c = readCover({ kind: "icon", icon: d.coverIcon, color: d.coverColor });
    if (c) return c;
  }
  return isPhoto(d.cover ?? null) ? { kind: "photo", id: d.cover as keyof typeof COVER_PHOTOS } : null;
}

/**
 * The cover as one person sees it. An upload shows to everyone once approved, and to the person who added it while
 * it waits or after it's turned down (so they know); `url` is how to fetch it (a member, signed in).
 */
export function coverFor(circleId: string, d: Partial<Cols> | null | undefined, viewerId: string | null, opts: { url?: string } = {}): CircleCover | null {
  if (d?.coverKind === "upload" && d.coverFileId && d.coverStatus) {
    const status = d.coverStatus === "approved" ? "approved" : d.coverStatus === "rejected" ? "rejected" : "pending";
    if (status === "approved" || (viewerId && d.coverBy === viewerId)) {
      return { kind: "upload", fileId: d.coverFileId, status, url: opts.url ?? `/api/app/v1/circles/${circleId}/cover` };
    }
  }
  return baseCover(d);
}

/** The cover anyone with an invite link sees: never an upload that hasn't been approved. */
export function publicCover(d: Partial<Cols> | null | undefined, code: string): CircleCover | null {
  if (d?.coverKind === "upload" && d.coverStatus === "approved" && d.coverFileId) return { kind: "upload", fileId: d.coverFileId, status: "approved", url: `/links/join-cover/${encodeURIComponent(code)}` };
  return baseCover(d);
}

/** The columns a new cover writes. Checks an upload is the caller's own cover file. */
export async function coverColumns(input: CoverIn | null, userId: string, previous: Partial<Cols> | null, tx: Db = db): Promise<Partial<typeof appCircleDetails.$inferInsert>> {
  const c = input == null ? null : CircleCoverInput.parse(input);
  const clearUpload = { coverFileId: null, coverStatus: null, coverBy: null, coverAutoApproveAt: null, coverCheckedAt: null, coverCheckedBy: null, coverNote: null };
  if (!c) return { coverKind: null, cover: null, coverIcon: null, coverColor: null, ...clearUpload };
  if (c.kind === "icon") return { coverKind: "icon", cover: null, coverIcon: c.icon, coverColor: c.color, ...clearUpload };
  if (c.kind === "photo") return { coverKind: "photo", cover: c.id, coverIcon: null, coverColor: null, ...clearUpload };
  // The same upload again (a rename sends the cover back): nothing changes, its check stands.
  if (previous?.coverKind === "upload" && previous.coverFileId === c.fileId) return {};
  const [f] = await tx.select().from(appFiles).where(and(eq(appFiles.id, c.fileId), eq(appFiles.ownerId, userId), eq(appFiles.purpose, "cover"), isNull(appFiles.deletedAt)));
  if (!f) throw err("VALIDATION", undefined, { cover: "Unknown upload" });
  const auto = moderationMode() === "auto";
  // The drawing or photo it replaces stays on the row for everyone else until the upload is approved.
  return { coverKind: "upload", coverFileId: f.id, coverStatus: "pending", coverBy: userId, coverAutoApproveAt: auto ? new Date(Date.now() + delaySeconds() * 1000) : null, coverCheckedAt: null, coverCheckedBy: null, coverNote: null };
}

/** Store a cover photo someone picked (multipart "file": JPEG, PNG, WebP or HEIC, up to 10 MB). Not on any circle yet. */
export async function uploadCover(userId: string, req: Request, ipHash: string | null): Promise<{ fileId: string; status: "pending" }> {
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(appFiles).where(and(eq(appFiles.ownerId, userId), eq(appFiles.purpose, "cover"), sql`${appFiles.createdAt} > now() - interval '1 hour'`));
  assertUnder(n?.n ?? 0, UPLOADS_PER_HOUR, 3600);
  const up = await readUpload(req, { allow: ["image/jpeg", "image/png", "image/webp", "image/heic"] });
  const f = await storeFile(db, userId, "cover", up);
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "circle.cover_uploaded", entityType: "file", entityId: f.id, summary: "Uploaded a circle cover photo (waiting to be checked)", ipHash });
  return { fileId: f.id, status: "pending" };
}

/** Approve covers whose wait is over (auto mode). Cheap; called before covers are read. */
export async function settleCovers(): Promise<number> {
  if (moderationMode() !== "auto") return 0;
  const done = await db.update(appCircleDetails).set({ coverStatus: "approved", coverCheckedAt: new Date(), coverCheckedBy: "auto" })
    .where(and(eq(appCircleDetails.coverKind, "upload"), eq(appCircleDetails.coverStatus, "pending"), lte(appCircleDetails.coverAutoApproveAt, new Date())))
    .returning({ id: appCircleDetails.circleId });
  return done.length;
}

/** Covers waiting for a person, oldest first (the desk's moderation queue). */
export async function coverQueue(limit = 50) {
  return db.select({ circleId: appCircleDetails.circleId, name: appCircles.name, fileId: appCircleDetails.coverFileId, by: appCircleDetails.coverBy, createdAt: appFiles.createdAt })
    .from(appCircleDetails).innerJoin(appCircles, eq(appCircles.id, appCircleDetails.circleId)).innerJoin(appFiles, eq(appFiles.id, appCircleDetails.coverFileId))
    .where(and(eq(appCircleDetails.coverKind, "upload"), eq(appCircleDetails.coverStatus, "pending"), isNull(appCircleDetails.coverAutoApproveAt)))
    .orderBy(asc(appFiles.createdAt)).limit(limit);
}

/** A person's decision on a cover. Turned down, only the person who added it sees it (marked so); the circle keeps the cover it had. */
export async function decideCover(circleId: string, decision: "approve" | "reject", by: { kind: "agent" | "system"; id: string }, note?: string) {
  return db.transaction(async (tx) => {
    const [d] = await tx.select().from(appCircleDetails).where(and(eq(appCircleDetails.circleId, circleId), eq(appCircleDetails.coverKind, "upload"))).for("update");
    if (!d || !d.coverFileId) throw new AppError("NOT_FOUND");
    if (d.coverStatus !== "pending") throw new AppError("NOT_FOUND"); // already decided
    await tx.update(appCircleDetails).set({ coverStatus: decision === "approve" ? "approved" : "rejected", coverCheckedAt: new Date(), coverCheckedBy: by.id, coverNote: note ?? null })
      .where(eq(appCircleDetails.circleId, circleId));
    await appAuditLog(tx, { actorKind: by.kind, actorId: by.id, action: `circle.cover_${decision === "approve" ? "approved" : "rejected"}`, entityType: "circle", entityId: circleId, summary: `Cover photo ${decision === "approve" ? "approved" : "rejected"}${note ? `: ${note.slice(0, 120)}` : ""}` });
    return { circleId, by: d.coverBy };
  });
}

async function coverFile(d: Pick<Details, "coverFileId"> & { coverBy: string | null }): Promise<StoredFile> {
  const f = d.coverFileId && d.coverBy ? await getFile(d.coverFileId, d.coverBy) : null;
  if (!f || f.purpose !== "cover") throw new AppError("NOT_FOUND");
  return f;
}

/** The uploaded cover's bytes for a member (approved, or their own while it waits) or someone invited (approved). */
export async function memberCoverBytes(circleId: string, viewerId: string) {
  await settleCovers();
  const [m] = await db.select({ id: appCircleMembers.userId }).from(appCircleMembers).where(and(eq(appCircleMembers.circleId, circleId), eq(appCircleMembers.userId, viewerId)));
  if (!m) {
    const [inv] = await db.select({ id: appCircleInvites.id }).from(appCircleInvites)
      .where(and(eq(appCircleInvites.circleId, circleId), eq(appCircleInvites.inviteeUserId, viewerId), eq(appCircleInvites.status, "pending"), sql`${appCircleInvites.expiresAt} > now()`)).limit(1);
    if (!inv) throw new AppError("NOT_FOUND");
    return circleCoverBytes(circleId);
  }
  const [d] = await db.select().from(appCircleDetails).where(eq(appCircleDetails.circleId, circleId));
  const shown = d ? coverFor(circleId, d, viewerId) : null;
  if (!d || shown?.kind !== "upload") throw new AppError("NOT_FOUND");
  const file = await coverFile(d);
  return { file, bytes: await readFileBytes(file) };
}

/** The uploaded cover's bytes for an invite page: approved only. */
export async function circleCoverBytes(circleId: string) {
  await settleCovers();
  const [d] = await db.select().from(appCircleDetails).where(eq(appCircleDetails.circleId, circleId));
  if (!d || d.coverKind !== "upload" || d.coverStatus !== "approved") throw new AppError("NOT_FOUND");
  const file = await coverFile(d);
  return { file, bytes: await readFileBytes(file) };
}

/** For the desk: the waiting cover's bytes, whatever its state. */
export async function deskCoverBytes(circleId: string) {
  const [d] = await db.select().from(appCircleDetails).where(and(eq(appCircleDetails.circleId, circleId), eq(appCircleDetails.coverKind, "upload")));
  if (!d) throw new AppError("NOT_FOUND");
  const file = await coverFile(d);
  return { file, bytes: await readFileBytes(file) };
}

/** Rows for many circles at once. */
export async function detailsFor(ids: string[]) {
  return ids.length ? db.select().from(appCircleDetails).where(inArray(appCircleDetails.circleId, ids)) : [];
}

/** After a cover changes: the upload it replaced goes for good. */
export async function dropReplacedUpload(tx: Db, previous: Partial<Cols> | null, next: Partial<typeof appCircleDetails.$inferInsert>) {
  if (previous?.coverKind !== "upload" || !previous.coverFileId || !previous.coverBy || !("coverKind" in next)) return;
  if (next.coverKind === "upload" && next.coverFileId === previous.coverFileId) return;
  const f = await getFile(previous.coverFileId, previous.coverBy);
  if (f) await deleteFile(tx, f);
}

/** An approved upload's file and bytes, by its file id (the invite page reaches it through its code first). */
export async function approvedUploadBytes(fileId: string) {
  const [d] = await db.select().from(appCircleDetails).where(and(eq(appCircleDetails.coverFileId, fileId), eq(appCircleDetails.coverKind, "upload"), eq(appCircleDetails.coverStatus, "approved")));
  if (!d) throw new AppError("NOT_FOUND");
  const file = await coverFile(d);
  return { file, bytes: await readFileBytes(file) };
}

/** An approved upload as a data URI for the link preview picture (JPEG or PNG only; null otherwise). */
export async function approvedUploadDataUri(fileId: string): Promise<string | null> {
  try {
    const { file, bytes } = await approvedUploadBytes(fileId);
    return file.mime === "image/jpeg" || file.mime === "image/png" ? `data:${file.mime};base64,${bytes.toString("base64")}` : null;
  } catch { return null; }
}
