import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, refreshSession, request, setTransport, timeoutFor, type Wire, type WireResponse } from '@/lib/api';
import { useSession } from '@/lib/session';
import { useGates } from '@/lib/net/gates';
import { resetNet, simulateOffline } from '@/lib/net/state';
import { backoffDelay } from '@/lib/net/retry';
import { clockOffset, noteServerTime, resetClock, serverNow } from '@/lib/net/clock';
import { freshnessLabel } from '@/lib/net/freshness';

/*
 * The API client's rules with a mocked fetch: timeouts, which requests retry and how, refresh once, the session
 * expiry sheet, busy waits, maintenance and update gates, contract drift. Timers run fast (backoff is ms-scale).
 */

const Ok = z.object({ ok: z.boolean() });
const TOKENS = { accessToken: 'a.b.c', accessExpiresAt: new Date(Date.now() + 60_000).toISOString(), refreshToken: 'r1', refreshExpiresAt: new Date(Date.now() + 86_400_000).toISOString() };
const USER = { id: 'u1', name: 'Omar', phone: '+966500004127' } as never;

type FetchCall = { url: string; init: RequestInit };
let calls: FetchCall[] = [];
const res = (status: number, body: unknown, headers: Record<string, string> = {}) => new Response(body === undefined ? '' : JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });
const err = (status: number, code: string, extra: Record<string, unknown> = {}, headers: Record<string, string> = {}) => res(status, { error: { code, message: `m:${code}`, ...extra } }, headers);

function mockFetch(...answers: (Response | Error | 'hang' | ((init: RequestInit) => Promise<Response>))[]) {
  const queue = [...answers];
  const f = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    const next = queue.length > 1 ? queue.shift()! : queue[0]!;
    if (next === 'hang') return new Promise<Response>((_, reject) => init.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))));
    if (typeof next === 'function') return next(init);
    if (next instanceof Error) throw next;
    return next.clone();
  });
  vi.stubGlobal('fetch', f);
  return f;
}
const header = (c: FetchCall, name: string) => (c.init.headers as Record<string, string>)[name];

beforeEach(async () => {
  calls = [];
  resetNet({ connected: true });
  resetClock();
  useGates.setState({ expired: false, update: null, maintenance: null, busyUntil: null });
  await useSession.getState().signIn(TOKENS, USER);
  vi.spyOn(Math, 'random').mockReturnValue(0); // backoff at its floor
});
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('timeouts', () => {
  it('8 s by default, 20 s for searches, payments, orders and refunds', () => {
    expect(timeoutFor('/me')).toBe(8000);
    expect(timeoutFor('/booking/search?to=IST')).toBe(20_000);
    expect(timeoutFor('/orders')).toBe(20_000);
    expect(timeoutFor('/trips/t1/refunds')).toBe(20_000);
    expect(timeoutFor('/payments/intent')).toBe(20_000);
  });

  it('gives up on a hanging request with TIMEOUT', async () => {
    mockFetch('hang');
    const e = await request({ method: 'GET', path: '/me', timeoutMs: 50, retries: 0 }, Ok).catch((x) => x);
    expect(e).toBeInstanceOf(ApiError);
    expect(e.code).toBe('TIMEOUT');
    expect(e.kind).toBe('timeout');
  });

  it('a caller can stop waiting: CANCELLED, no retry', async () => {
    const f = mockFetch('hang');
    const ctrl = new AbortController();
    setTimeout(() => ctrl.abort(), 20);
    const e = await request({ method: 'GET', path: '/me', signal: ctrl.signal }, Ok).catch((x) => x);
    expect(e.code).toBe('CANCELLED');
    expect(f).toHaveBeenCalledTimes(1);
  });
});

describe('retries', () => {
  it('retries a GET on 5xx and network trouble, with the same request id stem', async () => {
    const f = mockFetch(err(502, 'INTERNAL'), new TypeError('fetch failed'), res(200, { ok: true }));
    expect(await request({ method: 'GET', path: '/me' }, Ok)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    const ids = calls.map((c) => header(c, 'X-Request-Id'));
    expect(ids[1]).toBe(`${ids[0]}-1`);
    expect(ids[2]).toBe(`${ids[0]}-2`);
  });

  it('stops after two retries', async () => {
    const f = mockFetch(err(500, 'INTERNAL'));
    const e = await request({ method: 'GET', path: '/me' }, Ok).catch((x) => x);
    expect(e.code).toBe('INTERNAL');
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('never retries a 4xx the server meant', async () => {
    const f = mockFetch(err(400, 'VALIDATION'));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ code: 'VALIDATION' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never retries SUPPLIER_DOWN or MAINTENANCE (the server already said why)', async () => {
    const f = mockFetch(err(503, 'SUPPLIER_DOWN', { details: { supplier: 'flights', label: 'The airline' } }));
    await expect(request({ method: 'GET', path: '/booking/search' }, Ok)).rejects.toMatchObject({ code: 'SUPPLIER_DOWN', kind: 'supplier' });
    expect(f).toHaveBeenCalledTimes(1);
  });

  it('never retries a mutation without its own key (a payment can\'t happen twice), but still sends a key', async () => {
    const f = mockFetch(err(502, 'INTERNAL'));
    await expect(request({ method: 'POST', path: '/orders', body: { a: 1 } }, Ok)).rejects.toMatchObject({ code: 'INTERNAL' });
    expect(f).toHaveBeenCalledTimes(1);
    expect(header(calls[0]!, 'Idempotency-Key')).toMatch(/^m-/);
  });

  it('retries a mutation that carries its own Idempotency-Key, with the same key every time', async () => {
    const f = mockFetch(new TypeError('fetch failed'), err(503, 'INTERNAL'), res(201, { ok: true }));
    expect(await request({ method: 'POST', path: '/orders', body: { a: 1 }, idempotencyKey: 'pay-123456789' }, Ok)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    expect(new Set(calls.map((c) => header(c, 'Idempotency-Key')))).toEqual(new Set(['pay-123456789']));
  });

  it('backs off exponentially with jitter, capped', () => {
    expect(backoffDelay(1, undefined, () => 0)).toBe(200);
    expect(backoffDelay(2, undefined, () => 1)).toBe(800);
    expect(backoffDelay(10, undefined, () => 1)).toBe(4000);
  });

  it('waits as asked on 429 Retry-After, then tries again (any method: the server did nothing)', async () => {
    const f = mockFetch(err(429, 'RATE_LIMITED', {}, { 'Retry-After': '0' }), res(200, { ok: true }));
    vi.spyOn(globalThis, 'setTimeout');
    expect(await request({ method: 'POST', path: '/support/messages', body: {} }, Ok)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(2);
    expect(useGates.getState().busyUntil).not.toBeNull();
  });
});

describe('offline', () => {
  it('fails at once when the phone says offline, without touching the network', async () => {
    const f = mockFetch(res(200, { ok: true }));
    simulateOffline(true);
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ code: 'OFFLINE', kind: 'offline' });
    expect(f).not.toHaveBeenCalled();
    simulateOffline(false);
  });
});

describe('sessions', () => {
  it('refreshes once on TOKEN_EXPIRED and resends', async () => {
    const f = mockFetch(err(401, 'TOKEN_EXPIRED'), res(200, { tokens: { ...TOKENS, accessToken: 'new.a.b', refreshToken: 'r2' } }), res(200, { ok: true }));
    expect(await request({ method: 'GET', path: '/me' }, Ok)).toEqual({ ok: true });
    expect(f).toHaveBeenCalledTimes(3);
    expect(calls[1]!.url).toContain('/auth/refresh');
    expect(header(calls[2]!, 'Authorization')).toBe('Bearer new.a.b');
  });

  it('shares one refresh between requests that expire together', async () => {
    let refreshes = 0;
    mockFetch(async (init) => {
      const auth = (init.headers as Record<string, string>).Authorization;
      if (String(init.body ?? '').includes('refreshToken')) { refreshes += 1; await new Promise((r) => setTimeout(r, 20)); return res(200, { tokens: { ...TOKENS, accessToken: 'fresh.a.b' } }); }
      return auth === 'Bearer fresh.a.b' ? res(200, { ok: true }) : err(401, 'TOKEN_EXPIRED');
    });
    const out = await Promise.all([request({ method: 'GET', path: '/a' }, Ok), request({ method: 'GET', path: '/b' }, Ok), request({ method: 'GET', path: '/c' }, Ok)]);
    expect(out).toHaveLength(3);
    expect(refreshes).toBe(1);
  });

  it('refreshes only once per request: a second TOKEN_EXPIRED is final', async () => {
    const f = mockFetch(err(401, 'TOKEN_EXPIRED'), res(200, { tokens: TOKENS }), err(401, 'TOKEN_EXPIRED'));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(f).toHaveBeenCalledTimes(3);
  });

  it('a refused refresh opens the sign-in-again sheet and keeps the session (and the screen)', async () => {
    mockFetch(err(401, 'TOKEN_EXPIRED'), err(401, 'UNAUTHORIZED'));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ kind: 'auth' });
    expect(useGates.getState().expired).toBe(true);
    expect(useSession.getState().status).toBe('signedIn');
    // While the sheet is open, authenticated calls don't hammer the server.
    const f = mockFetch(res(200, { ok: true }));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    expect(f).not.toHaveBeenCalled();
  });

  it('a revoked session signs the phone out', async () => {
    mockFetch(err(401, 'TOKEN_EXPIRED'), err(401, 'SESSION_REVOKED'));
    await request({ method: 'GET', path: '/me' }, Ok).catch(() => {});
    expect(useSession.getState().status).toBe('signedOut');
  });

  it('refreshSession offline keeps the session', async () => {
    mockFetch(new TypeError('fetch failed'));
    expect(await refreshSession()).toBe(false);
    expect(useSession.getState().status).toBe('signedIn');
  });
});

describe('gates and drift', () => {
  it('426 opens the update screen', async () => {
    mockFetch(err(426, 'UPGRADE_REQUIRED', { details: { minVersion: '2.0.0' } }));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ kind: 'update' });
    expect(useGates.getState().update).toEqual({ minVersion: '2.0.0' });
  });

  it('503 MAINTENANCE opens the maintenance screen with the server\'s words', async () => {
    mockFetch(err(503, 'MAINTENANCE', { details: { until: '2026-10-10T03:00:00Z' } }));
    await expect(request({ method: 'POST', path: '/orders', body: {} }, Ok)).rejects.toMatchObject({ kind: 'maintenance' });
    expect(useGates.getState().maintenance).toMatchObject({ on: true, until: '2026-10-10T03:00:00Z' });
  });

  it('an answer that doesn\'t match the contract is a soft BAD_RESPONSE, never a crash', async () => {
    mockFetch(res(200, { ok: 'yes', extra: 1 }));
    await expect(request({ method: 'GET', path: '/me' }, Ok)).rejects.toMatchObject({ code: 'BAD_RESPONSE', kind: 'contract' });
  });

  it('unknown fields are fine; unknown error codes from a newer server still come through by status', async () => {
    mockFetch(res(200, { ok: true, newField: [1, 2] }));
    expect(await request({ method: 'GET', path: '/me' }, Ok)).toEqual({ ok: true });
    mockFetch(err(500, 'SOMETHING_NEW'));
    await expect(request({ method: 'GET', path: '/me', retries: 0 }, Ok)).rejects.toMatchObject({ code: 'INTERNAL', kind: 'server' });
  });

  it('an HTML error page from a proxy reads as our problem, not a parse crash', async () => {
    mockFetch(new Response('<html>502 Bad Gateway</html>', { status: 502 }));
    await expect(request({ method: 'GET', path: '/me', retries: 0 }, Ok)).rejects.toMatchObject({ kind: 'server' });
  });

  it('sends the app version and keeps the request id from the error body', async () => {
    mockFetch(err(500, 'INTERNAL', { requestId: 'srv-1234567890' }));
    const e = await request({ method: 'GET', path: '/me', retries: 0 }, Ok).catch((x) => x);
    expect(e.requestId).toBe('srv-1234567890');
    expect(header(calls[0]!, 'X-App-Version')).toBe('1.0.0');
  });
});

describe('server clock', () => {
  it('learns the offset from X-Server-Time, so countdowns use the server\'s now', async () => {
    const ahead = Date.now() + 10 * 60_000;
    mockFetch(res(200, { ok: true }, { 'X-Server-Time': String(ahead) }));
    await request({ method: 'GET', path: '/me' }, Ok);
    expect(clockOffset()).toBeGreaterThan(9 * 60_000);
    expect(serverNow() - Date.now()).toBeGreaterThan(9 * 60_000);
  });

  it('ignores samples from very slow round trips', () => {
    noteServerTime(Date.now() + 999_999, Date.now() - 20_000, Date.now());
    expect(clockOffset()).toBe(0);
  });
});

describe('freshness', () => {
  const now = Date.parse('2026-10-10T12:00:00Z');
  it('says how old what is on screen is', () => {
    expect(freshnessLabel(now - 20_000, now)).toBe('Updated just now');
    expect(freshnessLabel(now - 12 * 60_000, now)).toBe('Updated 12 min ago');
    expect(freshnessLabel(now - 5 * 3_600_000, now)).toBe('Updated 5h ago');
    expect(freshnessLabel(now - 3 * 86_400_000, now)).toMatch(/^Updated \w{3} \d{1,2} \w{3}, \d\d:\d\d$/);
    expect(freshnessLabel(null, now)).toBeNull();
  });
});

// Keep setTransport exercised so the export stays a public test seam.
it('lets tests replace the wire', async () => {
  const seen: Wire[] = [];
  setTransport(async (w): Promise<WireResponse> => { seen.push(w); return { status: 200, json: { ok: true } }; });
  expect(await request({ method: 'GET', path: '/x' }, Ok)).toEqual({ ok: true });
  expect(seen[0]?.path).toBe('/x');
});
