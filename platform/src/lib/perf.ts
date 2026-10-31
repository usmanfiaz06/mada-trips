import "server-only";

/**
 * Time a server operation and warn to the logs when it runs slow, so a performance regression
 * surfaces in Vercel's function logs instead of only as a "the system is slow" complaint.
 *
 * It never changes behaviour or adds latency of its own — it just measures and, past the
 * threshold, prints one line like `[slow] app-shell 912ms`. Wrap the hot paths (the per-page
 * app shell, the heaviest pages) so there's always an early signal if something regresses.
 */
export async function observe<T>(label: string, fn: () => Promise<T>, warnMs = 600): Promise<T> {
  const started = Date.now();
  try {
    return await fn();
  } finally {
    const ms = Date.now() - started;
    if (ms >= warnMs) console.warn(`[slow] ${label} ${ms}ms`);
  }
}
