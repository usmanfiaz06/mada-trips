import { useEffect } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  LivingPlanResponse, PlanChangeAskResponse, PlanChangeResponse, TripChatResponse, planRoute, tripChatRoute,
  type ChangeAsk, type CreatePlanRequest, type PlanOp, type SetOriginRequest,
} from '@mada/shared';
import { ApiError, request } from './api';
import { queryClient } from './queries';
import { kvReadJson, kvWriteJson } from './net/kv';
import { persistQueries } from './net/persist';
import { isOffline, useNet } from './net/state';
import { useSession } from './session';
import { applyLocal, flushQueue, type QueuedEdit } from './plan-logic';

/*
 * The living plan on the phone (docs/app/ASK-INTEGRATED.md §9.3, U8): read with what the caller may do (owner, or a
 * companion's role), changed through the plan's own endpoints with the version it was read at. An edit shows at once;
 * offline it waits in a small queue kept on the phone and goes when the connection is back, on the version it was
 * made on. If the plan changed elsewhere meanwhile the server refuses it: the queue for that trip is dropped, the
 * latest plan shows, and the screen says so. A companion's edit is sent as a change request (or applied at once for
 * "Can edit"): never queued, since it asks someone.
 */

persistQueries('plan', 30 * 86_400_000);

export const planKey = (tripId: string) => ['plan', tripId] as const;
export const tripChatKey = (tripId: string) => ['trip-chat', tripId] as const;

export const plansApi = {
  get: (tripId: string) => request({ method: 'GET', path: planRoute(tripId) }, LivingPlanResponse),
  /** A plan from a template ("Use this plan") or a shape, on a new planning trip. */
  create: (body: CreatePlanRequest) => request({ method: 'POST', path: '/trips/plan', body }, LivingPlanResponse),
  ops: (tripId: string, version: number, ops: PlanOp[]) => request({ method: 'POST', path: `${planRoute(tripId)}/ops`, body: { version, ops } }, PlanChangeResponse),
  origin: (tripId: string, body: SetOriginRequest) => request({ method: 'PUT', path: `${planRoute(tripId)}/origin`, body }, PlanChangeResponse),
  ask: (tripId: string, body: ChangeAsk) => request({ method: 'POST', path: `/trips/${tripId}/change-requests`, body }, PlanChangeAskResponse),
  tripChat: (tripId: string) => request({ method: 'GET', path: tripChatRoute(tripId) }, TripChatResponse),
  setTripChat: (tripId: string, on: boolean) => request({ method: on ? 'POST' : 'DELETE', path: tripChatRoute(tripId) }, TripChatResponse),
};

const signedIn = () => useSession.getState().status === 'signedIn';

export function usePlan(tripId: string | null | undefined) {
  return useQuery({ queryKey: planKey(tripId ?? ''), queryFn: () => plansApi.get(tripId!), enabled: !!tripId && signedIn(),
    // A living plan: read again every time a screen with it opens (the chat, the desk or a companion may have changed it).
    refetchOnMount: 'always', retry: (n, e) => !(e instanceof ApiError && e.code === 'NOT_FOUND') && n < 2 });
}

export function useTripChat(tripId: string | null | undefined) {
  return useQuery({ queryKey: tripChatKey(tripId ?? ''), queryFn: () => plansApi.tripChat(tripId!), enabled: !!tripId && signedIn() });
}

export function useSetTripChat(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (on: boolean) => plansApi.setTripChat(tripId, on),
    onSuccess: (data) => { qc.setQueryData(tripChatKey(tripId), data); void qc.invalidateQueries({ queryKey: ['ask', 'threads'] }); },
  });
}

/* ───────────── the queue ───────────── */

const QUEUE_KEY = 'mada.plan.queue.v1';
type Conflict = { tripId: string; lost: string[]; at: number };
type QueueState = { edits: QueuedEdit[]; loaded: boolean; conflict: Conflict | null; flushing: boolean };
export const usePlanQueue = create<QueueState>(() => ({ edits: [], loaded: false, conflict: null, flushing: false }));

const save = () => kvWriteJson(QUEUE_KEY, { v: 1, user: useSession.getState().user?.id ?? null, edits: usePlanQueue.getState().edits }).catch(() => {});

export async function loadPlanQueue(): Promise<void> {
  if (usePlanQueue.getState().loaded) return;
  const saved = await kvReadJson<{ v: number; user: string | null; edits: QueuedEdit[] }>(QUEUE_KEY).catch(() => null);
  const user = useSession.getState().user?.id ?? null;
  // Another account's edits are never sent as this one.
  usePlanQueue.setState({ edits: saved?.v === 1 && saved.user === user ? saved.edits : [], loaded: true });
}

let seq = 0;
const editId = () => `${Date.now().toString(36)}-${++seq}`;

/** The plan on screen right now: the server's answer, or the edit applied over the cached one. */
function setLocal(tripId: string, fn: (p: LivingPlanResponse) => LivingPlanResponse) {
  const cur = queryClient.getQueryData<LivingPlanResponse>(planKey(tripId));
  if (cur) queryClient.setQueryData(planKey(tripId), fn(cur));
}

export type EditResult = 'saved' | 'queued' | 'conflict' | 'asked' | 'applied' | 'failed';

/**
 * One edit from the plan screen. The owner's goes to the plan (offline: queued, shown at once); a companion's goes
 * to the owner as a change request (or applies at once for "Can edit"). Resolves with what happened.
 */
export async function editPlan(tripId: string, ops: PlanOp[], title: string, summary?: string): Promise<{ result: EditResult; text?: string; error?: unknown }> {
  const cur = queryClient.getQueryData<LivingPlanResponse>(planKey(tripId));
  if (!cur) return { result: 'failed' };
  const role = cur.access?.role ?? 'owner';
  if (role !== 'owner') {
    if (role === 'view') return { result: 'failed' };
    try {
      const r = await plansApi.ask(tripId, { summary: (summary ?? title).slice(0, 200), ops });
      await queryClient.invalidateQueries({ queryKey: planKey(tripId) });
      return { result: r.applied ? 'applied' : 'asked', text: r.text };
    } catch (e) { return { result: 'failed', error: e }; }
  }
  await loadPlanQueue();
  const waiting = usePlanQueue.getState().edits.some((e) => e.tripId === tripId);
  const edit: QueuedEdit = { id: editId(), tripId, version: cur.plan.version, ops, title, at: Date.now() };
  // Offline, or edits already waiting (this one goes after them, on top of them). The screen shows queued edits over
  // the plan it has (withQueued), so nothing is applied to the cached plan itself.
  if (isOffline() || waiting) {
    usePlanQueue.setState((s) => ({ edits: [...s.edits, edit] }));
    void save();
    if (!isOffline()) void flushPlanQueue(tripId);
    return { result: 'queued' };
  }
  setLocal(tripId, (p) => ({ ...p, plan: applyLocal(p.plan, ops) }));
  try {
    const r = await plansApi.ops(tripId, cur.plan.version, ops);
    queryClient.setQueryData(planKey(tripId), { ...cur, plan: r.plan });
    return { result: 'saved' };
  } catch (e) {
    if (e instanceof ApiError && e.code === 'PLAN_CHANGED') {
      usePlanQueue.setState({ conflict: { tripId, lost: [title], at: Date.now() } });
      await queryClient.invalidateQueries({ queryKey: planKey(tripId) });
      return { result: 'conflict' };
    }
    if (e instanceof ApiError && (e.code === 'OFFLINE' || e.code === 'TIMEOUT')) {
      // Back to the plan as it was, with the edit waiting on top of it.
      queryClient.setQueryData(planKey(tripId), cur);
      usePlanQueue.setState((s) => ({ edits: [...s.edits, edit] }));
      void save();
      return { result: 'queued' };
    }
    // Refused for a reason that won't change (a booked item): the plan as the server has it.
    await queryClient.invalidateQueries({ queryKey: planKey(tripId) });
    return { result: 'failed', error: e };
  }
}

/** Send what waited for a connection, oldest first; a plan changed elsewhere wins (the screen says so). */
export async function flushPlanQueue(tripId: string): Promise<void> {
  await loadPlanQueue();
  if (usePlanQueue.getState().flushing || isOffline()) return;
  if (!usePlanQueue.getState().edits.some((e) => e.tripId === tripId)) return;
  usePlanQueue.setState({ flushing: true });
  try {
    const rest = await flushQueue(usePlanQueue.getState().edits, tripId, async (e) => {
      const r = await plansApi.ops(tripId, e.version, e.ops);
      const cur = queryClient.getQueryData<LivingPlanResponse>(planKey(tripId));
      if (cur) queryClient.setQueryData(planKey(tripId), { ...cur, plan: r.plan });
      // Sent: off the queue at once, so a restart now never sends it twice.
      usePlanQueue.setState((s) => ({ edits: s.edits.filter((x) => x.id !== e.id) }));
      void save();
      return r.plan.version;
    }, (step) => {
      if (step.kind === 'conflict') usePlanQueue.setState({ conflict: { tripId, lost: step.lost.map((x) => x.title), at: Date.now() } });
    });
    usePlanQueue.setState({ edits: rest });
    void save();
  } finally {
    usePlanQueue.setState({ flushing: false });
    await queryClient.invalidateQueries({ queryKey: planKey(tripId) });
  }
}

/** While the plan screen is open: load the queue, and send it the moment the phone is back online. */
export function usePlanSync(tripId: string) {
  const online = useNet((s) => s.online);
  useEffect(() => { void loadPlanQueue(); }, []);
  useEffect(() => { if (online !== false) void flushPlanQueue(tripId); }, [online, tripId]);
}

export const dismissConflict = () => usePlanQueue.setState({ conflict: null });
