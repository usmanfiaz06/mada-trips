/*
 * Refining results by what the traveller says matters ("a sea view", "closer to Burj Khalifa", "quiet, for kids",
 * "under SAR 600 a night", "قريب من الحرم"). Rules only, English and Arabic, the same in the app and on the server; a
 * model may add to them where one is live, never replace them. Every match is backed by a fact we hold (where the
 * hotel is, its facilities and description, its rooms, the rate's board and cancellation); what the facts can't tell
 * is said as such, never guessed. Also: the card's lines in the traveller's language, and sorting.
 */
import { t, tn, type CopyKey } from '../copy';
import { formatSar } from '../money';
import { shortDay } from '../dates';
import { normalizeArabic } from './ask-arabic';
import { kmApart, landmarksIn, LANDMARKS, type DistanceAnchor, type Landmark } from './landmarks';
import { travelEstimate } from './directions';
import type { FlightOption, StayAmenity, StayFacts, StayOption, StayView } from './booking';

/* ───────────── wishes ───────────── */

export type StayWish =
  | { k: 'near'; id: string; walk: boolean }
  | { k: 'view'; view: StayView }
  | { k: 'has'; what: StayAmenity }
  | { k: 'board'; board: 'BB' | 'HB' }
  | { k: 'freeCancel' }
  | { k: 'stars'; min: number }
  | { k: 'price'; max: number; per: 'night' | 'stay' }
  | { k: 'vibe'; vibe: 'quiet' | 'family' | 'luxury' | 'budget' };

/** One key per wish, so the same wish said twice is one chip, and a newer price or star level replaces the older. */
export const wishKey = (w: StayWish): string =>
  w.k === 'near' ? `near:${w.id}` : w.k === 'view' ? `view:${w.view}` : w.k === 'has' ? `has:${w.what}` : w.k === 'board' ? `board` : w.k === 'vibe' ? `vibe:${w.vibe}` : w.k;

type Words = [RegExp, RegExp];
const AMENITY_WORDS: [StayAmenity, Words][] = [
  ['pool', [/\bpools?\b|swimming/, /مسبح|حمام سباحه|بركه سباحه|بركه/]],
  ['beach', [/beach access|private beach|on the beach|beachfront|beach front|by the beach/, /شاطئ خاص|علي الشاطئ|علي البحر مباشره|شاطي خاص/]],
  ['kidsClub', [/kids'? ?club|children'?s club|kids'? area|play ?ground|play area|mini club/, /نادي اطفال|نادي للاطفال|العاب اطفال|العاب للاطفال|منطقه العاب|ملاهي/]],
  ['gym', [/\bgym\b|fitness/, /جيم|نادي رياضي|صاله رياضيه/]],
  ['spa', [/\bspa\b|sauna|massage|hammam/, /سبا|ساونا|مساج|حمام تركي/]],
  ['parking', [/parking|car park|park the car/, /موقف|مواقف|باركنج|باركينج/]],
  ['connecting', [/connecting|interconnecting|adjoining/, /متصله|غرف متصله|غرفتين متصلتين/]],
  ['accessible', [/wheelchair|accessible|step[- ]free|disabled|reduced mobility/, /كرسي متحرك|ذوي الاعاقه|ذوي الهمم|كراسي متحركه/]],
  ['familyRooms', [/family rooms?|family suites?/, /غرفه عائليه|غرف عائليه|جناح عائلي/]],
  ['wifi', [/wi-?fi|internet/, /واي فاي|وايفاي|انترنت/]],
];
const VIEW_WORDS: [StayView, Words][] = [
  ['burj', [/burj (?:khalifa )?views?|views? (?:of|over) (?:the )?burj/, /اطلاله علي (?:برج خليفه|البرج)|فيو (?:البرج|برج خليفه)|مطل علي (?:البرج|برج خليفه)/]],
  ['haram', [/(?:haram|kaaba) views?|views? (?:of|over) (?:the )?(?:haram|kaaba)|overlooking the haram/, /اطلاله علي (?:الحرم|الكعبه)|مطل علي (?:الحرم|الكعبه)|فيو الحرم/]],
  ['beach', [/beach views?|views? (?:of|over) the beach/, /اطلاله علي الشاطئ|فيو شاطئ/]],
  ['sea', [/sea[- ]?views?|ocean views?|water views?|views? (?:of|over) the (?:sea|water|gulf)|overlooking the (?:sea|water)|sea[- ]facing/, /اطلاله بحريه|اطلاله علي البحر|مطل علي البحر|فيو بحر|فيو بحري|اطلاله علي الماء/]],
  ['city', [/city views?|skyline/, /اطلاله علي المدينه|فيو المدينه/]],
];
const FREE_CANCEL: Words = [/free cancell?ation|free to cancel|cancel for free|refundable|can cancel|flexible/, /الغاء مجاني|قابل للالغاء|قابله للالغاء|استرجاع|استرداد|مرن/];
const HALF_BOARD: Words = [/half[- ]board|dinner included|breakfast and dinner/, /نصف اقامه|فطور وعشاء|افطار وعشاء/];
const BREAKFAST: Words = [/breakfast/, /فطور|افطار|ريوق/];
const VIBES: ['quiet' | 'family' | 'luxury' | 'budget', Words][] = [
  ['quiet', [/\bquiet\b|\bcalm\b|peaceful|tranquil|away from (?:the )?noise/, /هادي|هادئ|هدوء|بعيد عن الزحمه|بعيد عن الازعاج/]],
  ['family', [/for (?:the )?kids|with (?:the )?kids|for (?:the )?children|with children|family|families/, /عائلي|للعائله|للعايله|للاطفال|مع الاطفال|للعيال|مع العيال/]],
  ['luxury', [/luxury|luxurious|upscale|fancy|high[- ]end|lavish/, /فخم|فاخر|راقي|فخامه/]],
  ['budget', [/cheap|budget|affordable|good value|not expensive|inexpensive|value for money/, /رخيص|اقتصادي|بسعر معقول|ارخص|سعر مناسب|ميزانيه محدوده/]],
];
const WALK: Words = [/walk|walking|on foot|steps from/, /مشي|مشيا|علي الاقدام|خطوات/];
const NEAR: Words = [/near|close|closer|next to|by\b|around|walk|walking|steps from|minutes? (?:from|to)/, /قريب|قرب|جنب|جمب|بجانب|حول|عند|مشي|مشيا|خطوات/];

const WORD_NUM: Record<string, number> = { one: 1, two: 2, three: 3, four: 4, five: 5, واحد: 1, ثلاث: 3, ثلاثه: 3, اربع: 4, اربعه: 4, خمس: 5, خمسه: 5 };

const hit = (w: Words, en: string, ar: string) => w[0].test(en) || w[1].test(ar);

export type ParsedWishes = { wishes: StayWish[]; /** What was said that Mada couldn't read as a wish (whole text when nothing was). */ rest: string | null };

/** The wishes in what was typed or said, for this city (landmarks elsewhere are ignored). */
export function parseStayWishes(text: string, city?: string | null): ParsedWishes {
  const en = ` ${text.toLowerCase().replace(/[’']/g, "'")} `;
  const ar0 = ` ${normalizeArabic(text)} `;
  // "للحرم" is ل + الحرم: read both ways.
  const ar = `${ar0} ${ar0.replace(/(\s)لل/g, '$1ال')}`;
  const out: StayWish[] = [];
  const add = (w: StayWish) => { if (!out.some((x) => wishKey(x) === wishKey(w))) out.push(w); };
  // Views first: "a view of the Burj" is a view, not "near the Burj".
  const views = VIEW_WORDS.filter(([, words]) => hit(words, en, ar)).map(([v]) => v);
  views.forEach((view) => add({ k: 'view', view }));
  const viewOnly = (l: Landmark) => !!l.view && views.includes(l.view) && !hit(NEAR, en.replace(/views?/g, ''), ar.replace(/اطلاله|فيو|مطل/g, ''));
  const walk = hit(WALK, en, ar);
  for (const l of landmarksIn(city ?? null)) {
    if ((l.en.test(en) || l.ar.test(ar)) && !viewOnly(l)) add({ k: 'near', id: l.id, walk });
  }
  for (const [what, words] of AMENITY_WORDS) if (hit(words, en, ar)) add({ k: 'has', what });
  if (hit(HALF_BOARD, en, ar)) add({ k: 'board', board: 'HB' });
  else if (hit(BREAKFAST, en, ar)) add({ k: 'board', board: 'BB' });
  if (hit(FREE_CANCEL, en, ar) && !/non[- ]?refundable/.test(en)) add({ k: 'freeCancel' });
  const stars = en.match(/\b([1-5]|one|two|three|four|five)[- ]?(?:\+ ?)?(?:stars?|\*)/) ?? ar.match(/([1-5]|ثلاث|ثلاثه|اربع|اربعه|خمس|خمسه) ?نجوم|(فايف|فور) ستار/);
  if (stars) {
    const n = stars[1] ? (Number(stars[1]) || WORD_NUM[stars[1]] || 0) : stars[2] === 'فايف' ? 5 : 4;
    if (n >= 1 && n <= 5) add({ k: 'stars', min: n });
  }
  // A price: "under SAR 600 a night", "below 2000 in total", "اقل من ٦٠٠ ريال بالليله", "ميزانيتي ٢٠٠٠".
  const money = en.match(/(?:under|below|less than|max(?:imum)?|up to|at most|no more than|budget(?: of| is)?|cheaper than|within)\s*(?:sar|sr|riyals?)?\s*([\d,]{2,7})\s*(?:sar|sr|riyals?)?/)
    ?? ar.match(/(?:اقل من|تحت|حد اقصي|بحدود|لا يزيد عن|ما يزيد عن|ميزانيتي|ميزانيه|الميزانيه)\s*([\d,]{2,7})/);
  if (money) {
    const max = Number(money[1]!.replace(/,/g, ''));
    const stay = /total|in all|for the (?:whole )?stay|altogether|overall/.test(en) || /الاجمالي|المجموع|كامل|للاقامه كلها|اجمالي/.test(ar);
    if (max > 0) add({ k: 'price', max: max * 100, per: stay ? 'stay' : 'night' });
  }
  for (const [vibe, words] of VIBES) if (hit(words, en, ar)) add({ k: 'vibe', vibe });
  // A newer price or star level replaces the one before (handled by wishKey in mergeWishes).
  return { wishes: out, rest: out.length ? null : text.trim() || null };
}

/** Wishes so far plus the new ones: the same kind of price or star wish is replaced, the rest added. */
export function mergeWishes(before: StayWish[], added: StayWish[]): StayWish[] {
  const keys = new Set(added.map(wishKey));
  return [...before.filter((w) => !keys.has(wishKey(w))), ...added];
}

const landmark = (id: string) => LANDMARKS.find((l) => l.id === id);
const placeName = (l: Landmark, lang: 'en' | 'ar') => (lang === 'ar' ? l.nameAr : l.name);

/** The chip for a wish ("Near Burj Khalifa", "Sea view", "Under SAR 600 a night"). */
export function wishLabel(w: StayWish, lang: 'en' | 'ar' = 'en'): string {
  switch (w.k) {
    case 'near': { const l = landmark(w.id); return l ? t(w.walk ? 'wish.walk' : 'wish.near', { place: placeName(l, lang) }) : ''; }
    case 'view': return t(`wish.view.${w.view}` as CopyKey);
    case 'has': return t(`wish.has.${w.what}` as CopyKey);
    case 'board': return t(w.board === 'HB' ? 'wish.board.HB' : 'wish.board.BB');
    case 'freeCancel': return t('wish.freeCancel');
    case 'stars': return w.min >= 5 ? t('wish.stars5') : t('wish.stars', { n: w.min });
    case 'price': return t(w.per === 'night' ? 'wish.priceNight' : 'wish.priceStay', { amount: formatSar(w.max, { bare: true }) });
    case 'vibe': return t(`wish.vibe.${w.vibe}` as CopyKey);
  }
}

/** "400 m", "1.2 km". */
export function distanceLabel(km: number): string {
  if (km < 1) return t('ev.m', { n: Math.max(50, Math.round((km * 1000) / 50) * 50) });
  return t('ev.km', { n: km < 10 ? km.toFixed(1).replace(/\.0$/, '') : String(Math.round(km)) });
}

/* ───────────── does a stay fit a wish ───────────── */

export type Verdict = { ok: boolean | null; ev: string | null; km?: number };

const nightly = (o: StayOption) => Math.round(o.total.amount / Math.max(1, o.nights));

/** Whether a stay fits one wish: yes with the evidence, no, or null when the facts can't tell. */
export function judge(o: StayOption, w: StayWish, lang: 'en' | 'ar' = 'en', median?: number): Verdict {
  const f = o.facts;
  switch (w.k) {
    case 'near': {
      const l = landmark(w.id);
      if (!l || f?.lat == null || f?.lng == null) return { ok: null, ev: null };
      const km = kmApart({ lat: f.lat, lng: f.lng }, l);
      const limit = w.walk ? Math.min(l.km, 1.2) : l.km;
      return { ok: km <= limit, ev: t('ev.near', { distance: distanceLabel(km), place: placeName(l, lang) }), km };
    }
    case 'view': {
      if (!f) return { ok: null, ev: null };
      const yes = f.views.includes(w.view) || (w.view === 'beach' && f.views.includes('sea')) || (w.view === 'sea' && f.views.includes('beach'));
      // A view the content doesn't mention isn't proof there is none: unknown, never "no".
      return yes ? { ok: true, ev: t(`ev.view.${w.view}` as CopyKey) } : { ok: null, ev: null };
    }
    case 'has': {
      if (!f) return { ok: null, ev: null };
      if (f.amenities.includes(w.what)) return { ok: true, ev: t(`wish.has.${w.what}` as CopyKey) };
      return { ok: f.content ? false : null, ev: null };
    }
    case 'board': {
      const b = f?.board ?? null;
      if (!b) return { ok: null, ev: null };
      const ok = w.board === 'HB' ? ['HB', 'FB', 'AI'].includes(b) : ['BB', 'HB', 'FB', 'AI'].includes(b);
      return { ok, ev: ok ? t(`stay.board.${b}` as CopyKey) : null };
    }
    case 'freeCancel': {
      const ok = f ? f.refundable : !!o.freeCancelUntil;
      return { ok, ev: ok ? (o.freeCancelUntil ? t('stay.freeCancel', { date: shortDay(o.freeCancelUntil) }) : t('stay.freeCancelAny')) : null };
    }
    case 'stars': {
      const s = f?.stars ?? null;
      if (s == null) return { ok: null, ev: null };
      return { ok: s >= w.min, ev: s >= w.min ? t('stay.stars', { n: s }) : null };
    }
    case 'price': {
      const v = w.per === 'night' ? nightly(o) : o.total.amount;
      return { ok: v <= w.max, ev: v <= w.max ? t('stay.perNight', { price: formatSar(nightly(o)) }) : null };
    }
    case 'vibe': {
      if (w.vibe === 'luxury') { const s = f?.stars ?? null; return s == null ? { ok: null, ev: null } : { ok: s >= 5, ev: s >= 5 ? t('stay.stars', { n: s }) : null }; }
      if (w.vibe === 'budget') { const ok = median == null ? null : nightly(o) <= median; return { ok, ev: ok ? t('stay.perNight', { price: formatSar(nightly(o)) }) : null }; }
      if (w.vibe === 'quiet') return f?.quiet ? { ok: true, ev: t('ev.quiet') } : { ok: null, ev: null };
      const fam = (['kidsClub', 'familyRooms', 'connecting', 'pool'] as const).find((a) => f?.amenities.includes(a));
      return fam ? { ok: true, ev: t(`wish.has.${fam}` as CopyKey) } : { ok: f?.content ? false : null, ev: null };
    }
  }
}

export type Refined = {
  /** Places that fit every wish, best first (nearest first when a place was asked for). */
  matches: { option: StayOption; ev: string[] }[];
  /** When nothing fits it all: the closest, with what they do have. */
  closest: { option: StayOption; ev: string[] }[];
  /** One line from Mada saying what changed. */
  answer: string;
  /** Wishes the facts couldn't tell for any place (a view not in any description): the desk can look. */
  unknown: StayWish[];
};

/** Re-rank and filter a list by the wishes, and say what changed. */
export function refineStays(options: StayOption[], wishes: StayWish[], lang: 'en' | 'ar' = 'en'): Refined {
  if (!wishes.length) return { matches: options.map((option) => ({ option, ev: [] })), closest: [], answer: '', unknown: [] };
  const prices = options.map(nightly).sort((a, b) => a - b);
  const median = prices.length ? prices[Math.floor(prices.length / 2)] : undefined;
  const rows = options.map((option, i) => {
    const v = wishes.map((w) => judge(option, w, lang, median));
    return { option, i, v, yes: v.filter((x) => x.ok === true).length, no: v.filter((x) => x.ok === false).length, km: v.find((x) => x.km != null)?.km ?? null, ev: v.map((x) => x.ev).filter((x): x is string => !!x) };
  });
  const near = wishes.find((w) => w.k === 'near');
  const price = wishes.find((w) => w.k === 'price' || (w.k === 'vibe' && w.vibe === 'budget'));
  const order = (a: (typeof rows)[number], b: (typeof rows)[number]) =>
    (near && a.km != null && b.km != null ? a.km - b.km : 0) || (price ? a.option.total.amount - b.option.total.amount : 0) || a.i - b.i;
  const all = rows.filter((r) => r.yes === wishes.length).sort(order);
  const unknown = wishes.filter((_, wi) => !rows.some((r) => r.v[wi]!.ok === true) && rows.some((r) => r.v[wi]!.ok === null));
  const labels = wishes.map((w) => wishLabel(w, lang));
  const list = (xs: string[]) => xs.join(lang === 'ar' ? '، ' : ', ');
  if (all.length) {
    const parts = [tn('refine.matches', all.length, { wishes: list(labels) })];
    if (near && all[0]!.km != null) { const l = landmark((near as { id: string }).id)!; parts.push(t('refine.closestIs', { distance: distanceLabel(all[0]!.km), place: placeName(l, lang) })); }
    if (price) parts.push(t('refine.from', { price: formatSar(Math.min(...all.map((r) => nightly(r.option)))) }));
    return { matches: all.map((r) => ({ option: r.option, ev: r.ev })), closest: [], answer: parts.join(' '), unknown };
  }
  const closest = rows.filter((r) => r.yes > 0 || !r.no).sort((a, b) => b.yes - a.yes || a.no - b.no || order(a, b)).slice(0, 6);
  const parts = [t('refine.none')];
  if (unknown.length) parts.push(t('refine.cantTell', { what: list(unknown.map((w) => wishLabel(w, lang))) }));
  if (closest.length) parts.push(t('refine.closest'));
  return { matches: [], closest: closest.map((r) => ({ option: r.option, ev: r.ev })), answer: parts.join(' '), unknown };
}

/* ───────────── the card, sorting ───────────── */

export type StaySort = 'best' | 'price' | 'stars';

/** Recommended (the server's order), lowest price, or most stars (then cheaper). */
export function sortStays<T extends StayOption>(options: T[], by: StaySort): T[] {
  if (by === 'best') return [...options].sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
  if (by === 'price') return [...options].sort((a, b) => a.total.amount - b.total.amount);
  return [...options].sort((a, b) => (b.facts?.stars ?? 0) - (a.facts?.stars ?? 0) || a.total.amount - b.total.amount);
}

const ROOM_TYPES: [RegExp, CopyKey][] = [
  [/junior suite/, 'stay.room.juniorSuite'], [/suite/, 'stay.room.suite'], [/studio/, 'stay.room.studio'], [/apartment|\bapt\b/, 'stay.room.apartment'], [/villa/, 'stay.room.villa'],
  [/family/, 'stay.room.family'], [/quad/, 'stay.room.quad'], [/triple/, 'stay.room.triple'], [/double or twin|twin or double/, 'stay.room.doubleTwin'], [/twin/, 'stay.room.twin'],
  [/double|king|queen/, 'stay.room.double'], [/single/, 'stay.room.single'], [/\broom\b/, 'stay.room.room'],
];
const ROOM_GRADES: [RegExp, CopyKey][] = [
  [/deluxe/, 'stay.grade.deluxe'], [/superior/, 'stay.grade.superior'], [/premium|premier/, 'stay.grade.premium'], [/executive/, 'stay.grade.executive'], [/classic/, 'stay.grade.classic'], [/standard/, 'stay.grade.standard'],
];
const ROOM_VIEWS: [RegExp, CopyKey][] = [[/sea|ocean/, 'ev.view.sea'], [/burj/, 'ev.view.burj'], [/haram|kaaba/, 'ev.view.haram'], [/city/, 'ev.view.city']];

/**
 * The room in a few plain words: "Deluxe double room", "غرفة مزدوجة ديلوكس". Hotel names for rooms ("AVANI ROOM",
 * "Double standard .") become a type and a grade; a name we can't read is tidied and kept, never dropped.
 */
export function roomTitle(raw: string | null | undefined): string {
  const s = (raw ?? '').toLowerCase().replace(/\s+/g, ' ').replace(/\s+([.,)])/g, '$1').replace(/\(\s+/g, '(').trim().replace(/[ .]+$/, '');
  if (!s) return t('stay.room.room');
  const type = ROOM_TYPES.find(([re]) => re.test(s))?.[1];
  const grade = ROOM_GRADES.find(([re]) => re.test(s))?.[1];
  const view = ROOM_VIEWS.find(([re]) => re.test(s))?.[1];
  // A name we can't read ("AVANI ROOM", "Golden sands 3"): tidied and kept.
  if (!type || (type === 'stay.room.room' && !grade && !view)) return s.charAt(0).toUpperCase() + s.slice(1);
  const typeText = t(type);
  const base = grade && grade !== 'stay.grade.standard' ? t('stay.room.graded', { type: typeText.charAt(0).toLowerCase() + typeText.slice(1), grade: t(grade) }) : typeText;
  return view ? t('stay.room.withView', { room: base, view: t(view) }) : base;
}

export type StayLines = {
  /** "Deira · 5-star" */
  where: string;
  /** "Deluxe double room · Breakfast included" */
  room: string;
  /** "Free cancellation until 19 Oct" (good) or "Non-refundable". */
  cancel: { text: string; free: boolean };
  /** "+ SAR 41 local tax at the hotel" */
  tax: string | null;
  /** "SAR 266 a night" */
  perNight: string;
};

/** A stay card's lines in the display language, from the facts (older offers without facts keep the server's words). */
export function stayLines(o: StayOption): StayLines {
  const f = o.facts;
  const perNight = t('stay.perNight', { price: formatSar(nightly(o)) });
  if (!f) return { where: o.area, room: o.note, cancel: { text: o.cancellation, free: !!o.freeCancelUntil }, tax: null, perNight };
  const where = [f.zone, f.stars ? t('stay.stars', { n: f.stars }) : f.apartment ? t('stay.apartment') : null].filter(Boolean).join(' · ');
  const board = f.board ? (f.board === 'other' ? null : t(`stay.board.${f.board}` as CopyKey)) : null;
  const room = [roomTitle(f.room), board, f.deal ? t('stay.deal') : null].filter(Boolean).join(' · ');
  const cancel = f.refundable
    ? { text: o.freeCancelUntil ? t('stay.freeCancel', { date: shortDay(o.freeCancelUntil) }) : t('stay.freeCancelAny'), free: true }
    : { text: t('stay.nonRefundable'), free: false };
  const tax = f.payAtHotel ? t('stay.taxAtHotel', { amount: formatSar(f.payAtHotel, { bare: true }) }) : null;
  return { where, room, cancel, tax, perNight };
}

/* ───────────── flights and things to do ───────────── */

export type FlightWish = { k: 'morning' | 'afternoon' | 'evening' | 'direct' | 'bags' | 'refundable' | 'aisle' | 'cheapest' | 'airline'; carrier?: string };
export const flightWishKey = (w: FlightWish) => (w.k === 'airline' ? `airline:${w.carrier}` : w.k);

const FLIGHT_WORDS: [FlightWish['k'], Words][] = [
  ['morning', [/morning|early|before noon|am flight/, /الصبح|صباح|بدري|الفجر/]],
  ['afternoon', [/afternoon|midday|after lunch/, /الظهر|العصر|بعد الظهر/]],
  ['evening', [/evening|night flight|late|after work|tonight/, /المساء|مساء|بالليل|الليل|متاخر/]],
  ['direct', [/direct|non-?stop|no stops?|without (?:a )?stop/, /مباشر|بدون توقف|بدون ترانزيت|بلا توقف/]],
  ['bags', [/bags?|luggage|baggage|suitcases?/, /شنط|شنطه|حقائب|حقيبه|عفش|وزن/]],
  ['refundable', [/refundable|free cancell?ation|flexible/, /قابل للاسترداد|استرداد|الغاء مجاني|مرن/]],
  ['aisle', [/aisle|seats? together|sit together|window seats?/, /ممر|مقاعد متجاوره|جنب بعض|نجلس مع بعض|شباك/]],
  ['cheapest', [/cheapest|lowest price|cheap/, /ارخص|الارخص|رخيص/]],
];
const AIRLINES: [string, RegExp][] = [['SV', /saudia|السعوديه|الخطوط السعوديه/], ['XY', /flynas|ناس|طيران ناس/], ['F3', /flyadeal|اديل|طيران اديل/], ['TK', /turkish|التركيه|الخطوط التركيه/], ['EK', /emirates|الاماراتيه|طيران الامارات/]];

export function parseFlightWishes(text: string): { wishes: FlightWish[]; rest: string | null } {
  const en = ` ${text.toLowerCase()} `;
  const ar = ` ${normalizeArabic(text)} `;
  const out: FlightWish[] = FLIGHT_WORDS.filter(([, w]) => hit(w, en, ar)).map(([k]) => ({ k }));
  for (const [carrier, re] of AIRLINES) if (re.test(en) || re.test(ar)) out.push({ k: 'airline', carrier });
  return { wishes: out, rest: out.length ? null : text.trim() || null };
}

export function flightWishLabel(w: FlightWish, airline?: string): string {
  return w.k === 'airline' ? t('wish.f.airline', { airline: airline ?? w.carrier ?? '' }) : t(`wish.f.${w.k}` as CopyKey);
}

const hourOf = (hhmm: string) => Number(hhmm.slice(0, 2));
/** Whether a flight fits: null for what the fare can't show (seats are set by the desk after booking). */
export function judgeFlight(o: FlightOption, w: FlightWish): boolean | null {
  const h = hourOf(o.out.dep);
  switch (w.k) {
    case 'morning': return h >= 4 && h < 12;
    case 'afternoon': return h >= 12 && h < 17;
    case 'evening': return h >= 17 || h < 4;
    case 'direct': return !o.stop;
    case 'bags': return !/no checked|hand luggage only|cabin bag only|carry-on only/i.test(o.bags);
    case 'refundable': return o.refundable;
    case 'airline': return o.carrier === w.carrier;
    case 'cheapest': return true;
    case 'aisle': return null;
  }
}

export function refineFlights(options: FlightOption[], wishes: FlightWish[]): { matches: FlightOption[]; answer: string; deskOnly: FlightWish[] } {
  if (!wishes.length) return { matches: options, answer: '', deskOnly: [] };
  const deskOnly = wishes.filter((w) => w.k === 'aisle');
  const hard = wishes.filter((w) => w.k !== 'aisle' && w.k !== 'cheapest');
  let matches = options.filter((o) => hard.every((w) => judgeFlight(o, w) === true));
  if (wishes.some((w) => w.k === 'cheapest')) matches = [...matches].sort((a, b) => a.total.amount - b.total.amount);
  const labels = wishes.filter((w) => w.k !== 'aisle').map((w) => flightWishLabel(w, options.find((o) => o.carrier === w.carrier)?.airline)).join(', ');
  const parts = [hard.length || wishes.some((w) => w.k === 'cheapest') ? (matches.length ? tn('refine.f.matches', matches.length, { wishes: labels }) : t('refine.f.none')) : ''];
  if (deskOnly.length) parts.push(t('refine.f.seats'));
  return { matches: matches.length ? matches : [], answer: parts.filter(Boolean).join(' '), deskOnly };
}

export type ThingWish = { k: 'indoor' | 'outdoor' | 'kids' | 'tonight' | 'today' | 'weekend' | 'free' | 'cheap' };
const THING_WORDS: [ThingWish['k'], Words][] = [
  ['indoor', [/indoors?|inside|air[- ]?con|it'?s hot|too hot|out of the (?:sun|heat)|cool place/, /داخلي|مكيف|مغلق|الجو حار|حر|بعيد عن الشمس/]],
  ['outdoor', [/outdoors?|outside|open air|fresh air/, /خارجي|في الهواء الطلق|مفتوح/]],
  ['kids', [/for (?:the )?kids|with (?:the )?kids|children|family|families|kid[- ]friendly/, /للاطفال|مع الاطفال|للعيال|عائلي|للعائله|اطفال/]],
  ['tonight', [/tonight|this evening/, /الليله|هالليله/]],
  ['today', [/today|now\b/, /اليوم|الحين/]],
  ['weekend', [/weekend/, /الويكند|نهايه الاسبوع/]],
  ['free', [/\bfree\b|no cost|no charge/, /مجاني|ببلاش|مجانا/]],
  ['cheap', [/cheap|budget|affordable|under sar/, /رخيص|اقتصادي|ارخص/]],
];
export function parseThingWishes(text: string): { wishes: ThingWish[]; rest: string | null } {
  const en = ` ${text.toLowerCase()} `;
  const ar = ` ${normalizeArabic(text)} `;
  const out: ThingWish[] = THING_WORDS.filter(([, w]) => hit(w, en, ar)).map(([k]) => ({ k }));
  return { wishes: out, rest: out.length ? null : text.trim() || null };
}
export const thingWishLabel = (w: ThingWish) => t(`wish.t.${w.k}` as CopyKey);

/* ───────────── distance from ───────────── */

export const anchorName = (a: DistanceAnchor, lang: 'en' | 'ar' = 'en') => (lang === 'ar' && a.nameAr ? a.nameAr : a.name);

/** "About 1.2 km from Burj Khalifa · 15 min walk": straight line, with the walk or drive estimate. Null without a location. */
export function distanceFrom(o: Pick<StayOption, 'facts'>, a: DistanceAnchor | null, lang: 'en' | 'ar' = 'en'): { km: number; text: string } | null {
  const f = o.facts;
  if (!a || f?.lat == null || f?.lng == null) return null;
  const e = travelEstimate({ lat: a.lat, lon: a.lng }, { lat: f.lat, lon: f.lng });
  const km = kmApart(a, { lat: f.lat, lng: f.lng });
  const time = e.mode === 'walk' ? t('dist.walk', { n: e.walkMin }) : t('dist.drive', { n: e.driveMin });
  return { km, text: t('dist.line', { distance: distanceLabel(km), place: anchorName(a, lang), time }) };
}

/** Nearest first from the anchor; places without a location last. */
export function sortByDistance<T extends Pick<StayOption, 'facts'>>(options: T[], a: DistanceAnchor): T[] {
  const d = (o: T) => (o.facts?.lat != null && o.facts?.lng != null ? kmApart(a, { lat: o.facts.lat, lng: o.facts.lng }) : Infinity);
  return [...options].sort((x, y) => d(x) - d(y));
}

/* ───────────── the catalogue's rooms (mock mode) ───────────── */

/** Facts for the catalogue's hand-picked rooms, so mock mode sorts, refines and maps like Hotelbeds does. */
export const CATALOGUE_STAY_FACTS: Readonly<Record<string, StayFacts & { score: number; badge: 'best' | 'lowest' | null }>> = {
  galata: { stars: 4, apartment: false, board: 'BB', room: 'Deluxe double', refundable: true, payAtHotel: null, zone: 'Beyoğlu', lat: 41.0262, lng: 28.9733, content: true, amenities: ['connecting', 'wifi', 'familyRooms'], views: ['city'], quiet: true, deal: false, score: 86, badge: 'best' },
  sultan: { stars: 4, apartment: false, board: 'BB', room: 'Family suite', refundable: true, payAtHotel: null, zone: 'Sultanahmet', lat: 41.0058, lng: 28.9794, content: true, amenities: ['familyRooms', 'wifi', 'parking'], views: [], quiet: true, deal: false, score: 74, badge: 'lowest' },
  bosphorus: { stars: 5, apartment: false, board: 'RO', room: 'Superior sea view', refundable: true, payAtHotel: null, zone: 'Beşiktaş', lat: 41.0431, lng: 29.0072, content: true, amenities: ['pool', 'spa', 'gym', 'connecting', 'wifi'], views: ['sea'], quiet: false, deal: false, score: 80, badge: null },
};
export function catalogueFacts(key: string): { facts: StayFacts; score: number; badge: 'best' | 'lowest' | null } | null {
  const f = CATALOGUE_STAY_FACTS[key];
  if (!f) return null;
  const { score, badge, ...facts } = f;
  return { facts, score, badge };
}
