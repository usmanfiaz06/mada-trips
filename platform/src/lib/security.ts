import "server-only";

/** Only ever redirect inside the platform. Rejects //host, backslashes, dot-segments that climb out, and other origins. */
export function safeNext(next: string | null | undefined, fallback = "/adminwork"): string {
  if (!next || typeof next !== "string" || next.length > 500) return fallback;
  if (!next.startsWith("/") || next.startsWith("//") || next.includes("\\")) return fallback;
  let u: URL;
  try { u = new URL(next, "https://internal.invalid"); } catch { return fallback; }
  if (u.origin !== "https://internal.invalid") return fallback;
  if (u.pathname !== "/adminwork" && !u.pathname.startsWith("/adminwork/")) return fallback;
  return u.pathname + u.search;
}

/** Escape a user string for use inside ILIKE '%…%' (backslash is Postgres' default LIKE escape). */
export const likeContains = (q: string) => `%${q.slice(0, 100).replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

export const isUuid = (s: unknown): s is string => typeof s === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
export const isIsoDate = (s: unknown): s is string => typeof s === "string" && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

/**
 * Identify an upload from its first bytes, never from the browser-supplied type.
 * Only PDF and common photo formats are accepted; anything else returns null.
 */
export function detectFileType(buf: Buffer): string | null {
  if (buf.length < 12) return null;
  const hex = buf.subarray(0, 12).toString("hex");
  if (hex.startsWith("89504e470d0a1a0a")) return "image/png";
  if (hex.startsWith("ffd8ff")) return "image/jpeg";
  if (buf.subarray(0, 5).toString("latin1") === "%PDF-") return "application/pdf";
  if (buf.subarray(0, 4).toString("latin1") === "RIFF" && buf.subarray(8, 12).toString("latin1") === "WEBP") return "image/webp";
  const brand = buf.subarray(4, 12).toString("latin1");
  if (/^ftyp(heic|heix|hevc|heim|heis|mif1|msf1)/.test(brand)) return "image/heic";
  return null;
}
export const SAFE_INLINE_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);

/** Neutralise spreadsheet formulas (=, +, -, @, tab, CR) before a value goes into a CSV export. */
export function csvCell(v: unknown): string {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}
