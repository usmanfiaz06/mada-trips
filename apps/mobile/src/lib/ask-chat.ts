import { Platform } from 'react-native';
import { create } from 'zustand';
import { API_PREFIX, ASK_CHAT_FEATURE, ASK_CHAT_ROUTE, HEADERS, readSseFrames, type AskChatEvent, type AskIntent, type ChatCard, type ChatPay } from '@mada/shared';
import { refreshSession } from './api';
import { API_MODE, API_ORIGIN, SHOW_DEMO_HINTS } from './config';
import { getLocale } from './i18n';
import { getAppVersion, useFeature } from './net/gates';
import { kvReadJson, kvWriteJson } from './net/kv';
import { isOffline } from './net/state';
import { useSession } from './session';

/*
 * Ask as a conversation (docs/app/ASK-CHAT.md): POST /ask/chat, read as Server-Sent Events while the words arrive.
 * Only when the server says so (GET /config askChat), signed in, live and online. Anything else, or any failure on
 * the way, and Ask answers with its own flows exactly as before: the conversation never dead-ends.
 */

export type ChatTurn = {
  id: number;
  me: string;
  /** When the traveller sent it (ISO), for the time shown after a quiet gap. */
  at?: string;
  /**
   * A person on the desk who wrote this reply themselves, by name. Missing or null: Mada wrote it (always, today: the
   * conversation never puts words in a person's mouth).
   */
  by?: string | null;
  /** What Mada has said so far (token by token while streaming). */
  text: string;
  /** What is being done right now ("Checking flights to Istanbul"). */
  status: string | null;
  cards: ChatCard[];
  pay: ChatPay | null;
  handoff: { threadId: string; agent: string | null } | null;
  /** What the traveller can do next, as chips that send their words (docs/app/ASSISTANT.md). */
  next?: string[];
  intent: AskIntent | null;
  lang: 'en' | 'ar';
  /** stopped: the app's flows answer. superseded: a newer message took over (nothing to do). */
  state: 'streaming' | 'done' | 'stopped' | 'superseded';
};

/** Whether this Ask talks with the conversation, or runs the app's own flows. */
export function useAskChatOn(): boolean {
  const on = useFeature(ASK_CHAT_FEATURE, false);
  const signedIn = useSession((s) => s.status === 'signedIn');
  return signedIn && ((on && API_MODE === 'live') || demoChatOn());
}

/** Mock builds only, for the web e2e and screenshots: `window.__MADA_DEMO__ = { askChat: true }` (ask-chat-demo.ts). */
export function demoChatOn(): boolean {
  if (API_MODE !== 'mock' || !SHOW_DEMO_HINTS) return false;
  return !!(globalThis as { __MADA_DEMO__?: { askChat?: boolean } }).__MADA_DEMO__?.askChat;
}

type Result = 'done' | 'fallback';

/** One message to the conversation. Every event goes to onEvent as it arrives; resolves when the server is done. */
export async function streamAskChat(body: { text: string; threadId?: string | null; tripId?: string | null }, onEvent: (e: AskChatEvent) => void, signal?: AbortSignal, retried = false): Promise<Result> {
  if (isOffline()) return 'fallback';
  if (demoChatOn()) return (await import('./ask-chat-demo')).demoAskChat(body, onEvent, signal);
  const token = useSession.getState().tokens?.accessToken;
  if (!token) return 'fallback';
  const f: typeof fetch = Platform.OS === 'web' ? fetch : ((await import('expo/fetch')).fetch as unknown as typeof fetch);
  let res: Response;
  try {
    res = await f(`${API_ORIGIN}${API_PREFIX}${ASK_CHAT_ROUTE}`, {
      method: 'POST',
      headers: { Accept: 'text/event-stream', 'Content-Type': 'application/json', Authorization: `Bearer ${token}`, 'Accept-Language': getLocale(), [HEADERS.appVersion]: getAppVersion() },
      body: JSON.stringify(body),
      signal,
    });
  } catch {
    return 'fallback';
  }
  if (res.status === 401 && !retried) return (await refreshSession()) ? streamAskChat(body, onEvent, signal, true) : 'fallback';
  if (!res.ok || !res.body || !(res.headers.get('content-type') ?? '').includes('text/event-stream')) return 'fallback';
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  let finished: Result | null = null;
  // Words that stop coming for 25 s: the line is gone; the app's own flows take it from here.
  let quiet: ReturnType<typeof setTimeout> | null = null;
  const arm = () => { if (quiet) clearTimeout(quiet); quiet = setTimeout(() => { void reader.cancel().catch(() => {}); }, 25_000); };
  arm();
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      arm();
      buf += decoder.decode(value, { stream: true });
      const { events, rest } = readSseFrames(buf);
      buf = rest;
      for (const e of events) {
        onEvent(e);
        if (e.type === 'done') finished = 'done';
        if (e.type === 'error') finished = 'fallback';
      }
    }
  } catch {
    return 'fallback';
  } finally {
    if (quiet) clearTimeout(quiet);
  }
  return finished ?? 'fallback';
}

/** A turn's state, changed by one event. Pure, so it is tested on its own. */
export function applyChatEvent(turn: ChatTurn, e: AskChatEvent): ChatTurn {
  switch (e.type) {
    case 'thread': return { ...turn, lang: e.lang };
    case 'status': return { ...turn, status: e.text };
    case 'text': return { ...turn, text: turn.text + e.delta, status: null };
    case 'replace': return { ...turn, text: e.text };
    case 'cards': return { ...turn, cards: [...turn.cards, ...e.cards] };
    case 'intent': return { ...turn, intent: e.intent };
    case 'pay': return { ...turn, pay: e.pay };
    case 'handoff': return { ...turn, handoff: { threadId: e.threadId, agent: e.agent } };
    case 'next': return { ...turn, next: e.choices };
    case 'done': return { ...turn, text: e.text || turn.text, status: null, state: 'done' };
    case 'error': return { ...turn, status: null, state: 'stopped' };
    default: return turn;
  }
}

type ChatState = {
  threadId: string | null;
  turns: ChatTurn[];
  busy: boolean;
  reset: () => void;
};
export const useAskChat = create<ChatState>((set) => ({ threadId: null, turns: [], busy: false, reset: () => set({ threadId: null, turns: [], busy: false }) }));

let seq = 0;

/*
 * Continuity on the phone: the thread id and the recent finished turns are kept on the device (lib/net/kv), so
 * reopening Ask within a day continues the same conversation (the server holds the rest of it). "New chat" starts
 * fresh. Kept per account: another sign-in on this phone never sees them.
 */
export const ASK_CHAT_KEY = 'mada.ask.chat.v1';
export const ASK_CHAT_KEEP_MS = 24 * 60 * 60_000;
const SAVED_TURNS = 8;
export type SavedChat = { v: 1; at: number; user: string | null; threadId: string | null; turns: ChatTurn[] };

const lastAt = (turns: ChatTurn[]) => Math.max(0, ...turns.map((x) => (x.at ? Date.parse(x.at) : 0)));

/** What is worth keeping: finished turns only, the last few. Null when there is nothing. */
export function savedOf(s: Pick<ChatState, 'threadId' | 'turns'>, user: string | null): SavedChat | null {
  const turns = s.turns.filter((x) => x.state === 'done').slice(-SAVED_TURNS);
  if (!turns.length || !s.threadId) return null;
  return { v: 1, at: lastAt(turns) || Date.now(), user, threadId: s.threadId, turns };
}

/** A saved conversation still worth continuing: this account's, and its last turn within 24 hours. */
export function freshSaved(x: SavedChat | null, user: string | null, now = Date.now()): SavedChat | null {
  return x && x.v === 1 && x.user === user && x.threadId && x.turns.length && now - x.at < ASK_CHAT_KEEP_MS ? x : null;
}

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;
useAskChat.subscribe((s, prev) => {
  if (!hydrated || s.busy || (s.turns === prev.turns && s.threadId === prev.threadId && s.busy === prev.busy)) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    void kvWriteJson(ASK_CHAT_KEY, savedOf(useAskChat.getState(), useSession.getState().user?.id ?? null));
  }, 300);
});

/** Opening Ask: the conversation from the last 24 hours comes back, or it starts fresh. */
export async function restoreAskChat(now = Date.now()): Promise<boolean> {
  const user = useSession.getState().user?.id ?? null;
  const here = useAskChat.getState();
  const inMemory = freshSaved(savedOf(here, user), user, now);
  const saved = inMemory ?? freshSaved(await kvReadJson<SavedChat>(ASK_CHAT_KEY), user, now);
  hydrated = true;
  if (!saved) { if (here.turns.length) here.reset(); return false; }
  seq = Math.max(seq, ...saved.turns.map((x) => x.id));
  useAskChat.setState({ threadId: saved.threadId, turns: saved.turns, busy: false });
  return true;
}

/** "New chat": the words in flight stop, the thread is let go, and nothing comes back next time. */
export function newAskChat() {
  current?.abort();
  current = null;
  useAskChat.getState().reset();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  void kvWriteJson(ASK_CHAT_KEY, null);
}
let current: AbortController | null = null;

/** Leaving Ask: the words in flight stop, and nothing falls back. */
export function stopAskChat() { current?.abort(); current = null; }

/**
 * Send one message. Resolves with the turn as it ended: state 'stopped' means the app should answer with its own flows
 * (the turn's intent, when the server read one, saves reading the words again).
 */
export async function sendAskChat(text: string, opts: { tripId?: string | null } = {}): Promise<ChatTurn> {
  current?.abort();
  const abort = new AbortController();
  current = abort;
  const id = ++seq;
  const blank: ChatTurn = { id, me: text, text: '', status: null, cards: [], pay: null, handoff: null, intent: null, lang: 'en', state: 'streaming', at: new Date().toISOString() };
  useAskChat.setState((s) => ({ turns: [...s.turns, blank].slice(-12), busy: true }));
  const update = (fn: (t: ChatTurn) => ChatTurn) => useAskChat.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) }));
  const r = await streamAskChat({ text, threadId: useAskChat.getState().threadId, tripId: opts.tripId ?? null }, (e) => {
    if (e.type === 'thread') useAskChat.setState({ threadId: e.threadId });
    update((t) => applyChatEvent(t, e));
  }, abort.signal);
  if (abort.signal.aborted) update((t) => ({ ...t, status: null, state: 'superseded' }));
  else if (r === 'fallback') update((t) => ({ ...t, status: null, state: 'stopped' }));
  if (current === abort) { current = null; useAskChat.setState({ busy: false }); }
  return useAskChat.getState().turns.find((t) => t.id === id) ?? { ...blank, state: 'stopped' };
}
