import "server-only";
import { createHmac } from "node:crypto";
import type { z } from "zod";
import { ERROR_CODES, HEADERS, t, type CopyKey, type ErrorCode, type Vars } from "@mada/shared";
import { pepper } from "./config";
import { idempotencyKeyOf, idempotent } from "./resilience/idempotency";
import { currentRequest, logRequest, withRequest } from "./resilience/request";
import { maintenanceRetryAfter, mustUpdate, runtimeConfig } from "./resilience/runtime";

/** An expected failure with a code from the shared catalogue. Anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: { fields?: Record<string, string>; triesLeft?: number; retryAfter?: number; details?: Record<string, unknown> };
  constructor(code: ErrorCode, opts: { message?: string; vars?: Vars; copy?: CopyKey; fields?: Record<string, string>; triesLeft?: number; retryAfter?: number; details?: Record<string, unknown> } = {}) {
    const def = ERROR_CODES[code];
    super(opts.message ?? t(opts.copy ?? def.copy, opts.vars));
    this.code = code;
    this.status = def.status;
    this.extra = { fields: opts.fields, triesLeft: opts.triesLeft, retryAfter: opts.retryAfter, details: opts.details };
  }
}

const BASE_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

/**
 * The one error envelope: { error: { code, message, fields?, triesLeft?, retryAfter?, details?, requestId? } }, with
 * Retry-After when there's a wait. Inside route() the request id is added; anything unexpected is logged with it
 * and becomes INTERNAL (never a stack trace or a supplier's words).
 */
export function errorResponse(e: unknown): Response {
  const rid = currentRequest()?.id;
  if (e instanceof AppError) {
    const body = { error: { code: e.code, message: e.message, ...Object.fromEntries(Object.entries(e.extra).filter(([, v]) => v !== undefined)), ...(rid ? { requestId: rid } : null) } };
    const headers: Record<string, string> = e.extra.retryAfter ? { "Retry-After": String(e.extra.retryAfter) } : {};
    if (e.status === 401) headers["WWW-Authenticate"] = `Bearer error="${e.code === "TOKEN_EXPIRED" ? "invalid_token" : "unauthorized"}"`;
    return json(body, e.status, headers);
  }
  console.error(`[app-api]${rid ? ` ${rid}` : ""} unexpected error`, e);
  return json({ error: { code: "INTERNAL", message: t("error.internal"), ...(rid ? { requestId: rid } : null) } }, 500);
}

type Handler = (req: Request) => Promise<Response>;

export type RouteOptions = {
  /**
   * Honour Idempotency-Key on POST/PATCH/PUT/DELETE (resilience/idempotency.ts). On by default: a repeat with the
   * same key gets the first answer. Turn off only for routes whose bodies aren't JSON or that must always run.
   */
  idempotent?: boolean;
  /** Skip the maintenance and minimum-version gates (health, config, status, webhooks). */
  ungated?: boolean;
};

/** Paths that answer whatever the app's version or maintenance says: the app needs them to find out. */
const UNGATED = [/\/(health|config|status)$/, /\/payments\/webhook$/, /\/flights\/alerts$/];
const MUTATION = new Set(["POST", "PATCH", "PUT", "DELETE"]);

/**
 * Before the handler: the minimum app version (426 UPGRADE_REQUIRED) and planned maintenance (503 MAINTENANCE for
 * changes; reads and sign-in refresh still work). Exported so other route wrappers can apply the same gates.
 */
export async function gate(req: Request): Promise<void> {
  const path = new URL(req.url).pathname;
  if (UNGATED.some((r) => r.test(path))) return;
  const cfg = await runtimeConfig();
  if (mustUpdate(req.headers.get(HEADERS.appVersion), cfg)) throw new AppError("UPGRADE_REQUIRED", { details: { minVersion: cfg.minVersion, latestVersion: cfg.latestVersion } });
  if (cfg.maintenance.on && MUTATION.has(req.method) && !path.includes("/auth/")) {
    throw new AppError("MAINTENANCE", { message: cfg.maintenance.message ?? undefined, retryAfter: maintenanceRetryAfter(cfg), details: { until: cfg.maintenance.until } });
  }
}

/** Who an idempotency key belongs to: the signed-in user, or the caller's network before sign-in. */
async function idempotencyScope(req: Request): Promise<string> {
  if (req.headers.has("authorization")) {
    try {
      const { authenticate } = await import("./tokens");
      return (await authenticate(req)).userId;
    } catch { /* the handler will answer 401 itself; 401s are never kept */ }
  }
  return `ip:${ipHash(clientIp(req)) ?? "unknown"}`;
}

/** Stamp the request id and the server's clock on a response (the app uses X-Server-Time for countdowns). */
export function stamp(res: Response, rid: string): Response {
  try {
    res.headers.set(HEADERS.requestId, rid);
    res.headers.set("X-Server-Time", String(Date.now()));
    return res;
  } catch {
    // Immutable headers (Response.redirect): copy into a new response.
    const h = new Headers(res.headers);
    h.set(HEADERS.requestId, rid);
    h.set("X-Server-Time", String(Date.now()));
    return new Response(res.body, { status: res.status, statusText: res.statusText, headers: h });
  }
}

/**
 * Wraps a route handler: a request id on the response and in every log line, the version and maintenance gates,
 * Idempotency-Key on mutations, the consistent error envelope, no caching. Other wrappers (bookingRoute,
 * withParams, routeP) get the same by calling `resilient(req, () => …)`.
 */
export function route(fn: Handler, opts: RouteOptions = {}): Handler {
  return (req) => resilient(req, () => fn(req), opts);
}

/** The body of route(), for wrappers that authenticate or read params first. */
export function resilient(req: Request, run: () => Promise<Response>, opts: RouteOptions = {}): Promise<Response> {
  return withRequest(req, async (info) => {
    let res: Response;
    try {
      if (!opts.ungated) await gate(req);
      res = opts.idempotent !== false && MUTATION.has(req.method) && idempotencyKeyOf(req)
        ? await idempotent(req, await idempotencyScope(req), run)
        : await run();
    } catch (e) {
      res = errorResponse(e);
    }
    logRequest(info, res.status, res.headers.get(HEADERS.replayed) ? "replayed" : undefined);
    return stamp(res, info.id);
  });
}

/** Parse a JSON body against a shared schema. Field problems come back as { fields: { path: message } }. */
export async function body<S extends z.ZodType>(req: Request, schema: S): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    const text = await req.text();
    if (text.length > 64_000) throw new AppError("VALIDATION");
    raw = text ? JSON.parse(text) : {};
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("VALIDATION");
  }
  const r = schema.safeParse(raw);
  if (!r.success) {
    const fields: Record<string, string> = {};
    for (const i of r.error.issues) {
      const k = i.path.join(".") || "_";
      if (!fields[k]) fields[k] = i.message;
    }
    throw new AppError("VALIDATION", { fields });
  }
  return r.data;
}

/** The caller's IP. On Vercel, x-real-ip / x-forwarded-for are set by the edge, not the client. */
export function clientIp(req: Request): string | null {
  const h = req.headers;
  return (h.get("x-real-ip") ?? h.get("x-forwarded-for")?.split(",")[0])?.trim().slice(0, 64) || null;
}

/** IPs are only ever stored as a keyed hash (rate limits, audit). */
export const ipHash = (ip: string | null) => (ip ? createHmac("sha256", pepper()).update(`ip:${ip}`).digest("hex").slice(0, 32) : null);

export const userAgent = (req: Request) => req.headers.get("user-agent")?.slice(0, 300) ?? null;
