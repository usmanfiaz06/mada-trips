/*
 * Waiting between tries: exponential backoff with jitter (half fixed, half random), so a thousand phones coming back
 * online at once don't all knock at the same moment. A server's Retry-After wins when it gives one.
 */

export type Backoff = { baseMs: number; capMs: number };
export const DEFAULT_BACKOFF: Backoff = { baseMs: 400, capMs: 4000 };

/** Delay before try number `attempt` (1 = the first retry). `rand` is injectable for tests. */
export function backoffDelay(attempt: number, b: Backoff = DEFAULT_BACKOFF, rand: () => number = Math.random): number {
  const ceiling = Math.min(b.capMs, b.baseMs * 2 ** Math.max(0, attempt - 1));
  return Math.round(ceiling / 2 + rand() * (ceiling / 2));
}

/** Sleep that a signal can cut short (it rejects with the signal's reason). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) { reject(signal.reason); return; }
    const id = setTimeout(() => { signal?.removeEventListener('abort', onAbort); resolve(); }, ms);
    const onAbort = () => { clearTimeout(id); reject(signal?.reason); };
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/** A key for Idempotency-Key: random enough that two phones never collide; the server scopes it per user anyway. */
export function newIdempotencyKey(prefix = 'm'): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return `${prefix}-${c.randomUUID()}`;
  const r = () => Math.random().toString(36).slice(2, 10);
  return `${prefix}-${Date.now().toString(36)}-${r()}${r()}`;
}
