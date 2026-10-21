import "server-only";
import { createHmac } from "node:crypto";
import { AppError } from "../http";

/*
 * Document fingerprints (docs/app/ASK-INTEGRATED.md §1.2, U6): "is this the same passport again?" answered without
 * decrypting anything. HMAC-SHA256 under a server pepper of the normalised kind, issuer, number and date of birth, so
 * the same passport read twice (a scan, a photo in Ask, typed by hand) gives the same value, and nothing about the
 * number can be learnt from it.
 *
 *   APP_FINGERPRINT_KEY  base64 of 32 bytes. Optional: without it the pepper is derived from APP_DATA_KEY. Set it before
 *                        rotating APP_DATA_KEY, or the documents job recomputes nothing (it only fills empty ones).
 */

let cached: { from: string; key: Buffer } | null = null;

function pepper(): Buffer {
  const own = process.env.APP_FINGERPRINT_KEY?.trim();
  const data = process.env.APP_DATA_KEY?.trim();
  const from = own ? `own:${own}` : data ? `data:${data}` : "";
  if (!from) throw new AppError("NOT_CONFIGURED");
  if (cached?.from === from) return cached.key;
  const key = own ? Buffer.from(own, "base64") : createHmac("sha256", Buffer.from(data!, "base64")).update("mada-document-fingerprint-v1").digest();
  if (key.length < 32) throw new Error("APP_FINGERPRINT_KEY must be base64 of 32 bytes");
  cached = { from, key };
  return key;
}

export type FingerprintKind = "passport" | "visa" | "id";

const letters = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z]/g, "");
const code = (s: string | null | undefined) => (s ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");

/** The fingerprint of one document. The date of birth as YYYY-MM-DD (empty when unknown: then only an exact retype matches). */
export function documentFingerprint(kind: FingerprintKind, p: { issuer: string | null | undefined; number: string; dob: string | null | undefined }): string {
  const dob = /^\d{4}-\d{2}-\d{2}$/.test(p.dob ?? "") ? p.dob! : "";
  return createHmac("sha256", pepper()).update(`${kind}|${letters(p.issuer)}|${code(p.number)}|${dob}`).digest("hex");
}

export const passportFingerprint = (p: { issuer: string | null | undefined; number: string; dob: string | null | undefined }) => documentFingerprint("passport", p);

