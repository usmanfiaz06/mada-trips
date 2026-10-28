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

/** "A 3-day plan for Istanbul": a living plan from the Istanbul template, on a new planning trip (mock/plans.ts). */
const ISTANBUL_PLAN = /plan.*istanbul|istanbul.*plan|days in istanbul|خطة.*إسطنبول|إسطنبول.*خطة/i;
const ISTANBUL_LINES = {
  en: { status: 'Putting the plan together', text: 'Here’s a 3-day plan for Istanbul, starting from Riyadh. Review it.', next: ['Find a stay', 'Add an eSIM', 'Start from Jeddah'] },
  ar: { status: 'نجهّز الخطة', text: 'هذي خطة ٣ أيام في إسطنبول، البداية من الرياض. شوفها.', next: ['دوّر سكن', 'أضف شريحة نت', 'ابدأ من جدة'] },
} as const;

/** Places (find_places / place_details): a list near the hotel, and one in full ("More about …"). */
const PLACES_WORDS = /shawarma|mandi|near (?:our|my|the) hotel|open now|شاورما|مندي|قريب من فندق|مفتوح الحين/i;
const PLACE_MORE = /^(?:more about|تفاصيل) /i;
const week = (line: string) => ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'].map((d) => `${d}: ${line}`);
const demoPlace = (id: string, name: string, type: string, rating: number, ratings: number, price: number, closes: string, distanceM: number, address: string, photo: string, extra: Partial<import('@mada/shared').ChatPlace> = {}): import('@mada/shared').ChatPlace => ({
  id, name, type, rating, ratings, price, open: { now: true, closes, opens: null }, today: null, address, lat: 41.0336, lng: 28.9768, distanceM,
  photo: { url: `photo:${photo}`, credit: [{ name: 'Ayşe K.', url: null }] }, ...extra,
});
const DEMO_PLACES = {
  en: [
    demoPlace('demo-ist-1', 'Taksim Şam Shawarma', 'Shawarma restaurant', 4.4, 3210, 1, '02:00', 400, 'Sıraselviler Cd. 12, Beyoğlu, İstanbul', 'turkish-breakfast'),
    demoPlace('demo-ist-2', 'Dürümzade Beyoğlu', 'Shawarma restaurant', 4.6, 18420, 1, '03:00', 650, 'Hamalbaşı Cd. 26/B, Beyoğlu, İstanbul', 'istanbul-sultanahmet'),
    demoPlace('demo-ist-3', 'Karadeniz Döner Asım Usta', 'Turkish restaurant', 4.7, 9870, 2, '21:30', 2400, 'Beşiktaş Cd. 1, Beşiktaş, İstanbul', 'istanbul-bosphorus'),
  ],
  ar: [
    demoPlace('demo-dxb-1', 'مطعم بيت المندي', 'مطعم يمني', 4.5, 6420, 2, '01:00', 350, 'شارع المطينة، ديرة، دبي', 'dubai-creek'),
    demoPlace('demo-dxb-2', 'مندي هاوس داون تاون', 'مطعم عربي', 4.1, 870, 3, '23:00', 900, 'بوليفارد محمد بن راشد، وسط دبي', 'desert-camp'),
    demoPlace('demo-dxb-3', 'الروشة للمندي', 'مطعم يمني', 4.3, 2980, 2, '00:30', 1400, 'شارع الشيخ زايد، الوصل، دبي', 'dubai-skyline'),
  ],
} as const;
/** Today's hours as Google writes them, for each demo place's closing time. */
const TODAY: Record<string, string> = { '02:00': '11:00 AM – 2:00 AM', '03:00': '11:00 AM – 3:00 AM', '21:30': '10:30 AM – 9:30 PM', '01:00': '12:00 PM – 1:00 AM', '23:00': '1:00 PM – 11:00 PM', '00:30': '11:30 AM – 12:30 AM' };
const PLACES_LINES = {
  en: { status: 'Looking at places nearby', list: 'Three good shawarma places open now near your hotel. Taksim Şam is the closest, 400 m away.', next: ['More about Taksim Şam Shawarma', 'Directions', 'Add to my plan'], detailStatus: 'Checking the opening hours', detail: 'Taksim Şam is open until 02:00 tonight, 400 m from your hotel.', detailNext: ['Directions', 'Add to my plan', 'Something sweet after'] },
  ar: { status: 'نشوف الأماكن القريبة', list: 'لقيت لك ثلاث مطاعم مندي مفتوحة الحين قريبة من فندقك. بيت المندي أقربها، على بعد 350 م.', next: ['تفاصيل مطعم بيت المندي', 'الاتجاهات', 'أضفه لخطتي'], detailStatus: 'نشوف أوقات الدوام', detail: 'بيت المندي مفتوح لين 01:00 الليلة، على بعد 350 م من فندقك.', detailNext: ['الاتجاهات', 'أضفه لخطتي', 'حلا بعده'] },
} as const;

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
  // Loaded on demand through mock-api, which a live build swaps for its stub: none of the mock's code ships there.
  const { mockUserById, demoThread, recordDemoTurn } = await import('./mock-api');
  const user = mockUserById(useSession.getState().user?.id);
  const threadId = demoThread(user, body.threadId ?? null, lang);
  const keep = (reply: string) => recordDemoTurn(user, threadId, body.text, reply, lang);
  try {
    onEvent({ type: 'thread', threadId, lang });
    await wait(700, signal);
    let cards: ChatCard[] = [];
    const people = await demoPeople(body.text, lang, user, signal, onEvent);
    if (people) { keep(people); return 'done'; }
    if (ISTANBUL_PLAN.test(body.text) && user) {
      const P = ISTANBUL_LINES[lang];
      onEvent({ type: 'status', text: P.status, tool: 'create_plan' });
      // Through mock-api, which a live build swaps for its stub (metro.config.js): the mock's trips never ship there.
      const { mockCreatePlan, mockPlanCard, attachDemoThread } = await import('./mock-api');
      await wait(900, signal);
      const plan = mockCreatePlan(user, 'istanbul3');
      if (plan) {
        attachDemoThread(user, threadId, plan.tripId, `${plan.title} · ${rangeLabel(plan.startDate, plan.endDate, lang)}`);
        onEvent({ type: 'thread', threadId, lang, tripId: plan.tripId });
        for (const word of P.text.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
        onEvent({ type: 'cards', cards: [mockPlanCard(user, plan)] });
        onEvent({ type: 'next', choices: [...P.next] });
        onEvent({ type: 'done', text: P.text });
        keep(P.text);
        return 'done';
      }
    }
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
    if (PLACES_WORDS.test(body.text) || PLACE_MORE.test(body.text)) {
      const P = PLACES_LINES[lang];
      const more = PLACE_MORE.test(body.text);
      onEvent({ type: 'status', text: more ? P.detailStatus : P.status, tool: more ? 'place_details' : 'find_places' });
      // The mock's own trip, so Add to plan has a plan to go on (mock/plans.ts).
      const { mockTripsOf } = await import('./mock-api');
      const trip = user ? mockTripsOf(user).find((x) => x.status !== 'cancelled' && x.status !== 'completed') : undefined;
      await wait(900, signal);
      const list = DEMO_PLACES[lang];
      const named = list.find((x) => body.text.includes(x.name)) ?? list[0];
      const one = { ...named, today: TODAY[named.open?.closes ?? ''] ?? null, week: week(TODAY[named.open?.closes ?? ''] ?? ''), phone: '+90 212 249 0147', website: 'https://example.com', mapsUrl: null };
      const card: ChatCard = more ? { type: 'place', tripId: trip?.id ?? null, place: one } : { type: 'places', query: lang === 'ar' ? 'مندي' : 'shawarma', near: lang === 'ar' ? 'فندقك' : 'your hotel', tripId: trip?.id ?? null, places: [...list] };
      const text = more ? P.detail : P.list;
      for (const word of text.split(/(?<= )/)) { onEvent({ type: 'text', delta: word }); await wait(45, signal); }
      onEvent({ type: 'cards', cards: [card] });
      onEvent({ type: 'next', choices: [...(more ? P.detailNext : P.next)] });
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

/** The companion cards, scripted: the mock's own trip and people (mock/trip-people.ts). Null when the words aren't about people. */
async function demoPeople(text: string, lang: 'en' | 'ar', user: import('./mock-api').MockUser | null, signal: AbortSignal | undefined, onEvent: (e: AskChatEvent) => void): Promise<string | null> {
  const which = WHICH_WORDS.test(text);
  const invite = !which && INVITE_WORDS.test(text);
  const change = !which && !invite && CHANGE_WORDS.test(text);
  if (!user || (!which && !invite && !change)) return null;
  const { mockTripsOf, DEMO_ABDULLAH, mockAskChange, mockTripTitle } = await import('./mock-api');
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
