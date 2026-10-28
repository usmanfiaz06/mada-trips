import "server-only";
import { imageOf } from "./shield";
import { isPlacesPhotoUrl, placesPhotoSource } from "./suppliers/places";

/*
 * The image route behind /api/app/v1/img/{token}: fetch the partner's photo once, check it is an image of a sensible
 * size, and answer with our own headers (no partner headers, no Server, no ETag of theirs). A small in-memory cache
 * holds recent photos per instance; browsers and the CDN keep them for a day (s-maxage a week).
 * A Google Places photo (CONNECT.md §32) is asked for in two steps: its media URL with our key in a header (server to
 * Google only) gives a short-lived image address on Google's image host, then the image itself. The key is never in
 * the token, the URL the app sees, a redirect or the answer; these photos are kept a day at most (Google's terms).
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

const GOOGLE_IMAGE_HOST = /^https:\/\/[\w-]+\.(?:googleusercontent|ggpht)\.com\//;
const GOOGLE_CACHE = "public, max-age=86400, s-maxage=86400";

export async function proxiedImage(token: string, f: Fetch = (u, i) => fetch(u, i), now = Date.now(), source: (url: string) => Promise<string | null> = placesPhotoSource): Promise<Response> {
  let url = imageOf(token);
  if (!url) return notFound();
  const google = isPlacesPhotoUrl(url);
  const hit = cache.get(token);
  if (hit && now - hit.at < CACHE_MS) return image(hit.type, hit.bytes, google);
  let res: Response;
  try {
    if (google) {
      const src = await source(url);
      if (!src || !GOOGLE_IMAGE_HOST.test(src)) return notFound();
      url = src;
    }
    res = await f(url, { headers: { Accept: "image/avif,image/webp,image/jpeg,image/png,image/*;q=0.8" }, redirect: google ? "follow" : "error", signal: AbortSignal.timeout(TIMEOUT_MS), cache: google ? "no-store" : "force-cache" });
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
  return image(type, bytes, google);
}

function image(type: string, bytes: Uint8Array, google = false): Response {
  return new Response(bytes as BodyInit, { status: 200, headers: { ...HEADERS, ...(google ? { "Cache-Control": GOOGLE_CACHE } : {}), "Content-Type": type, "Content-Length": String(bytes.length) } });
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
