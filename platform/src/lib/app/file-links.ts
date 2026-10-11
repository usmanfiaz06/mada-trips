import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { pepper } from "./config";
import { getFile, readFileBytes } from "./documents/storage";

/*
 * Short-lived signed links to files in a traveller's conversations, so the app can open a photo or PDF the desk sent
 * (an image view, the system's PDF viewer) without a sign-in header. A link is minted only after the owner check that
 * reading the thread already does, names one file, and ends after 15 minutes.
 *
 *   desk  a file an agent attached in Mada Ops (the Ops attachments table, entity "app_thread")
 *   app   a file the traveller sent in support (encrypted storage, documents/storage.ts; the local or mock store
 *         outside production)
 *
 * The link is relative to the Core API base (/api/app/v1), so the app joins it to whichever server it talks to.
 */

export type FileKind = "desk" | "app";
const TTL_S = 15 * 60;

const sign = (kind: FileKind, id: string, exp: number) => createHmac("sha256", `${pepper()}:file-links`).update(`${kind}:${id}:${exp}`).digest("base64url");

export function signedFilePath(kind: FileKind, id: string, now = Date.now(), ttlS = TTL_S): string {
  const exp = Math.floor(now / 1000) + ttlS;
  return `/files/${kind}/${id}?exp=${exp}&sig=${sign(kind, id, exp)}`;
}

export function verifyFileLink(kind: string, id: string, exp: string | null, sig: string | null, now = Date.now()): kind is FileKind {
  if ((kind !== "desk" && kind !== "app") || !exp || !sig || !/^\d{9,11}$/.test(exp)) return false;
  if (Number(exp) * 1000 < now) return false;
  const want = Buffer.from(sign(kind, id, Number(exp)));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}

/** The bytes behind a verified link, or null when the file is gone. */
export async function linkedFile(kind: FileKind, id: string): Promise<{ name: string; mime: string; bytes: Buffer } | null> {
  if (kind === "desk") {
    const [f] = await db.select().from(schema.attachments).where(and(eq(schema.attachments.id, id), eq(schema.attachments.entityType, "app_thread")));
    return f ? { name: f.filename, mime: f.mime, bytes: Buffer.from(f.data) } : null;
  }
  const f = await getFile(id);
  if (!f || f.purpose !== "support") return null;
  return { name: f.name, mime: f.mime, bytes: await readFileBytes(f) };
}

type StoredCard = { attachment?: { id: string; filename: string; mime: string; size: number }; _file?: { id: string; name: string; mime: string; size: number } } | null;

/** The file on a thread message (an agent's or the traveller's), with a fresh signed link. */
export function messageAttachment(card: unknown): { id: string; name: string; mime: string; size: number; url: string | null } | null {
  const c = (card ?? null) as StoredCard;
  if (c?.attachment?.id) return { id: c.attachment.id, name: c.attachment.filename, mime: c.attachment.mime, size: c.attachment.size, url: signedFilePath("desk", c.attachment.id) };
  if (c?._file?.id) return { id: c._file.id, name: c._file.name, mime: c._file.mime, size: c._file.size, url: signedFilePath("app", c._file.id) };
  return null;
}
