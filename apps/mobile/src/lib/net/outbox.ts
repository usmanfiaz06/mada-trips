import { useEffect } from 'react';
import type { QueryKey } from '@tanstack/react-query';
import { z } from 'zod';
import { create } from 'zustand';
import { request, type Wire } from '../api';
import { queryClient } from '../queries';
import { kvReadJson, kvWriteJson } from './kv';
import { newIdempotencyKey } from './retry';
import { useNet } from './state';

/*
 * The outbox: things the traveller sent while offline (a message to Mada, a request, a disruption choice) are kept on
 * the phone and sent, in the order they were made, once there's a connection. Each item has its own Idempotency-Key,
 * made when it was queued and kept across restarts, so an item whose answer was lost on the way back is never done
 * twice by the server.
 *
 * Item states:   queued → sending → (gone: sent)
 *                                  → queued again (no connection, the server busy or down: tried again later)
 *                                  → failed (the server said no for a reason that won't change: Send again / Remove)
 *
 * Order: items are sent one at a time, oldest first. A transient problem stops the run (so a later message never
 * overtakes an earlier one); a lasting refusal marks that item failed and the run carries on.
 * Dedupe: items with the same `dedupe` key replace each other while still queued (the latest choice wins).
 */

export type OutboxState = 'queued' | 'sending' | 'failed';
export type OutboxItem = {
  id: string;
  /** Idempotency-Key, fixed for the item's life. */
  key: string;
  /** What it is, for handlers and for screens that show their own queued items ("message", "request", "disruption"). */
  kind: string;
  /** A few words to show in a list ("Message to Mada"). */
  label: string;
  method: Wire['method'];
  path: string;
  body?: unknown;
  /** Same dedupe key while queued: the newer replaces the older, keeping the older's place in line. */
  dedupe?: string;
  /** Free-form facts for the screen that queued it (a thread id, a trip id). */
  meta?: Record<string, string>;
  createdAt: number;
  state: OutboxState;
  tries: number;
  /** Not before (ms): backoff after a transient problem. */
  nextAt: number;
  /** The words to show for a failed item. */
  problem?: string;
};

export type OutboxHandler = {
  /** Called with the server's answer once sent (update caches, show a toast). */
  onSent?: (result: unknown, item: OutboxItem) => void;
  /** Query keys to refetch once sent. */
  invalidate?: (item: OutboxItem) => QueryKey[];
};

const handlers = new Map<string, OutboxHandler>();
/** Areas register what happens after their kind of item is sent. One line, at module load. */
export const registerOutboxKind = (kind: string, h: OutboxHandler) => { handlers.set(kind, h); };

const KEY = 'mada.outbox.v1';
type Store = { items: OutboxItem[]; loaded: boolean };
export const useOutboxStore = create<Store>(() => ({ items: [], loaded: false }));

const persist = () => kvWriteJson(KEY, useOutboxStore.getState().items);
function setItems(fn: (items: OutboxItem[]) => OutboxItem[]) {
  useOutboxStore.setState((s) => ({ items: fn(s.items) }));
  void persist();
}

export async function loadOutbox() {
  if (useOutboxStore.getState().loaded) return;
  const saved = (await kvReadJson<OutboxItem[]>(KEY)) ?? [];
  // Anything that was mid-send when the app stopped goes back in line; its key stops it happening twice.
  const restored = saved.filter((i) => i && i.id && i.path).map((i) => (i.state === 'sending' ? { ...i, state: 'queued' as const } : i));
  useOutboxStore.setState((s) => ({ loaded: true, items: [...restored, ...s.items.filter((i) => !restored.some((r) => r.id === i.id))] }));
}

let seq = 0;
export type EnqueueInput = Pick<OutboxItem, 'kind' | 'label' | 'method' | 'path'> & Partial<Pick<OutboxItem, 'body' | 'dedupe' | 'meta'>>;

/** Queue something to send. Returns the item (with its id and key). Sends at once when online. */
export function enqueue(input: EnqueueInput): OutboxItem {
  const now = Date.now();
  const existing = input.dedupe ? useOutboxStore.getState().items.find((i) => i.dedupe === input.dedupe && i.state !== 'sending') : undefined;
  if (existing) {
    // The latest wins. A new request needs a new key: the old key belongs to the old body.
    const replaced: OutboxItem = { ...existing, ...input, key: newIdempotencyKey('o'), state: 'queued', tries: 0, nextAt: 0, problem: undefined };
    setItems((items) => items.map((i) => (i.id === existing.id ? replaced : i)));
    void flushOutbox();
    return replaced;
  }
  const item: OutboxItem = { ...input, id: `ob${now.toString(36)}${(seq++).toString(36)}`, key: newIdempotencyKey('o'), createdAt: now, state: 'queued', tries: 0, nextAt: 0 };
  setItems((items) => [...items, item]);
  void flushOutbox();
  return item;
}

export function retryItem(id: string) {
  setItems((items) => items.map((i) => (i.id === id ? { ...i, state: 'queued', nextAt: 0, problem: undefined } : i)));
  void flushOutbox();
}

export function discardItem(id: string) {
  setItems((items) => items.filter((i) => i.id !== id));
}

const TRANSIENT = new Set(['offline', 'timeout', 'busy', 'server', 'supplier', 'maintenance', 'auth', 'cancelled']);
const backoff = (tries: number) => Math.min(60_000, 2000 * 2 ** Math.max(0, tries - 1));

let running: Promise<number> | null = null;

/** Send what's queued, oldest first. Returns how many were sent. Concurrent calls share one run. */
export function flushOutbox(): Promise<number> {
  // A run already going may have stopped before this change (offline a moment ago): go again once it settles.
  if (running) return running.then((n) => flushOutbox().then((m) => n + m));
  const run = (async () => {
    let sent = 0;
    for (;;) {
        if (useNet.getState().online === false) break;
        const now = Date.now();
        const next = useOutboxStore.getState().items.filter((i) => i.state === 'queued').sort((a, b) => a.createdAt - b.createdAt)[0];
        if (!next || next.nextAt > now) break;
        setItems((items) => items.map((i) => (i.id === next.id ? { ...i, state: 'sending' } : i)));
        try {
          const result = await request({ method: next.method, path: next.path, body: next.body, idempotencyKey: next.key, retries: 0 }, z.unknown());
          setItems((items) => items.filter((i) => i.id !== next.id));
          sent += 1;
          const h = handlers.get(next.kind);
          try { h?.onSent?.(result, next); } catch { /* a handler's problem isn't the outbox's */ }
          for (const k of h?.invalidate?.(next) ?? []) void queryClient.invalidateQueries({ queryKey: k });
        } catch (e) {
          const kind = (e as { kind?: string }).kind ?? 'server';
          if (TRANSIENT.has(kind)) {
            setItems((items) => items.map((i) => (i.id === next.id ? { ...i, state: 'queued', tries: i.tries + 1, nextAt: Date.now() + backoff(i.tries + 1) } : i)));
            break; // keep the order: nothing overtakes it
          }
          setItems((items) => items.map((i) => (i.id === next.id ? { ...i, state: 'failed', tries: i.tries + 1, problem: (e as Error).message } : i)));
        }
      }
    return sent;
  })();
  // Cleared once the run settles (a run that ends at once must not leave itself behind as "running").
  const p: Promise<number> = run.finally(() => { if (running === p) running = null; });
  running = p;
  return p;
}

/** The items of one kind (or all), for screens that show "Sends when you're online" under what was queued. */
export function useOutbox(kind?: string, match?: (i: OutboxItem) => boolean): OutboxItem[] {
  return useOutboxStore((s) => s.items).filter((i) => (!kind || i.kind === kind) && (!match || match(i)));
}

/** Keeps the outbox moving: on launch, on reconnect, and every 15 s while something waits. Mount once (root). */
export function useOutboxPump() {
  const online = useNet((s) => s.online);
  const waiting = useOutboxStore((s) => s.items.some((i) => i.state === 'queued'));
  useEffect(() => { void loadOutbox().then(() => flushOutbox()); }, []);
  useEffect(() => { if (online !== false) void flushOutbox(); }, [online]);
  useEffect(() => {
    if (!waiting) return;
    const id = setInterval(() => void flushOutbox(), 15_000);
    return () => clearInterval(id);
  }, [waiting]);
}

/** Tests. */
export function resetOutbox() { useOutboxStore.setState({ items: [], loaded: true }); handlers.clear(); running = null; }
