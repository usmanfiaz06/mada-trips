import { Platform } from 'react-native';

/*
 * The web build's shell (public/sw.js): a reload with no signal opens the app, and the app opens the trips saved on
 * this device (lib/net/persist.ts). Phones don't need it: the app is installed. Only on a secure origin with service
 * workers; local dev servers (expo start) are left alone so a stale bundle never gets in the way of hot reload.
 */

type SwContainer = {
  register(url: string, opts?: { scope?: string; updateViaCache?: 'none' | 'all' | 'imports' }): Promise<{ active?: { postMessage(m: unknown): void } | null; update?: () => Promise<unknown> }>;
  ready: Promise<{ active?: { postMessage(m: unknown): void } | null }>;
  controller?: { postMessage(m: unknown): void } | null;
};

const container = (): SwContainer | null => {
  if (Platform.OS !== 'web') return null;
  const nav = globalThis.navigator as (Navigator & { serviceWorker?: SwContainer }) | undefined;
  if (!nav?.serviceWorker || !(globalThis as { isSecureContext?: boolean }).isSecureContext) return null;
  return nav.serviceWorker;
};

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

let registered = false;

/** Register the worker once the page has loaded. Safe to call more than once; does nothing off the web. */
export function registerShell() {
  const sw = container();
  if (!sw || registered || process.env.NODE_ENV === 'development') return;
  registered = true;
  const go = () => {
    sw.register('/sw.js', { scope: '/', updateViaCache: 'none' })
      .then(() => sw.ready)
      .then((reg) => {
        const perf = globalThis.performance as Performance | undefined;
        const urls = loadedFiles((perf?.getEntriesByType?.('resource') ?? []) as { name: string }[], globalThis.location.origin);
        reg.active?.postMessage({ type: 'keep', urls });
      })
      .catch(() => { /* private mode, blocked: the app still works online */ });
  };
  const w = globalThis as unknown as Window;
  if (document.readyState === 'complete') go(); else w.addEventListener('load', go, { once: true });
}

/** Signed out: the worker drops its files cache too (it never holds anything of an account, but nothing is left). */
export function forgetShell() {
  const sw = container();
  sw?.controller?.postMessage({ type: 'forget' });
}
