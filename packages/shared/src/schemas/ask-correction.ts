/*
 * Corrections while Ask is already answering: "we are 5", "3 kids", "December", "next week", "right now", "I have a
 * permit", "احنا ٥", "الأسبوع الجاي". Every flow (flights, stays, requests) runs the same layer: what was typed updates
 * who, when or where on the answer in hand instead of starting over. Text that looks like a change but says nothing
 * the layer can read comes back "unclear", and the app asks which thing to change. Pure functions, no I/O.
 */
import { addDays, daysBetween } from '../dates';
import { DESTINATIONS } from './booking-data';
import { parseDetails, parseKind, parseWho, weekendDates } from './booking-logic';
import { matchParty, normalizeAsk, parseParty, type SaidParty } from './party';
import type { AskIntent } from './booking';
import type { Person } from './people';

export type CorrectionField = 'who' | 'when' | 'where' | 'permit' | 'cabin' | 'kind';
export type Correction = { type: 'apply'; intent: AskIntent; changed: CorrectionField[] } | { type: 'unclear' } | { type: 'new' };

const AR_PLACES: [RegExp, string][] = [
  [/اسطنبول|تركيا/, 'istanbul'], [/دبي/, 'dubai'], [/القاهر[هة]|مصر/, 'cairo'], [/لندن|بريطانيا/, 'london'], [/باكو|اذربيجان/, 'baku'], [/جد[هة]/, 'jeddah'],
  [/العلا/, 'alula'], [/ابها/, 'abha'], [/تبليسي|جورجيا/, 'tbilisi'], [/باريس|فرنسا/, 'paris'], [/بالي/, 'bali'], [/المالديف/, 'maldives'],
];
const AR_MONTHS = ['يناير', 'فبراير', 'مارس', 'ابريل', 'مايو', 'يونيو', 'يوليو', 'اغسطس', 'سبتمبر', 'اكتوبر', 'نوفمبر', 'ديسمبر'];
const PERMIT = /\b(?:i|we)(?:'ve| have| got|'ve got| already have| already got)\s+(?:a |an |the |our |my )?(?:permits?|visas?|nusuk|eta)\b|\balready (?:have|got) (?:a |the |our )?(?:permits?|visas?)\b|\b(?:permits?|visas?) (?:is |are )?(?:done|sorted|ready)\b|(?:عندي|عندنا|معي|معنا) (?:ال)?(?:تصريح|تصاريح|فيزا|تاشير[هة])|(?:التصريح|الفيزا|التاشير[هة]) (?:جاهز|جاهز[هة]|طالع|طالع[هة])|طلعت التصريح|طلعنا التصريح/;
const TODAY_WORDS = /\b(?:right now|leave now|go now|asap|as soon as possible|immediately)\b|^\s*now\s*$|الحين|الان|حالا|اليوم|الليل[هة]/;
const FIX_WORDS = /\b(?:change|actually|instead|wrong|not|no|fix|update|make it)\b|غير|غيّر|بدل|عدل|عدّل|لا |مو /;

/** The next Sunday (a Saudi week starts on Sunday). */
const nextWeek = (today: string) => addDays(today, ((7 - new Date(`${today}T00:00:00Z`).getUTCDay()) % 7) || 7);

/** The days said in a correction, beyond what the first reading of a request understands. */
function whenIn(text: string, s: string, today: string): { depart: string | null; return: string | null; monthOnly: AskIntent['monthOnly']; tripType: AskIntent['tripType'] } | null {
  const d = parseDetails(text, today);
  if (d.depart) return { depart: d.depart, return: d.return, monthOnly: null, tripType: d.tripType };
  if (d.monthOnly) return { depart: null, return: null, monthOnly: d.monthOnly, tripType: d.tripType };
  if (/\bnext week\b|الاسبوع (?:الجاي|القادم|اللي بعده)/.test(s)) return { depart: nextWeek(today), return: null, monthOnly: null, tripType: null };
  if (/الويكند الجاي|نهاي[هة] الاسبوع الجاي[هة]/.test(s)) { const [a, b] = weekendDates(today, 1); return { depart: a, return: b, monthOnly: null, tripType: 'return' }; }
  if (/(?:هال|ذا ال|ال)ويكند|نهاي[هة] الاسبوع/.test(s)) { const [a, b] = weekendDates(today, 0); return { depart: a, return: b, monthOnly: null, tripType: 'return' }; }
  if (/بكر[هة]/.test(s)) return { depart: addDays(today, 1), return: null, monthOnly: null, tripType: null };
  if (TODAY_WORDS.test(s)) return { depart: today, return: null, monthOnly: null, tripType: null };
  if (/العيد الكبير|عيد الاضحي|الاضحي/.test(s)) return { depart: '2027-05-15', return: '2027-05-20', monthOnly: null, tripType: 'return' };
  if (/العيد|عيد الفطر/.test(s)) return { depart: '2027-03-09', return: '2027-03-15', monthOnly: null, tripType: 'return' };
  const thisMonth0 = Number(today.slice(5, 7)) - 1;
  const y = Number(today.slice(0, 4));
  const next = /\bnext month\b|الشهر الجاي|الشهر القادم/.test(s);
  const mi = next ? (thisMonth0 + 1) % 12 : AR_MONTHS.findIndex((m) => s.includes(m));
  if (mi >= 0) return { depart: null, return: null, monthOnly: { month: mi + 1, year: mi < thisMonth0 ? y + 1 : y, label: null }, tripType: null };
  if (/رمضان/.test(s)) return { depart: null, return: null, monthOnly: { month: 2, year: 2027, label: 'Ramadan' }, tripType: null };
  return null;
}

/** A new count on top of what was said before: "3 kids" keeps the adults, "we are 5" keeps a party that already adds up to 5. */
function mergeParty(prev: SaidParty | null | undefined, said: SaidParty): SaidParty {
  if (!prev) return said;
  const onlyTotal = said.adults == null && !said.childAges.length && !said.infants;
  if (onlyTotal) {
    const prevSum = (prev.adults ?? 0) + prev.childAges.length + prev.infants;
    return prev.adults != null && prevSum === said.total ? prev : said;
  }
  const adults = said.adults ?? prev.adults;
  const childAges = said.childAges.length ? said.childAges : prev.childAges;
  const infants = said.infants || prev.infants;
  return { adults, childAges, infants, infantSeats: Math.min(infants, prev.infantSeats ?? 0), total: adults != null ? adults + childAges.length + infants : said.total };
}

/** The one question still open after a change, as the first reading would ask it. */
function askOf(i: AskIntent, people: Person[]): AskIntent['ask'] {
  if (i.kind !== 'flight') return null;
  if (!i.destination) return 'where';
  if (!i.depart) return 'when';
  if (i.tripType !== 'oneway' && !i.return) return 'return';
  if (!i.travellerIds && (people.filter((p) => p.relation !== 'helper').length > 1 || i.party)) return 'who';
  return null;
}

/**
 * Apply what was just typed to the answer in hand. "apply" with the fields that changed; "unclear" when it reads like a
 * change but names nothing the layer can read (the app asks which thing to change); "new" when it's a different request.
 */
export function correctAsk(prev: AskIntent, text: string, ctx: { today: string; people: Person[] }): Correction {
  const s = normalizeAsk(text);
  const kind = parseKind(text);
  // A different kind of request ("a visa for Sara", "Umrah in Ramadan") starts again, even when it names someone.
  if (['visa', 'umrah', 'car', 'food', 'todo', 'esim'].includes(kind) && kind !== prev.kind && !PERMIT.test(s)) return { type: 'new' };
  const next: AskIntent = { ...prev, answers: { ...prev.answers } };
  const changed: CorrectionField[] = [];

  const said = parseParty(text);
  const who = parseWho(text, ctx.people, ctx.today);
  if (said) {
    const party = mergeParty(prev.party, said);
    const m = matchParty(party, ctx.people, ctx.today);
    Object.assign(next, { party, travellerIds: m.complete ? m.ids : null, travellerCount: Math.min(9, m.seats), infants: Math.min(4, m.lapInfants) });
    changed.push('who');
  } else if (who.ids) {
    Object.assign(next, { party: null, travellerIds: who.ids, travellerCount: who.count, infants: who.infants });
    changed.push('who');
  }

  const when = whenIn(text, s, ctx.today);
  if (when) {
    const keep = prev.depart && prev.return && when.depart && !when.return && when.tripType !== 'oneway' ? addDays(when.depart, daysBetween(prev.depart, prev.return)) : null;
    Object.assign(next, { depart: when.depart, return: when.return ?? keep, monthOnly: when.monthOnly, tripType: when.tripType ?? prev.tripType });
    changed.push('when');
  }

  const d = parseDetails(text, ctx.today);
  const arPlace = AR_PLACES.find(([re]) => re.test(s))?.[1] ?? null;
  // Only a city Mada knows: "closer to Sultanahmet" is a wish about these results, not a new place.
  const place = arPlace ?? (d.destination && d.destination !== 'other' ? d.destination : null);
  if (place && place !== prev.destination && DESTINATIONS[place]) {
    Object.assign(next, { destination: place, destinationName: null });
    changed.push('where');
  }
  if (d.from && d.from !== prev.from) { next.from = d.from; changed.push('where'); }
  if (d.cabin && d.cabin !== prev.cabin) { next.cabin = d.cabin; next.cabinNote = d.cabinNote; changed.push('cabin'); }

  if (PERMIT.test(s)) { next.answers.permit = ['has']; changed.push('permit'); }

  if ((kind === 'flight' || kind === 'stay') && kind !== prev.kind && (prev.kind === 'flight' || prev.kind === 'stay') && /\b(?:flights?|fly|hotels?|rooms?|stay)\b|طيران|رحل[هة]|فندق|سكن/.test(s)) {
    next.kind = kind; changed.push('kind');
  }

  if (!changed.length) {
    if (kind !== 'general' && !FIX_WORDS.test(s)) return { type: 'new' };
    return { type: 'unclear' };
  }
  next.ask = askOf(next, ctx.people);
  return { type: 'apply', intent: next, changed: [...new Set(changed)] };
}

/** "I have a permit": the entry-check answers that mark each traveller's visa and re-entry permit as in hand. */
export function permitAnswers(intent: Pick<AskIntent, 'answers'>, travellerIds: string[], destination: string | null | undefined): Record<string, string> {
  const c = destination ? DESTINATIONS[destination]?.country : null;
  if (!intent.answers.permit?.length || !c) return {};
  return Object.fromEntries(travellerIds.flatMap((id) => [[`${id}:${c}:visa`, 'has'], [`${id}:reentry`, 'has']]));
}
