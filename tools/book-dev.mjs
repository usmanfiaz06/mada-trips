#!/usr/bin/env node
// Serves the website from the repo root and forwards /api/* to the Core API, so /book runs locally against staging
// the way it runs in production: same origin, no CORS (the app's web build does the same in apps/mobile/vercel.json).
//
//   node tools/book-dev.mjs                      → http://localhost:8820/book.html, API from https://mada-staging.vercel.app
//   API_ORIGIN=http://localhost:3100 PORT=8821 node tools/book-dev.mjs
import { createReadStream, existsSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(fileURLToPath(new URL("..", import.meta.url)));
const PORT = Number(process.env.PORT || 8820);
const API = (process.env.API_ORIGIN || "https://mada-staging.vercel.app").replace(/\/$/, "");
const TYPES = { ".html": "text/html; charset=utf-8", ".js": "text/javascript", ".css": "text/css", ".json": "application/json", ".svg": "image/svg+xml", ".jpg": "image/jpeg", ".png": "image/png", ".mp4": "video/mp4", ".woff2": "font/woff2", ".webmanifest": "application/manifest+json" };

createServer(async (req, res) => {
  const url = new URL(req.url, "http://x");
  if (url.pathname.startsWith("/api/")) {
    const chunks = [];
    for await (const c of req) chunks.push(c);
    const headers = { ...req.headers };
    delete headers.host; delete headers.origin; delete headers.referer; delete headers["accept-encoding"];
    try {
      const r = await fetch(API + url.pathname + url.search, { method: req.method, headers, body: chunks.length ? Buffer.concat(chunks) : undefined, redirect: "manual" });
      const out = {};
      r.headers.forEach((v, k) => { if (!["content-encoding", "content-length", "transfer-encoding", "connection"].includes(k)) out[k] = v; });
      res.writeHead(r.status, out);
      if (!r.body) return res.end();
      // Stream (Ask's chat answers as server-sent events).
      for await (const c of r.body) res.write(c);
      return res.end();
    } catch (e) {
      res.writeHead(502, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: { code: "UPSTREAM", message: String(e) } }));
    }
  }
  let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, "");
  if (p.endsWith("/")) p += "index.html";
  let file = join(root, p);
  if (!existsSync(file) && existsSync(file + ".html")) file += ".html";
  if (!file.startsWith(root) || !existsSync(file) || statSync(file).isDirectory()) { res.writeHead(404); return res.end("Not found"); }
  res.writeHead(200, { "content-type": TYPES[extname(file)] || "application/octet-stream" });
  createReadStream(file).pipe(res);
}).listen(PORT, () => console.log(`/book on http://localhost:${PORT}/book.html · API → ${API}`));
