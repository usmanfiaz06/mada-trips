import "server-only";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { isLocale, pickLocale, setLocaleResolver, type Lang } from "@mada/shared";

/*
 * Request ids: every Core API response carries X-Request-Id (the app's own if it sent a sane one, otherwise a new
 * one), every log line for that request carries it, and error bodies repeat it so the app can show "Reference …"
 * and Faisal can find the request. No PII in the log line: method, path, status, time, id.
 */

export type RequestInfo = { id: string; startedAt: number; method: string; path: string; locale: Lang };
const store = new AsyncLocalStorage<RequestInfo>();

/*
 * Language (COPY.md §7.4): every word the Core API returns (errors, notifications, texts, emails, invoices) is in the
 * traveller's language. A request starts in its Accept-Language; once signed in, the language saved on the account
 * wins. Work done for another traveller (the desk writing to them, a push to a circle member) runs inLocale() of
 * that traveller.
 */
const scoped = new AsyncLocalStorage<Lang>();
setLocaleResolver(() => scoped.getStore() ?? store.getStore()?.locale ?? null);

/** Run fn with every t() inside it in this language. */
export const inLocale = <T>(locale: Lang, fn: () => T): T => scoped.run(locale, fn);
/** The language of the request (or scope) being handled. */
export const currentLocale = (): Lang => scoped.getStore() ?? store.getStore()?.locale ?? "en";
/** Once the account is known, its saved language replaces Accept-Language for the rest of the request. */
export function setRequestLocale(locale: string | null | undefined) {
  const info = store.getStore();
  if (info && isLocale(locale)) info.locale = locale;
}

const SANE = /^[A-Za-z0-9_.:-]{8,64}$/;

export function requestIdFrom(req: Request): string {
  const given = req.headers.get("x-request-id");
  return given && SANE.test(given) ? given : randomUUID();
}

export function withRequest<T>(req: Request, fn: (info: RequestInfo) => Promise<T>): Promise<T> {
  const url = new URL(req.url);
  const info: RequestInfo = { id: requestIdFrom(req), startedAt: Date.now(), method: req.method, path: url.pathname, locale: pickLocale(req.headers.get("accept-language")) };
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
