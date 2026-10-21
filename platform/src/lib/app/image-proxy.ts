import "server-only";
import { imageOf } from "./shield";

/*
 * The image route behind /api/app/v1/img/{token}: fetch the partner's photo once, check it is an image of a sensible
 * size, and answer with our own headers (no partner headers, no Server, no ETag of theirs). A small in-memory cache
 * holds recent photos per instance; browsers and the CDN keep them for a day (s-maxage a week).
 */

const MAX_BYTES = 6 * 1024 * 1024;
const TIMEOUT_MS = 8000;
const TYPES = new Set(["image/jpeg", "image/png", "image/webp", "image/gif", "image/avif"]);
const CACHE_MAX = 200;
const cache = new Map<string, { type: string; bytes: Uint8Array; at: number }>();
const CACHE_MS = 6 * 3600_000;

const HEADERS = {
  "Cache-Control": "public, max-age=86400, s-maxage=604800, stale-while-revalidate=86400, immutable",
  "X-Content-Type-Options": "nosniff",
  "Content-Security-Policy": "default-src 'none'; sandbox",
  "Referrer-Policy": "no-referrer",
  "Cross-Origin-Resource-Policy": "cross-origin",
};

const notFound = () => new Response(null, { status: 404, headers: { "Cache-Control": "public, max-age=300" } });

type Fetch = (url: string, init: RequestInit) => Promise<Response>;

export async function proxiedImage(token: string, f: Fetch = (u, i) => fetch(u, i), now = Date.now()): Promise<Response> {
  const url = imageOf(token);
  if (!url) return notFound();
  const hit = cache.get(token);
  if (hit && now - hit.at < CACHE_MS) return image(hit.type, hit.bytes);
  let res: Response;
  try {
    res = await f(url, { headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" }, redirect: "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: "force-cache" });
  } catch {
    return new Response(null, { status: 502, headers: { "Cache-Control": "no-store" } });
  }
  const type = (res.headers.get("content-type") ?? "").split(";")[0]!.trim().toLowerCase();
  const said = Number(res.headers.get("content-length") ?? 0);
  if (!res.ok || !TYPES.has(type) || said > MAX_BYTES || !res.body) return notFound();
  const bytes = await capped(res.body);
  if (!bytes) return notFound();
  if (cache.size >= CACHE_MAX) cache.delete(cache.keys().next().value!);
  cache.set(token, { type, bytes, at: now });
  return image(type, bytes);
}

function image(type: string, bytes: Uint8Array): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { ...HEADERS, "Content-Type": type, "Content-Length": String(bytes.length) } });
}

/** The body, or null past MAX_BYTES (a server that didn't say its length). */
async function capped(body: ReadableStream<Uint8Array>): Promise<Uint8Array | null> {
  const reader = body.getReader();
  const parts: Uint8Array[] = [];
  let n = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > MAX_BYTES) { await reader.cancel().catch(() => {}); return null; }
    parts.push(value);
  }
  const out = new Uint8Array(n);
  let o = 0;
  for (const p of parts) { out.set(p, o); o += p.length; }
  return out;
}

export const clearImageCache = () => cache.clear();
