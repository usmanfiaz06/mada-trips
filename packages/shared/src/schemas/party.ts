/*
 * Who is going, as said ("2 adults and 3 kids aged 2, 6 and 13", "احنا ٥"), and how that maps onto the saved household.
 * Ask never books fewer people than were said: when the counts or ages don't map to the people saved, the app asks with a
 * stepper (adults, children with an age each, infants on a lap or a seat). Fare bands and family-aware ranking live here
 * too. Pure functions, no I/O; English and spoken Saudi Arabic.
 */
import { addDays, isIsoDay } from '../dates';
import type { Person } from './people';

/** What was said about the party. childAges are children 2–17 (null: age not said); infants are under 2. */
export type SaidParty = { adults: number | null; childAges: (number | null)[]; infants: number; infantSeats?: number; total: number | null };

const AR_DIGITS = /[٠-٩۰-۹]/g;
/** Lower case, Latin digits, one alef, Arabic commas as commas: what every reader below matches against. */
export function normalizeAsk(text: string): string {
  return ` ${text
    .replace(AR_DIGITS, (d) => String((d.charCodeAt(0) & 0xf) % 10))
    .replace(/[أإآ]/g, 'ا').replace(/ى/g, 'ي').replace(/ـ/g, '').replace(/،/g, ',')
    .toLowerCase()} `;
}

const EN_N: Record<string, number> = { a: 1, an: 1, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12 };
const AR_N: Record<string, number> = {
  واحد: 1, وحده: 1, وحدة: 1, اثنين: 2, اثنان: 2, ثنين: 2, ثلاث: 3, ثلاثة: 3, ثلاثه: 3, اربع: 4, اربعة: 4, اربعه: 4, خمس: 5, خمسة: 5, خمسه: 5,
  ست: 6, ستة: 6, سته: 6, سبع: 7, سبعة: 7, سبعه: 7, ثمان: 8, ثمانية: 8, ثمانيه: 8, تسع: 9, تسعة: 9, تسعه: 9,
};
const N = `(\\d{1,2}|${[...Object.keys(EN_N), ...Object.keys(AR_N)].sort((a, b) => b.length - a.length).join('|')})`;
const num = (w: string | undefined) => (w == null ? null : /\d/.test(w) ? Number(w) : EN_N[w] ?? AR_N[w] ?? null);
/** Arabic has no \b: a word starts after a space, punctuation or a joined و/ل/ب. */
const A = '(?:^|[\\s,.(]|[\\s,.(][وبل]ـ?)';

const match = (s: string, re: RegExp) => { const m = s.match(re); return m ? num(m[1]) : null; };
const allNums = (s: string) => [...s.matchAll(/\d{1,2}/g)].map((m) => Number(m[0]));

/** The counts and ages in what was typed, or null when it says nothing about how many. */
export function parseParty(text: string): SaidParty | null {
  const s = normalizeAsk(text);
  const adultsSaid = match(s, new RegExp(`\\b${N}\\s+(?:adults?|grown[- ]?ups?)\\b`)) ?? match(s, new RegExp(`${A}${N}\\s*(?:بالغين|بالغ|كبار)`))
    ?? (/(?:شخصين|اثنين)\s*(?:بالغين|كبار)|كبيرين/.test(s) ? 2 : null);
  let kids = match(s, new RegExp(`\\b${N}\\s+(?:kids?|children|child|boys?|girls?|sons?|daughters?|little ones)\\b`))
    ?? match(s, new RegExp(`${A}${N}\\s*(?:اطفال|عيال|بزران|اولاد|بنات|ورعان)`));
  if (kids == null && new RegExp(`${A}(?:طفلين|ولدين|بنتين|عيالين|ورعين)`).test(s)) kids = 2;
  // Ages: "aged 2, 6 and 13", "ages 4 and 7", "أعمارهم ٢ و٦ و١٣", or one by one ("a 6 year old", "عمره ٥ سنين").
  let ages: number[] = [];
  const list = s.match(/\b(?:aged?|ages?)\s*:?\s*(\d{1,2}(?:\s*(?:,|and|&|و)\s*\d{1,2})*)/) ?? s.match(/(?:اعمارهم|اعمارها|اعمار|عمرهم|عمره|عمرها|بعمر|بأعمار|باعمار)\s*:?\s*(\d{1,2}(?:\s*(?:,|و)\s*\d{1,2})*)/);
  if (list) ages = allNums(list[1]!);
  else ages = [...s.matchAll(/(\d{1,2})\s*[- ]?\s*(?:years?|yrs?|y\/?o)\b(?:[- ]old)?|(\d{1,2})\s*(?:سنين|سنوات|سنة|سنه)/g)].map((m) => Number(m[1] ?? m[2]));
  const months = [...s.matchAll(/(\d{1,2})\s*[- ]?\s*months?[- ]old|(?:عمره|عمرها|رضيع|بيبي)\s*(\d{1,2})\s*(?:شهور|اشهر|شهر)/g)].length;
  let infantsSaid = match(s, new RegExp(`\\b${N}\\s+(?:babies|infants)\\b`)) ?? 0;
  if (!infantsSaid && /\btwins\b|توام|رضيعين/.test(s) && !ages.length) infantsSaid = 2;
  else if (!infantsSaid && /\b(?:baby|infant|newborn)\b|رضيع|بيبي/.test(s)) infantsSaid = 1;
  const infantsFromAges = ages.filter((a) => a < 2).length + months;
  const infants = Math.min(4, Math.max(infantsSaid, infantsFromAges));
  const childAges: (number | null)[] = ages.filter((a) => a >= 2 && a < 18);
  const kidCount = kids == null ? null : Math.max(0, kids - ages.filter((a) => a < 2).length);
  if (kidCount != null) while (childAges.length < kidCount) childAges.push(null);
  const total = match(s, new RegExp(`\\b(?:we are|we're|we re|there are|there's|theres)\\s+${N}\\b(?!\\s*(?:nights?|days?|kids|children|adults))`))
    ?? match(s, new RegExp(`\\b${N}\\s+of us\\b`)) ?? match(s, new RegExp(`\\b(?:family|party|group) of\\s+${N}\\b`))
    ?? match(s, new RegExp(`\\b${N}\\s+(?:people|persons|travell?ers|passengers|pax)\\b`))
    ?? match(s, new RegExp(`\\bfor\\s+${N}\\b(?!\\s*(?:nights?|days?|weeks?|months?|hours?|years?|kids|children|adults|babies|infants|people|-|of))`))
    ?? match(s, new RegExp(`(?:احنا|نحن|حنا|عددنا)\\s*${N}`)) ?? match(s, new RegExp(`${A}${N}\\s*(?:اشخاص|افراد|مسافرين|نفر|انفار)`))
    ?? match(s, new RegExp(`(?:عايلة|عايله|عائلة|عائله)\\s+من\\s+${N}`));
  let adults = adultsSaid;
  const anyKids = childAges.length > 0 || infants > 0;
  if (adults == null && anyKids) {
    if (/\b(?:me and my (?:wife|husband)|my (?:wife|husband) and (?:i|me)|the two of us|both of us)\b|(?:انا|وانا) و?(?:زوجتي|زوجي|المدام|ام العيال|ابو العيال)/.test(s)) adults = 2;
    else if (/\b(?:me and|just me with|i'm taking|i am taking)\b|انا و/.test(s)) adults = 1;
  }
  if (adults == null && total != null && anyKids) adults = Math.max(1, total - childAges.length - infants);
  if (adults == null && !anyKids && total == null) return null;
  const sum = adults != null ? adults + childAges.length + infants : null;
  return { adults, childAges, infants, total: Math.max(total ?? 0, sum ?? 0) || null };
}

/* ───────────── matching the household ───────────── */

/** Whole years on a day; null without a date of birth. */
export function ageAt(dateOfBirth: string | null | undefined, day: string): number | null {
  if (!dateOfBirth || !isIsoDay(dateOfBirth)) return null;
  const a = Number(day.slice(0, 4)) - Number(dateOfBirth.slice(0, 4));
  return day.slice(5) < dateOfBirth.slice(5) ? a - 1 : a;
}

/** A date of birth for someone known only by age: half a year past that birthday, so the age reads right all year. */
export function dobFromAge(age: number, today: string): string {
  return addDays(today, -Math.floor((Math.max(0, age) + 0.5) * 365.25));
}

export type PartySlot = { kind: 'adult' | 'child' | 'infant'; age: number | null; personId: string | null };
export type PartyMatch = { slots: PartySlot[]; ids: string[]; complete: boolean; lapInfants: number; seats: number };

const isKid = (p: Person, today: string) => !p.isSelf && (p.relation === 'child' || (ageAt(p.dateOfBirth, today) ?? 30) < 18);

/** The household in the order a party is filled: you, your spouse, other adults, then the children oldest first. */
function ordered(people: Person[], today: string) {
  const nonHelper = people.filter((p) => p.relation !== 'helper');
  const rank = (p: Person) => (p.isSelf ? 0 : p.relation === 'spouse' ? 1 : isKid(p, today) ? 3 : 2);
  const sorted = [...nonHelper].sort((a, b) => rank(a) - rank(b) || (a.dateOfBirth ?? '9').localeCompare(b.dateOfBirth ?? '9'));
  return { all: sorted, adults: sorted.filter((p) => !isKid(p, today)), kids: sorted.filter((p) => isKid(p, today)) };
}

/**
 * Who in the saved household fills each place that was said. A place nobody fits stays empty (personId null), and the
 * match is incomplete: the app asks rather than booking fewer people. Infants on a lap need no place.
 */
export function matchParty(party: SaidParty, people: Person[], today: string): PartyMatch {
  const H = ordered(people, today);
  const seatInfants = Math.min(party.infants, party.infantSeats ?? 0);
  const lapInfants = party.infants - seatInfants;
  const slots: PartySlot[] = [];
  const used = new Set<string>();
  const take = (p: Person | undefined) => { if (p) used.add(p.id); return p?.id ?? null; };
  if (party.adults == null && !party.childAges.length && !seatInfants) {
    // Only a total ("we are 5", "for 2"): the household in order, then places to fill.
    const seated = Math.max(1, (party.total ?? 1) - lapInfants);
    for (let i = 0; i < seated; i += 1) {
      const p = H.all[i];
      slots.push({ kind: p && isKid(p, today) ? 'child' : 'adult', age: p ? ageAt(p.dateOfBirth, today) : null, personId: take(p) });
    }
  } else {
    const adults = party.adults ?? Math.max(1, H.adults.length);
    for (let i = 0; i < adults; i += 1) slots.push({ kind: 'adult', age: null, personId: take(H.adults[i]) });
    const kids = party.childAges.map((age) => ({ kind: 'child' as const, age, personId: null as string | null }));
    // Known ages first, to the child whose age is closest (a year either way: birthdays fall during the trip).
    for (const k of [...kids].filter((x) => x.age != null).sort((a, b) => b.age! - a.age!)) {
      const fit = H.kids.filter((p) => !used.has(p.id)).map((p) => ({ p, d: Math.abs((ageAt(p.dateOfBirth, today) ?? 99) - k.age!) })).filter((x) => x.d <= 1).sort((a, b) => a.d - b.d)[0];
      k.personId = take(fit?.p);
    }
    for (const k of kids.filter((x) => x.age == null)) {
      const p = H.kids.find((c) => !used.has(c.id) && (ageAt(c.dateOfBirth, today) ?? 2) >= 2);
      k.personId = take(p);
      if (p) k.age = ageAt(p.dateOfBirth, today);
    }
    slots.push(...[...kids].sort((a, b) => (b.age ?? -1) - (a.age ?? -1)));
    for (let i = 0; i < seatInfants; i += 1) slots.push({ kind: 'infant', age: 0, personId: take(people.find((p) => !used.has(p.id) && (ageAt(p.dateOfBirth, today) ?? 99) < 2)) });
  }
  const ids = slots.map((x) => x.personId).filter((x): x is string => !!x);
  return { slots, ids, complete: slots.every((x) => !!x.personId), lapInfants, seats: slots.length };
}

/** The party the household itself makes, for the stepper's starting point when nothing was said. */
export function partyOfPeople(people: Person[], ids: string[], today: string, lapInfants = 0): SaidParty {
  const chosen = people.filter((p) => ids.includes(p.id));
  const kids = chosen.filter((p) => isKid(p, today));
  const seatBabies = kids.filter((p) => (ageAt(p.dateOfBirth, today) ?? 99) < 2).length;
  const childAges = kids.filter((p) => (ageAt(p.dateOfBirth, today) ?? 99) >= 2).map((p) => ageAt(p.dateOfBirth, today));
  const adults = Math.max(1, chosen.length - kids.length);
  return { adults, childAges, infants: lapInfants + seatBabies, infantSeats: seatBabies, total: adults + childAges.length + lapInfants + seatBabies };
}

/** "2 adults, 3 children (2, 6, 13), 1 on a lap": the counts, for summaries and tests. */
export function partyCounts(p: SaidParty) {
  return { adults: p.adults ?? 0, children: p.childAges.length, ages: p.childAges, infants: p.infants, seats: (p.adults ?? 0) + p.childAges.length + Math.min(p.infants, p.infantSeats ?? 0) };
}

/* ───────────── fares and family-aware options ───────────── */

/** Airline fare bands: under 2 an infant, 2 to 11 a child, 12 and over an adult. */
export type FareBand = 'adult' | 'child' | 'seatInfant' | 'lapInfant';
export function fareBandOf(age: number | null): Exclude<FareBand, 'lapInfant'> {
  if (age == null || age >= 12) return 'adult';
  return age >= 2 ? 'child' : 'seatInfant';
}

export type FareLine = { band: FareBand; count: number; each: number; total: number; ages: number[] };

/**
 * The price per person, by band, for a flight option: adults, children, babies on their own seat (each priced as the
 * airline prices a seat), babies on a lap. The lines always add up to the option's total.
 */
export function fareLines(o: { pricePerPerson: { amount: number }; infantPrice: { amount: number }; total: { amount: number }; infants: number }, travellers: Pick<Person, 'dateOfBirth'>[], onDay: string): FareLine[] {
  const by: Record<Exclude<FareBand, 'lapInfant'>, number[]> = { adult: [], child: [], seatInfant: [] };
  for (const p of travellers) { const a = ageAt(p.dateOfBirth, onDay); by[fareBandOf(a)].push(a ?? -1); }
  const pp = o.pricePerPerson.amount;
  const lines: FareLine[] = (['adult', 'child', 'seatInfant'] as const).filter((b) => by[b].length).map((b) => ({ band: b, count: by[b].length, each: pp, total: pp * by[b].length, ages: by[b].filter((a) => a >= 0).sort((x, y) => y - x) }));
  if (o.infants) lines.push({ band: 'lapInfant', count: o.infants, each: o.infantPrice.amount, total: o.infantPrice.amount * o.infants, ages: [] });
  // Whatever the supplier added on top (taxes it doesn't split) stays on the first line, so the sum is the total.
  const gap = o.total.amount - lines.reduce((a, l) => a + l.total, 0);
  if (gap && lines[0]) lines[0] = { ...lines[0], total: lines[0].total + gap };
  return lines;
}

/** Leaves between 23:00 and 04:59: a hard start with a small child. */
export const isNightDeparture = (hhmm: string) => { const h = Number(hhmm.slice(0, 2)); return h < 5 || h >= 23; };

/** A child under 5 or a baby on a lap is going. */
export function hasLittleOnes(travellers: Pick<Person, 'dateOfBirth'>[], lapInfants: number, onDay: string) {
  return lapInfants > 0 || travellers.some((p) => { const a = ageAt(p.dateOfBirth, onDay); return a != null && a < 5; });
}

/**
 * Options in the order a family with little ones would want: night departures move to the end and lose "best" and
 * "earliest" (they show as leaving at night), and the first daytime option is the best one when the night flight was.
 */
export function familyRank<T extends { label: string; out: { dep: string } }>(options: T[], littleOnes: boolean): (T & { night: boolean })[] {
  const tagged = options.map((o) => ({ ...o, night: littleOnes && isNightDeparture(o.out.dep) }));
  if (!littleOnes) return tagged;
  const day = tagged.filter((o) => !o.night);
  const night = tagged.filter((o) => o.night);
  if (day.length && night.some((o) => o.label === 'best') && !day.some((o) => o.label === 'best')) day[0] = { ...day[0]!, label: 'best' };
  return [...day, ...night];
}

/** "6", "٦", "6 years" or "2019-04-02": a date of birth, or null when it reads as neither (or is in the future). */
export function dobOfTyped(text: string, today: string): string | null {
  const s = normalizeAsk(text).trim();
  const iso = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (iso) return isIsoDay(s) && s <= today ? s : null;
  const age = s.match(/^(\d{1,3})(?:\s*(?:years?|yrs?|y|سنة|سنه|سنين|سنوات))?$/);
  return age && Number(age[1]) <= 120 ? dobFromAge(Number(age[1]), today) : null;
}
