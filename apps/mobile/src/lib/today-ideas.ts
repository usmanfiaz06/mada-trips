import { addDays, daysBetween, type CopyKey } from '@mada/shared';

/*
 * Today's bento with nothing planned: a hero photo tile and two smaller ones, picked fresh each day from what is
 * true for this traveller. Pure (no React, no network) so the choice can be tested: Nothing.tsx gathers the inputs
 * (trips, saved places, cached searches, circles, eSIMs, What Mada remembers) and renders what comes back.
 *
 * Nothing here is invented. A flight time shows only when we know where they fly from; a price only from a search
 * they ran that is still cached; a person only from a circle message they really wrote; dates only from the
 * Umm al-Qura calendar, the fixed public holidays, or the coming weekend.
 */

export type HomeCode = 'RUH' | 'JED' | 'DMM';
export type IdeaKind = 'idea' | 'weekend' | 'event' | 'fare' | 'umrah' | 'esim' | 'circle' | 'family' | 'saved';

/** A place we have a photo and words for. Months are 1–12, the ones it is at its best. */
type Place = { key: string; city: string; photo: string; saudi: boolean; months: number[]; why: CopyKey };
export const IDEA_PLACES: readonly Place[] = [
  { key: 'alula', city: 'AlUla', photo: 'alula-elephant-rock', saudi: true, months: [10, 11, 12, 1, 2, 3], why: 'ti.why.alula' },
  { key: 'abha', city: 'Abha', photo: 'abha-mountains', saudi: true, months: [5, 6, 7, 8, 9], why: 'ti.why.abha' },
  { key: 'jeddah', city: 'Jeddah', photo: 'jeddah-al-balad', saudi: true, months: [11, 12, 1, 2, 3], why: 'ti.why.jeddah' },
  { key: 'istanbul', city: 'Istanbul', photo: 'istanbul-galata', saudi: false, months: [3, 4, 5, 6, 9, 10, 11], why: 'ti.why.istanbul' },
  { key: 'dubai', city: 'Dubai', photo: 'dubai-skyline', saudi: false, months: [11, 12, 1, 2, 3], why: 'ti.why.dubai' },
  { key: 'cairo', city: 'Cairo', photo: 'cairo-pyramids', saudi: false, months: [10, 11, 12, 1, 2, 3], why: 'ti.why.cairo' },
  { key: 'baku', city: 'Baku', photo: 'baku-old-city', saudi: false, months: [5, 6, 7, 8, 9], why: 'ti.why.baku' },
  { key: 'tbilisi', city: 'Tbilisi', photo: 'tbilisi-old-town', saudi: false, months: [5, 6, 7, 8, 9, 10], why: 'ti.why.tbilisi' },
  { key: 'london', city: 'London', photo: 'london-kensington', saudi: false, months: [5, 6, 7, 8, 9], why: 'ti.why.london' },
  { key: 'maldives', city: 'the Maldives', photo: 'maldives-overwater', saudi: false, months: [11, 12, 1, 2, 3, 4], why: 'ti.why.maldives' },
];
const placeOf = (key: string) => IDEA_PLACES.find((p) => p.key === key) ?? null;
const placeByCity = (city: string) => IDEA_PLACES.find((p) => p.city.toLowerCase() === city.trim().toLowerCase() || p.key === city.trim().toLowerCase()) ?? null;
export const HOME_CITY_OF: Record<HomeCode, string> = { RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam' };

/**
 * Typical direct flight times, in minutes, from the published schedules (Saudia, flynas, flyadeal), rounded.
 * A pair that isn't here has no direct flight we'd stand behind, and the tile says no time at all.
 */
const FLY_MIN: Record<HomeCode, Partial<Record<string, number>>> = {
  RUH: { alula: 80, abha: 100, jeddah: 110, istanbul: 255, dubai: 120, cairo: 150, baku: 210, tbilisi: 245, london: 405, maldives: 330 },
  JED: { alula: 75, abha: 80, istanbul: 235, dubai: 160, cairo: 125, london: 400 },
  DMM: { jeddah: 140, dubai: 75, istanbul: 265, cairo: 170 },
};

/** "Flies from Jeddah", "السفر من جدة", "JED": the home airport a remembered fact names, if it names one. */
export function homeFromText(text: string | null | undefined): HomeCode | null {
  const s = (text ?? '').toLowerCase();
  if (/\bruh\b|riyadh|الرياض/.test(s)) return 'RUH';
  if (/\bjed\b|jeddah|jiddah|جدة|جده/.test(s)) return 'JED';
  if (/\bdmm\b|dammam|الدمام|الشرقية|khobar|الخبر/.test(s)) return 'DMM';
  return null;
}

/* ───────── the calendar: Umm al-Qura where the runtime has it, and the fixed public holidays ───────── */

const hijriFmt = (() => { try { return new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { day: 'numeric', month: 'numeric', timeZone: 'UTC' }); } catch { return null; } })();
export function hijriOf(iso: string): { month: number; day: number } | null {
  if (!hijriFmt) return null;
  try {
    const parts = hijriFmt.formatToParts(new Date(`${iso}T12:00:00Z`));
    const get = (k: string) => Number(parts.find((p) => p.type === k)?.value);
    const month = get('month'), day = get('day');
    return Number.isFinite(month) && Number.isFinite(day) ? { month, day } : null;
  } catch { return null; }
}
/** The next day (from `today`, inclusive) that is this Hijri date, within `within` days. */
function nextHijri(today: string, month: number, day: number, within: number): string | null {
  for (let i = 0; i <= within; i += 1) {
    const d = addDays(today, i);
    const h = hijriOf(d);
    if (!h) return null;
    if (h.month === month && h.day === day) return d;
  }
  return null;
}
function nextFixed(today: string, mmdd: string): string {
  const y = Number(today.slice(0, 4));
  const d = `${y}-${mmdd}`;
  return d >= today ? d : `${y + 1}-${mmdd}`;
}

export type Holiday = { id: 'fitr' | 'adha' | 'national' | 'founding'; date: string; days: number };
/** Public holidays in the next `within` days, soonest first. */
export function holidaysAhead(today: string, within = 60): Holiday[] {
  const out: Holiday[] = [];
  const fitr = nextHijri(today, 10, 1, within);
  if (fitr) out.push({ id: 'fitr', date: fitr, days: daysBetween(today, fitr) });
  const adha = nextHijri(today, 12, 10, within);
  if (adha) out.push({ id: 'adha', date: adha, days: daysBetween(today, adha) });
  for (const [id, mmdd] of [['national', '09-23'], ['founding', '02-22']] as const) {
    const d = nextFixed(today, mmdd);
    const n = daysBetween(today, d);
    if (n <= within) out.push({ id, date: d, days: n });
  }
  return out.sort((a, b) => a.days - b.days);
}
/** Ramadan now, or starting within `within` days. */
export function ramadanAhead(today: string, within = 30): { now: boolean; days: number } | null {
  const h = hijriOf(today);
  if (!h) return null;
  if (h.month === 9) return { now: true, days: 0 };
  const start = nextHijri(today, 9, 1, within);
  return start ? { now: false, days: daysBetween(today, start) } : null;
}

/** The coming Saudi weekend: leave Thursday, back Saturday. On a Thursday or Friday, the one after. */
export function nextWeekend(today: string): { from: string; to: string } {
  const dow = new Date(`${today}T12:00:00Z`).getUTCDay(); // 0 Sun … 4 Thu
  const toThu = (4 - dow + 7) % 7 || 7;
  const from = addDays(today, toThu);
  return { from, to: addDays(from, 2) };
}

/* ───────── the inputs and the cards ───────── */

export type IdeaInput = {
  /** The day the app shows (the trip clock's), YYYY-MM-DD. */
  today: string;
  guest: boolean;
  /** Where they fly from: What Mada remembers, else their own searches. Null when nobody said. */
  home: HomeCode | null;
  /** Past trips, newest first. */
  past?: { city: string; startDate: string; endDate: string | null }[];
  upcoming?: { id: string; city: string; country: string | null; startDate: string; endDate: string | null; hasEsim: boolean }[];
  /** Saved places, by city. */
  saved?: { city: string; count: number }[];
  /** Flight searches still in the cache: the destination key, where from, the lowest real fare a person (halalas) and the direct flight time. */
  searches?: { dest: string; from: HomeCode; fromHalalas: number | null; durationMin: number | null; depart: string }[];
  /** The latest message a real member wrote in one of their circles. */
  circle?: { circleId: string; circleName: string; person: string; dest: string | null; at: string } | null;
  /** More than one person in the household. */
  family?: boolean;
};

type Go =
  | { to: 'ask'; ask: CopyKey; vars: Record<string, string | number>; place?: string }
  | { to: 'umrah' } | { to: 'esim'; tripId: string } | { to: 'circle'; id: string } | { to: 'circles' } | { to: 'household' } | { to: 'saved' };

export type IdeaCard = {
  kind: IdeaKind;
  /** Stable across days for the same idea, for rotation and "not yesterday's". */
  id: string;
  score: number;
  /** A DESTINATIONS / IDEA_PLACES key, or a city name, when the card is about a place. */
  place: string | null;
  /** A photo key, when the card can carry one. */
  photo: string | null;
  title: CopyKey;
  body: CopyKey;
  vars: Record<string, string | number>;
  /** Direct flight time from home, minutes. Never without a known home. */
  durationMin: number | null;
  /** A real cached fare a person, in halalas. */
  fromHalalas: number | null;
  /** A real member's name. */
  person: string | null;
  go: Go;
};

const PHOTO_KINDS: readonly IdeaKind[] = ['idea', 'weekend', 'event', 'fare', 'umrah'];

/** A small, stable hash: the same id on the same day lands in the same place. */
function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0) / 4294967295;
}

/** Where they just were (ended within 90 days): never suggested again today. */
function justVisited(input: IdeaInput): string | null {
  const p = input.past?.[0];
  if (!p) return null;
  const end = p.endDate ?? p.startDate;
  return daysBetween(end, input.today) <= 90 ? p.city.toLowerCase() : null;
}

/** Every true card for today, scored, before rotation. */
export function candidates(input: IdeaInput): IdeaCard[] {
  const { today, home } = input;
  const month = Number(today.slice(5, 7));
  const away = justVisited(input);
  const homeCity = home ? HOME_CITY_OF[home].toLowerCase() : null;
  // Not home, not where they just were, not where they're already going.
  const going = new Set((input.upcoming ?? []).map((u) => u.city.toLowerCase()));
  const visitedOk = (city: string) => city.toLowerCase() !== away && city.toLowerCase() !== homeCity && !going.has(city.toLowerCase());
  const holidays = holidaysAhead(today, 60);
  const ramadan = ramadanAhead(today, 30);
  const signedIn = !input.guest;
  const searches = signedIn ? input.searches ?? [] : [];
  const saved = signedIn ? input.saved ?? [] : [];
  const flyMin = (key: string): number | null => {
    if (!home) return null;
    const s = searches.find((x) => x.dest === key && x.from === home && x.durationMin);
    return s?.durationMin ?? FLY_MIN[home][key] ?? null;
  };
  const out: IdeaCard[] = [];
  const card = (c: Omit<IdeaCard, 'durationMin' | 'fromHalalas' | 'person' | 'photo' | 'place'> & Partial<IdeaCard>) => out.push({ durationMin: null, fromHalalas: null, person: null, photo: null, place: null, ...c });

  // Destination ideas: in season, and somewhere new to them right now.
  for (const p of IDEA_PLACES) {
    if (!p.months.includes(month) || !visitedOk(p.city)) continue;
    let score = 3 + (p.months.indexOf(month) > 0 && p.months.indexOf(month) < p.months.length - 1 ? 0.5 : 0);
    if (saved.some((s) => s.city.toLowerCase() === p.city.toLowerCase())) score += 2;
    if (searches.some((s) => s.dest === p.key)) score += 2;
    if ((input.past ?? []).slice(1).some((x) => x.city.toLowerCase() === p.city.toLowerCase())) score += 1;
    const d = flyMin(p.key);
    const go = nextWeekend(addDays(today, 21)).from;
    card({ kind: 'idea', id: `idea:${p.key}`, score, place: p.key, photo: p.photo, title: `ti.place.${p.key}` as CopyKey, body: p.why, vars: {}, durationMin: d, go: { to: 'ask', ask: 'ti.ask.idea', vars: { from: go, to: addDays(go, p.saudi ? 2 : 5) }, place: p.key } });
  }

  // A Saudi weekend, or a long one around a public holiday.
  const soon = holidays.find((h) => h.days >= 2 && h.days <= 21);
  const wk = soon ? { from: addDays(soon.date, -1), to: addDays(soon.date, soon.id === 'fitr' || soon.id === 'adha' ? 3 : 1) } : nextWeekend(today);
  for (const p of IDEA_PLACES.filter((x) => x.saudi && x.months.includes(month) && visitedOk(x.city))) {
    const d = flyMin(p.key);
    if (home && d && d > 180) continue;
    card({
      kind: 'weekend', id: `weekend:${p.key}`, score: 3.5 + (soon ? 2.5 : 0) + (d ? 0.5 : 0), place: p.key, photo: p.photo,
      title: soon ? (`ti.weekend.${soon.id}` as CopyKey) : 'ti.weekend.title', body: 'ti.weekend.body', vars: { from: wk.from, to: wk.to },
      durationMin: d, go: { to: 'ask', ask: 'ti.ask.weekend', vars: { from: wk.from, to: wk.to }, place: p.key },
    });
  }

  // Events and seasons, only with dates we know.
  for (const h of holidays) {
    if (h.days < 2 || h.days > (h.id === 'fitr' || h.id === 'adha' ? 60 : 30)) continue;
    card({
      kind: 'event', id: `event:${h.id}`, score: 4 + (h.days <= 21 ? 2 : 0), photo: h.id === 'national' || h.id === 'founding' ? 'riyadh-kingdom-centre' : 'family-walking',
      title: `ti.event.${h.id}` as CopyKey, body: h.days <= 13 ? 'ti.event.inDays' : 'ti.event.inWeeks', vars: { count: h.days <= 13 ? h.days : Math.round(h.days / 7), date: h.date },
      go: { to: 'ask', ask: h.id === 'fitr' || h.id === 'adha' ? 'ti.ask.eid' : 'ti.ask.holiday', vars: { from: addDays(h.date, -1), to: addDays(h.date, 2) } },
    });
  }
  // Riyadh Season runs through the winter; no dates claimed beyond that.
  if ([10, 11, 12, 1, 2].includes(month) && away !== 'riyadh') {
    card({ kind: 'event', id: 'event:season', score: 3.5, photo: 'riyadh-night', place: 'riyadh', title: 'ti.event.season', body: home === 'RUH' ? 'ti.event.seasonHome' : 'ti.event.seasonBody', vars: {}, go: { to: 'ask', ask: home === 'RUH' ? 'ti.ask.seasonHome' : 'ti.ask.season', vars: {} } });
  }

  // Umrah: always an option; at its most relevant in and before Ramadan, and in the cool months.
  if (signedIn || ramadan) {
    card({ kind: 'umrah', id: 'umrah', score: 2 + (ramadan ? (ramadan.now ? 5 : 4) : 0) + ([11, 12, 1, 2].includes(month) ? 0.5 : 0), photo: 'makkah-clock-tower', place: 'makkah', title: 'ti.umrah.title', body: ramadan?.now ? 'ti.umrah.ramadanNow' : ramadan ? (ramadan.days <= 1 ? 'ti.umrah.ramadanTomorrow' : 'ti.umrah.ramadanSoon') : 'ti.umrah.body', vars: { count: ramadan?.days ?? 0 }, go: { to: 'umrah' } });
  }

  if (!signedIn) return out;

  // A fare from their own search, still cached: the only place a price comes from.
  for (const s of searches) {
    const p = placeOf(s.dest);
    if (!p || s.fromHalalas === null || !visitedOk(p.city)) continue;
    card({ kind: 'fare', id: `fare:${s.dest}`, score: 5, place: s.dest, photo: p.photo, title: `ti.place.${s.dest}` as CopyKey, body: 'ti.fare.body', vars: { price: s.fromHalalas }, fromHalalas: s.fromHalalas, durationMin: s.from === home ? s.durationMin : null, go: { to: 'ask', ask: 'ti.ask.fare', vars: { from: s.depart, to: s.depart }, place: s.dest } });
  }

  // An international trip coming up with no eSIM yet.
  for (const u of input.upcoming ?? []) {
    const days = daysBetween(today, u.startDate);
    const intl = !!u.country && !/^(saudi arabia|sa|ksa)$/i.test(u.country);
    if (!intl || u.hasEsim || days < 0 || days > 45) continue;
    card({ kind: 'esim', id: `esim:${u.id}`, score: 6 + (days <= 14 ? 2 : 0), place: u.city, title: 'ti.esim.title', body: 'ti.esim.body', vars: { city: u.city }, go: { to: 'esim', tripId: u.id } });
  }

  // Someone in a circle said something this week; else the circle or family prompt.
  const c = input.circle;
  if (c && daysBetween(c.at.slice(0, 10), today) <= 7) {
    card({ kind: 'circle', id: `circle:${c.circleId}`, score: 4.5, person: c.person, place: c.dest, title: 'ti.circle.title', body: c.dest ? 'ti.circle.bodyDest' : 'ti.circle.body', vars: { name: c.person, circle: c.circleName, dest: c.dest ?? '' }, go: { to: 'circle', id: c.circleId } });
  } else {
    card({ kind: 'family', id: input.family ? 'family:circle' : 'family:add', score: 2.5, title: input.family ? 'td.tile.circle' : 'today.tile.family.title', body: input.family ? 'td.tile.circleBody' : 'today.tile.family.body', vars: {}, go: input.family ? { to: 'circles' } : { to: 'household' } });
  }

  // Places they saved: the city with the most, unless they've just been.
  const top = [...saved].filter((s) => s.count > 0 && visitedOk(s.city)).sort((a, b) => b.count - a.count)[0];
  if (top) card({ kind: 'saved', id: `saved:${top.city.toLowerCase()}`, score: 4 + Math.min(top.count, 5) * 0.2, place: placeByCity(top.city)?.key ?? top.city, title: top.count === 1 ? 'ti.saved.single' : 'ti.saved.many', body: 'ti.saved.body', vars: { count: top.count, city: top.city }, go: { to: 'saved' } });

  return out;
}

const EPOCH = '2026-01-01';
const isHero = (c: IdeaCard) => PHOTO_KINDS.includes(c.kind) && !!c.photo;

/**
 * The hero: the strongest few photo cards take turns, one a day (the day's number picks which), so a strong signal
 * leads often but never two days running. Exact without any history: yesterday's turn is worked out the same way.
 */
function heroRing(all: IdeaCard[]): IdeaCard[] {
  return all.filter(isHero).map((c) => ({ c, s: c.score + hash(c.id) * 1.5 })).sort((a, b) => b.s - a.s || a.c.id.localeCompare(b.c.id)).slice(0, 3).map((x) => x.c);
}
function heroOn(all: IdeaCard[], day: string): IdeaCard | null {
  const ring = heroRing(all);
  return ring.length ? ring[((daysBetween(EPOCH, day) % ring.length) + ring.length) % ring.length]! : null;
}

/** Two smaller tiles: of a different kind from the hero and from each other when there are enough kinds. */
function smalls(all: IdeaCard[], hero: IdeaCard | null, day: string, avoid: readonly string[]): IdeaCard[] {
  const ranked = all
    .filter((c) => c.id !== hero?.id)
    .map((c) => ({ ...c, score: c.score + hash(`${day}|${c.id}`) * 3 - (avoid.includes(c.id) ? 2.5 : 0) }))
    .sort((a, b) => b.score - a.score || a.id.localeCompare(b.id));
  const picked: IdeaCard[] = hero ? [hero] : [];
  const samePlace = (a: IdeaCard, b: IdeaCard) => !!a.place && a.place === b.place;
  for (const c of ranked) {
    if (picked.length === 3) break;
    if (picked.some((p) => p.kind === c.kind || samePlace(p, c))) continue;
    picked.push(c);
  }
  // Not enough kinds (a guest in a quiet month): a second card of a kind already shown, for another place.
  for (const c of ranked) {
    if (picked.length === 3) break;
    if (picked.some((p) => p.id === c.id || samePlace(p, c))) continue;
    picked.push(c);
  }
  return hero ? picked.slice(1) : picked;
}

/**
 * Today's three: every true card scored by season, holidays, home, their own signals and circle activity; the hero
 * turns daily among the strongest photo cards (never yesterday's), and the two smaller tiles follow a daily seed
 * (the same all day, different tomorrow) with yesterday's pushed back.
 */
export function pickIdeas(input: IdeaInput): IdeaCard[] {
  const all = candidates(input);
  const y = addDays(input.today, -1);
  const yAll = candidates({ ...input, today: y });
  const yHero = heroOn(yAll, y);
  let hero = heroOn(all, input.today);
  if (hero && yHero && hero.id === yHero.id) {
    // The ring changed overnight (a holiday came into view) and landed on the same card: take the next one.
    const ring = heroRing(all);
    hero = ring.find((c) => c.id !== yHero.id) ?? all.find((c) => isHero(c) && c.id !== yHero.id) ?? hero;
  }
  const before = [yHero?.id, ...smalls(yAll, yHero, y, []).map((c) => c.id)].filter((x): x is string => !!x);
  return [...(hero ? [hero] : []), ...smalls(all, hero, input.today, before)];
}
