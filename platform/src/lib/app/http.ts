import "server-only";
import { createHmac } from "node:crypto";
import type { z } from "zod";
import { ERROR_CODES, t, type CopyKey, type ErrorCode, type Vars } from "@mada/shared";
import { pepper } from "./config";

/** An expected failure with a code from the shared catalogue. Anything else becomes INTERNAL. */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly status: number;
  readonly extra: { fields?: Record<string, string>; triesLeft?: number; retryAfter?: number };
  constructor(code: ErrorCode, opts: { message?: string; vars?: Vars; copy?: CopyKey; fields?: Record<string, string>; triesLeft?: number; retryAfter?: number } = {}) {
    const def = ERROR_CODES[code];
    super(opts.message ?? t(opts.copy ?? def.copy, opts.vars));
    this.code = code;
    this.status = def.status;
    this.extra = { fields: opts.fields, triesLeft: opts.triesLeft, retryAfter: opts.retryAfter };
  }
}

const BASE_HEADERS = { "Cache-Control": "no-store", "Content-Type": "application/json; charset=utf-8", "X-Content-Type-Options": "nosniff" };

export function json(data: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(data), { status, headers: { ...BASE_HEADERS, ...headers } });
}

export function errorResponse(e: unknown): Response {
  if (e instanceof AppError) {
    const body = { error: { code: e.code, message: e.message, ...Object.fromEntries(Object.entries(e.extra).filter(([, v]) => v !== undefined)) } };
    const headers: Record<string, string> = e.extra.retryAfter ? { "Retry-After": String(e.extra.retryAfter) } : {};
    if (e.status === 401) headers["WWW-Authenticate"] = `Bearer error="${e.code === "TOKEN_EXPIRED" ? "invalid_token" : "unauthorized"}"`;
    return json(body, e.status, headers);
  }
  console.error("[app-api] unexpected error", e);
  return json({ error: { code: "INTERNAL", message: t("error.internal") } }, 500);
}

type Handler = (req: Request) => Promise<Response>;

/** Wraps a route handler: consistent error envelope, no caching. */
export function route(fn: Handler): Handler {
  return async (req) => {
    try {
      return await fn(req);
    } catch (e) {
      return errorResponse(e);
    }
  };
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
