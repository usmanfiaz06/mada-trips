import { lazy, Suspense, useState, type ComponentType } from 'react';

type Later<P> = ComponentType<P & { when: boolean }> & { preload: () => Promise<unknown> };

/**
 * A part of the screen that waits in its own file until it first has something to show: a sheet, a toast, the
 * offline pill. On the web that keeps it (and what it imports, Reanimated and the gesture library among them) out of
 * the first download (docs/app/PERF.md); once shown it stays mounted, so it opens and closes as before. `preload()`
 * fetches the file ahead of time (the root layout does, once the first screen is up, so it's there offline).
 */
export function later<P extends object>(load: () => Promise<ComponentType<P>>): Later<P> {
  let loading: Promise<ComponentType<P>> | null = null;
  const fetchPart = () => (loading ??= load().catch((e: unknown) => { loading = null; throw e; }));
  // A file that can't be fetched (offline before it was ever shown) leaves nothing on screen, never a crash.
  const Part = lazy(async () => ({ default: await fetchPart().catch(() => Nothing as ComponentType<P>) }));
  function Lazy({ when, ...props }: P & { when: boolean }) {
    const [seen, setSeen] = useState(when);
    if (when && !seen) setSeen(true);
    if (!seen && !when) return null;
    return <Suspense fallback={null}><Part {...(props as P)} /></Suspense>;
  }
  return Object.assign(Lazy, { preload: () => fetchPart().catch(() => undefined) });
}

const Nothing = () => null;
