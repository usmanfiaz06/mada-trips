import "server-only";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

/*
 * The landing pages' own files (./assets): covers, fonts, the brand marks. Read with fs from process.cwd() (the
 * platform folder, locally and on Vercel, whose file tracing ships them with the functions). Only names on these
 * lists are served, so a path can never reach anything else.
 */

const DIR = join(process.cwd(), "src/lib/app/links/assets");
export const ASSETS = {
  cover: { "istanbul.jpg": "image/jpeg", "istanbul-tall.jpg": "image/jpeg", "alula.jpg": "image/jpeg", "riyadh.jpg": "image/jpeg" },
  font: {
    "instrument-serif.ttf": "font/ttf", "plex-arabic-400.woff2": "font/woff2", "plex-arabic-600.woff2": "font/woff2",
    "plex-latin-400.woff2": "font/woff2", "plex-latin-600.woff2": "font/woff2",
  },
  brand: { "wordmark-sand.svg": "image/svg+xml", "symbol-gold.svg": "image/svg+xml" },
} as const;
export type AssetKind = keyof typeof ASSETS;

const cache = new Map<string, Buffer>();
export async function asset(name: string): Promise<Buffer> {
  let b = cache.get(name);
  if (!b) { b = await readFile(join(DIR, name)); cache.set(name, b); }
  return b;
}

/** GET /links/{kind}/{file}: a year in shared caches (the files never change under the same name). */
export async function serveAsset(kind: AssetKind, file: string): Promise<Response> {
  const type = (ASSETS[kind] as Record<string, string>)[file];
  if (!type) return new Response("Not found", { status: 404, headers: { "Content-Type": "text/plain; charset=utf-8" } });
  const body = await asset(file);
  return new Response(new Uint8Array(body), {
    headers: { "Content-Type": type, "Cache-Control": "public, max-age=31536000, immutable", "Access-Control-Allow-Origin": "*", "X-Content-Type-Options": "nosniff" },
  });
}
