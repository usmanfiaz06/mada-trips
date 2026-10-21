import { addDays, languageOfText, todayIn, type AskChatEvent, type ChatCard } from '@mada/shared';
import { api } from './api';
import { bookingApi } from './booking';
import { getLocale } from './i18n';
import { useSession } from './session';

/*
 * The conversation in mock mode, for the web e2e and screenshots only: `window.__MADA_DEMO__ = { askChat: true }` in a
 * mock build (ask-chat.ts demoChatOn). A short scripted reply in the words' language, with the mock's own flights as
 * the cards, so the thread can be seen without a server. Live builds never load this file.
 */

const wait = (ms: number, signal?: AbortSignal) => new Promise<void>((resolve, reject) => {
  const id = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => { clearTimeout(id); reject(new Error('aborted')); });
});

const LINES = {
  en: {
    status: 'Looking at flights to Istanbul',
    flights: 'Three good ways to Istanbul next month. The morning Saudia gets you there in time for lunch.',
    flightsNext: ['Book the first one', 'Hotels in Istanbul', 'Other dates'],
    area: 'Taksim is lively and late; Sultanahmet is calmer, right by the old city. Which feels more like you?',
    areaNext: ['Taksim', 'Sultanahmet'],
    requestStatus: 'Sending it to the team',
    request: 'Noted. The team books the table and gets back to you on WhatsApp.',
    requestTitle: 'Restaurant table',
    requestDetail: 'Dinner for two, a quiet table with a view',
    requestNext: ['Add a birthday cake', 'Hotels in Istanbul'],
  },
  ar: {
    status: 'أدوّر رحلات لإسطنبول',
    flights: 'لقيت لك ثلاث رحلات لإسطنبول الشهر الجاي. رحلة السعودية الصباحية توصلك قبل الغدا.',
    flightsNext: ['احجز الأولى', 'فنادق في إسطنبول', 'تواريخ ثانية'],
    area: 'تقسيم حيّة وسهرانة، والسلطان أحمد أهدى وجنب البلد القديمة. وش يناسبك أكثر؟',
    areaNext: ['تقسيم', 'السلطان أحمد'],
    requestStatus: 'نرسلها للفريق',
    request: 'تمام. الفريق يحجز الطاولة ويرد عليك على واتساب.',
    requestTitle: 'طاولة في مطعم',
    requestDetail: 'عشاء لشخصين، طاولة هادية مع إطلالة',
    requestNext: ['أضف كيكة عيد ميلاد', 'فنادق في إسطنبول'],
  },
} as const;

/** Mock only, for the waiting screenshots: how long the first search "runs" (`__MADA_DEMO__.askChatWait`, ms). */
const demoWait = () => {
  const v = (globalThis as { __MADA_DEMO__?: { askChatWait?: number } }).__MADA_DEMO__?.askChatWait;
  return typeof v === 'number' && v > 0 ? Math.min(v, 30_000) : 600;
};
/** A trip of several days or places: the demo answers with a plan card; a new start with what changed. */
const PLAN_WORDS = /road trip|رحلة برية|خطة/i;
const START_WORDS = /start from|leaving from|نبدأ من|البداية من|من جدة/i;
const PLAN_LINES = {
  en: { status: 'Putting the plan together', plan: 'Here’s your 7-day plan from Riyadh, through Melaka and Kuala Lumpur to Penang. Review it.', next: ['Book a car for days 3–6', 'Find stays', 'Start in Singapore'], startStatus: 'Moving the start', start: 'Now starting from Jeddah. The flights need checking again.', startNext: ['Find Jeddah flights', 'Review the plan'] },
  ar: { status: 'نجهّز الخطة', plan: 'هذي خطتك ٧ أيام من الرياض، عن طريق ملقا وكوالالمبور لين بينانغ. شوفها.', next: ['احجز سيارة للأيام ٣–٦', 'دوّر سكن', 'ابدأ من سنغافورة'], startStatus: 'نغيّر نقطة البداية', start: 'صارت البداية من جدة. الرحلات تحتاج نشوفها من جديد.', startNext: ['رحلات من جدة', 'شوف الخطة'] },
} as const;
const row = (kind: 'leg' | 'stay' | 'activity', title: string, o: { mode?: 'flight' | 'drive'; from?: string; to?: string; place?: string; nights?: number; status?: 'idea' | 'booked'; booking?: string } = {}) =>
  ({ kind, mode: o.mode ?? null, title, place: o.place ?? null, from: o.from ?? null, to: o.to ?? null, status: o.status ?? 'idea', nights: o.nights ?? null, at: null, km: null, minutes: null, borders: [], booking: o.booking ?? null });
function demoPlanCard(start: string, who: { name: string; self: boolean }[]): ChatCard {
  return {
    type: 'plan', planId: '5b0c6a3e-2f41-4c7d-9e18-6a4b2d9f0c11', tripId: '0f6e2d1c-8b3a-4e59-a7c2-3d1b9e8f4a60', version: 1, title: 'Riyadh → Singapore → Penang',
    start, end: addDays(start, 6), origin: { name: 'Riyadh', code: 'RUH', source: 'memory' }, originNeeded: false, travellers: who,
    days: [
      { day: 0, items: [row('leg', 'Riyadh → Singapore', { mode: 'flight', from: 'Riyadh', to: 'Singapore' }), row('stay', 'Stay in Singapore', { place: 'Singapore', nights: 2 })] },
      { day: 1, items: [row('activity', 'Gardens by the Bay', { place: 'Singapore' })] },
      { day: 2, items: [row('leg', 'Singapore → Melaka', { mode: 'drive', from: 'Singapore', to: 'Melaka' }), row('stay', 'Stay in Melaka', { place: 'Melaka', nights: 1 })] },
      { day: 3, items: [row('leg', 'Melaka → Kuala Lumpur', { mode: 'drive', from: 'Melaka', to: 'Kuala Lumpur' }), row('stay', 'Stay in Kuala Lumpur', { place: 'Kuala Lumpur', nights: 2 })] },
      { day: 4, items: [] },
      { day: 5, items: [row('leg', 'Kuala Lumpur → Penang', { mode: 'drive', from: 'Kuala Lumpur', to: 'Penang' }), row('stay', 'Stay in Penang', { place: 'Penang', nights: 1 })] },
      { day: 6, items: [row('leg', 'Penang → Riyadh', { mode: 'flight', from: 'Penang', to: 'Riyadh' })] },
    ],
    more: 0, todo: [{ key: 'car', state: 'todo', days: [2, 3, 4, 5] }, { key: 'stays', state: 'todo', days: [] }],
  };
}
const demoDiffCard: ChatCard = {
  type: 'plan_diff', planId: '5b0c6a3e-2f41-4c7d-9e18-6a4b2d9f0c11', tripId: '0f6e2d1c-8b3a-4e59-a7c2-3d1b9e8f4a60', title: 'Jeddah → Singapore → Penang', from: 1, to: 2,
  changes: [
    { op: 'origin', day: null, row: row('leg', 'Jeddah', { place: 'Jeddah' }) },
    { op: 'update', day: 0, row: row('leg', 'Jeddah → Singapore', { mode: 'flight', from: 'Jeddah', to: 'Singapore' }) },
    { op: 'update', day: 6, row: row('leg', 'Penang → Jeddah', { mode: 'flight', from: 'Penang', to: 'Jeddah' }) },
  ],
  untouched: [],
};

/** A table, a request, the team: the words the demo answers with a request card. */
const REQUEST_WORDS = /table|restaurant|dinner|book .* for us|طاولة|مطعم|عشاء/i;

export async function demoAskChat(body: { text: string; threadId?: string | null }, onEvent: (e: AskChatEvent) => void, signal?: AbortSignal): Promise<'done' | 'fallback'> {
  const lang = languageOfText(body.text) ?? (getLocale() === 'ar' ? 'ar' : 'en');
  const L = LINES[lang];
  // A new chat starts with the flights; a chat that goes on answers about the area (or a request).
  const first = !body.threadId;
  // Kept as the server keeps it, so the chat opens again from the list (mock/ask-threads.ts).
  // Loaded on demand, so the mock's code stays in its own chunk (tools/leak-scan allows sample prices there only).
  const [{ mockUserById }, { demoThread, recordDemoTurn }] = await Promise.all([import('./mock-api'), import('./mock/ask-threads')]);
  const user = mockUserById(useSession.getState().user?.id);
  const threadId = demoThread(user, body.threadId ?? null, lang);
  const keep = (reply: string) => recordDemoTurn(user, threadId, body.text, reply, lang);
  try {
    onEvent({ type: 'thread', threadId, lang });
    await wait(700, signal);
    let cards: ChatCard[] = [];
    if (PLAN_WORDS.test(body.text) || START_WORDS.test(body.text)) {
      const P = PLAN_LINES[lang];
      const start = START_WORDS.test(body.text);
      onEvent({ type: 'status', text: start ? P.startStatus : P.status, tool: start ? 'set_origin' : 'create_plan' });
      const people = (await api.people()).people;
      const self = people.find((p) => p.isSelf) ?? people[0];
      const other = people.find((p) => !p.isSelf && p.relation !== 'child');
      await wait(900, signal);
      const card = start ? demoDiffCard : demoPlanCard(addDays(todayIn(), 52), [self, other].filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ name: p.firstName, self: !!p.isSelf })));
      const text = start ? P.start : P.plan;
      for (const word of text.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
      onEvent({ type: 'cards', cards: [card] });
      onEvent({ type: 'next', choices: [...(start ? P.startNext : P.next)] });
      onEvent({ type: 'done', text });
      keep(text);
      return 'done';
    }
    if (REQUEST_WORDS.test(body.text)) {
      onEvent({ type: 'status', text: L.requestStatus, tool: 'create_request' });
      const people = (await api.people()).people;
      const self = people.find((p) => p.isSelf) ?? people[0];
      const other = people.find((p) => !p.isSelf && p.relation !== 'child');
      await wait(900, signal);
      const card: ChatCard = {
        type: 'request', requestId: '3c9a1f2e-7b4d-4e8a-9c61-5d2f0a8b7e14', kind: 'food', title: L.requestTitle, detail: L.requestDetail,
        promisedBy: new Date(Date.now() + 20 * 60_000).toISOString(), contact: 'whatsapp', where: 'Istanbul', depart: addDays(todayIn(), 31), return: null,
        who: [self, other].filter((p): p is NonNullable<typeof p> => !!p).map((p) => ({ name: p.firstName, self: !!p.isSelf })),
      };
      for (const word of L.request.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
      onEvent({ type: 'cards', cards: [card] });
      onEvent({ type: 'next', choices: [...L.requestNext] });
      onEvent({ type: 'done', text: L.request });
      keep(L.request);
      return 'done';
    }
    if (first) {
      onEvent({ type: 'status', text: L.status, tool: 'search_flights' });
      const people = (await api.people()).people;
      const self = people.find((p) => p.isSelf) ?? people[0];
      const depart = addDays(todayIn(), 30);
      if (self) {
        const r = await bookingApi.searchFlights({ from: 'RUH', destination: 'istanbul', depart, return: addDays(depart, 6), travellerIds: [self.id] });
        if (r.options.length) cards = [{ type: 'flights', search: { destination: r.destination, destinationName: r.destinationName, from: r.from, depart: r.depart, return: r.return, travellerIds: [self.id] }, options: r.options.slice(0, 3) }];
      }
      await wait(demoWait(), signal);
    }
    const text = first ? L.flights : L.area;
    for (const word of text.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
    if (cards.length) onEvent({ type: 'cards', cards });
    onEvent({ type: 'next', choices: [...(first ? L.flightsNext : L.areaNext)] });
    onEvent({ type: 'done', text });
    keep(text);
    return 'done';
  } catch {
    return 'fallback';
  }
}
