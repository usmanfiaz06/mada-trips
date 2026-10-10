/*
 * Booking rules that the Core API and the app's mock API both run: reading what people type (the deterministic parser
 * behind POST /ask/parse in mock mode, and the fallback when the model is down), the household, fares and bundles,
 * entry checks, the desk's per-person quotes, promo codes, cards and seats. Pure functions, no I/O.
 */
import { t } from '../copy';
import { addDays, daysBetween, dayOfMonth, isIsoDay, monthOf, MONTHS, shortDay } from '../dates';
import { sarToHalalas } from '../money';
import type { Person } from './people';
import type { Cabin } from './trips';
import {
  CABIN_FACTOR, CATALOGUE_HOTELS, DEMO_HELPER_IQAMA, DEMO_SHORT_PASSPORT, DESK_PRICES, DESTINATIONS, ENTRY_RULES, INFANT_FACTOR, MADA_BINS,
  NATIONALITY_ADJECTIVE, NEED_LABELS, NEED_WORDS, ONE_WAY_FACTOR, PICKUP_SAR, PROMOS, REQUEST_FORMS, SEAT_ROW, SMALL_ROOM_FACTOR, STAY_NIGHTS_DEFAULT,
  type HomeAirportCode, type NeedKey, type RequestFormKind,
} from './booking-data';

/* ───────────── days ───────────── */

const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const ymd = (y: number, m0: number, d: number) => isoOf(new Date(Date.UTC(y, m0, d)));
const weekdayIdx = (iso: string) => utc(iso).getUTCDay();

/** Saudi weekends: out on Thursday, back on Saturday. offset 0 = this weekend. */
export function weekendDates(today: string, offset = 0): [string, string] {
  const delta = (4 - weekdayIdx(today) + 7) % 7;
  const thu = addDays(today, delta + offset * 7);
  return [thu, addDays(thu, 2)];
}

/** Quick picks in the calendar and the "When?" chips. Fixed season dates drop off once they're past. */
export function quickDates(today: string): { id: string; label: string; dates: [string, string] }[] {
  const all: { id: string; label: string; dates: [string, string] }[] = [
    { id: 'thisWeekend', label: 'This weekend', dates: weekendDates(today, 0) },
    { id: 'nextWeekend', label: 'Next weekend', dates: weekendDates(today, 1) },
    { id: 'eid', label: 'Eid al-Fitr · Mar 2027', dates: ['2027-03-09', '2027-03-15'] },
    { id: 'school', label: 'School break', dates: ['2027-01-07', '2027-01-16'] },
  ];
  return all.filter((q) => q.dates[0] >= today);
}

/** The 12 months the calendar offers, starting with this one. */
export function calendarMonths(today: string): { year: number; month0: number; first: string }[] {
  const y = Number(today.slice(0, 4));
  const m = Number(today.slice(5, 7)) - 1;
  return Array.from({ length: 12 }, (_, i) => { const d = new Date(Date.UTC(y, m + i, 1)); return { year: d.getUTCFullYear(), month0: d.getUTCMonth(), first: isoOf(d) }; });
}

/* ───────────── the household ───────────── */

export type Household = { me: string | null; all: Person[]; nonHelper: Person[]; kids: Person[]; spouse: Person | null; helper: Person | null };

export function ageOn(p: Pick<Person, 'dateOfBirth'>, today: string): number | null {
  if (!p.dateOfBirth || !isIsoDay(p.dateOfBirth)) return null;
  const a = Number(today.slice(0, 4)) - Number(p.dateOfBirth.slice(0, 4));
  return today.slice(5) < p.dateOfBirth.slice(5) ? a - 1 : a;
}

export function householdOf(people: Person[], today: string): Household {
  const self = people.find((p) => p.isSelf) ?? null;
  const others = people.filter((p) => !p.isSelf);
  const isKid = (p: Person) => p.relation === 'child' || ((ageOn(p, today) ?? 30) < 18);
  const nonHelper = [...(self ? [self] : []), ...others.filter((p) => p.relation !== 'helper')];
  return {
    me: self?.id ?? null, all: people, nonHelper,
    kids: nonHelper.filter((p) => !p.isSelf && isKid(p)),
    spouse: others.find((p) => p.relation === 'spouse') ?? null,
    helper: others.find((p) => p.relation === 'helper') ?? null,
  };
}

/** The name the interface uses: "You" for the account holder without a name. */
export const personName = (p: Pick<Person, 'firstName' | 'isSelf'> | undefined | null, selfName = '') => (p ? p.firstName || (p.isSelf ? selfName || 'You' : 'Guest') : 'Guest');

/* ───────────── reading what people type ───────────── */

const FLIGHT_WORDS = /\b(flights?|fly|flying|plane|one[- ]?way|round[- ]?trip|return ticket|business class|economy|first class|premium economy|airfare|tickets? to)\b/;
const STAY_WORDS = /\b(hotels?|rooms?|apartment|villa|resort|somewhere to stay|place to stay|a stay)\b/;
const PLAN_WORDS = /\b(itinerary|plan (a|my|the)|days in|weekend in|day trip|what to do in)\b/;

export type AskKindValue = 'flight' | 'stay' | 'plan' | 'esim' | 'visa' | 'umrah' | 'car' | 'food' | 'todo' | 'general';

export function parseKind(text: string): AskKindValue {
  const s = text.toLowerCase();
  if (/\bumrah\b|makkah|mecca|madinah|medina/.test(s)) return 'umrah';
  if (/\bvisa\b|schengen|\beta\b|appointment/.test(s)) return 'visa';
  if (FLIGHT_WORDS.test(s)) return 'flight';
  if (/\besim\b|data plan|sim card|\bdata\b/.test(s)) return 'esim';
  if (STAY_WORDS.test(s)) return 'stay';
  if (/\bcars?\b|car rental|rent a car|\bdriver\b|\brental\b/.test(s)) return 'car';
  if (/restaurant|dinner|lunch|\btable\b|breakfast/.test(s)) return 'food';
  if (/\btours?\b|things to do|activit|museum|cruise|tickets/.test(s)) return 'todo';
  if (PLAN_WORDS.test(s) || (/alula|weekend/.test(s) && !/\bto\b/.test(s))) return 'plan';
  if (/\beid\b|\btrip\b|\breturn\b|\bto\b|same as last/.test(s) || Object.values(DESTINATIONS).some((d) => d.words.test(s))) return 'flight';
  return 'general';
}

const MRE = 'jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?';
const mIdx = (m: string) => MONTHS.map((x) => x.toLowerCase()).indexOf(m.slice(0, 3) as never);
const NUMW: Record<string, number> = { one: 1, a: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7 };
const toNum = (w: string) => (/\d/.test(w) ? Number(w) : NUMW[w] ?? null);

/** The next time this day comes round (this year, or next if it's past). */
function upcoming(today: string, day: number, m0: number): string | null {
  const y = Number(today.slice(0, 4));
  const d = new Date(Date.UTC(y, m0, day));
  if (d.getUTCMonth() !== m0) return null;
  const iso = isoOf(d);
  return iso < today ? ymd(y + 1, m0, day) : iso;
}

export function needsIn(text: string): NeedKey[] {
  return NEED_WORDS.filter(([, re]) => re.test(text)).map(([k]) => k);
}

const nameRe = (n: string) => new RegExp(`\\b${n.toLowerCase().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`);

export type ParsedWho = { ids: string[] | null; count: number | null; infants: number };

export function parseWho(text: string, people: Person[], today: string): ParsedWho {
  const s = ` ${text.toLowerCase()} `;
  const H = householdOf(people, today);
  const me = H.me;
  let infants = 0;
  if (/\btwins\b/.test(s)) infants = 2;
  else if (/\b(baby|infant|newborn)\b/.test(s)) infants = 1;
  if (/just me|only me|\bfor me\b(?! and)|by myself|on my own|\balone\b|\bsolo\b/.test(s)) return { ids: me ? [me] : null, count: 1, infants };
  let ids: string[] | null = null;
  let n: number | null = null;
  if (/all of us|whole family|the family|\bfamily\b|everyone|\ball (three|four|five|six)\b|the (three|four|five|six) of us|same as last/.test(s)) ids = H.nonHelper.map((p) => p.id);
  const picked = new Set(ids ?? []);
  const addMe = () => { if (me) picked.add(me); };
  if (/\b(my )?(wife|husband|spouse)\b|the two of us|\bcouple\b/.test(s)) { addMe(); if (H.spouse) picked.add(H.spouse.id); n = 2; }
  if (/\b(kids|children|the boys|the girls)\b/.test(s)) { addMe(); H.kids.forEach((k) => picked.add(k.id)); }
  people.forEach((p) => { if (!p.isSelf && p.firstName && nameRe(p.firstName).test(s)) { addMe(); picked.add(p.id); } });
  if (/\b(helper|nanny|maid|housekeeper)\b/.test(s) && H.helper) { addMe(); picked.add(H.helper.id); }
  const nm = s.match(/\bfor (\d+|two|three|four|five|six)\b(?!\s*(?:nights?|days?|weeks?))|\b(\d+|two|three|four|five|six) (?:people|adults|travellers|passengers|of us)\b/);
  if (nm) n = toNum((nm[1] ?? nm[2])!);
  if (picked.size) ids = [...picked];
  if (n && (!ids || ids.length < n)) ids = n <= H.nonHelper.length ? H.nonHelper.slice(0, n).map((p) => p.id) : null;
  return { ids, count: n, infants };
}

export type ParsedDetails = {
  destination: string | null; destinationName: string | null; from: HomeAirportCode | null; depart: string | null; return: string | null;
  tripType: 'return' | 'oneway' | null; monthOnly: { month: number; year: number; label: string | null } | null; cabin: Cabin | null; cabinNote: string | null;
};

export function parseDetails(text: string, today: string): ParsedDetails {
  const s = ` ${text.toLowerCase()} `;
  const out: ParsedDetails = { destination: null, destinationName: null, from: null, depart: null, return: null, tripType: null, monthOnly: null, cabin: null, cabinNote: null };
  const fm = s.match(/\bfrom (riyadh|jeddah|dammam|ruh|jed|dmm)\b/);
  if (fm) out.from = ({ riyadh: 'RUH', ruh: 'RUH', jeddah: 'JED', jed: 'JED', dammam: 'DMM', dmm: 'DMM' } as const)[fm[1] as 'riyadh'];
  const s2 = fm ? s.replace(fm[0], ' ') : s;
  const hit = Object.values(DESTINATIONS).find((d) => d.words.test(s2));
  if (hit) out.destination = hit.key;
  else if (/same as last/.test(s2)) out.destination = 'istanbul';
  else {
    const m = s2.match(/\bto ([a-z][a-z-]{2,}(?: [a-z][a-z-]{2,})?)(?=\s+(?:on|in|for|next|this|with|at|by|and|from|over|during)\b|\s*[.,]|\s*$)/);
    const stop = /^(the|go|be|me|us|stay|fly|visit|book|see|get|take|bring|somewhere|anywhere|travel|do|have|leave|come)\b/;
    if (m && !stop.test(m[1]!)) { out.destination = 'other'; out.destinationName = m[1]!.replace(/\b\w/g, (c) => c.toUpperCase()); }
  }
  let dep: string | null = null;
  let ret: string | null = null;
  const range = s.match(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s*(?:-|\\u2013|to|until|till)\\s*(\\d{1,2})(?:st|nd|rd|th)?\\s+(${MRE})\\b`));
  if (range) {
    dep = upcoming(today, Number(range[1]), mIdx(range[3]!));
    if (dep) { const r = ymd(Number(dep.slice(0, 4)), Number(dep.slice(5, 7)) - 1, Number(range[2])); if (r > dep && isIsoDay(r) && dayOfMonth(r) === Number(range[2])) ret = r; }
  } else {
    const all = [...s.matchAll(new RegExp(`\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+(?:of\\s+)?(${MRE})\\b|\\b(${MRE})\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b`, 'g'))];
    const ds = all.map((x) => (x[1] ? upcoming(today, Number(x[1]), mIdx(x[2]!)) : upcoming(today, Number(x[4]), mIdx(x[3]!)))).filter((x): x is string => !!x);
    if (ds[0]) dep = ds[0];
    if (ds[1] && dep) { ret = ds[1]; if (ret <= dep) ret = ymd(Number(ret.slice(0, 4)) + 1, Number(ret.slice(5, 7)) - 1, Number(ret.slice(8, 10))); }
  }
  if (!dep) {
    if (/next weekend/.test(s)) [dep, ret] = weekendDates(today, 1);
    else if (/this weekend|the weekend|\bweekend\b/.test(s)) [dep, ret] = weekendDates(today, 0);
    else if (/eid al[- ]?adha|\badha\b/.test(s)) { dep = '2027-05-15'; ret = '2027-05-20'; }
    else if (/\beid\b|same as last/.test(s)) { dep = '2027-03-09'; ret = '2027-03-15'; }
    else if (/school break|mid-?year break|winter break/.test(s)) { dep = '2027-01-07'; ret = '2027-01-16'; }
    else if (/\btomorrow\b/.test(s)) dep = addDays(today, 1);
    else if (/\btonight\b|\btoday\b/.test(s)) dep = today;
  }
  if (!dep) {
    const mo = s.match(new RegExp(`\\b(?:in|during|early|late|mid|end of|start of|this|next)\\s+(${MRE})\\b`)) ?? s.match(/\b(jan(?:uary)?|feb(?:ruary)?|march|april|june|july|august|sept(?:ember)?|october|november|december)\b/);
    const thisMonth0 = Number(today.slice(5, 7)) - 1;
    const y = Number(today.slice(0, 4));
    if (mo) { const mi = mIdx(mo[1]!); out.monthOnly = { month: mi + 1, year: mi < thisMonth0 ? y + 1 : y, label: null }; }
    else if (/ramadan/.test(s)) out.monthOnly = { month: 2, year: 2027, label: 'Ramadan' };
    else if (/summer/.test(s)) out.monthOnly = { month: 7, year: 2027, label: 'the summer' };
  }
  const dur = s.match(/\bfor (\d+|a|one|two|three|four|five|six|seven) (night|day|week)s?\b/);
  if (dep && !ret && dur) ret = addDays(dep, (toNum(dur[1]!) ?? 1) * (dur[2] === 'week' ? 7 : 1));
  if (/one[- ]?way|single ticket|no return|not coming back/.test(s)) { out.tripType = 'oneway'; ret = null; }
  else if (ret || /\breturn\b|round[- ]?trip|and back|coming back/.test(s)) out.tripType = 'return';
  out.depart = dep;
  out.return = ret;
  if (/first class|\bin first\b/.test(s)) { out.cabin = 'business'; out.cabinNote = t('search.cabinNoFirst'); }
  else if (/premium/.test(s)) out.cabin = 'premium';
  else if (/business/.test(s)) out.cabin = 'business';
  else if (/economy/.test(s)) out.cabin = 'economy';
  return out;
}

/** Needs said next to a name go to that person ("Hessa needs a wheelchair"). */
export function needsByPerson(text: string, people: Person[]): Record<string, NeedKey[]> {
  const out: Record<string, NeedKey[]> = {};
  text.toLowerCase().split(/[.;!?]|,| but /).forEach((part) => {
    const ks = needsIn(part);
    if (!ks.length) return;
    people.filter((p) => p.firstName && nameRe(p.firstName).test(part)).forEach((p) => { out[p.id] = [...new Set([...(out[p.id] ?? []), ...ks])]; });
  });
  return out;
}

/** Form answers already in the text ("Schengen", "In Ramadan"). */
export function prefillAnswers(kind: string, text: string): Record<string, string[]> {
  const form = REQUEST_FORMS[kind as RequestFormKind] ?? [];
  const s = text.toLowerCase();
  const a: Record<string, string[]> = {};
  form.forEach((f) => { const hit = (f.from ?? []).find(([re]) => re.test(s)); if (hit) a[f.k] = [hit[1]]; });
  return a;
}

export type RuleIntent = ParsedDetails & ParsedWho & { kind: AskKindValue; needs: Record<string, NeedKey[]>; needsMentioned: NeedKey[]; answers: Record<string, string[]>; ask: 'where' | 'when' | 'return' | 'who' | null };

/** The deterministic parser: the whole of what Ask understands in mock mode. */
export function parseAskRules(text: string, ctx: { today: string; people: Person[] }): RuleIntent {
  const kind = parseKind(text);
  const d = parseDetails(text, ctx.today);
  const w = parseWho(text, ctx.people, ctx.today);
  const H = householdOf(ctx.people, ctx.today);
  let ask: RuleIntent['ask'] = null;
  if (kind === 'flight') {
    if (!d.destination) ask = 'where';
    else if (!d.depart) ask = 'when';
    else if (d.tripType !== 'oneway' && !d.return) ask = 'return';
    else if (!w.ids && H.nonHelper.length > 1) ask = 'who';
  }
  return { kind, ...d, ...w, needs: needsByPerson(text, ctx.people), needsMentioned: needsIn(text.toLowerCase()), answers: prefillAnswers(kind, text), ask };
}

/* ───────────── fares, rooms, bundles ───────────── */

export const fareSar = (ppSar: number, cabin: Cabin, oneway: boolean) => Math.round(ppSar * CABIN_FACTOR[cabin] * (oneway ? ONE_WAY_FACTOR : 1));
export const infantSar = (fare: number) => Math.round(fare * INFANT_FACTOR);

/** Rooms for the party: one room for two or fewer, connecting rooms for more. */
export function roomsFor(n: number) { return n > 2 ? 2 : 1; }
export function roomsLabel(n: number) { return n > 2 ? t('search.rooms.connecting') : n === 2 ? t('search.rooms.forTwo') : t('search.rooms.one'); }

export function staySar(nightSar: number, nights: number, n: number) { return Math.round(nightSar * nights * (n > 2 ? 1 : SMALL_ROOM_FACTOR)); }

/** Rooms near Galata Tower plus pickups, offered next to Istanbul flights. Ask and the order sheet both read this. */
export function bundleFor(n: number, depart: string, ret: string | null) {
  const nights = ret ? Math.max(1, daysBetween(depart, ret)) : STAY_NIGHTS_DEFAULT;
  const hotel = CATALOGUE_HOTELS.istanbul![0]!;
  const stay = staySar(hotel.nightSar, nights, n);
  const pickup = ret ? PICKUP_SAR : PICKUP_SAR / 2;
  return { nights, staySar: stay, pickupSar: pickup, totalSar: stay + pickup, hotel, rooms: roomsFor(n) };
}

/** Seats held together, by cabin ("14A–14D"). */
export function seatsFor(n: number, cabin: Cabin, back = false): string[] {
  return Array.from({ length: Math.max(1, n) }, (_, i) => `${SEAT_ROW[cabin] + (back ? 2 : 0)}${'ABCDEF'[i % 6]}`);
}

/** Free to cancel until a week before the first night or flight. */
export const freeUntilLabel = (iso: string) => shortDay(addDays(iso, -7));

/* ───────────── promo codes ───────────── */

export function checkPromo(code: string | null | undefined, today: string, baseHalalas: number): { code: string; status: 'applied' | 'ended' | 'unknown'; message: string | null; discount: number } | null {
  const c = (code ?? '').trim().toUpperCase();
  if (!c) return null;
  const p = PROMOS[c];
  if (!p) return { code: c, status: 'unknown', message: t('pay.promo.unknown'), discount: 0 };
  if (today > p.validUntil) return { code: c, status: 'ended', message: t('pay.promo.ended', { date: p.endedLabel }), discount: 0 };
  const discount = Math.min(sarToHalalas(p.maxSar), Math.round((baseHalalas * p.percent) / 100));
  return { code: c, status: 'applied', message: null, discount };
}

/* ───────────── cards ───────────── */

export function cardBrandOf(digits: string): 'mada' | 'visa' | 'mastercard' | null {
  if (MADA_BINS.some((b) => digits.startsWith(b))) return 'mada';
  if (/^4/.test(digits)) return 'visa';
  if (/^(5[1-5]|2[2-7])/.test(digits)) return 'mastercard';
  return null;
}

export function luhnOk(digits: string): boolean {
  if (!/^\d+$/.test(digits)) return false;
  let sum = 0;
  for (let i = 0; i < digits.length; i += 1) {
    let d = Number(digits[digits.length - 1 - i]);
    if (i % 2 === 1) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
  }
  return sum % 10 === 0;
}

export const BRAND_NAMES = { visa: 'Visa', mastercard: 'Mastercard', mada: 'mada' } as const;
/** "Visa ending 41": the last two digits, as the prototype and most Saudi banks print it. */
export const cardLabel = (brand: keyof typeof BRAND_NAMES, last4: string) => t('pay.card.label', { brand: BRAND_NAMES[brand], last: last4.slice(-2) });

/** Problems with a card being typed, in the order people hit them. Null when it's fine. */
export function cardProblems(input: { number: string; expiry: string; cvv: string; name: string }, today: string, touched: { number?: boolean; expiry?: boolean } = {}) {
  const digits = input.number.replace(/\D/g, '');
  const brand = cardBrandOf(digits);
  const amex = /^3[47]/.test(digits);
  const numberOk = !!brand && digits.length === 16 && luhnOk(digits);
  const [mm, yy] = input.expiry.split('/').map((x) => Number(x));
  const cy = Number(today.slice(2, 4));
  const cm = Number(today.slice(5, 7));
  const shaped = /^\d{2}\/\d{2}$/.test(input.expiry);
  const expiryOk = shaped && mm! >= 1 && mm! <= 12 && (yy! > cy || (yy === cy && mm! >= cm));
  const cvvOk = /^\d{3}$/.test(input.cvv);
  const nameOk = input.name.trim().length >= 3;
  const number = amex ? t('pay.card.amex') : digits.length >= 16 && !luhnOk(digits) ? t('pay.card.luhn')
    : digits.length > 0 && digits.length < 16 && touched.number ? t('pay.card.short') : digits.length >= 6 && !brand ? t('pay.card.brands') : null;
  const expiry = touched.expiry && input.expiry && !expiryOk ? (shaped ? t('pay.card.expired') : t('pay.card.expiryShape')) : null;
  return { brand, digits, numberOk, expiryOk, cvvOk, nameOk, ok: numberOk && expiryOk && cvvOk && nameOk, problems: { number, expiry } };
}

/* ───────────── entry checks ───────────── */

export type EntryCheckValue = {
  personId: string | null; name: string | null; key: 'passport' | 'visa' | 'iqama' | 'reentry' | 'manual' | 'eta'; blocking: boolean; done: boolean; info: boolean;
  title: string | null; text: string; need: string | null; answerKey: string | null; removable: boolean; service: 'uk_eta' | 'evisa' | 'reentry' | 'passport_renewal' | null;
};

/** The passport country we go by: the passport's, else the person's, else Saudi (a helper with no passport: unknown). */
export function nationalityOf(p: Person): string | null {
  const n = p.passport?.nationality ?? p.nationality;
  if (n) return n;
  return p.relation === 'helper' ? null : 'SAU';
}

/**
 * Everything that could stop someone boarding, worked out before anyone pays (FLOWS.md §2, prototype entryChecks).
 * `iqamaOf` is where an iqama expiry comes from (documents later; the demo date in mock mode).
 */
export function entryChecks(input: {
  destination: string; travellers: Person[]; depart: string; return: string | null; answers: Record<string, string>; today: string;
  demo?: { passportProblem?: boolean }; iqamaOf?: (p: Person) => string | null;
}) {
  const dest = DESTINATIONS[input.destination];
  const c = dest?.country ?? '';
  const rule = ENTRY_RULES[c] ?? { name: dest?.name ?? '' };
  const ans = input.answers;
  const until = input.return ?? input.depart;
  const out: EntryCheckValue[] = [];
  const base = { done: false, info: false, title: null, need: null, answerKey: null, service: null } as const;
  const firstChild = input.travellers.find((p) => p.relation === 'child') ?? input.travellers.find((p) => !p.isSelf);
  for (const p of input.travellers) {
    const name = personName(p);
    const removable = !p.isSelf;
    const nat = nationalityOf(p);
    // Passport validity after landing (Türkiye: 150 days), or simply valid for the whole trip.
    const expiry = input.demo?.passportProblem && firstChild?.id === p.id ? DEMO_SHORT_PASSPORT : p.passport?.expiry ?? null;
    if (dest && !rule.domestic && expiry) {
      const need = rule.passportDays ? addDays(input.depart, rule.passportDays) : until;
      if (expiry < need) {
        out.push({ ...base, personId: p.id, name, key: 'passport', blocking: true, removable, service: 'passport_renewal', title: t('entry.passport.title', { name }),
          text: rule.passportDays
            ? t('entry.passport.days', { name, date: `${dayOfMonth(expiry)} ${monthOf(expiry)} ${expiry.slice(0, 4)}`, country: rule.name, days: rule.passportDays, until: shortDay(need) })
            : t('entry.passport.trip', { name, date: `${dayOfMonth(expiry)} ${monthOf(expiry)} ${expiry.slice(0, 4)}` }) });
      }
    }
    if (dest && !rule.domestic) {
      const r = nat === 'SAU' ? rule.SAU : nat === 'PHL' ? rule.PHL : undefined;
      const needRule = r && 'need' in r ? (r as { need?: string; text?: string }) : null;
      if (needRule?.need) {
        const k = `${p.id}:${c}:visa`;
        out.push(ans[k]
          ? { ...base, personId: p.id, name, key: 'visa', blocking: false, done: true, removable, text: ans[k] === 'has' ? t('entry.visa.has', { name, need: needRule.need }) : t('entry.visa.asked', { name, need: needRule.need }) }
          : { ...base, personId: p.id, name, key: 'visa', blocking: true, removable, service: 'evisa', title: t('entry.visa.title', { name, country: rule.name }), text: (needRule.text ?? '').replace('{name}', name), need: needRule.need, answerKey: k });
      } else if (!r) {
        out.push({ ...base, personId: p.id, name, key: 'manual', blocking: false, info: true, removable, text: t('entry.manual', { name, country: rule.name || dest.name }) });
      }
    }
    if (p.relation === 'helper' || (nat && nat !== 'SAU')) {
      const iq = ans[`${p.id}:iqama`] ?? input.iqamaOf?.(p) ?? null;
      if (iq && until && iq < until) {
        out.push({ ...base, personId: p.id, name, key: 'iqama', blocking: true, removable, title: t('entry.iqama.title', { name }), text: t('entry.iqama.text', { date: dayLabelShort(iq, input.today), back: dayLabelShort(until, input.today) }), answerKey: `${p.id}:iqama` });
      }
      if (dest && !rule.domestic) {
        const k = `${p.id}:reentry`;
        out.push(ans[k]
          ? { ...base, personId: p.id, name, key: 'reentry', blocking: false, done: true, removable, text: ans[k] === 'has' ? t('entry.reentry.has', { name }) : t('entry.reentry.asked', { name }) }
          : { ...base, personId: p.id, name, key: 'reentry', blocking: true, removable, service: 'reentry', title: t('entry.reentry.title', { name }), text: t('entry.reentry.text'), answerKey: k });
      }
    }
  }
  if (rule.SAU?.eta && input.travellers.some((p) => nationalityOf(p) === 'SAU')) {
    const k = `eta:${c}`;
    out.unshift(ans[k]
      ? { ...base, personId: null, name: null, key: 'eta', blocking: false, done: true, removable: false, text: t('entry.eta.asked') }
      : { ...base, personId: null, name: null, key: 'eta', blocking: false, info: true, removable: false, service: 'uk_eta', text: t('entry.eta.text'), answerKey: k });
  }
  const nats = [...new Set(input.travellers.map(nationalityOf).filter((x): x is string => !!x))].map((n) => NATIONALITY_ADJECTIVE[n] ?? n);
  return {
    countryName: rule.name || dest?.name || '', domestic: !!rule.domestic, nationalities: nats,
    okText: !out.length && !rule.domestic ? rule.SAU?.ok ?? null : null,
    checks: out, blocking: out.filter((x) => x.blocking).length, checkedOn: input.today,
  };
}

/** The mock-mode iqama: a helper's iqama ends on the prototype's demo date. */
export const demoIqama = (p: Person) => (p.relation === 'helper' ? DEMO_HELPER_IQAMA : null);

function dayLabelShort(iso: string, today: string) {
  const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][weekdayIdx(iso)];
  return `${wd} ${dayOfMonth(iso)} ${monthOf(iso)}${iso.slice(0, 4) !== today.slice(0, 4) ? ` ${iso.slice(0, 4)}` : ''}`;
}

/* ───────────── the desk's quotes (what a person types in Ops; the mock desk uses the same table) ───────────── */

export type DeskQuote = { totalSar: number; breakdown: { personId: string | null; name: string; lines: { label: string; sar: number }[] }[]; text: string; lead: string | null; needLines: string[] };

const youAll = (n: number) => (n === 1 ? 'you' : `all ${n} of you`);
const fmtSar = (n: number) => Math.round(n).toLocaleString('en-US');

export function deskQuote(input: {
  kind: string; answers: Record<string, string[]>; travellers: Person[]; needs: Record<string, NeedKey[]>; note: string; today: string;
  service?: string | null; serviceNeed?: string | null; byHand?: { ppSar: number; text: string; cabin: Cabin; oneway: boolean } | null;
}): DeskQuote | null {
  const { kind, answers, travellers: who, needs, note, today } = input;
  const n = Math.max(1, who.length);
  const name = (p: Person) => personName(p);
  if (input.service) {
    const each = input.service === 'uk_eta' ? DESK_PRICES.ukEtaEach : 0;
    const flat = input.service === 'evisa' ? DESK_PRICES.eVisa : input.service === 'reentry' ? DESK_PRICES.reentry : input.service === 'passport_renewal' ? DESK_PRICES.passportRenewal : 0;
    const total = each ? each * n : flat;
    const label = input.service === 'uk_eta' ? 'UK ETA application' : input.service === 'reentry' ? 'Exit and re-entry visa, single, 90 days' : input.service === 'passport_renewal' ? 'Passport renewal appointment and forms' : `${input.serviceNeed ?? 'Visa'} application`;
    const breakdown = each ? who.map((p) => ({ personId: p.id, name: name(p), lines: [{ label, sar: each }] })) : [{ personId: who[0]?.id ?? null, name: who[0] ? name(who[0]) : 'Guest', lines: [{ label, sar: flat }] }];
    return { totalSar: total, breakdown, lead: null, needLines: [], text: `I’ll take care of it. SAR ${fmtSar(total)}, and I’ll send you the document here once it’s issued.` };
  }
  if (input.byHand) {
    const pp = fareSar(input.byHand.ppSar, input.byHand.cabin, input.byHand.oneway);
    return { totalSar: pp * n, breakdown: who.map((p) => ({ personId: p.id, name: name(p), lines: [{ label: 'Return flights, held', sar: pp }] })), lead: null, needLines: [],
      text: `Best option: ${input.byHand.text}. SAR ${fmtSar(pp)} each, SAR ${fmtSar(pp * n)} for ${youAll(n)}. I can hold it until 18:00 tomorrow.` };
  }
  const needLines: string[] = [];
  who.forEach((p) => (needs[p.id] ?? []).forEach((k) => {
    if (k === 'oxygen') needLines.push(`Oxygen for ${name(p)}: I’ll arrange the airline’s approval. I need a doctor’s form 7 days before.`);
    else if (k.startsWith('wheelchair')) needLines.push(`${NEED_LABELS[k]} for ${name(p)} on both flights, no charge.`);
    else if (k === 'toilet') needLines.push(`${name(p)} sits near the toilet.`);
    else needLines.push(`${NEED_LABELS[k]} for ${name(p)} on both flights.`);
  }));
  const anyWheelchair = who.some((p) => (needs[p.id] ?? []).some((k) => k.startsWith('wheelchair')));
  if (kind === 'umrah') {
    const near = (answers.stay ?? [])[0] === 'Steps from the Haram';
    const breakdown = who.map((p) => {
      const a = ageOn(p, today) ?? 30;
      const lines = [{ label: a < 2 ? 'On a lap, flights and transfers' : 'Flights, 3 nights, train and transfers', sar: a < 2 ? DESK_PRICES.umrahInfant : a < 12 ? DESK_PRICES.umrahChild : DESK_PRICES.umrahAdult }];
      if (near && a >= 2) lines.push({ label: 'Room steps from the Haram', sar: DESK_PRICES.umrahNearHaram });
      if ((needs[p.id] ?? []).some((k) => k.startsWith('wheelchair'))) lines.push({ label: 'Wheelchair and pusher at the Haram, 3 days', sar: DESK_PRICES.umrahWheelchair });
      return { personId: p.id, name: name(p), lines };
    });
    const total = breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.sar, 0), 0);
    const where = near ? 'steps from the Haram' : 'a short ride from the Haram';
    const helped = who.filter((p) => (needs[p.id] ?? []).length).map((p) => `${name(p)}: ${(needs[p.id] ?? []).map((k) => (k === 'oxygen' ? 'oxygen, with airline approval' : NEED_LABELS[k].toLowerCase())).join(', ')}.`);
    return {
      totalSar: total, breakdown, needLines: [...needLines, ...(anyWheelchair ? ['Rooms on a low floor, next to the lift.'] : [])],
      lead: `Flights to Madinah, 3 nights ${where}, the Haramain train and transfers. Nusuk permits are yours to get; I’ll remind you.`,
      text: `Flights to Madinah, 3 nights ${where}, the Haramain train and transfers for ${youAll(n)}: SAR ${fmtSar(total)}.${helped.length ? ` Arranged for each person. ${helped.join(' ')}` : ''}${note ? ' I’ve planned around your note.' : ''} Nusuk permits are yours to get; I’ll remind you.`,
    };
  }
  if (kind === 'visa') {
    const total = DESK_PRICES.visaAppointment * n;
    return { totalSar: total, breakdown: who.map((p) => ({ personId: p.id, name: name(p), lines: [{ label: 'Appointment, forms and checklist', sar: DESK_PRICES.visaAppointment }] })), lead: null, needLines: [],
      text: `The earliest appointment is Tue 12 Jan, 10:20 at VFS Riyadh. I’ll book it and prepare every form. SAR ${fmtSar(DESK_PRICES.visaAppointment)} each, SAR ${fmtSar(total)} in total, plus the embassy fee paid on the day.` };
  }
  if (kind === 'todo') {
    const picks = answers.pick ?? [];
    const breakdown = who.map((p) => ({ personId: p.id, name: name(p), lines: picks.map((x) => ({ label: x, sar: (ageOn(p, today) ?? 30) < 12 ? Math.round((DESK_PRICES.todo[x] ?? 0) / 2) : DESK_PRICES.todo[x] ?? 0 })) }));
    const total = breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.sar, 0), 0);
    return { totalSar: total, breakdown, lead: null, needLines: [],
      text: `${picks.join(', ')} for ${youAll(n)}: SAR ${fmtSar(total)}. Children under 12 are half price.${needLines.length ? ' ' + needLines.join(' ').replace(/ on both flights/g, '') : ''}` };
  }
  if (kind === 'car') {
    return { totalSar: DESK_PRICES.car, breakdown: [], lead: null, needLines: [], text: `${(answers.size ?? ['A car'])[0]} with a driver, ${((answers.days ?? ['1 day'])[0] ?? '').toLowerCase()}: SAR ${fmtSar(DESK_PRICES.car)}, fuel and the driver included.` };
  }
  return null;
}

/** How the agent answers a reply, until a person types it (the mock desk). Returns an offer when there is one. */
export function deskReply(kind: string, text: string, n: number): { text: string; offer: { label: string; perPersonSar: number } | null } {
  const s = text.toLowerCase();
  if (/closer|nearer|haram|walk/.test(s) && kind === 'umrah') {
    const each = DESK_PRICES.closerToHaram;
    return { text: `Yes. A hotel at the King Abdulaziz Gate, 2 minutes’ walk to the Haram. SAR ${each} more each, SAR ${fmtSar(each * n)} for ${n === 1 ? 'you' : `all ${n}`}. Shall I switch it?`, offer: { label: 'Room at the King Abdulaziz Gate', perPersonSar: each } };
  }
  if (/cheaper|less|budget|price/.test(s)) return { text: 'I’ll look for a lower price on the same dates and reply here within 20 minutes.', offer: null };
  if (/date|later|earlier|day|week/.test(s)) return { text: 'I’ll check those dates with the airline and the hotel, and reply here within 20 minutes.', offer: null };
  return { text: 'Got it. I’ll check and reply here within 20 minutes.', offer: null };
}

/** The request title and one-line summary the desk and Trips show. */
export function requestTitle(kind: string, answers: Record<string, string[]>, query: string): string {
  const titles: Record<string, string> = { visa: 'Visa', umrah: 'Umrah', car: 'Car rental', food: 'Restaurant table', todo: 'Things to do', stay: 'A place to stay', flight: 'Flights', general: 'Request' };
  if (kind === 'general' || kind === 'flight') return query || titles[kind]!;
  const where = (answers.where ?? [])[0];
  return `${titles[kind] ?? 'Request'}${where ? `: ${where}` : ''}`;
}
