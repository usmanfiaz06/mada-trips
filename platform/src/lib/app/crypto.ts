import "server-only";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { AppError } from "./http";

/*
 * Field encryption for sensitive values (passport numbers). AES-256-GCM with a random 96-bit IV per value.
 * The associated data binds a ciphertext to its row and column, so a value copied onto another row won't decrypt.
 *
 * Stored form: v1.<keyId>.<iv>.<tag>.<ciphertext>  (base64url parts; keyId = first 8 hex of sha256(key))
 * Rotation: put the new key in APP_DATA_KEY and the old one in APP_DATA_KEYS_OLD; old values still decrypt,
 * and re-encrypt on their next write.
 */

type Key = { id: string; key: Buffer };

function parseKey(b64: string): Key {
  const key = Buffer.from(b64.trim(), "base64");
  if (key.length !== 32) throw new Error("APP_DATA_KEY must be base64 of exactly 32 bytes (openssl rand -base64 32)");
  return { id: createHash("sha256").update(key).digest("hex").slice(0, 8), key };
}

export function hasDataKey(): boolean {
  try { return !!currentKey(); } catch { return false; }
}

function currentKey(): Key | null {
  const k = process.env.APP_DATA_KEY;
  return k ? parseKey(k) : null;
}

function allKeys(): Key[] {
  const cur = currentKey();
  const old = (process.env.APP_DATA_KEYS_OLD ?? "").split(",").map((s) => s.trim()).filter(Boolean).map(parseKey);
  return [...(cur ? [cur] : []), ...old];
}

const b64u = (b: Buffer) => b.toString("base64url");

export function encryptField(plaintext: string, aad: string): string {
  const k = currentKey();
  if (!k) throw new AppError("NOT_CONFIGURED");
  const iv = randomBytes(12);
  const c = createCipheriv("aes-256-gcm", k.key, iv);
  c.setAAD(Buffer.from(aad, "utf8"));
  const ct = Buffer.concat([c.update(plaintext, "utf8"), c.final()]);
  return ["v1", k.id, b64u(iv), b64u(c.getAuthTag()), b64u(ct)].join(".");
}

export function decryptField(stored: string, aad: string): string {
  const [v, id, iv, tag, ct] = stored.split(".");
  if (v !== "v1" || !id || !iv || !tag || ct === undefined) throw new Error("Unrecognised ciphertext");
  const k = allKeys().find((x) => x.id === id);
  if (!k) throw new Error(`No key ${id} for this value`);
  const d = createDecipheriv("aes-256-gcm", k.key, Buffer.from(iv, "base64url"));
  d.setAAD(Buffer.from(aad, "utf8"));
  d.setAuthTag(Buffer.from(tag, "base64url"));
  return Buffer.concat([d.update(Buffer.from(ct, "base64url")), d.final()]).toString("utf8");
}

export const passportAad = (personId: string) => `app_people:${personId}:passport_number`;
