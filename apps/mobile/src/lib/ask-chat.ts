import { Platform } from 'react-native';
import { create } from 'zustand';
import { z } from 'zod';
import { API_PREFIX, ASK_CHAT_DESK_ROUTE, ASK_CHAT_FEATURE, ASK_CHAT_ROUTE, ASK_THREADS_ROUTE, AskDeskResponse, AskThreadResponse, AskThreadRow, AskThreadsResponse, HEADERS, askThreadRoute, readSseFrames, type AskChatEvent, type AskDeskLine, type AskIntent, type AskThreadLine, type AskThreadPatch, type ChatCard, type ChatPay } from '@mada/shared';
import { refreshSession, request } from './api';
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
  /** What the traveller wrote. Empty on a line from the desk that answers nothing new (a person on the desk wrote again). */
  me: string;
  /** When the traveller sent it (ISO), for the time shown after a quiet gap. */
  at?: string;
  /**
   * A person on the desk who wrote this reply themselves, by name: only after they took the conversation over (their
   * replies come from GET /ask/chat/desk). Missing or null: Mada wrote it; the conversation never puts words in a
   * person's mouth.
   */
  by?: string | null;
  /** joined: the line "Noura from Mada joined", shown once when a person takes the conversation over. */
  desk?: 'joined';
  /** What Mada has said so far (token by token while streaming). */
  text: string;
  /** What is being done right now ("Checking flights to Istanbul"). */
  status: string | null;
  /** The tool behind the status (search_stays, search_flights…) and when it began, for the line that moves on. */
  statusTool?: string | null;
  statusAt?: number;
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
export async function streamAskChat(body: { text: string; threadId?: string | null; tripId?: string | null; attach?: 'trip' | 'new' }, onEvent: (e: AskChatEvent) => void, signal?: AbortSignal, retried = false): Promise<Result> {
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
    case 'status': return { ...turn, status: e.text, statusTool: e.tool ?? null, statusAt: Date.now() };
    case 'text': return { ...turn, text: turn.text + e.delta, status: null };
    case 'replace': return { ...turn, text: e.text };
    case 'cards': return { ...turn, cards: [...turn.cards, ...e.cards] };
    case 'intent': return { ...turn, intent: e.intent };
    case 'pay': return { ...turn, pay: e.pay };
    case 'handoff': return { ...turn, handoff: { threadId: e.threadId, agent: e.agent } };
    // A person has the conversation: this message waits for them, nothing more comes in this turn.
    case 'agent': return { ...turn, status: null };
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
  /** Who on the desk has the conversation now (they took it over), or null while Mada answers. */
  agent: string | null;
  /** The last thread line the desk's replies were read up to (GET /ask/chat/desk `after`). */
  deskAfter: number;
  reset: () => void;
};
export const useAskChat = create<ChatState>((set) => ({ threadId: null, turns: [], busy: false, agent: null, deskAfter: -1, reset: () => set({ threadId: null, turns: [], busy: false, agent: null, deskAfter: -1 }) }));

/**
 * The desk's lines into the conversation. Pure, so it is tested on its own. "Noura from Mada joined" is a line of its
 * own; a reply fills the traveller's latest message that nobody answered yet, or follows the same person's last reply,
 * or starts a line of its own.
 */
export function applyDeskLines(turns: ChatTurn[], lines: AskDeskLine[], nextId: () => number, lang: 'en' | 'ar' = 'en'): ChatTurn[] {
  const out = [...turns];
  for (const l of lines) {
    const last = out[out.length - 1];
    const line = (o: Partial<ChatTurn>): ChatTurn => ({ id: nextId(), me: '', at: l.at, text: l.text, status: null, cards: [], pay: null, handoff: null, intent: null, lang: last?.lang ?? lang, state: 'done', ...o });
    if (l.kind === 'joined') { out.push(line({ by: null, desk: 'joined' })); continue; }
    if (last && last.state === 'done' && !last.text && !last.cards.length && last.me) out[out.length - 1] = { ...last, by: l.by, text: l.text };
    else if (last && !last.me && last.by === l.by && !last.desk) out[out.length - 1] = { ...last, text: `${last.text}\n\n${l.text}` };
    else out.push(line({ by: l.by }));
  }
  return out;
}

let seq = 0;

/*
 * Continuity on the phone (docs/app/ASK-INTEGRATED.md §2.5): a small cache keyed by thread id (the last 3 chats, 8
 * finished turns each), so opening a recent chat paints at once while GET /ask/threads/{id} refreshes it from the
 * server (where every chat lives, so it opens on any device). The 24-hour rule only decides whether the orb jumps
 * into the last chat. Kept per account: another sign-in on this phone never sees them.
 */
export const ASK_CHAT_KEY = 'mada.ask.chat.v2';
export const ASK_CHAT_KEEP_MS = 24 * 60 * 60_000;
const SAVED_TURNS = 8;
const SAVED_CHATS = 3;
export type SavedChat = { v: 1; at: number; user: string | null; threadId: string | null; turns: ChatTurn[]; deskAfter?: number };
/** The cache: this account's recent chats, newest first, and the one open last (null after "New chat"). */
export type SavedChats = { v: 2; user: string | null; last: string | null; chats: SavedChat[] };

const lastAt = (turns: ChatTurn[]) => Math.max(0, ...turns.map((x) => (x.at ? Date.parse(x.at) : 0)));

/** What is worth keeping: finished turns only, the last few. Null when there is nothing. */
export function savedOf(s: Pick<ChatState, 'threadId' | 'turns'> & { deskAfter?: number }, user: string | null): SavedChat | null {
  const turns = s.turns.filter((x) => x.state === 'done').slice(-SAVED_TURNS);
  if (!turns.length || !s.threadId) return null;
  return { v: 1, at: lastAt(turns) || Date.now(), user, threadId: s.threadId, turns, ...(s.deskAfter !== undefined && s.deskAfter >= 0 ? { deskAfter: s.deskAfter } : {}) };
}

/** A saved conversation still worth continuing: this account's, and its last turn within 24 hours. */
export function freshSaved(x: SavedChat | null, user: string | null, now = Date.now()): SavedChat | null {
  return x && x.v === 1 && x.user === user && x.threadId && x.turns.length && now - x.at < ASK_CHAT_KEEP_MS ? x : null;
}

async function readCache(user: string | null): Promise<SavedChats> {
  const c = await kvReadJson<SavedChats>(ASK_CHAT_KEY).catch(() => null);
  return c && c.v === 2 && c.user === user && Array.isArray(c.chats) ? c : { v: 2, user, last: null, chats: [] };
}
/** One chat into the cache (newest first, 3 at most); last: whether it is the one open now. */
export function cacheWith(c: SavedChats, chat: SavedChat | null, last: string | null): SavedChats {
  const chats = chat ? [chat, ...c.chats.filter((x) => x.threadId !== chat.threadId)].slice(0, SAVED_CHATS) : c.chats;
  return { ...c, last, chats };
}
let writing: Promise<void> = Promise.resolve();
const writeCache = (fn: (c: SavedChats) => SavedChats) => {
  const user = useSession.getState().user?.id ?? null;
  writing = writing.then(async () => { await kvWriteJson(ASK_CHAT_KEY, fn(await readCache(user))); }).catch(() => {});
  return writing;
};

let writeTimer: ReturnType<typeof setTimeout> | null = null;
let hydrated = false;
useAskChat.subscribe((s, prev) => {
  if (!hydrated || s.busy || (s.turns === prev.turns && s.threadId === prev.threadId && s.busy === prev.busy && s.deskAfter === prev.deskAfter)) return;
  if (writeTimer) clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const now = useAskChat.getState();
    const chat = savedOf(now, useSession.getState().user?.id ?? null);
    if (chat) void writeCache((c) => cacheWith(c, chat, chat.threadId));
  }, 300);
});

/** The chat open last, if its last turn was within 24 hours: the orb jumps straight into it (owner decision 1). */
export async function lastAskThread(now = Date.now()): Promise<string | null> {
  const user = useSession.getState().user?.id ?? null;
  const c = await readCache(user);
  const chat = c.last ? c.chats.find((x) => x.threadId === c.last) ?? null : null;
  return freshSaved(chat, user, now)?.threadId ?? null;
}

/** Opening Ask on the last chat (the flows, and the orb): the conversation from the last 24 hours comes back, or none. */
export async function restoreAskChat(now = Date.now()): Promise<boolean> {
  const user = useSession.getState().user?.id ?? null;
  const here = useAskChat.getState();
  const inMemory = freshSaved(savedOf(here, user), user, now);
  let saved = inMemory;
  if (!saved) {
    const c = await readCache(user);
    saved = freshSaved(c.last ? c.chats.find((x) => x.threadId === c.last) ?? null : null, user, now);
  }
  hydrated = true;
  if (!saved) { if (here.turns.length) here.reset(); return false; }
  seq = Math.max(seq, ...saved.turns.map((x) => x.id));
  useAskChat.setState({ threadId: saved.threadId, turns: saved.turns, busy: false, deskAfter: saved.deskAfter ?? -1 });
  followDesk();
  return true;
}

/**
 * The lines the server kept, as turns: what the traveller wrote and what came back (Mada's words, a person's reply,
 * "Noura joined"). The cards aren't kept on the server (only their kinds), so a turn the phone still has keeps its own.
 */
export function turnsOfLines(lines: AskThreadLine[], cached: ChatTurn[], lang: 'en' | 'ar', nextId: () => number): ChatTurn[] {
  const out: ChatTurn[] = [];
  const blank = (o: Partial<ChatTurn>): ChatTurn => ({ id: nextId(), me: '', text: '', status: null, cards: [], pay: null, handoff: null, intent: null, lang, state: 'done', ...o });
  for (const l of lines) {
    const last = out[out.length - 1];
    if (l.who === 'me') out.push(blank({ me: l.text, at: l.at ?? undefined }));
    else if (l.who === 'joined') out.push(blank({ desk: 'joined', text: l.text, at: l.at ?? undefined }));
    else if (last && last.me && !last.text && !last.desk && !last.by) out[out.length - 1] = { ...last, text: l.text, by: l.who === 'agent' ? l.by ?? null : null, next: l.next };
    else if (last && !last.me && l.who === 'agent' && last.by === l.by) out[out.length - 1] = { ...last, text: `${last.text}\n\n${l.text}` };
    else out.push(blank({ text: l.text, by: l.who === 'agent' ? l.by ?? null : null, next: l.next, at: l.at ?? undefined }));
  }
  // The phone's own copy of a turn keeps its cards and pay sheet.
  return out.map((x) => {
    const mine = cached.find((c) => c.me === x.me && c.text === x.text && (c.cards.length || c.pay));
    return mine ? { ...x, cards: mine.cards, pay: mine.pay, handoff: mine.handoff, intent: mine.intent } : x;
  });
}

/** The chat being opened now (a newer open wins over a slower refresh). */
let opening: string | null = null;

/**
 * Open one chat: the phone's copy at once (if it has one), then the server's. Resolves with whether the chat could be
 * shown (false: not found, or offline with nothing cached).
 */
export async function openAskThread(threadId: string): Promise<boolean> {
  unfollowDesk();
  current?.abort();
  current = null;
  opening = threadId;
  hydrated = true;
  const user = useSession.getState().user?.id ?? null;
  const here = useAskChat.getState();
  const cached = here.threadId === threadId ? savedOf(here, user) : (await readCache(user)).chats.find((x) => x.threadId === threadId) ?? null;
  if (opening !== threadId) return false;
  if (cached?.user === user && cached.turns.length) {
    seq = Math.max(seq, ...cached.turns.map((x) => x.id));
    useAskChat.setState({ threadId, turns: cached.turns, busy: false, agent: null, deskAfter: cached.deskAfter ?? -1 });
  } else useAskChat.setState({ threadId, turns: [], busy: false, agent: null, deskAfter: -1 });
  let r: AskThreadResponse;
  try {
    r = await request({ method: 'GET', path: askThreadRoute(threadId), retries: 0 }, AskThreadResponse);
  } catch {
    if (opening === threadId) followDesk();
    return !!cached?.turns.length;
  }
  if (opening !== threadId || useAskChat.getState().busy) return true;
  const lang = r.thread.lang;
  const turns = turnsOfLines(r.lines, cached?.turns ?? [], lang, () => ++seq).slice(-30);
  useAskChat.setState({ threadId, turns, agent: r.thread.mode === 'agent' ? r.thread.agent : null, deskAfter: Math.max(r.last, useAskChat.getState().deskAfter) });
  followDesk();
  return true;
}

/* The chats list (ASK-INTEGRATED.md §2.4). */
export const askThreadsApi = {
  list: (o: { q?: string; archived?: boolean; tripId?: string; filter?: 'trips' | 'upcoming' | 'past' } = {}) => {
    const qs = new URLSearchParams();
    if (o.q) qs.set('q', o.q);
    if (o.archived) qs.set('archived', '1');
    if (o.filter) qs.set('filter', o.filter);
    if (o.tripId) qs.set('tripId', o.tripId);
    const tail = qs.toString();
    return request({ method: 'GET', path: `${ASK_THREADS_ROUTE}${tail ? `?${tail}` : ''}`, retries: 0 }, AskThreadsResponse);
  },
  patch: (id: string, body: AskThreadPatch) => request({ method: 'PATCH', path: askThreadRoute(id), body }, z.object({ thread: AskThreadRow })),
  remove: async (id: string) => {
    await request({ method: 'DELETE', path: askThreadRoute(id) }, z.object({ deleted: z.boolean() }));
    // Gone from the phone too.
    await writeCache((c) => ({ ...c, last: c.last === id ? null : c.last, chats: c.chats.filter((x) => x.threadId !== id) }));
    if (useAskChat.getState().threadId === id) useAskChat.getState().reset();
  },
};

/*
 * A person on the desk can take the conversation over (DESK-PLAN.md U5). While Ask is open on a thread, the app asks
 * GET /ask/chat/desk now and then: every 6 s while someone has it, every 30 s otherwise. Live builds only.
 */
let deskTimer: ReturnType<typeof setTimeout> | null = null;
let deskOn = false;
export async function pollDesk(): Promise<void> {
  const { threadId, deskAfter } = useAskChat.getState();
  if (!threadId || API_MODE !== 'live' || isOffline() || useSession.getState().status !== 'signedIn') return;
  let r: AskDeskResponse;
  try {
    r = await request({ method: 'GET', path: `${ASK_CHAT_DESK_ROUTE}?threadId=${threadId}&after=${deskAfter}`, retries: 0 }, AskDeskResponse);
  } catch { return; }
  const now = useAskChat.getState();
  if (now.threadId !== threadId) return; // a new chat started meanwhile
  const lang = getLocale() === 'ar' ? 'ar' : 'en';
  useAskChat.setState({ agent: r.agent, deskAfter: Math.max(now.deskAfter, r.last), ...(r.lines.length ? { turns: applyDeskLines(now.turns, r.lines, () => ++seq, lang).slice(-12) } : {}) });
}
function followDesk() {
  if (deskOn) return;
  deskOn = true;
  const tick = async () => {
    deskTimer = null;
    if (!deskOn) return;
    if (!useAskChat.getState().busy) await pollDesk();
    if (deskOn) deskTimer = setTimeout(() => { void tick(); }, useAskChat.getState().agent ? 6_000 : 30_000);
  };
  deskTimer = setTimeout(() => { void tick(); }, 1_000);
}
function unfollowDesk() {
  deskOn = false;
  if (deskTimer) { clearTimeout(deskTimer); deskTimer = null; }
}

/** "New chat": the words in flight stop, the thread is let go (it stays in the list), and the orb won't jump back into it. */
export function newAskChat() {
  unfollowDesk();
  current?.abort();
  current = null;
  opening = null;
  hydrated = true;
  useAskChat.getState().reset();
  if (writeTimer) { clearTimeout(writeTimer); writeTimer = null; }
  void writeCache((c) => ({ ...c, last: null }));
}
let current: AbortController | null = null;

/** Leaving Ask: the words in flight stop, and nothing falls back. */
export function stopAskChat() { current?.abort(); current = null; unfollowDesk(); }

/**
 * Send one message. Resolves with the turn as it ended: state 'stopped' means the app should answer with its own flows
 * (the turn's intent, when the server read one, saves reading the words again).
 */
export async function sendAskChat(text: string, opts: { tripId?: string | null; attach?: 'trip' | 'new' | null } = {}): Promise<ChatTurn> {
  current?.abort();
  const abort = new AbortController();
  current = abort;
  const id = ++seq;
  const blank: ChatTurn = { id, me: text, text: '', status: null, cards: [], pay: null, handoff: null, intent: null, lang: 'en', state: 'streaming', at: new Date().toISOString() };
  useAskChat.setState((s) => ({ turns: [...s.turns, blank].slice(-12), busy: true }));
  const update = (fn: (t: ChatTurn) => ChatTurn) => useAskChat.setState((s) => ({ turns: s.turns.map((t) => (t.id === id ? fn(t) : t)) }));
  let moved: string | null = null;
  const r = await streamAskChat({ text, threadId: useAskChat.getState().threadId, tripId: opts.tripId ?? null, ...(opts.attach ? { attach: opts.attach } : {}) }, (e) => {
    if (e.type === 'thread') { useAskChat.setState({ threadId: e.threadId }); if (e.moved) moved = e.threadId; }
    if (e.type === 'agent') useAskChat.setState({ agent: e.name });
    update((t) => applyChatEvent(t, e));
  }, abort.signal);
  if (abort.signal.aborted) update((t) => ({ ...t, status: null, state: 'superseded' }));
  else if (r === 'fallback') update((t) => ({ ...t, status: null, state: 'stopped' }));
  if (current === abort) { current = null; useAskChat.setState({ busy: false }); }
  if (r === 'done') followDesk();
  const ended = useAskChat.getState().turns.find((t) => t.id === id) ?? { ...blank, state: 'stopped' };
  // The message went into the trip's own chat: its earlier turns come in above this one.
  if (moved && r === 'done') await openAskThread(moved);
  return ended;
}
