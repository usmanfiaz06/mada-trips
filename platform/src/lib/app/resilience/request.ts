import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";

/*
 * Request ids: every Core API response carries X-Request-Id (the app's own if it sent a sane one, otherwise a new
 * one), every log line for that request carries it, and error bodies repeat it so the app can show "Reference …"
 * and Faisal can find the request. No PII in the log line: method, path, status, time, id.
 */

export type RequestInfo = { id: string; startedAt: number; method: string; path: string };
const store = new AsyncLocalStorage<RequestInfo>();

const SANE = /^[A-Za-z0-9_.:-]{8,64}$/;

export function requestIdFrom(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && SANE.test(given) ? given : randomUUID();
}

export function withRequest<T>(req: Request, fn: (info: RequestInfo) => Promise<T>): Promise<T> {
  const url = new URL(req.url);
  const info: RequestInfo = { id: requestIdFrom(req), startedAt: Date.now(), method: req.method, path: url.pathname };
  return store.run(info, () => fn(info));
}

/** The current request, when running inside route(). */
export const currentRequest = () => store.getStore() ?? null;

const quiet = () => process.env.VITEST === "true" || process.env.NODE_ENV === "test";

/** One line per request. Paths hold ids, never names, numbers or tokens. */
export function logRequest(info: RequestInfo, status: number, extra?: string) {
  const ms = Date.now() - info.startedAt;
  if (quiet() && status < 500) return;
  const line = `[app-api] ${info.id} ${info.method} ${info.path} ${status} ${ms}ms${extra ? ` ${extra}` : ""}`;
  if (status >= 500) console.error(line);
  else if (ms > 2000) console.warn(line);
  else console.info(line);
}
