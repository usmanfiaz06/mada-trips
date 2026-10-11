import { AppState, Platform } from 'react-native';
import { create } from 'zustand';
import { API_PREFIX, CircleEventsResponse, CircleLiveEvent, HEADERS, type CircleLiveEvent as LiveEvent } from '@mada/shared';
import { refreshSession, request } from './api';
import { API_MODE, API_ORIGIN } from './config';
import { getLocale } from './i18n';
import { getAppVersion } from './net/gates';
import { isOffline } from './net/state';
import { queryClient } from './queries';
import { useSession } from './session';

/*
 * Circles, live: messages, votes, reactions, splits, people joining and leaving, read receipts and "typing" arrive as
 * they happen (platform lib/app/circles/live.ts). The channel is a Server-Sent Events stream from the Core API
 * (GET /circles/live), held ~25 s at a time and resumed from the last event id, so it works on Vercel. Each event
 * only names what changed; we refetch that through the normal queries, so the outbox, offline copies and the
 * member checks all stay as they are.
 *
 * When the stream can't be held (a proxy that buffers, a captive portal, a flaky network) we poll its twin
 * (GET /circles/events?after=) every few seconds and keep trying the stream with backoff (2, 4, 8 … 60 s). When both
 * fail, `mode` is "off" and the screens fall back to their own polling (5 s for an open chat). Mock mode polls the
 * in-app mock's feed. Nothing runs while the app is in the background or nobody is signed in.
 */

export type LiveMode = 'off' | 'stream' | 'poll';
type LiveState = {
  mode: LiveMode;
  /** circleId → userId → when their "typing" stops showing (ms). */
  typing: Record<string, Record<string, number>>;
};
export const useLive = create<LiveState>(() => ({ mode: 'off', typing: {} }));

/** How often screens poll by themselves: rarely while the live channel works, as before when it doesn't. */
export const pollEvery = (fallbackMs: number) => (useLive.getState().mode === 'off' ? fallbackMs : Math.max(fallbackMs, 60_000));
export function useLivePoll(fallbackMs: number): number {
  return useLive((s) => (s.mode === 'off' ? fallbackMs : Math.max(fallbackMs, 60_000)));
}

/** Who is typing in a circle right now (not you). */
export function useTyping(circleId: string, me: string): string[] {
  const map = useLive((s) => s.typing[circleId]);
  return Object.keys(map ?? {}).filter((id) => id !== me);
}

/* ───────────── applying events ───────────── */

const seen = new Set<number>();
const pending = new Set<string>();
let flushTimer: ReturnType<typeof setTimeout> | null = null;
const key = (k: readonly unknown[]) => JSON.stringify(k);

function touch(...keys: (readonly unknown[])[]) {
  for (const k of keys) pending.add(key(k));
  flushTimer ??= setTimeout(() => {
    flushTimer = null;
    for (const k of pending) void queryClient.invalidateQueries({ queryKey: JSON.parse(k) as unknown[] });
    pending.clear();
  }, 120);
}

/** What each kind of change refreshes. Exported for tests. */
export function applyEvent(e: LiveEvent, me = useSession.getState().user?.id ?? '') {
  if (seen.has(e.id)) return;
  seen.add(e.id);
  if (seen.size > 1000) for (const id of [...seen].slice(0, 500)) seen.delete(id);
  const msgs = ['circles', 'messages', e.circleId] as const;
  const circle = ['circles', 'circle', e.circleId] as const;
  const list = ['circles', 'list'] as const;
  switch (e.kind) {
    case 'typing': {
      if (!e.actor || e.actor === me) return;
      useLive.setState((s) => ({ typing: { ...s.typing, [e.circleId]: { ...s.typing[e.circleId], [e.actor!]: Date.now() + 5_000 } } }));
      // Expired entries go, so a stale "typing" never lingers.
      setTimeout(() => useLive.setState((s) => {
        const now = Date.now();
        const c = Object.fromEntries(Object.entries(s.typing[e.circleId] ?? {}).filter(([, until]) => until > now));
        return { typing: { ...s.typing, [e.circleId]: c } };
      }), 5_100);
      return;
    }
    case 'message':
      // Their message arrived: they've stopped typing.
      if (e.actor) useLive.setState((s) => { const c = { ...s.typing[e.circleId] }; delete c[e.actor!]; return { typing: { ...s.typing, [e.circleId]: c } }; });
      touch(msgs, list);
      return;
    case 'vote': case 'split': case 'reaction':
      touch(msgs, list);
      return;
    case 'read':
      if (e.actor !== me) touch(msgs, circle);
      return;
    case 'member': case 'circle': case 'invite':
      touch(msgs, circle, list, ['circles', 'invites'], ['circles', 'friends']);
      return;
  }
}

/* ───────────── the channel ───────────── */

let cursor: number | null = null;
let running = false;
let stopRequested = false;
let abort: AbortController | null = null;
let failures = 0;
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function pollOnce(): Promise<boolean> {
  try {
    const r = await request({ method: 'GET', path: `/circles/events${cursor == null ? '' : `?after=${cursor}`}`, retries: 0, timeoutMs: 8_000 }, CircleEventsResponse);
    for (const e of r.events) applyEvent(e);
    cursor = r.cursor;
    return true;
  } catch {
    return false;
  }
}

/** Parse a Server-Sent Events body as it arrives. Resolves when the server ends the stream. */
async function readStream(body: ReadableStream<Uint8Array>, onOpen: () => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) return;
    buf += decoder.decode(value, { stream: true });
    let i: number;
    while ((i = buf.indexOf('\n\n')) >= 0) {
      const frame = buf.slice(0, i);
      buf = buf.slice(i + 2);
      let event = 'message';
      let data = '';
      for (const line of frame.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;
      try {
        const j = JSON.parse(data) as Record<string, unknown>;
        if (event === 'hello') { onOpen(); if (cursor == null && typeof j.cursor === 'number') cursor = j.cursor; }
        else if (event === 'circle') { const e = CircleLiveEvent.parse(j); applyEvent(e); }
        else if ((event === 'cursor' || event === 'bye') && typeof j.cursor === 'number') cursor = j.cursor;
      } catch { /* a frame we don't understand: skip it */ }
    }
  }
}

async function streamOnce(): Promise<'ended' | 'failed' | 'unauthorized'> {
  const token = useSession.getState().tokens?.accessToken;
  if (!token) return 'unauthorized';
  abort = new AbortController();
  const f: typeof fetch = Platform.OS === 'web' ? fetch : ((await import('expo/fetch')).fetch as unknown as typeof fetch);
  let opened = false;
  // A stream that says nothing (not even hello) for 15 s is being buffered somewhere: treat it as failed.
  const quiet = setTimeout(() => { if (!opened) abort?.abort(); }, 15_000);
  try {
    const res = await f(`${API_ORIGIN}${API_PREFIX}/circles/live${cursor == null ? '' : `?after=${cursor}`}`, {
      headers: { Accept: 'text/event-stream', Authorization: `Bearer ${token}`, 'Accept-Language': getLocale(), [HEADERS.appVersion]: getAppVersion() },
      signal: abort.signal,
    });
    if (res.status === 401) return 'unauthorized';
    if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) return 'failed';
    await readStream(res.body, () => { opened = true; failures = 0; useLive.setState({ mode: 'stream' }); });
    return opened ? 'ended' : 'failed';
  } catch {
    return 'failed';
  } finally {
    clearTimeout(quiet);
    abort = null;
  }
}

async function loop() {
  running = true;
  stopRequested = false;
  while (!stopRequested) {
    if (isOffline()) { useLive.setState({ mode: 'off' }); await sleep(3_000); continue; }
    if (API_MODE === 'mock') {
      useLive.setState({ mode: (await pollOnce()) ? 'poll' : 'off' });
      await sleep(1_000);
      continue;
    }
    const r = await streamOnce();
    if (stopRequested) break;
    if (r === 'ended') continue; // the server's window closed: carry on at once from the cursor
    if (r === 'unauthorized') {
      if (!(await refreshSession())) { useLive.setState({ mode: 'off' }); await sleep(30_000); }
      continue;
    }
    // The stream didn't hold: poll its twin while waiting to try it again.
    failures += 1;
    const wait = Math.min(60_000, 1_000 * 2 ** Math.min(failures, 6));
    const until = Date.now() + wait;
    while (!stopRequested && Date.now() < until) {
      const ok = await pollOnce();
      useLive.setState({ mode: ok ? 'poll' : 'off' });
      await sleep(ok ? 4_000 : Math.min(15_000, 2_000 * failures));
    }
  }
  running = false;
  useLive.setState({ mode: 'off' });
}

export function startLive() {
  if (running || useSession.getState().status !== 'signedIn') return;
  void loop();
}
export function stopLive() {
  stopRequested = true;
  abort?.abort();
}

/* Signed in and in the foreground: live. Otherwise not. After a pause, refetch once, since events may have aged out. */
let wired = false;
export function wireLive() {
  if (wired) return;
  wired = true;
  const sync = () => {
    const active = AppState.currentState !== 'background' && useSession.getState().status === 'signedIn';
    if (active) startLive(); else stopLive();
  };
  useSession.subscribe((s, prev) => { if (s.status !== prev.status) { if (s.status !== 'signedIn') cursor = null; sync(); } });
  AppState.addEventListener('change', (st) => {
    if (st === 'active') void queryClient.invalidateQueries({ queryKey: ['circles'] });
    sync();
  });
  sync();
}
