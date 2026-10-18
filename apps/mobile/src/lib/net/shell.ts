import { Platform } from 'react-native';
import { create } from 'zustand';

/*
 * The web build's shell (public/sw.js): a reload with no signal opens the app, and the app opens the trips saved on
 * this device (lib/net/persist.ts). Phones don't need it: the app is installed. Only on a secure origin with service
 * workers; local dev servers (expo start) are left alone so a stale bundle never gets in the way of hot reload.
 *
 * Updates: each export is a build, named by the hash in its entry bundle (entry-<hash>.js). The worker is registered
 * as /sw.js?build=<that>, so a new deploy installs a new worker that takes over at once and keeps its own cache. A tab
 * already open keeps running the app it started with (its screens still load from the last build's cache); once the
 * page, the worker or a quiet check of "/" says a newer build is out, `useShellUpdate().ready` turns on and the root
 * layout shows "A new version is ready · Refresh". The next cold open is simply the new build (the page is fetched
 * network first).
 */

type SwLike = { postMessage(m: unknown): void; scriptURL?: string };
type SwContainer = {
  register(url: string, opts?: { scope?: string; updateViaCache?: 'none' | 'all' | 'imports' }): Promise<{ active?: SwLike | null; update?: () => Promise<unknown> }>;
  ready: Promise<{ active?: SwLike | null }>;
  controller?: SwLike | null;
  addEventListener?: (type: string, fn: (e: { data?: unknown }) => void) => void;
};

const container = (): SwContainer | null => {
  if (Platform.OS !== 'web') return null;
  const nav = globalThis.navigator as (Navigator & { serviceWorker?: SwContainer }) | undefined;
  if (!nav?.serviceWorker || !(globalThis as { isSecureContext?: boolean }).isSecureContext) return null;
  return nav.serviceWorker;
};

/** A page's build: the hash in its entry bundle's name. The same rule as public/sw.js. */
export function buildOf(html: string | null | undefined): string | null {
  const m = /\/_expo\/static\/js\/web\/entry-([A-Za-z0-9]+)\.js/.exec(html ?? '');
  return m ? m[1]! : null;
}

/** The build this page is running, from its own script tags. */
export function runningBuild(): string | null {
  if (Platform.OS !== 'web' || typeof document === 'undefined') return null;
  const srcs = Array.from(document.querySelectorAll('script[src]')).map((s) => s.getAttribute('src') ?? '');
  for (const s of srcs) { const b = buildOf(s); if (b) return b; }
  return null;
}

/** Whether a build the page heard about means a refresh: a known, different one. */
export const isNewer = (running: string | null, seen: string | null | undefined) => !!running && !!seen && seen !== running;

/** What the page loaded before the worker was in charge (its first visit): the bundles and the app's own files. */
export function loadedFiles(entries: { name: string }[], origin: string): string[] {
  const out = new Set<string>();
  for (const e of entries) {
    try {
      const u = new URL(e.name);
      if (u.origin !== origin) continue;
      if (u.pathname.startsWith('/_expo/') || u.pathname.startsWith('/assets/')) out.add(u.pathname);
    } catch { /* not a URL */ }
  }
  return [...out];
}

export const useShellUpdate = create<{ ready: boolean; build: string | null }>(() => ({ ready: false, build: null }));

/** Heard of a build (from the worker, or the check below): a newer one shows the bar, and gets its worker. */
export function noteBuild(seen: string | null | undefined, sw: SwContainer | null = container()) {
  const running = runningBuild();
  if (!isNewer(running, seen) || useShellUpdate.getState().build === seen) return;
  useShellUpdate.setState({ ready: true, build: seen! });
  // Its worker saves the new page and bundles now, so Refresh is quick (and works offline after).
  sw?.register(`/sw.js?build=${encodeURIComponent(seen!)}`, { scope: '/', updateViaCache: 'none' }).catch(() => {});
}

/** Fetch "/" past every cache and read its build. Nothing at all when offline or anything goes wrong. */
export async function checkForUpdate(fetcher: typeof fetch = globalThis.fetch): Promise<string | null> {
  try {
    const res = await fetcher('/', { cache: 'no-store', headers: { Accept: 'text/html' } });
    if (!res.ok) return null;
    const seen = buildOf(await res.text());
    noteBuild(seen);
    return seen;
  } catch { return null; }
}

const CHECK_EVERY_MS = 10 * 60_000;
let registered = false;

/** Register the worker once the page has loaded. Safe to call more than once; does nothing off the web. */
export function registerShell() {
  const sw = container();
  if (!sw || registered || process.env.NODE_ENV === 'development') return;
  registered = true;
  const build = runningBuild() ?? 'unknown';
  // The worker says when a newer build answered while this page runs an older one.
  sw.addEventListener?.('message', (e) => {
    const d = e.data as { type?: string; build?: string } | null;
    if (d?.type === 'build') noteBuild(d.build, sw);
  });
  const go = () => {
    sw.register(`/sw.js?build=${encodeURIComponent(build)}`, { scope: '/', updateViaCache: 'none' })
      .then(() => sw.ready)
      .then((reg) => {
        const perf = globalThis.performance as Performance | undefined;
        const urls = loadedFiles((perf?.getEntriesByType?.('resource') ?? []) as { name: string }[], globalThis.location.origin);
        reg.active?.postMessage({ type: 'keep', urls, build });
      })
      .catch(() => { /* private mode, blocked: the app still works online */ });
    // A deploy while the tab stays open: look when it comes back to the front, and now and then.
    const doc = globalThis.document;
    doc.addEventListener('visibilitychange', () => { if (doc.visibilityState === 'visible') void checkForUpdate(); });
    setInterval(() => { if (doc.visibilityState === 'visible') void checkForUpdate(); }, CHECK_EVERY_MS);
  };
  const w = globalThis as unknown as Window;
  if (document.readyState === 'complete') go(); else w.addEventListener('load', go, { once: true });
}

/** "Refresh": open the new build. */
export function refreshToNew() {
  try { globalThis.location.reload(); } catch { /* not a browser */ }
}

/** Signed out: the worker drops its files cache too (it never holds anything of an account, but nothing is left). */
export function forgetShell() {
  const sw = container();
  sw?.controller?.postMessage({ type: 'forget' });
}
