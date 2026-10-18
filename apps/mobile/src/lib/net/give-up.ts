import { useCallback, useEffect, useState } from 'react';
import { useQueryClient, type QueryKey } from '@tanstack/react-query';
import { ApiError } from '../api';
import { t } from '../i18n';
import { useSession } from '../session';
import { requireAccount, type AccountReason } from '../signin-ask';
import { describeError, type Described } from './describe';
import { noteSessionExpired } from './gates';

/*
 * No endless spinners. A search (eSIM plans, flights, stays, places, a pickup) that hasn't answered in GIVE_UP_MS
 * stops waiting and says so: "This is taking too long." with Try again and Talk to Mada. A request that fails (4xx,
 * 5xx, no network) lands in the same honest state at once, and an ended session (401, or no session at all) asks to
 * sign in instead of spinning. A query that can never run (disabled) is treated the same way: it gives up too.
 *
 *   const wait = useGiveUp(q, { key: [where, days], signedIn });
 *   if (wait.view !== 'loading' && wait.view !== 'ready') return <WaitTrouble wait={wait} />;
 */

/** How long a search may take before the screen stops waiting (EXPO_PUBLIC_GIVE_UP_MS overrides, for tests). */
export const GIVE_UP_MS = Number(process.env.EXPO_PUBLIC_GIVE_UP_MS) > 0 ? Number(process.env.EXPO_PUBLIC_GIVE_UP_MS) : 12_000;

/**
 * Flights and hotels are searched live at the suppliers, which the API itself gives 20 s (TIMEOUTS.long): the screen
 * waits that long before giving up, so a slow-but-answering supplier isn't cut off and retried forever.
 */
export const SUPPLIER_GIVE_UP_MS = Number(process.env.EXPO_PUBLIC_GIVE_UP_MS) > 0 ? GIVE_UP_MS : 20_000;

export type WaitView = 'loading' | 'ready' | 'error' | 'timeout' | 'signin';

/** The parts of a React Query result this reads. */
export type QueryLike = { data?: unknown; error?: unknown; status: 'pending' | 'error' | 'success'; fetchStatus: 'fetching' | 'paused' | 'idle' };

const isAuth = (e: unknown) => e instanceof ApiError && (e.kind === 'auth' || e.status === 401);

/**
 * What the screen shows. Data wins (a refresh going wrong under it keeps it on screen). Then: no session → sign in;
 * still fetching and under the limit → loading; a failure → error (sign in for a 401); waited past the limit → timeout.
 */
export function waitView(q: QueryLike, o: { waitedMs: number; giveUpMs?: number; signedIn?: boolean }): WaitView {
  const giveUpMs = o.giveUpMs ?? GIVE_UP_MS;
  if (q.data !== undefined) return 'ready';
  if (o.signedIn === false) return 'signin';
  const over = o.waitedMs >= giveUpMs;
  if (q.fetchStatus === 'fetching' && !over) return 'loading';
  if (q.error && q.fetchStatus !== 'fetching') return isAuth(q.error) ? 'signin' : 'error';
  if (over) return 'timeout';
  return 'loading';
}

export type GiveUp = {
  view: WaitView;
  /** The words for error and timeout. */
  problem: Described | null;
  /** Start over: the wait restarts and the query runs again. */
  retry: () => void;
  /** Sign in (the sign-in-again sheet when a session ran out; "Sign in to …" with none). */
  signIn: () => void;
};

/**
 * useGiveUp(query): the wait view for a query, restarting its clock whenever `key` changes (a new place, new days) or
 * Try again is pressed. Past the limit the query is cancelled, so Try again really starts again.
 */
export function useGiveUp(q: QueryLike & { refetch: () => unknown }, o: { key?: unknown; queryKey?: QueryKey; giveUpMs?: number; signedIn?: boolean; reason?: AccountReason; active?: boolean } = {}): GiveUp {
  const giveUpMs = o.giveUpMs ?? GIVE_UP_MS;
  const qc = useQueryClient();
  const active = o.active ?? true;
  const [round, setRound] = useState(0);
  const sig = `${JSON.stringify(o.key ?? null)}|${round}|${active}`;
  // The wait that ran past the limit (by its key and round): a new key or Try again starts a fresh one.
  const [overSig, setOverSig] = useState<string | null>(null);
  const waiting = active && q.data === undefined;
  useEffect(() => {
    if (!waiting) return undefined;
    const id = setTimeout(() => setOverSig(sig), giveUpMs);
    return () => clearTimeout(id);
  }, [waiting, sig, giveUpMs]);

  const view: WaitView = !active ? 'loading' : waitView(q, { waitedMs: overSig === sig ? giveUpMs : 0, giveUpMs, signedIn: o.signedIn });

  // Past the limit, stop the request itself.
  const queryKey = o.queryKey;
  useEffect(() => {
    if (view === 'timeout' && queryKey) void qc.cancelQueries({ queryKey });
  }, [view, qc, queryKey]);

  const refetch = q.refetch;
  const retry = useCallback(() => { setRound((n) => n + 1); void refetch(); }, [refetch]);
  const reason = o.reason ?? 'book';
  const signIn = useCallback(() => {
    if (useSession.getState().tokens) noteSessionExpired();
    else requireAccount(reason);
  }, [reason]);

  let problem: Described | null = null;
  if (view === 'timeout') problem = describeError(new ApiError('TIMEOUT', t('error.timeout'), 0));
  else if (view === 'error') problem = describeError(q.error);
  else if (view === 'signin') problem = { kind: 'auth', title: t('wait.signin.title'), body: t('wait.signin.body'), primary: 'signin' };
  return { view, problem, retry, signIn };
}
