import { addDays, languageOfText, todayIn, type AskChatEvent, type ChatCard } from '@mada/shared';
import { api } from './api';
import { bookingApi } from './booking';
import { getLocale } from './i18n';

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

let said = 0;

/** Mock only, for the waiting screenshots: how long the first search "runs" (`__MADA_DEMO__.askChatWait`, ms). */
const demoWait = () => {
  const v = (globalThis as { __MADA_DEMO__?: { askChatWait?: number } }).__MADA_DEMO__?.askChatWait;
  return typeof v === 'number' && v > 0 ? Math.min(v, 30_000) : 600;
};
/** A table, a request, the team: the words the demo answers with a request card. */
const REQUEST_WORDS = /table|restaurant|dinner|book .* for us|طاولة|مطعم|عشاء/i;

export async function demoAskChat(body: { text: string }, onEvent: (e: AskChatEvent) => void, signal?: AbortSignal): Promise<'done' | 'fallback'> {
  const lang = languageOfText(body.text) ?? (getLocale() === 'ar' ? 'ar' : 'en');
  const L = LINES[lang];
  const first = said++ === 0;
  try {
    onEvent({ type: 'thread', threadId: '7d1f3c2a-5b4e-4c8d-9a61-2f0e8b7c6d51', lang });
    await wait(700, signal);
    let cards: ChatCard[] = [];
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
    return 'done';
  } catch {
    return 'fallback';
  }
}
