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
  },
  ar: {
    status: 'أدوّر رحلات لإسطنبول',
    flights: 'لقيت لك ثلاث رحلات لإسطنبول الشهر الجاي. رحلة السعودية الصباحية توصلك قبل الغدا.',
    flightsNext: ['احجز الأولى', 'فنادق في إسطنبول', 'تواريخ ثانية'],
    area: 'تقسيم حيّة وسهرانة، والسلطان أحمد أهدى وجنب البلد القديمة. وش يناسبك أكثر؟',
    areaNext: ['تقسيم', 'السلطان أحمد'],
  },
} as const;

let said = 0;

export async function demoAskChat(body: { text: string }, onEvent: (e: AskChatEvent) => void, signal?: AbortSignal): Promise<'done' | 'fallback'> {
  const lang = languageOfText(body.text) ?? (getLocale() === 'ar' ? 'ar' : 'en');
  const L = LINES[lang];
  const first = said++ === 0;
  try {
    onEvent({ type: 'thread', threadId: '7d1f3c2a-5b4e-4c8d-9a61-2f0e8b7c6d51', lang });
    await wait(700, signal);
    let cards: ChatCard[] = [];
    if (first) {
      onEvent({ type: 'status', text: L.status });
      const people = (await api.people()).people;
      const self = people.find((p) => p.isSelf) ?? people[0];
      const depart = addDays(todayIn(), 30);
      if (self) {
        const r = await bookingApi.searchFlights({ from: 'RUH', destination: 'istanbul', depart, return: addDays(depart, 6), travellerIds: [self.id] });
        if (r.options.length) cards = [{ type: 'flights', search: { destination: r.destination, destinationName: r.destinationName, from: r.from, depart: r.depart, return: r.return, travellerIds: [self.id] }, options: r.options.slice(0, 3) }];
      }
      await wait(600, signal);
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
