import { readdirSync } from "node:fs";
import { basename, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { expect } from "vitest";

/** Call a route handler the way Next does: a standard Request in, a Response out. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Handler = (req: Request, ctx?: any) => Promise<Response>;

/*
 * Every test file shares one database, so per-IP and per-phone limits would leak between files that happened to
 * pick the same addresses or numbers. Each file gets its own block instead: its place among the test files.
 */
const FILES = readdirSync(dirname(fileURLToPath(import.meta.url))).filter((f) => f.endsWith(".test.ts")).sort();
const slot = Math.max(0, FILES.indexOf(basename(String(expect.getState().testPath ?? ""))));

let ipSeq = slot * 2 ** 18 + 1_000;
/** Each test gets its own network address unless it asks for one, so per-IP limits don't leak between tests. */
export const freshIp = () => { ipSeq += 1; return `10.${ipSeq >> 16 & 255}.${(ipSeq >> 8) & 255}.${ipSeq & 255}`; };

export async function call(handler: Handler, opts: { method?: string; path?: string; body?: unknown; token?: string; ip?: string; raw?: string } = {}) {
  const headers: Record<string, string> = { "content-type": "application/json", "x-forwarded-for": opts.ip ?? "10.0.0.1", "user-agent": "vitest" };
  if (opts.token) headers.authorization = `Bearer ${opts.token}`;
  const req = new Request(`http://localhost${opts.path ?? "/api/app/v1/test"}`, {
    method: opts.method ?? "POST", headers,
    body: opts.raw ?? (opts.body === undefined ? undefined : JSON.stringify(opts.body)),
  });
  const res = await handler(req, { params: Promise.resolve({}) });
  const text = await res.text();
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, headers: res.headers, json: (text ? JSON.parse(text) : null) as any };
}

let phoneSeq = slot * 1_000_000 + 1_000;
/** A unique, valid Saudi mobile number per call (each file its own block, so test files never share one). */
export const newPhone = () => `+9665${String(10000000 + ((++phoneSeq * 7919) % 89999999)).padStart(8, "0")}`;
