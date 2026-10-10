import "server-only";
import { createHash } from "node:crypto";
import { and, eq, lt, sql } from "drizzle-orm";
import { HEADERS } from "@mada/shared";
import { db } from "@/db";
import { appIdempotencyKeys } from "@/db/app-schema-resilience";
import { AppError } from "../http";

/*
 * The idempotency store. A mutation sent with `Idempotency-Key: <key>` runs once per (scope, key):
 *   - first time: the key is claimed ("running"), the handler runs, and its answer is kept for 24 hours;
 *   - the same key and the same request again: the kept answer comes back, marked `Idempotency-Replayed: true`;
 *   - the same key while the first is still running: 409 IN_PROGRESS with Retry-After (the app waits and asks again);
 *   - the same key with a different request: 422 IDEMPOTENCY_CONFLICT.
 * Answers the server might give differently next time (5xx, 409, 429, 503) are not kept: the claim is released so a
 * retry runs for real. A claim older than STALE_MS (a function that died mid-way) can be taken over.
 *
 * route() applies this to every POST/PATCH/PUT/DELETE that carries the header; other wrappers call idempotent().
 */

export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;
const STALE_MS = 60_000;
const MAX_BODY = 256_000;
const KEY = /^[A-Za-z0-9_.:-]{8,128}$/;

export const idempotencyKeyOf = (req: Request) => req.headers.get(HEADERS.idempotencyKey);

function hashRequest(method: string, path: string, body: string) {
  return createHash("sha256").update(method).update("\n").update(path).update("\n").update(body).digest("hex");
}

/** Answers that are safe to replay: the outcome won't change if asked again. */
const keepable = (status: number) => status < 500 && status !== 409 && status !== 429 && status !== 401;

function replay(row: { responseStatus: number | null; responseBody: string | null; responseType: string | null }): Response {
  return new Response(row.responseBody ?? "", {
    status: row.responseStatus ?? 200,
    headers: { "Content-Type": row.responseType ?? "application/json; charset=utf-8", "Cache-Control": "no-store", [HEADERS.replayed]: "true" },
  });
}

/**
 * Run `handler` at most once for this request's Idempotency-Key within `scope` (a user id, or "ip:<hash>").
 * Without a key it simply runs. Throws AppError for a malformed key, a conflict or a request still running.
 */
export async function idempotent(req: Request, scope: string, handler: () => Promise<Response>): Promise<Response> {
  const key = idempotencyKeyOf(req);
  if (!key) return handler();
  if (!KEY.test(key)) throw new AppError("VALIDATION", { fields: { [HEADERS.idempotencyKey]: "8 to 128 letters, digits, - _ . or :" } });
  // Uploads and other non-JSON bodies are not kept (too large to hash and store); they rely on their own checks.
  const type = req.headers.get("content-type") ?? "";
  if (type.startsWith("multipart/")) return handler();

  const url = new URL(req.url);
  const body = await req.clone().text();
  const requestHash = hashRequest(req.method, url.pathname, body);
  const now = new Date();

  // Opportunistic cleanup: about one call in fifty clears expired keys.
  if (Math.random() < 0.02) await db.delete(appIdempotencyKeys).where(lt(appIdempotencyKeys.expiresAt, now)).catch(() => {});

  const claimed = await db.insert(appIdempotencyKeys)
    .values({ scope, key, method: req.method, path: url.pathname, requestHash, state: "running", expiresAt: new Date(now.getTime() + IDEMPOTENCY_TTL_MS) })
    .onConflictDoNothing()
    .returning({ key: appIdempotencyKeys.key });

  if (!claimed.length) {
    const [row] = await db.select().from(appIdempotencyKeys).where(and(eq(appIdempotencyKeys.scope, scope), eq(appIdempotencyKeys.key, key))).limit(1);
    if (!row) return idempotent(req, scope, handler); // released between our insert and select: claim again
    if (row.expiresAt.getTime() <= now.getTime()) {
      await db.delete(appIdempotencyKeys).where(and(eq(appIdempotencyKeys.scope, scope), eq(appIdempotencyKeys.key, key), eq(appIdempotencyKeys.expiresAt, row.expiresAt)));
      return idempotent(req, scope, handler);
    }
    if (row.requestHash !== requestHash) throw new AppError("IDEMPOTENCY_CONFLICT");
    if (row.state === "done") return replay(row);
    // Still running. Take over a claim that has gone quiet (its function died); otherwise ask the app to wait.
    if (now.getTime() - row.lockedAt.getTime() < STALE_MS) throw new AppError("IN_PROGRESS", { retryAfter: 2 });
    const took = await db.update(appIdempotencyKeys).set({ lockedAt: now })
      .where(and(eq(appIdempotencyKeys.scope, scope), eq(appIdempotencyKeys.key, key), eq(appIdempotencyKeys.state, "running"), eq(appIdempotencyKeys.lockedAt, row.lockedAt)))
      .returning({ key: appIdempotencyKeys.key });
    if (!took.length) throw new AppError("IN_PROGRESS", { retryAfter: 2 });
  }

  const release = () => db.delete(appIdempotencyKeys).where(and(eq(appIdempotencyKeys.scope, scope), eq(appIdempotencyKeys.key, key), eq(appIdempotencyKeys.state, "running"))).catch(() => {});
  let res: Response;
  try {
    res = await handler();
  } catch (e) {
    // An AppError for a deterministic reason (VALIDATION, FORBIDDEN…) is kept by the caller's envelope next time
    // anyway; releasing keeps the rule simple: a thrown error never sticks to the key.
    await release();
    throw e;
  }
  const responseType = res.headers.get("content-type") ?? "application/json; charset=utf-8";
  const text = await res.clone().text();
  if (!keepable(res.status) || text.length > MAX_BODY || !responseType.includes("json")) {
    await release();
    return res;
  }
  await db.update(appIdempotencyKeys)
    .set({ state: "done", responseStatus: res.status, responseBody: text, responseType, lockedAt: sql`now()` })
    .where(and(eq(appIdempotencyKeys.scope, scope), eq(appIdempotencyKeys.key, key)));
  return res;
}
