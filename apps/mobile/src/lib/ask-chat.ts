import { Platform } from 'react-native';
import { create } from 'zustand';
import { API_PREFIX, ASK_CHAT_FEATURE, ASK_CHAT_ROUTE, HEADERS, readSseFrames, type AskChatEvent, type AskIntent, type ChatCard, type ChatPay } from '@mada/shared';
import { refreshSession } from './api';
import { API_MODE, API_ORIGIN, SHOW_DEMO_HINTS } from './config';
import { getLocale } from './i18n';
import { getAppVersion, useFeature } from './net/gates';
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
