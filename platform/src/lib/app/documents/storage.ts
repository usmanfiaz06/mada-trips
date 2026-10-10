import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes, randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { and, eq, isNull } from "drizzle-orm";
import { db, type Tx } from "@/db";
import { appFiles } from "@/db/app-schema-wallet";
import { isProductionDeploy } from "../config";
import { decryptField, encryptField } from "../crypto";
import { AppError } from "../http";

/*
 * Encrypted file storage for documents, support attachments, profile photos and data exports.
 *
 * Every file gets its own random 256-bit key. The bytes are sealed with AES-256-GCM under that key; the key itself
 * is sealed with APP_DATA_KEY (crypto.ts) and bound to the file's row, so rotation of APP_DATA_KEY works as it does
 * for passports. Nothing is ever reachable by URL: files come back only through an authenticated route that checks
 * the owner (or a live grant) first.
 *
 *   APP_BLOB_STORE  local (default) | s3
 *   APP_BLOB_DIR    folder for the local store (default .data/blobs). Required on a production deployment that
 *                   uses the local store, which is only sensible on a server with a persistent disk.
 *   S3 / Supabase storage: the adapter interface is ready; the live adapter answers NOT_CONFIGURED until the bucket
 *   (in a Saudi region, PRODUCTION.md §2) exists.
 */

export type BlobStore = {
  readonly name: "local" | "s3";
  put(key: string, bytes: Buffer): Promise<void>;
  get(key: string): Promise<Buffer>;
  remove(key: string): Promise<void>;
};

function localStore(): BlobStore {
  const dir = process.env.APP_BLOB_DIR;
  if (!dir && isProductionDeploy()) throw new AppError("NOT_CONFIGURED", { copy: "error.storageMissing" });
  const base = resolve(dir ?? ".data/blobs");
  const path = (key: string) => {
    if (!/^[a-z0-9/-]+$/.test(key)) throw new Error("Bad storage key");
    return join(base, key);
  };
  return {
    name: "local",
    async put(key, bytes) {
      const p = path(key);
      await mkdir(join(p, ".."), { recursive: true });
      await writeFile(p, bytes, { mode: 0o600 });
    },
    async get(key) { return readFile(path(key)); },
    async remove(key) { await rm(path(key), { force: true }); },
  };
}

const s3Store: BlobStore = {
  name: "s3",
  async put() { throw new AppError("NOT_CONFIGURED", { copy: "error.storageMissing" }); },
  async get() { throw new AppError("NOT_CONFIGURED", { copy: "error.storageMissing" }); },
  async remove() { throw new AppError("NOT_CONFIGURED", { copy: "error.storageMissing" }); },
};

export function blobStore(name = process.env.APP_BLOB_STORE ?? "local"): BlobStore {
  return name === "s3" ? s3Store : localStore();
}

const fileAad = (fileId: string) => `app_files:${fileId}:key`;

function seal(bytes: Buffer, key: Buffer): Buffer {
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", key, iv);
  const ct = Buffer.concat([c.update(bytes), c.final()]);
  // v1 | iv (12) | tag (16) | ciphertext
  return Buffer.concat([Buffer.from([1]), iv, c.getAuthTag(), ct]);
}

function open(blob: Buffer, key: Buffer): Buffer {
  if (blob[0] !== 1) throw new Error("Unrecognised file format");
  const iv = blob.subarray(1, 13);
  const tag = blob.subarray(13, 29);
  const d = createDecipheriv("aes-256-gcm", key, iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(blob.subarray(29)), d.final()]);
}

export type StoredFile = typeof appFiles.$inferSelect;

/** Encrypt and store a file, and record it. Throws NOT_CONFIGURED without APP_DATA_KEY or a store. */
export async function storeFile(tx: Tx | typeof db, ownerId: string, purpose: "document" | "support" | "photo" | "export", file: { name: string; mime: string; bytes: Buffer }): Promise<StoredFile> {
  const id = randomUUID();
  const key = randomBytes(32);
  const keyEnc = encryptField(key.toString("base64"), fileAad(id)); // NOT_CONFIGURED without APP_DATA_KEY
  const store = blobStore();
  const storageKey = `${ownerId}/${id}`;
  await store.put(storageKey, seal(file.bytes, key));
  const [row] = await tx.insert(appFiles).values({
    id, ownerId, purpose, name: file.name.slice(0, 120), mime: file.mime, size: file.bytes.length,
    sha256: createHash("sha256").update(file.bytes).digest("hex"), storage: store.name, storageKey, keyEnc,
  }).returning();
  return row!;
}

/** The plain bytes of a stored file. Callers check ownership (or a grant) first. */
export async function readFileBytes(file: StoredFile): Promise<Buffer> {
  const key = Buffer.from(decryptField(file.keyEnc, fileAad(file.id)), "base64");
  return open(await blobStore(file.storage).get(file.storageKey), key);
}

export async function getFile(fileId: string, ownerId?: string): Promise<StoredFile | null> {
  const [f] = await db.select().from(appFiles).where(and(eq(appFiles.id, fileId), isNull(appFiles.deletedAt), ...(ownerId ? [eq(appFiles.ownerId, ownerId)] : [])));
  return f ?? null;
}

/** Remove the bytes for good and mark the row. */
export async function deleteFile(tx: Tx | typeof db, file: Pick<StoredFile, "id" | "storage" | "storageKey">): Promise<void> {
  await tx.update(appFiles).set({ deletedAt: new Date() }).where(eq(appFiles.id, file.id));
  await blobStore(file.storage).remove(file.storageKey).catch(() => {});
}

/** A file as an HTTP response: never cached, never sniffed, shown inline or saved. */
export function fileResponse(file: StoredFile, bytes: Buffer, disposition: "inline" | "attachment" = "inline"): Response {
  const safe = file.name.replace(/[^\w. -]/g, "_");
  return new Response(new Uint8Array(bytes), {
    status: 200,
    headers: {
      "Content-Type": file.mime, "Content-Length": String(bytes.length), "Cache-Control": "no-store, private",
      "X-Content-Type-Options": "nosniff", "Content-Disposition": `${disposition}; filename="${safe}"`,
      "Content-Security-Policy": "default-src 'none'; img-src 'self' data:; style-src 'unsafe-inline'; sandbox",
    },
  });
}

/* ───────────── uploads ───────────── */

const SIGNATURES: [string, (b: Buffer) => boolean][] = [
  ["image/jpeg", (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff],
  ["image/png", (b) => b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))],
  ["application/pdf", (b) => b.subarray(0, 5).toString("latin1") === "%PDF-"],
  ["image/webp", (b) => b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP"],
  ["image/heic", (b) => b.subarray(4, 8).toString("latin1") === "ftyp" && /^(heic|heix|hevc|mif1|msf1|heif)$/.test(b.subarray(8, 12).toString("latin1"))],
];

/** What the bytes really are (by their first bytes, not the name or the declared type), or null. */
export function sniffType(bytes: Buffer): string | null {
  return SIGNATURES.find(([, test]) => test(bytes))?.[0] ?? null;
}

export const MAX_UPLOAD = 10 * 1024 * 1024;

/**
 * Read a multipart upload: the "file" part and an optional JSON "meta" part. Checks size and type by content.
 * Wrong type or over 10 MB come back as VALIDATION with the catalogue's words (FLOWS.md §8c).
 */
export async function readUpload(req: Request, opts: { allow?: readonly string[] } = {}): Promise<{ name: string; mime: string; bytes: Buffer; meta: unknown }> {
  const len = Number(req.headers.get("content-length") ?? 0);
  if (len > MAX_UPLOAD + 64 * 1024) throw new AppError("VALIDATION", { copy: "error.documentSize", fields: { file: "too_big" } });
  let form: FormData;
  try { form = await req.formData(); } catch { throw new AppError("VALIDATION", { fields: { file: "missing" } }); }
  const file = form.get("file");
  if (!file || typeof file === "string") throw new AppError("VALIDATION", { fields: { file: "missing" } });
  if (file.size > MAX_UPLOAD) throw new AppError("VALIDATION", { copy: "error.documentSize", fields: { file: "too_big" } });
  const bytes = Buffer.from(await file.arrayBuffer());
  const mime = sniffType(bytes);
  const allow = opts.allow ?? ["image/jpeg", "image/png", "image/webp", "image/heic", "application/pdf"];
  if (!mime || !allow.includes(mime)) throw new AppError("VALIDATION", { copy: "error.documentType", fields: { file: "type" } });
  let meta: unknown = undefined;
  const m = form.get("meta");
  if (typeof m === "string" && m) {
    try { meta = JSON.parse(m); } catch { throw new AppError("VALIDATION", { fields: { meta: "json" } }); }
  }
  const ext = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp", "image/heic": "heic", "application/pdf": "pdf" }[mime] ?? "bin";
  const name = (file.name || `file.${ext}`).replace(/[\\/]/g, "_").slice(0, 120);
  return { name, mime, bytes, meta };
}
