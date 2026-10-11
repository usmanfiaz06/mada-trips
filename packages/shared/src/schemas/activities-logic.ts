import type { Activity, ActivityKind, NextPrayer, TodayIdeas, TodayWeather, WeatherMood } from './activities';

/*
 * Things to do, the rules: one copy for the server, the app's mock mode and tests. Pure functions, no network.
 */

/* ───────────── OpenStreetMap tags → what kind of place ───────────── */

export type OsmTags = Record<string, string>;

/** The kind of place an OSM element is, or null when it isn't one we show. */
export function kindOf(tags: OsmTags): ActivityKind | null {
  const tourism = tags.tourism;
  const leisure = tags.leisure;
  if (tourism === 'museum') return 'museum';
  if (tourism === 'gallery') return 'gallery';
  if (tourism === 'viewpoint') return 'viewpoint';
  if (tourism === 'theme_park') return 'theme_park';
  if (tourism === 'zoo') return 'zoo';
  if (tourism === 'aquarium') return 'aquarium';
  if (leisure === 'water_park') return 'water_park';
  if (tags.amenity === 'place_of_worship' && tags.religion === 'muslim') return 'mosque';
  if (tourism === 'attraction') return tags.historic ? 'historic' : 'attraction';
  if (tags.historic && !['memorial', 'wayside_cross', 'wayside_shrine', 'boundary_stone', 'milestone', 'tomb', 'grave'].includes(tags.historic)) return 'historic';
  if (leisure === 'park' || leisure === 'garden') return 'park';
  return null;
}

/*
 * Places that aren't things to do, whatever OSM calls them (LIVE-AUDIT P1-16): aircraft and military hardware on
 * display (an exhibit inside a museum is mapped on its own: "F-15", "C-130"), military and government sites, and
 * palaces that are residences or offices (a royal court), not open to visitors. A museum, or a palace or fort that is
 * a heritage site, stays. Used when a city is loaded from OpenStreetMap and again when it is shown (rows already held).
 */
const HARDWARE = /\b(f-\d{1,2}[a-z]?|c-130|kc-135|boeing\s?7\d7|dc-\d{1,2}|tri-?star|l-1011|lockheed|mig-\d+|fighter\s(jet|aircraft|plane)|jet\sfighter|bomber|warplane|airliner|aircraft|aeroplane|airplane|helicopter|missile|howitzer|artillery)\b/i;
const OFFICIAL = /\b(royal court|ministry|embassy|consulate|government|military|air base|airbase|barracks|national guard|prison)\b/i;
const VISITABLE = /\b(museum|heritage|historic(al)?|fort(ress)?|visitors?|tours?|open to the public|archaeolog\w*|unesco)\b/i;

export function isUnfitThing(t: { name: string; summary?: string | null; tags?: OsmTags }): boolean {
  const name = t.name ?? '';
  if (/\bmuseum\b/i.test(name) || t.tags?.tourism === 'museum') return false;
  const tags = t.tags ?? {};
  if (tags.historic === 'aircraft' || tags.historic === 'tank' || tags.historic === 'cannon' || tags.historic === 'military' || tags.military || tags.landuse === 'military') return true;
  if (tags.office === 'government' || tags.government || tags.building === 'government' || tags.amenity === 'townhall' || tags.diplomatic) return true;
  if (HARDWARE.test(name)) return true;
  const text = `${name} ${t.summary ?? ''}`;
  if (OFFICIAL.test(text) && !VISITABLE.test(text)) return true;
  // A palace is a thing to do only when it is a heritage site or a museum (Murabba Palace), not a residence or a court.
  if (/\bpalace\b/i.test(name) || tags.historic === 'palace' || tags.building === 'palace') {
    if (/\b(residence|royal court|official|seat of|offices?)\b/i.test(t.summary ?? '')) return true;
    return !VISITABLE.test(t.summary ?? '');
  }
  return false;
}

const INDOOR: ReadonlySet<ActivityKind> = new Set(['museum', 'gallery', 'aquarium', 'mosque']);
const FAMILY: ReadonlySet<ActivityKind> = new Set(['zoo', 'aquarium', 'theme_park', 'water_park', 'park']);

export function isIndoor(kind: ActivityKind, tags: OsmTags): boolean {
  if (tags.indoor === 'yes' || (tags.building === 'yes' && kind === 'theme_park')) return true;
  if (tags.indoor === 'no') return false;
  return INDOOR.has(kind);
}

export function isFamily(kind: ActivityKind, tags: OsmTags, name: string): boolean {
  if (FAMILY.has(kind)) return true;
  if (tags.museum === 'children' || tags.museum === 'science' || tags['museum:type'] === 'science') return true;
  return /\b(children|kids|science|discovery|planetarium|toy)\b/i.test(name);
}

/* ───────────── opening_hours (the common subset) ───────────── */

const DAYS = ['Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa', 'Su'] as const;
const dayIndex = (d: string) => DAYS.indexOf(d as (typeof DAYS)[number]);
const toMin = (hhmm: string) => { const m = /^(\d{1,2}):(\d\d)$/.exec(hhmm); return m ? Number(m[1]) * 60 + Number(m[2]) : NaN; };

function daySet(spec: string): Set<number> | null {
  const out = new Set<number>();
  for (const part of spec.split(',')) {
    const r = /^([A-Z][a-z])(?:-([A-Z][a-z]))?$/.exec(part.trim());
    if (!r) return null;
    const a = dayIndex(r[1]!);
    const b = r[2] ? dayIndex(r[2]) : a;
    if (a < 0 || b < 0) return null;
    for (let i = a; ; i = (i + 1) % 7) { out.add(i); if (i === b) break; }
  }
  return out;
}

type Span = [number, number];
function spans(spec: string): Span[] | null {
  const out: Span[] = [];
  for (const part of spec.split(',')) {
    const r = /^(\d{1,2}:\d\d)-(\d{1,2}:\d\d)\+?$/.exec(part.trim());
    if (!r) return null;
    const a = toMin(r[1]!);
    let b = toMin(r[2]!);
    if (Number.isNaN(a) || Number.isNaN(b)) return null;
    if (b <= a) b += 24 * 60;
    out.push([a, b]);
  }
  return out;
}

/** Each weekday's opening spans (Monday 0), or null when the string is beyond the subset we read. */
export function parseHours(raw: string | null | undefined): Span[][] | null {
  if (!raw) return null;
  const text = raw.trim();
  if (text === '24/7') return Array.from({ length: 7 }, () => [[0, 24 * 60] as Span]);
  const week: (Span[] | null)[] = Array.from({ length: 7 }, () => null);
  for (const ruleRaw of text.split(';')) {
    const rule = ruleRaw.trim();
    if (!rule) continue;
    // Public holidays and month/date ranges: too fine for us, and never a reason to guess.
    if (/\bPH\b|\bSH\b|\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\b|"|\bweek\b|sunrise|sunset/.test(rule)) {
      if (/^PH\b/.test(rule)) continue;
      return null;
    }
    const m = /^((?:[A-Z][a-z](?:-[A-Z][a-z])?)(?:,[A-Z][a-z](?:-[A-Z][a-z])?)*)?\s*(.*)$/.exec(rule);
    if (!m) return null;
    const days = m[1] ? daySet(m[1]) : new Set([0, 1, 2, 3, 4, 5, 6]);
    if (!days) return null;
    const rest = m[2]!.trim();
    const s = !rest ? null : /^(off|closed)$/i.test(rest) ? [] : spans(rest);
    if (s === null) return null;
    days.forEach((d) => { week[d] = s; });
  }
  return week.map((d) => d ?? []);
}

/** The city's weekday (Monday 0) and minutes since midnight, now. */
export function localClock(tz: string, at: Date = new Date()): { weekday: number; minutes: number; day: string; hhmm: string } {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', weekday: 'short', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })
    .formatToParts(at).map((x) => [x.type, x.value]));
  const weekday = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'].indexOf(p.weekday!);
  const hour = Number(p.hour) % 24;
  return { weekday, minutes: hour * 60 + Number(p.minute), day: `${p.year}-${p.month}-${p.day}`, hhmm: `${String(hour).padStart(2, '0')}:${p.minute}` };
}

const hhmmOf = (min: number) => `${String(Math.floor((min % 1440) / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;

/** Open now, and until when, from OSM hours. Spans past midnight count for the next morning too. */
export function openState(raw: string | null | undefined, clock: { weekday: number; minutes: number }): { open: boolean | null; closesAt: string | null } {
  const week = parseHours(raw);
  if (!week) return { open: null, closesAt: null };
  for (const [a, b] of week[clock.weekday]!) if (clock.minutes >= a && clock.minutes < b) return { open: true, closesAt: a === 0 && b === 24 * 60 ? null : hhmmOf(b) };
  const yesterday = week[(clock.weekday + 6) % 7]!;
  for (const [, b] of yesterday) if (b > 24 * 60 && clock.minutes < b - 24 * 60) return { open: true, closesAt: hhmmOf(b - 24 * 60) };
  return { open: false, closesAt: null };
}

/* ───────────── distance and ranking ───────────── */

export function kmBetween(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const r = Math.PI / 180;
  const a = Math.sin(((lat2 - lat1) * r) / 2) ** 2 + Math.cos(lat1 * r) * Math.cos(lat2 * r) * Math.sin(((lon2 - lon1) * r) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(a)));
}

const KIND_BOOST: Partial<Record<ActivityKind, number>> = { museum: 4, historic: 3, attraction: 3, viewpoint: 2, theme_park: 3, zoo: 3, aquarium: 3, mosque: 2, park: 0 };

/** A raw score from open signals: how often people read about it, how many Wikipedias have it, a photo. */
export function rawScore(s: { pageviews: number; sitelinks: number; hasImage: boolean; hasWikidata: boolean; kind: ActivityKind }): number {
  return Math.log10(s.pageviews + 1) * 18 + Math.min(s.sitelinks, 80) * 0.6 + (s.hasImage ? 6 : 0) + (s.hasWikidata ? 6 : 0) + (KIND_BOOST[s.kind] ?? 0);
}

/** Scores to 0–100 within one city (the best is 100). */
export function popularityOf(scores: number[]): number[] {
  const top = Math.max(1, ...scores);
  return scores.map((s) => Math.max(0, Math.min(100, Math.round((s / top) * 100))));
}

/* ───────────── weather (Open-Meteo, WMO codes) ───────────── */

const RAIN_CODES = new Set([51, 53, 55, 56, 57, 61, 63, 65, 66, 67, 80, 81, 82, 95, 96, 99]);
export function moodOf(w: { tempC: number; maxC: number; rainChance: number; code: number }): WeatherMood {
  if (RAIN_CODES.has(w.code) || w.rainChance >= 60) return 'rain';
  if (w.maxC >= 38 || w.tempC >= 36) return 'hot';
  if (w.maxC <= 8) return 'cold';
  return 'fine';
}

/* ───────────── prayer times (Umm al-Qura: Fajr 18.5°, Isha 90 min after Maghrib) ───────────── */

/** Minutes past local midnight for each prayer, for a day at a place. `offsetMin` is the city's UTC offset. */
export function prayerTimes(day: string, lat: number, lon: number, offsetMin: number): Record<NextPrayer['name'], number> | null {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number];
  const jd = Date.UTC(y, m - 1, d, 12) / 86_400_000 + 2440587.5;
  const n = jd - 2451545.0;
  const rad = Math.PI / 180;
  const L = (280.46 + 0.9856474 * n) % 360;
  const g = ((357.528 + 0.9856003 * n) % 360) * rad;
  const lambda = (L + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * rad;
  const eps = (23.439 - 0.0000004 * n) * rad;
  const decl = Math.asin(Math.sin(eps) * Math.sin(lambda));
  const ra = Math.atan2(Math.cos(eps) * Math.sin(lambda), Math.cos(lambda)) / rad / 15;
  const eqt = L / 15 - ((ra + 24) % 24);
  const noon = 12 + offsetMin / 60 - lon / 15 - (((eqt + 12) % 24) - 12);
  const phi = lat * rad;
  const hourAngle = (angle: number) => {
    const c = (Math.sin(angle * rad) - Math.sin(phi) * Math.sin(decl)) / (Math.cos(phi) * Math.cos(decl));
    return c < -1 || c > 1 ? null : Math.acos(c) / rad / 15;
  };
  const sunset = hourAngle(-0.833);
  const fajr = hourAngle(-18.5);
  const asrAlt = Math.atan(1 / (1 + Math.tan(Math.abs(phi - decl)))) / rad;
  const asr = hourAngle(asrAlt);
  if (sunset === null || fajr === null || asr === null) return null;
  const min = (h: number) => Math.round(h * 60);
  const maghrib = min(noon + sunset);
  return { fajr: min(noon - fajr), dhuhr: min(noon) + 2, asr: min(noon + asr), maghrib, isha: maghrib + 90 };
}

/** The city's offset from UTC in minutes, now. */
export function utcOffsetMin(tz: string, at: Date = new Date()): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour! % 24, +p.minute!) - Math.floor(at.getTime() / 60_000) * 60_000) / 60_000);
  } catch { return 0; }
}

/** The next prayer today, if any is left. */
export function nextPrayer(day: string, minutes: number, lat: number, lon: number, offsetMin: number): NextPrayer | null {
  const t = prayerTimes(day, lat, lon, offsetMin);
  if (!t) return null;
  for (const name of ['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'] as const) if (t[name] > minutes) return { name, at: hhmmOf(t[name]) };
  return null;
}

/* ───────────── "Today": a few ideas that suit the weather, the hour and who's along ───────────── */

/** Muslim-majority countries where shops and sites can pause for prayer: a gentle note there. */
export const PRAYER_PAUSE_COUNTRIES: ReadonlySet<string> = new Set(['SA']);

export function todayIdeas(acts: readonly Activity[], o: { day: string; minutes: number; weather: TodayWeather | null; family: boolean; prayer: NextPrayer | null }): TodayIdeas | null {
  if (!acts.length) return null;
  const evening = o.minutes >= 17 * 60;
  const why: TodayIdeas['why'] = o.weather?.mood === 'hot' ? 'hot' : o.weather?.mood === 'rain' ? 'rain' : o.weather?.mood === 'cold' ? 'cold' : evening ? 'evening' : o.family ? 'family' : 'open';
  const fits = (a: Activity) => {
    if (a.openNow === false) return false;
    if (o.weather?.indoorFirst && !a.indoor) return false;
    // After dark: viewpoints, the old town and mosques; not parks and zoos.
    if (evening && !o.weather?.indoorFirst && ['zoo', 'park', 'water_park'].includes(a.kind)) return false;
    if (o.family && !a.family && a.kind !== 'museum') return false;
    return true;
  };
  const rank = (a: Activity) => a.popularity + (a.openNow ? 15 : 0) + (a.distanceKm !== null ? Math.max(0, 12 - a.distanceKm * 2) : 0) + (evening && a.kind === 'viewpoint' ? 10 : 0);
  const picked = acts.filter(fits).sort((a, b) => rank(b) - rank(a)).slice(0, 4);
  if (!picked.length) return null;
  return { day: o.day, ids: picked.map((a) => a.id), why, prayer: o.prayer };
}

/** Filters the list the way the chips ask. Ages under 4 keep out thrill parks. */
export function filterActivities(acts: readonly Activity[], f: { open?: boolean; family?: boolean; ages?: number[]; kind?: 'all' | 'see' | 'indoor' | 'outdoor' }): Activity[] {
  const youngest = f.ages?.length ? Math.min(...f.ages) : null;
  return acts.filter((a) => {
    if (f.open && a.openNow !== true) return false;
    if (f.family && !a.family) return false;
    if (youngest !== null && youngest < 4 && (a.kind === 'theme_park' || a.kind === 'water_park')) return false;
    if (f.kind === 'indoor' && !a.indoor) return false;
    if (f.kind === 'outdoor' && a.indoor) return false;
    if (f.kind === 'see' && !['museum', 'gallery', 'historic', 'attraction', 'viewpoint', 'mosque'].includes(a.kind)) return false;
    return true;
  });
}
