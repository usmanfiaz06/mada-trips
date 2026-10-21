import { addDays, languageOfText, rangeLabel, t, todayIn, type AskChatEvent, type ChatCard } from '@mada/shared';
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
/** A table, a request, the team: the words the demo answers with a request card. */
const REQUEST_WORDS = /table|restaurant|dinner|book .* for us|طاولة|مطعم|عشاء/i;
/** Companions (ASK-INTEGRATED.md §5): two Abdullahs, someone not in the circle, a change asked by a companion. */
const WHICH_WORDS = /abdullah|abdallah|عبدالله|عبد الله/i;
const INVITE_WORDS = /faisal|فيصل/i;
const CHANGE_WORDS = /two nights|ليلتين/i;

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
    const people = await demoPeople(body.text, lang, user, signal, onEvent);
    if (people) { keep(people); return 'done'; }
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

/** The companion cards, scripted: the mock's own trip and people (mock/trip-people.ts). Null when the words aren't about people. */
async function demoPeople(text: string, lang: 'en' | 'ar', user: import('./mock-api').MockUser | null, signal: AbortSignal | undefined, onEvent: (e: AskChatEvent) => void): Promise<string | null> {
  const which = WHICH_WORDS.test(text);
  const invite = !which && INVITE_WORDS.test(text);
  const change = !which && !invite && CHANGE_WORDS.test(text);
  if (!user || (!which && !invite && !change)) return null;
  const [{ mockTripsOf }, { DEMO_ABDULLAH, mockAskChange, mockTripTitle }] = await Promise.all([import('./mock/trips'), import('./mock/trip-people')]);
  const trip = mockTripsOf(user).find((x) => x.status !== 'cancelled' && x.status !== 'completed');
  if (!trip && !change) return null;
  const name = which ? (lang === 'ar' ? 'عبدالله' : 'Abdullah') : lang === 'ar' ? 'فيصل' : 'Faisal';
  onEvent({ type: 'status', text: change ? t('people.status.suggest', undefined, lang) : t('people.status.find', { name }, lang), tool: change ? 'request_change' : 'add_traveller' });
  await wait(800, signal);
  let card: ChatCard;
  let reply: string;
  let next: string[];
  if (which) {
    card = { type: 'people', tripId: trip!.id, name, options: [
      { ref: { kind: 'person', id: DEMO_ABDULLAH.person }, name, initial: lang === 'ar' ? 'ع' : 'A', how: t('people.how.household', { relation: t('person.rel.family', undefined, lang) }, lang) },
      { ref: { kind: 'user', id: DEMO_ABDULLAH.user }, name, initial: lang === 'ar' ? 'ع' : 'A', how: t('people.how.circle', { circle: lang === 'ar' ? 'رحلات الرياض' : 'Riyadh Hiking' }, lang) },
    ] };
    reply = t('people.which', { name }, lang);
    next = lang === 'ar' ? ['أخوي عبدالله', 'عبدالله من رحلات الرياض'] : ['My brother Abdullah', 'Abdullah from hiking'];
  } else if (invite) {
    const title = mockTripTitle(user, trip!.id);
    card = { type: 'invite', tripId: trip!.id, name, tripTitle: title, when: rangeLabel(trip!.startDate, trip!.endDate, lang) };
    reply = t('people.invite.lead', { name, trip: title }, lang);
    next = lang === 'ar' ? ['أضف الاسم بس', 'خلها بعدين'] : ['Just add the name', 'Leave it for now'];
  } else {
    const c = mockAskChange(user, lang === 'ar' ? 'ليلتين في العلا بدل ليلة' : 'Two nights in AlUla instead of one');
    card = { type: 'change', change: c };
    reply = t('people.line.waiting', { owner: c.ownerName }, lang);
    next = lang === 'ar' ? ['وش في اليوم الثاني؟', 'مين رايح؟'] : ['What’s on day 2?', 'Who else is going?'];
  }
  for (const word of reply.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
  onEvent({ type: 'cards', cards: [card] });
  onEvent({ type: 'next', choices: next });
  onEvent({ type: 'done', text: reply });
  return reply;
}
