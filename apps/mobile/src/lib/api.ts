import Constants from 'expo-constants';
import { Platform } from 'react-native';
import { z } from 'zod';
import {
  API_PREFIX, ApiErrorBody, ERROR_CODES, HEADERS, MeResponse, OtpStartResponse, PeopleResponse, PersonResponse, RefreshResponse, ROUTES, SignInResponse, TIMEOUTS, errorKind,
  type ClientOnlyErrorCode, type CreatePersonRequest, type DeviceInfo, type ErrorCode, type ErrorKind, type UpdateMeRequest,
} from '@mada/shared';
import { API_MODE, API_ORIGIN } from './config';
import { useSession } from './session';
import { t } from './i18n';
import { noteServerTime } from './net/clock';
import { getAppVersion, noteBusy, noteMaintenance, noteSessionExpired, noteUpgradeRequired, setAppVersion, useGates } from './net/gates';
import { breadcrumb } from './net/report';
import { backoffDelay, newIdempotencyKey, sleep } from './net/retry';
import { isOffline, reportReached, reportUnreachable } from './net/state';

/*
 * The Core API client. Plain JSON; every response is checked against the shared zod schema, so a contract drift shows
 * up as a soft "part of this didn't load" instead of a blank screen or a crash.
 *
 * When things go wrong (FLOWS.md §12):
 *   - every request has a timeout: 8 s, or 20 s for searches, payments, orders and refunds (TIMEOUTS);
 *   - offline (the phone says so) fails at once with OFFLINE instead of waiting;
 *   - GETs retry network trouble and 5xx up to twice, with exponential backoff and jitter. Mutations retry only when
 *     the caller passes its own `idempotencyKey` (the server then answers a repeat with the first answer). Every
 *     mutation still sends an Idempotency-Key, so a duplicate that slips through is harmless where the server honours it;
 *   - 429 / IN_PROGRESS with Retry-After ≤ 10 s: wait as asked ("Trying again in N seconds"), then try again;
 *   - 401 TOKEN_EXPIRED: refresh once (single-flight) and resend. If the refresh is refused, the sign-in-again sheet
 *     opens over the current screen, so nothing typed is lost; SESSION_REVOKED signs the phone out;
 *   - 426 / UPGRADE_REQUIRED: the update screen. 503 MAINTENANCE: the maintenance screen;
 *   - every response's X-Server-Time keeps the server clock (net/clock.ts) for countdowns.
 */

export type ClientErrorCode = ErrorCode | ClientOnlyErrorCode;

type Extra = { triesLeft?: number; retryAfter?: number; fields?: Record<string, string>; details?: Record<string, unknown>; requestId?: string };

export class ApiError extends Error {
  constructor(
    readonly code: ClientErrorCode,
    message: string,
    readonly status: number,
    readonly extra: Extra = {},
  ) { super(message); this.name = 'ApiError'; }
  /** The one state to show for it: offline, timeout, busy, supplier, server… (shared errorKind). */
  get kind(): ErrorKind { return errorKind(this.code, this.status); }
  get retryAfter() { return this.extra.retryAfter; }
  get details() { return this.extra.details; }
  get requestId() { return this.extra.requestId; }
}

export type Wire = {
  method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE'; path: string; body?: unknown; token?: string | null;
  /** Extra request headers (Idempotency-Key, X-Request-Id…). */
  headers?: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
};
export type WireResponse = { status: number; json: unknown; headers?: Record<string, string> };

setAppVersion(Constants.expoConfig?.version);

const LONG = /\/(search|payments?|pay|orders?|refunds?|checkout|quotes\/[^/]+\/accept|plans\/[^/]+\/book)(\/|$|\?)/;
/** Searches, payments, orders and refunds wait on suppliers: 20 s. Everything else: 8 s. */
export const timeoutFor = (path: string) => (LONG.test(path) ? TIMEOUTS.long : TIMEOUTS.default);

let ridSeq = 0;
const requestId = () => `m${Date.now().toString(36)}${(ridSeq++ % 1296).toString(36).padStart(2, '0')}${Math.random().toString(36).slice(2, 6)}`;

/** One HTTP round trip with a timeout. Never throws for an HTTP status; throws ApiError OFFLINE/TIMEOUT/CANCELLED. */
async function httpTransport(w: Wire): Promise<WireResponse> {
  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => { timedOut = true; ctrl.abort(); }, w.timeoutMs ?? timeoutFor(w.path));
  const onAbort = () => ctrl.abort();
  w.signal?.addEventListener('abort', onAbort, { once: true });
  const sentAt = Date.now();
  let res: Response;
  try {
    if (w.signal?.aborted) throw new ApiError('CANCELLED', t('slow.cancel'), 0);
    res = await fetch(`${API_ORIGIN}${API_PREFIX}${w.path}`, {
      method: w.method,
      signal: ctrl.signal,
      headers: {
        Accept: 'application/json',
        [HEADERS.appVersion]: getAppVersion(),
        ...(w.body !== undefined ? { 'Content-Type': 'application/json' } : null),
        ...(w.token ? { Authorization: `Bearer ${w.token}` } : null),
        ...w.headers,
      },
      body: w.body !== undefined ? JSON.stringify(w.body) : undefined,
    });
  } catch (e) {
    if (e instanceof ApiError) throw e;
    if (timedOut) throw new ApiError('TIMEOUT', t('error.timeout'), 0);
    if (w.signal?.aborted) throw new ApiError('CANCELLED', t('slow.cancel'), 0);
    reportUnreachable();
    throw new ApiError('OFFLINE', t('error.offline'), 0);
  } finally {
    clearTimeout(timer);
    w.signal?.removeEventListener('abort', onAbort);
  }
  const receivedAt = Date.now();
  reportReached(receivedAt - sentAt);
  const headers: Record<string, string> = {};
  res.headers.forEach((v, k) => { headers[k.toLowerCase()] = v; });
  if (headers['x-server-time']) noteServerTime(Number(headers['x-server-time']), sentAt, receivedAt);
  let text: string;
  try { text = await res.text(); } catch { throw new ApiError(timedOut ? 'TIMEOUT' : 'OFFLINE', t(timedOut ? 'error.timeout' : 'error.offline'), 0); }
  let json: unknown = null;
  try { json = text ? JSON.parse(text) : null; } catch {
    // A proxy's HTML error page, a captive portal: not our server talking.
    if (res.status >= 500 || res.status === 0) return { status: res.status, json: { error: { code: 'INTERNAL', message: t('error.internal') } }, headers };
    throw new ApiError('BAD_RESPONSE', t('problem.partial.title'), res.status, { requestId: headers['x-request-id'] });
  }
  return { status: res.status, json, headers };
}

/*
 * The mock loads on first use, in mock mode only: a production build never runs it, and on the web its code and data
 * (the bundled city list alone is about 240 KB) sit in their own chunk that live mode never fetches.
 */
let mockModule: Promise<typeof import('./mock-api')> | null = null;
const mockTransport = (w: Wire) => (mockModule ??= import('./mock-api')).then((m) => m.mockTransport(w));

/** The in-app mock, with the same timeouts and the same offline rule, so mock mode behaves like the real thing. */
async function mockWire(w: Wire): Promise<WireResponse> {
  if (isOffline()) throw new ApiError('OFFLINE', t('error.offline'), 0);
  // e2e only: EXPO_PUBLIC_MOCK_WIRE=http sends a real request first, so Playwright's network emulation (offline, slow
  // 3G, page.route answering 500/503/429/426) applies; the test server answers "x-mada-mock: pass" to let the mock reply.
  if (process.env.EXPO_PUBLIC_MOCK_WIRE === 'http') {
    const r = await httpTransport(w);
    if (r.headers?.['x-mada-mock'] !== 'pass') return r;
  }
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ApiError('TIMEOUT', t('error.timeout'), 0)), w.timeoutMs ?? timeoutFor(w.path)); });
  try { return await Promise.race([mockTransport(w), timeout]); } finally { clearTimeout(timer); }
}

/** The raw wire (no retries, no refresh). Area clients use request(); uploads may use this directly. */
let transport: (w: Wire) => Promise<WireResponse> = API_MODE === 'mock' ? mockWire : httpTransport;
/** Tests replace the wire. */
export const setTransport = (fn: (w: Wire) => Promise<WireResponse>) => { transport = fn; };

/** The shared envelope, but any code: an older app must still read a newer server's errors. */
const PermissiveError = ApiErrorBody.shape.error.extend({ code: z.string().min(1) });

function toError(r: WireResponse): ApiError {
  // A code this app doesn't know yet (a newer server) still comes through, as its HTTP status's kind.
  const body = (r.json as { error?: unknown } | null)?.error;
  const parsed = PermissiveError.safeParse(body);
  const requestId = r.headers?.['x-request-id'];
  if (!parsed.success) {
    const code: ClientErrorCode = r.status === 426 ? 'UPGRADE_REQUIRED' : r.status === 429 ? 'RATE_LIMITED' : r.status === 404 ? 'NOT_FOUND' : r.status === 401 ? 'UNAUTHORIZED' : r.status === 403 ? 'FORBIDDEN' : 'INTERNAL';
    const retry = Number(r.headers?.['retry-after']);
    return new ApiError(code, t(ERROR_CODES[code as ErrorCode]?.copy ?? 'error.internal', { seconds: retry || 30 }), r.status, { requestId, retryAfter: Number.isFinite(retry) && retry > 0 ? retry : undefined });
  }
  const { code, message, ...extra } = parsed.data;
  const retryHeader = Number(r.headers?.['retry-after']);
  const known = code in ERROR_CODES ? (code as ErrorCode) : (r.status >= 500 ? 'INTERNAL' : r.status === 404 ? 'NOT_FOUND' : 'VALIDATION');
  return new ApiError(known, message, r.status, {
    ...extra,
    retryAfter: extra.retryAfter ?? (Number.isFinite(retryHeader) && retryHeader > 0 ? retryHeader : undefined),
    requestId: extra.requestId ?? requestId,
  });
}

let refreshing: Promise<boolean> | null = null;

/** Swap the refresh token for a new pair. Concurrent callers share one attempt. */
export function refreshSession(): Promise<boolean> {
  refreshing ??= (async () => {
    const s = useSession.getState();
    if (!s.tokens) return false;
    try {
      const r = await transport({ method: 'POST', path: ROUTES.refresh, body: { refreshToken: s.tokens.refreshToken }, headers: { [HEADERS.requestId]: requestId() } });
      if (r.status !== 200) {
        if (r.status === 401) {
          const code = (r.json as { error?: { code?: string } } | null)?.error?.code;
          // Revoked (signed out everywhere, a reused token): this phone is signed out. Anything else (the refresh
          // token simply ran out): sign in again over the current screen, keeping the traveller's place.
          if (code === 'SESSION_REVOKED') await s.clear();
          else noteSessionExpired();
        }
        return false;
      }
      await s.setTokens(RefreshResponse.parse(r.json).tokens);
      return true;
    } catch {
      return false; // offline: keep the session, try again later
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

export type RequestOptions = {
  /** Send the access token (default true). */
  auth?: boolean;
  /** Override the timeout (ms). */
  timeoutMs?: number;
  /**
   * Your own Idempotency-Key, kept across retries (and across app restarts if you store it, as the outbox does).
   * Passing one makes a mutation retryable. Without one, mutations get a fresh key and are never retried.
   */
  idempotencyKey?: string;
  /** How many times to retry network trouble and 5xx (default 2 for GETs and keyed mutations, else 0). */
  retries?: number;
  /** Cancel (React Query passes one to queryFn; "Stop waiting" aborts it). */
  signal?: AbortSignal;
};

const RETRYABLE_5XX = (e: ApiError) => e.status >= 500 && e.status !== 501 && e.code !== 'MAINTENANCE' && e.code !== 'SUPPLIER_DOWN' && e.code !== 'NOT_CONFIGURED';

async function request<S extends z.ZodType>(w: Omit<Wire, 'token' | 'headers' | 'signal' | 'timeoutMs'> & RequestOptions, schema: S): Promise<z.infer<S>> {
  const auth = w.auth ?? true;
  const mutation = w.method !== 'GET';
  const key = mutation ? (w.idempotencyKey ?? newIdempotencyKey()) : undefined;
  const maxRetries = w.retries ?? (!mutation || w.idempotencyKey ? 2 : 0);
  const rid = requestId();
  let attempt = 0;
  let waits = 0;
  let refreshed = false;

  for (;;) {
    if (isOffline()) throw new ApiError('OFFLINE', t('error.offline'), 0);
    if (auth && useGates.getState().expired && useSession.getState().tokens) throw new ApiError('TOKEN_EXPIRED', t('error.sessionExpired'), 401);
    let r: WireResponse;
    try {
      r = await transport({
        method: w.method, path: w.path, body: w.body, signal: w.signal, timeoutMs: w.timeoutMs,
        token: auth ? useSession.getState().tokens?.accessToken : null,
        headers: { [HEADERS.requestId]: attempt ? `${rid}-${attempt}` : rid, ...(key ? { [HEADERS.idempotencyKey]: key } : null) },
      });
    } catch (e) {
      const err = e instanceof ApiError ? e : new ApiError('OFFLINE', t('error.offline'), 0);
      if ((err.code === 'OFFLINE' || err.code === 'TIMEOUT') && attempt < maxRetries && !isOffline()) {
        attempt += 1;
        await sleep(backoffDelay(attempt), w.signal).catch(() => { throw new ApiError('CANCELLED', t('slow.cancel'), 0); });
        continue;
      }
      breadcrumb('api', `${w.method} ${w.path} ${err.code}`);
      throw err;
    }

    if (auth && r.status === 401 && !refreshed && (r.json as { error?: { code?: string } } | null)?.error?.code === 'TOKEN_EXPIRED') {
      refreshed = true;
      if (await refreshSession()) continue;
    }

    if (r.status >= 400) {
      const e = toError(r);
      if (e.code === 'UPGRADE_REQUIRED' || r.status === 426) noteUpgradeRequired(e.details?.minVersion);
      if (e.code === 'MAINTENANCE') noteMaintenance({ message: e.message, until: typeof e.details?.until === 'string' ? e.details.until : null });
      // The server asked us to wait a little: wait as asked, then try again (it didn't do the work).
      if ((r.status === 429 || e.code === 'IN_PROGRESS') && waits < 2 && (e.retryAfter ?? 1) <= 10) {
        waits += 1;
        const seconds = e.retryAfter ?? 1;
        noteBusy(seconds);
        await sleep(seconds * 1000, w.signal).catch(() => { throw new ApiError('CANCELLED', t('slow.cancel'), 0); });
        continue;
      }
      if (RETRYABLE_5XX(e) && attempt < maxRetries) {
        attempt += 1;
        await sleep(backoffDelay(attempt), w.signal).catch(() => { throw new ApiError('CANCELLED', t('slow.cancel'), 0); });
        continue;
      }
      if (auth && r.status === 401 && useSession.getState().tokens) {
        if (e.code === 'SESSION_REVOKED') await useSession.getState().clear();
        else noteSessionExpired();
      }
      breadcrumb('api', `${w.method} ${w.path} ${r.status} ${e.code}`, { requestId: e.requestId });
      throw e;
    }

    const parsed = schema.safeParse(r.json);
    if (!parsed.success) {
      // A newer or older server: say part of it didn't load, never crash.
      console.warn('[api] response did not match the contract', w.path, parsed.error.issues.slice(0, 3));
      breadcrumb('contract', `${w.method} ${w.path}`, { issues: parsed.error.issues.length });
      throw new ApiError('BAD_RESPONSE', t('problem.partial.title'), r.status, { requestId: r.headers?.['x-request-id'] });
    }
    return parsed.data;
  }
}

export function deviceInfo(): DeviceInfo {
  return {
    platform: Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : 'web',
    name: (Constants.deviceName ?? undefined)?.slice(0, 80),
    appVersion: Constants.expoConfig?.version,
  };
}

export const api = {
  startOtp: (phone: string) => request({ method: 'POST', path: ROUTES.otpStart, body: { phone }, auth: false }, OtpStartResponse),
  /** Sends the access token when there is one: a phone added after Apple/Google sign-in joins that account. */
  verifyOtp: (phone: string, code: string) => request({ method: 'POST', path: ROUTES.otpVerify, body: { phone, code, device: deviceInfo() }, auth: !!useSession.getState().tokens }, SignInResponse),
  signInWith: (provider: 'apple' | 'google', idToken: string, givenName?: string) =>
    request({ method: 'POST', path: provider === 'apple' ? ROUTES.apple : ROUTES.google, body: { idToken, givenName, device: deviceInfo() }, auth: false }, SignInResponse),
  me: () => request({ method: 'GET', path: ROUTES.me }, MeResponse),
  updateMe: (patch: UpdateMeRequest) => request({ method: 'PATCH', path: ROUTES.me, body: patch }, MeResponse),
  people: () => request({ method: 'GET', path: ROUTES.people }, PeopleResponse),
  addPerson: (p: CreatePersonRequest) => request({ method: 'POST', path: ROUTES.people, body: p }, PersonResponse),
  async logout() {
    const s = useSession.getState();
    try {
      if (s.tokens) await transport({ method: 'POST', path: ROUTES.logout, body: { refreshToken: s.tokens.refreshToken }, token: s.tokens.accessToken });
    } catch { /* offline: the server forgets the session when it expires */ } finally {
      await s.clear();
    }
  },
};

/** For area clients (lib/<area>.ts): the same checked, refreshing request. `transport` is the raw wire. */
const rawTransport = (w: Wire) => transport(w);
export { request, rawTransport as transport };
