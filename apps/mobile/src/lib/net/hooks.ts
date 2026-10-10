import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient, type QueryKey, type UseMutationOptions, type UseQueryOptions, type UseQueryResult } from '@tanstack/react-query';
import { ApiError } from '../api';
import { toast } from '../toast';
import { t } from '../i18n';
import { describeError, type Described } from './describe';
import { enqueue, type EnqueueInput } from './outbox';
import { newIdempotencyKey } from './retry';
import { isOffline, useNet } from './state';

/*
 * The hooks screens use instead of useQuery/useMutation, so every screen gets the same honest states for free
 * (components/states/README.md):
 *
 *   useApiQuery → { view: 'loading' | 'slow' | 'offline' | 'error' | 'ready', problem, stale, updatedAt, retry, cancel }
 *   useApiMutation → double taps ignored, one Idempotency-Key per attempt (kept for "Try again"), calm toasts for
 *                    transient problems, and optionally queue-when-offline through the outbox.
 */

/** True once `active` has been true for `afterMs` without a break. */
export function useSlow(active: boolean, afterMs = 4000): boolean {
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    if (!active) return;
    const id = setTimeout(() => setSlow(true), useNet.getState().weak ? Math.min(afterMs, 2500) : afterMs);
    return () => { clearTimeout(id); setSlow(false); };
  }, [active, afterMs]);
  return active && slow;
}

export type QueryView = 'loading' | 'slow' | 'offline' | 'error' | 'ready';

export type ApiQueryResult<T> = UseQueryResult<T, Error> & {
  view: QueryView;
  /** The words for an error or offline view (or for a stale banner when data is on screen anyway). */
  problem: Described | null;
  /** Data is on screen but the last refresh didn't happen or didn't work. */
  stale: boolean;
  /** When the data on screen came from the server (ms), for "Updated 12 min ago". */
  updatedAt: number | null;
  retry: () => void;
  cancel: () => void;
};

export function useApiQuery<T, K extends QueryKey = QueryKey>(options: UseQueryOptions<T, Error, T, K> & { slowAfterMs?: number }): ApiQueryResult<T> {
  const { slowAfterMs = 4000, ...rest } = options;
  const qc = useQueryClient();
  const q = useQuery(rest);
  const online = useNet((s) => s.online);
  const [cancelled, setCancelled] = useState(false);
  const hasData = q.data !== undefined;
  const loading = !hasData && (q.fetchStatus === 'fetching' || (q.status === 'pending' && q.fetchStatus !== 'paused' && !cancelled));
  const slow = useSlow(loading && q.fetchStatus === 'fetching', slowAfterMs);

  const problem = useMemo(() => {
    if (q.error) return describeError(q.error);
    if (q.fetchStatus === 'paused' || (online === false && !hasData)) return describeError(new ApiError('OFFLINE', t('error.offline'), 0));
    if (cancelled && !hasData) return describeError(new ApiError('CANCELLED', t('slow.cancel'), 0));
    return null;
  }, [q.error, q.fetchStatus, online, hasData, cancelled]);

  let view: QueryView;
  if (hasData) view = 'ready';
  else if (q.fetchStatus === 'paused' || problem?.kind === 'offline') view = 'offline';
  else if (q.error || cancelled) view = 'error';
  else view = slow ? 'slow' : 'loading';

  const retry = useCallback(() => { setCancelled(false); void q.refetch(); }, [q]);
  const cancel = useCallback(() => { setCancelled(true); void qc.cancelQueries({ queryKey: rest.queryKey }); }, [qc, rest.queryKey]);

  return Object.assign(q, {
    view, problem,
    stale: hasData && (!!q.error || q.fetchStatus === 'paused' || online === false),
    updatedAt: q.dataUpdatedAt || null,
    retry, cancel,
  });
}

export type ApiMutationOptions<TData, TVars> = Omit<UseMutationOptions<TData, Error, TVars>, 'mutationFn'> & {
  /** Your call. Pass `idempotencyKey` on to request(): it's the same for a retry of the same thing. */
  mutationFn: (vars: TVars, ctx: { idempotencyKey: string }) => Promise<TData>;
  /**
   * When there's no connection, queue it in the outbox instead (messages, requests, disruption choices). Return what
   * to send; the mutation then resolves with `undefined` and the toast says it will go when the phone is back online.
   */
  queueWhenOffline?: (vars: TVars) => EnqueueInput;
  /** Don't toast transient problems; the screen shows its own state. */
  quiet?: boolean;
};

export function useApiMutation<TData, TVars = void>(options: ApiMutationOptions<TData, TVars>) {
  const { mutationFn, queueWhenOffline, quiet, onError, ...rest } = options;
  const attempt = useRef<{ vars: string; key: string } | null>(null);
  const inflight = useRef<Promise<TData | undefined> | null>(null);

  const m = useMutation<TData, Error, TVars>({
    ...rest,
    mutationFn: async (vars) => {
      const sig = safeStringify(vars);
      // The same thing tried again (after a timeout, offline, a busy server) keeps its key: the server does it once.
      if (!attempt.current || attempt.current.vars !== sig) attempt.current = { vars: sig, key: newIdempotencyKey('u') };
      if (queueWhenOffline && isOffline()) {
        enqueue(queueWhenOffline(vars));
        toast(t('net.offline.queued'));
        attempt.current = null;
        return undefined as TData;
      }
      try {
        const out = await mutationFn(vars, { idempotencyKey: attempt.current.key });
        attempt.current = null;
        return out;
      } catch (e) {
        if (queueWhenOffline && e instanceof ApiError && e.kind === 'offline') {
          enqueue(queueWhenOffline(vars));
          toast(t('net.offline.queued'));
          attempt.current = null;
          return undefined as TData;
        }
        throw e;
      }
    },
    onError: (e, vars, ctx, mctx) => {
      if (!quiet && e instanceof ApiError && ['offline', 'timeout', 'busy', 'server', 'contract'].includes(e.kind)) {
        const d = describeError(e);
        toast(d.kind === 'server' ? t('error.internal') : d.kind === 'busy' ? t('busy.wait', { seconds: d.retryAfter ?? 5 }) : d.kind === 'offline' ? t('error.offline') : d.title);
      }
      onError?.(e, vars, ctx, mctx);
    },
  });

  /** Ignores a second tap while the first is still going (a double tap on Pay is one payment). */
  const mutateAsync = useCallback((vars: TVars): Promise<TData | undefined> => {
    if (inflight.current) return inflight.current;
    const p = m.mutateAsync(vars).finally(() => { inflight.current = null; });
    inflight.current = p;
    return p;
  }, [m]);
  const mutate = useCallback((vars: TVars) => { mutateAsync(vars).catch(() => {}); }, [mutateAsync]);

  return { ...m, mutate, mutateAsync, problem: m.error ? describeError(m.error) : null };
}

function safeStringify(v: unknown): string {
  try { return JSON.stringify(v) ?? ''; } catch { return String(Math.random()); }
}
