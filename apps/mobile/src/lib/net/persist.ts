import { dehydrate, hydrate, type Query, type QueryKey } from '@tanstack/react-query';
import { queryClient } from '../queries';
import { useSession } from '../session';
import { kvReadJson, kvWriteJson } from './kv';

/*
 * The offline copy of server state: React Query's cache, saved to the phone so the app opens with trips, the
 * itinerary, Wallet and boarding passes already there, with or without a connection (FLOWS.md §12).
 *
 * What is kept, and for how long, is a list of rules by query key (`persistQueries`) or a query's own
 * `meta: { persist: maxAgeMs }`. Anything else (search results, prices, previews, positions) is never kept: a
 * price from yesterday is worse than no price. Saved at most once a second after a change; restored before the first
 * screen draws; dropped when the traveller signs out or a different account signs in.
 * Only what the server already sends the app is kept (passport numbers come masked); it lives in the app's own
 * storage and goes with the app.
 */

const KEY = 'mada.cache.v1';
const VERSION = 1;
const DAY = 86_400_000;

type Rule = { root: string; maxAge: number; except: string[] };
const rules: Rule[] = [];

/** Keep queries whose key starts with `root` for `maxAgeMs` (except second-level keys in `except`). One line per area. */
export function persistQueries(root: string, maxAgeMs: number, except: string[] = []) {
  const i = rules.findIndex((r) => r.root === root);
  const rule = { root, maxAge: maxAgeMs, except };
  if (i >= 0) rules[i] = rule; else rules.push(rule);
}

// What a traveller needs with no signal. Areas can add or change theirs with persistQueries().
persistQueries('me', 30 * DAY);
persistQueries('people', 30 * DAY);
persistQueries('trips', 30 * DAY, ['position']);
persistQueries('wallet', 30 * DAY, ['devices', 'export']);
persistQueries('support', 7 * DAY, ['presence', 'unread']);
persistQueries('inbox', 7 * DAY);
persistQueries('circles', 7 * DAY);
persistQueries('booking', 7 * DAY, ['flights', 'stays', 'preview', 'entry', 'search']);

export function maxAgeFor(key: QueryKey, meta?: Record<string, unknown>): number {
  if (typeof meta?.persist === 'number') return meta.persist;
  if (meta?.persist === false) return 0;
  const [root, second] = key as readonly unknown[];
  const rule = rules.find((r) => r.root === root);
  if (!rule) return 0;
  if (typeof second === 'string' && rule.except.includes(second)) return 0;
  return rule.maxAge;
}

const keep = (q: Query) => q.state.status === 'success' && maxAgeFor(q.queryKey, q.meta) > 0;

type Snapshot = { v: number; at: number; user: string | null; state: ReturnType<typeof dehydrate> };

let timer: ReturnType<typeof setTimeout> | null = null;
let restored = false;

export async function saveNow(): Promise<boolean> {
  if (timer) { clearTimeout(timer); timer = null; }
  const s = useSession.getState();
  if (s.status !== 'signedIn') return false;
  const snap: Snapshot = { v: VERSION, at: Date.now(), user: s.user?.id ?? null, state: dehydrate(queryClient, { shouldDehydrateQuery: keep }) };
  return kvWriteJson(KEY, snap);
}

const schedule = () => {
  if (!restored || timer) return;
  timer = setTimeout(() => { timer = null; void saveNow(); }, 1000);
};

/** Put the saved copy back into the cache (expired entries dropped). Resolves quickly even with no copy. */
export async function restoreCache(now = Date.now()): Promise<number> {
  try {
    const snap = await kvReadJson<Snapshot>(KEY);
    if (!snap || snap.v !== VERSION || !snap.state) return 0;
    const me = useSession.getState().user?.id;
    if (me && snap.user && me !== snap.user) { await clearCache(); return 0; }
    const queries = snap.state.queries.filter((q) => now - q.state.dataUpdatedAt < maxAgeFor(q.queryKey, q.meta as Record<string, unknown> | undefined));
    hydrate(queryClient, { ...snap.state, queries, mutations: [] });
    return queries.length;
  } catch {
    return 0;
  } finally {
    restored = true;
  }
}

export async function clearCache() {
  if (timer) { clearTimeout(timer); timer = null; }
  await kvWriteJson(KEY, null);
}

let started = false;
/** Watch the cache and the session. Call once at launch, before restoreCache(). */
export function startPersistence(): () => void {
  if (started) return () => {};
  started = true;
  const unsubCache = queryClient.getQueryCache().subscribe((e) => {
    if (e.type === 'updated' && e.action.type === 'success' && maxAgeFor(e.query.queryKey, e.query.meta) > 0) schedule();
    else if (e.type === 'removed' && maxAgeFor(e.query.queryKey, e.query.meta) > 0) schedule();
  });
  let prev = useSession.getState();
  const unsubSession = useSession.subscribe((s) => {
    // Signed out, or someone else signed in on this phone: nothing of the last account stays.
    if ((prev.status === 'signedIn' && s.status === 'signedOut') || (prev.user && s.user && prev.user.id !== s.user.id)) {
      void clearCache();
      if (s.status === 'signedOut') queryClient.clear();
    }
    prev = s;
  });
  return () => { unsubCache(); unsubSession(); started = false; };
}
