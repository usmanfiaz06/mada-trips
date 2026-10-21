import { ERROR_CODES, AskThreadPatch, localeOr, nameIn, rangeLabel, t, type AskThreadLine, type AskThreadRow, type AskTripStatus, type ErrorCode } from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { mockTripsOf } from './trips';
import { mockDemoChange } from './trip-people';

/*
 * EXPO_PUBLIC_API_MODE=mock for the Ask chats list: the same contract as platform/src/app/api/app/v1/ask/threads
 * (docs/app/ASK-INTEGRATED.md §2.4). A signed-in traveller starts with a few chats (one about their upcoming trip, one
 * a person on the desk has, one archived) in the app's language, so the list has something to show in design work and
 * screenshots. The demo conversation (ask-chat-demo.ts) writes its turns here, so a chat opens again from the "server".
 */

type MockThread = {
  id: string; title: string | null; tripId: string | null; lines: AskThreadLine[]; lastAt: number; archived: boolean;
  mode: 'ai' | 'agent'; agent: string | null; lang: 'en' | 'ar';
};

const byUser = new Map<string, MockThread[]>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy) } } });
const HOUR = 3_600_000;
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const SEED = {
  en: {
    trip: [['me', 'What should we do on our first evening in Istanbul?'], ['mada', 'Taksim is lively and late; Sultanahmet is calmer, right by the old city. Which feels more like you?']],
    esimTitle: 'eSIM for Pakistan',
    esim: [['me', 'Internet in Pakistan for 10 days'], ['mada', 'Here are three plans for 10 days. The 10 GB one covers maps and calls.']],
    stayTitle: 'A stay in Dubai · Dec',
    stay: [['me', 'A quiet hotel in Dubai with a sea view in December'], ['mada', 'The team at Mada can take it from here.'], ['agent', 'I found two rooms with a sea view. Shall I hold one?']],
    agent: 'Noura',
    visaTitle: 'Visa for the UK',
    visa: [['me', 'UK visa for 2'], ['mada', 'The team gets back to you by 18:40 with what the visa needs.']],
  },
  ar: {
    trip: [['me', 'وش نسوي أول ليلة في إسطنبول؟'], ['mada', 'تقسيم حيّة وسهرانة، والسلطان أحمد أهدى وجنب البلد القديمة. وش يناسبك أكثر؟']],
    esimTitle: 'شريحة نت لباكستان',
    esim: [['me', 'نت في باكستان لعشرة أيام'], ['mada', 'هذي ثلاث باقات لعشرة أيام. باقة ١٠ جيجا تكفي للخرايط والمكالمات.']],
    stayTitle: 'سكن في دبي · ديسمبر',
    stay: [['me', 'فندق هادي في دبي يطل على البحر في ديسمبر'], ['mada', 'الفريق في مادا يكمل معك من هنا.'], ['agent', 'لقيت لك غرفتين تطل على البحر. أحجز لك وحدة؟']],
    agent: 'نورة',
    visaTitle: 'تأشيرة بريطانيا',
    visa: [['me', 'تأشيرة بريطانيا لشخصين'], ['mada', 'الفريق يرد عليك قبل ١٨:٤٠ باللي تحتاجه التأشيرة.']],
  },
} as const;

const lines = (xs: readonly (readonly [string, string])[], agent: string | null, at: number): AskThreadLine[] =>
  xs.map(([who, text], i) => ({ who: who as AskThreadLine['who'], text, ...(who === 'agent' ? { by: agent } : {}), at: new Date(at - (xs.length - i) * 60_000).toISOString() }));

/** "Riyadh → Istanbul · 9–15 Mar" (← in Arabic), the way the server titles a chat about a trip. */
const tripTitle = (city: string, start: string, end: string | null, lang: 'en' | 'ar') =>
  `${t('chat.title.route', { from: nameIn('Riyadh', lang), to: nameIn(city, lang) }, lang)} · ${rangeLabel(start, end, lang)}`;

function threadsOf(user: MockUser): MockThread[] {
  let list = byUser.get(user.id);
  if (!list) {
    const lang: 'en' | 'ar' = localeOr() === 'ar' ? 'ar' : 'en';
    const S = SEED[lang];
    const now = Date.now();
    const trip = mockTripsOf(user).find((x) => x.status !== 'cancelled' && x.status !== 'completed');
    list = [
      ...(trip ? [{ id: '5a1e0000-0000-4000-8000-000000000001', title: tripTitle(trip.city, trip.startDate, trip.endDate, lang), tripId: trip.id, lines: lines(S.trip, null, now - 2 * HOUR), lastAt: now - 2 * HOUR, archived: false, mode: 'ai' as const, agent: null, lang }] : []),
      { id: '5a1e0000-0000-4000-8000-000000000002', title: S.stayTitle, tripId: null, lines: lines(S.stay, S.agent, now - 20 * HOUR), lastAt: now - 20 * HOUR, archived: false, mode: 'agent', agent: S.agent, lang },
      { id: '5a1e0000-0000-4000-8000-000000000003', title: S.esimTitle, tripId: null, lines: lines(S.esim, null, now - 74 * HOUR), lastAt: now - 74 * HOUR, archived: false, mode: 'ai', agent: null, lang },
      { id: '5a1e0000-0000-4000-8000-000000000004', title: S.visaTitle, tripId: null, lines: lines(S.visa, null, now - 400 * HOUR), lastAt: now - 400 * HOUR, archived: true, mode: 'ai', agent: null, lang },
    ];
    // Companions (U5, mock only with __MADA_DEMO__.askPeople): Abdullah's change waiting in the trip's chat.
    const change = trip && (globalThis as { __MADA_DEMO__?: { askPeople?: boolean } }).__MADA_DEMO__?.askPeople ? mockDemoChange(user) : null;
    if (change && list[0]?.tripId === trip!.id) {
      list[0].lines.push({ who: 'mada', text: t('people.line.asked', { name: change.byName, trip: change.tripTitle, summary: change.summary }, lang), kept: [{ type: 'change', change }], at: new Date(now - 40 * 60_000).toISOString() });
      list[0].lastAt = now - 40 * 60_000;
    }
    byUser.set(user.id, list);
  }
  return list;
}

export function resetAskThreadsMock() { byUser.clear(); }

/** The demo conversation's chat: the one asked for, or a new one (listed once something is said in it). */
export function demoThread(user: MockUser | null, threadId: string | null, lang: 'en' | 'ar'): string {
  if (!user) return threadId ?? uuid();
  const list = threadsOf(user);
  const th = threadId ? list.find((x) => x.id === threadId) : undefined;
  if (th) return th.id;
  const id = threadId ?? uuid();
  list.push({ id, title: null, tripId: null, lines: [], lastAt: Date.now(), archived: false, mode: 'ai', agent: null, lang });
  return id;
}

/** The demo conversation's turn, kept as the server keeps it. */
export function recordDemoTurn(user: MockUser | null, threadId: string, me: string, reply: string, lang: 'en' | 'ar'): void {
  if (!user) return;
  const th = threadsOf(user).find((x) => x.id === demoThread(user, threadId, lang));
  if (!th) return;
  const at = new Date().toISOString();
  th.lines.push({ who: 'me', text: me, at }, { who: 'mada', text: reply });
  th.lastAt = Date.now();
  th.archived = false;
  if (!th.title) { const w = me.trim().split(/\s+/); th.title = w.slice(0, 6).join(' ') + (w.length > 6 ? '…' : ''); }
}

function statusOf(user: MockUser, tripId: string | null): { status: AskTripStatus | null; start: string | null } {
  const trip = tripId ? mockTripsOf(user).find((x) => x.id === tripId) : undefined;
  if (!trip) return { status: null, start: null };
  const today = new Date().toISOString().slice(0, 10);
  const end = trip.endDate ?? trip.startDate;
  const status: AskTripStatus = trip.status === 'cancelled' || trip.status === 'completed' || end < today ? 'done' : trip.startDate <= today ? 'today' : 'booked';
  return { status, start: trip.startDate };
}

function rowOf(user: MockUser, x: MockThread): AskThreadRow {
  const last = [...x.lines].reverse().find((l) => l.text);
  const trip = statusOf(user, x.tripId);
  return {
    id: x.id, title: x.title, tripId: x.tripId, tripStatus: trip.status, tripStart: trip.start, preview: last?.text.slice(0, 140) ?? null,
    lastAt: new Date(x.lastAt).toISOString(), mode: x.mode, agent: x.agent, unread: x.lines.at(-1)?.who === 'agent', archived: x.archived, ended: false, lang: x.lang,
  };
}

export const askThreadsMock: AreaMock = async (w, ctx) => {
  const [path, query = ''] = w.path.split('?');
  if (path !== '/ask/threads' && !path?.startsWith('/ask/threads/')) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const user = ctx.user;
  const list = threadsOf(user);
  if (w.method === 'GET' && path === '/ask/threads') {
    const u = new URLSearchParams(query);
    const q = (u.get('q') ?? '').trim().toLowerCase();
    const archived = u.get('archived') === '1';
    const tripId = u.get('tripId');
    const filter = u.get('filter');
    const has = (x: string | null | undefined) => !!q && !!x && x.toLowerCase().includes(q);
    const city = (x: MockThread) => (x.tripId ? mockTripsOf(user).find((tr) => tr.id === x.tripId)?.city ?? '' : '');
    const rows = list
      .filter((x) => x.lines.length && x.archived === archived && (!tripId || x.tripId === tripId))
      .map((x) => ({ x, row: rowOf(user, x) }))
      .filter(({ row }) => filter === 'trips' ? !!row.tripId : filter === 'upcoming' ? !!row.tripStatus && row.tripStatus !== 'done' : filter === 'past' ? row.tripStatus === 'done' : true)
      .map(({ x, row }) => ({ x, row, line: q ? [...x.lines].reverse().find((l) => l.who !== 'joined' && has(l.text)) : undefined }))
      .filter(({ x, line }) => !q || has(x.title) || has(city(x)) || !!line)
      .sort((a, b) => b.x.lastAt - a.x.lastAt)
      .map(({ row, line }) => (q ? { ...row, match: line ? line.text.slice(0, 90) : null } : row));
    return ok({ threads: rows, next: null, archivedCount: list.filter((x) => x.archived && x.lines.length).length });
  }
  const id = path.slice('/ask/threads/'.length);
  const th = list.find((x) => x.id === id);
  if (!th) return err('NOT_FOUND');
  if (w.method === 'GET') return ok({ thread: rowOf(user, th), lines: th.lines, last: th.lines.length - 1 });
  if (w.method === 'PATCH') {
    const p = AskThreadPatch.safeParse(w.body);
    if (!p.success) return err('VALIDATION');
    if (p.data.title !== undefined) th.title = p.data.title?.trim() || null;
    if (p.data.archived !== undefined) th.archived = p.data.archived;
    return ok({ thread: rowOf(user, th) });
  }
  if (w.method === 'DELETE') { byUser.set(user.id, list.filter((x) => x.id !== id)); return ok({ deleted: true }); }
  return null;
};
