/**
 * Dates and times. Two kinds of value travel in the API:
 *  - Calendar days as ISO strings "2027-03-09". Day maths runs in UTC so a phone's time zone never shifts a day.
 *  - Instants as ISO date-times with an offset or Z. Flight times are local to their airport and carry the
 *    airport's IANA zone next to them, because "Lands 16:40 Istanbul time" is what the traveller needs.
 *
 * The business runs on Riyadh time (Asia/Riyadh, UTC+3, no daylight saving).
 * Display follows COPY.md §4: "Thu 14 Mar", "14–20 Mar", "3h 40m", relative within 2 hours then a clock time.
 */

import { localeOr, localizeDigits, getDisplayPrefs, type Lang } from './locale';

export const TZ = 'Asia/Riyadh';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

/** Gregorian month names as Saudi readers know them (يناير…), and the weekdays. Arabic has no short weekday form. */
export const MONTHS_AR = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر'] as const;
export const WEEKDAYS_AR = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت'] as const;

/** A month's short name (0-based), in the display locale. */
export const monthName = (month0: number, locale?: Lang): string =>
  (localeOr(locale) === 'ar' ? MONTHS_AR : MONTHS)[((month0 % 12) + 12) % 12]!;
/** A weekday's name (0 = Sunday), short in English, in the display locale. */
export const weekdayName = (dow: number, opts: { locale?: Lang; long?: boolean } = {}): string =>
  (localeOr(opts.locale) === 'ar' ? WEEKDAYS_AR : opts.long ? WEEKDAYS_LONG : WEEKDAYS)[((dow % 7) + 7) % 7]!;
const num = (n: number, locale?: Lang) => localizeDigits(String(n), locale);

const ISO_DAY = /^(\d{4})-(\d{2})-(\d{2})$/;

/** A real calendar day in YYYY-MM-DD form (rejects 2027-02-30). */
export function isIsoDay(s: unknown): s is string {
  if (typeof s !== 'string') return false;
  const m = ISO_DAY.exec(s);
  if (!m) return false;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  return d.toISOString().slice(0, 10) === s;
}

function day(iso: string): Date {
  if (!isIsoDay(iso)) throw new RangeError(`Not an ISO day: ${iso}`);
  return new Date(`${iso}T00:00:00Z`);
}

export function isoDay(y: number, month1: number, d: number): string {
  return new Date(Date.UTC(y, month1 - 1, d)).toISOString().slice(0, 10);
}

export function addDays(iso: string, n: number): string {
  const d = day(iso);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** Whole days from a to b (b − a). */
export function daysBetween(a: string, b: string): number {
  return Math.round((day(b).getTime() - day(a).getTime()) / 86_400_000);
}

export const weekdayOf = (iso: string, locale?: Lang) => weekdayName(day(iso).getUTCDay(), { locale });
export const monthOf = (iso: string, locale?: Lang) => monthName(day(iso).getUTCMonth(), locale);
export const dayOfMonth = (iso: string) => day(iso).getUTCDate();
export const yearOf = (iso: string) => day(iso).getUTCFullYear();

/** The parts of an instant in a time zone (Riyadh by default). */
export function zonedParts(at: Date | string | number, tz: string = TZ) {
  const d = at instanceof Date ? at : new Date(at);
  if (Number.isNaN(d.getTime())) throw new RangeError('Invalid date');
  const f = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23',
  });
  const p: Record<string, string> = {};
  for (const x of f.formatToParts(d)) p[x.type] = x.value;
  return { date: `${p.year}-${p.month}-${p.day}`, hour: Number(p.hour), minute: Number(p.minute) };
}

/** Today's date in Riyadh (or another zone). */
export const todayIn = (tz: string = TZ, now: Date = new Date()) => zonedParts(now, tz).date;

/** "HH:MM" of an instant in a zone. COPY.md: times follow the phone's 12/24-hour setting; the app formats, the API sends instants. */
export function clockIn(at: Date | string | number, tz: string = TZ): string {
  const p = zonedParts(at, tz);
  return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
}

/**
 * A clock time for display: "18:30", or "6:30 pm" / "6:30 م" on a 12-hour phone. Arabic-Indic digits when chosen.
 * Accepts an "HH:MM" string or an instant (shown in `tz`, Riyadh by default).
 */
export function timeLabel(at: Date | string | number, opts: { tz?: string; locale?: Lang; hour12?: boolean } = {}): string {
  const hhmm = typeof at === 'string' && /^\d{1,2}:\d{2}$/.test(at) ? at : clockIn(at, opts.tz ?? TZ);
  const l = localeOr(opts.locale);
  const [hs = '0', ms = '00'] = hhmm.split(':');
  const h = Number(hs);
  if (!(opts.hour12 ?? getDisplayPrefs().hour12)) return localizeDigits(`${String(h).padStart(2, '0')}:${ms}`, l);
  const h12 = h % 12 || 12;
  const mark = l === 'ar' ? (h < 12 ? 'ص' : 'م') : h < 12 ? 'am' : 'pm';
  return localizeDigits(`${h12}:${ms} ${mark}`, l);
}

/**
 * The Hijri (Umm al-Qura) date for a calendar day: "15 Ramadan 1448" / "15 رمضان 1448". Null where the
 * runtime's Intl has no islamic-umalqura calendar.
 */
export function hijriDay(iso: string, opts: { locale?: Lang; year?: boolean } = {}): string | null {
  const l = localeOr(opts.locale);
  try {
    const f = new Intl.DateTimeFormat(`${l === 'ar' ? 'ar-SA' : 'en'}-u-ca-islamic-umalqura-nu-latn`, {
      timeZone: 'UTC', day: 'numeric', month: 'long', ...(opts.year === false ? {} : { year: 'numeric' }),
    });
    const parts = f.formatToParts(day(iso));
    const get = (t: string) => parts.find((p) => p.type === t)?.value;
    const month = get('month');
    const d = get('day');
    const y = get('year');
    if (!month || !d || /^\d+$/.test(month)) return null;
    const dd = String(Number(d.replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x)))));
    const yy = y ? String(Number(y.replace(/[^0-9٠-٩]/g, '').replace(/[٠-٩]/g, (x) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(x))))) : '';
    return localizeDigits(`${dd} ${month}${yy && opts.year !== false ? ` ${yy}` : ''}`, l);
  } catch {
    return null;
  }
}

/**
 * "Thu 14 Mar" / "الخميس 14 مارس", with the year only when it isn't this year (COPY.md §4). With the Hijri setting on
 * (or `hijri: true`), the Hijri date follows after a middle dot.
 */
export function dayLabel(iso: string, opts: { today?: string; locale?: Lang; hijri?: boolean } = {}): string {
  const l = localeOr(opts.locale);
  const today = opts.today ?? todayIn();
  const base = `${weekdayOf(iso, l)} ${num(dayOfMonth(iso), l)} ${monthOf(iso, l)}`;
  const g = yearOf(iso) === Number(today.slice(0, 4)) ? base : `${base} ${num(yearOf(iso), l)}`;
  const withHijri = opts.hijri ?? (opts.locale === undefined && getDisplayPrefs().hijri);
  const h = withHijri ? hijriDay(iso, { locale: l, year: false }) : null;
  return h ? `${g} · ${h}` : g;
}

/** "14 Mar" / "14 مارس" */
export const shortDay = (iso: string, locale?: Lang) => `${num(dayOfMonth(iso), locale)} ${monthOf(iso, locale)}`;

/** "14–20 Mar", "28 Feb – 3 Mar" (en dash for ranges, COPY.md §4); "14–20 مارس" in Arabic. */
export function rangeLabel(a: string, b?: string | null, locale?: Lang): string {
  if (!b || b === a) return shortDay(a, locale);
  if (monthOf(a) === monthOf(b) && yearOf(a) === yearOf(b)) return `${num(dayOfMonth(a), locale)}–${num(dayOfMonth(b), locale)} ${monthOf(b, locale)}`;
  return `${shortDay(a, locale)} – ${shortDay(b, locale)}`;
}

/** "3h 40m", "45m", "2h" (COPY.md §4: hours and minutes, no spaces inside); Arabic "3 س 40 د". */
export function durationLabel(minutes: number, locale?: Lang): string {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Duration must be a positive number of minutes');
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (localeOr(locale) === 'ar') {
    const n = (x: number) => num(x, 'ar');
    if (!h) return `${n(r)} د`;
    return r ? `${n(h)} س ${n(r)} د` : `${n(h)} س`;
  }
  if (!h) return `${r}m`;
  return r ? `${h}h ${r}m` : `${h}h`;
}

/** Add minutes to an "HH:MM" clock time, wrapping at midnight. */
export function addMinutes(hhmm: string, mins: number): string {
  const m = /^(\d{1,2}):(\d{2})$/.exec(hhmm);
  if (!m) throw new RangeError(`Not a clock time: ${hhmm}`);
  const t = ((((Number(m[1]) * 60 + Number(m[2]) + mins) % 1440) + 1440) % 1440);
  return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`;
}

/**
 * "Leave in 42 min" within 2 hours, then "Leave at 18:30" (COPY.md §4: relative time within 2 hours, then a clock time).
 * Returns the parts so the caller can put them into a catalogue string.
 */
export function relativeOrClock(target: Date | string | number, now: Date = new Date(), tz: string = TZ):
  { kind: 'in'; minutes: number } | { kind: 'at'; clock: string } | { kind: 'past'; minutes: number } {
  const t = target instanceof Date ? target.getTime() : new Date(target).getTime();
  const diff = Math.round((t - now.getTime()) / 60_000);
  if (diff < 0) return { kind: 'past', minutes: -diff };
  if (diff <= 120) return { kind: 'in', minutes: diff };
  return { kind: 'at', clock: clockIn(t, tz) };
}

/** The UTC instant for a wall-clock time in a zone ("2027-03-09T09:40" in Asia/Riyadh → 06:40Z). */
export function zonedToInstant(localIso: string, tz: string): Date {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(localIso);
  if (!m) throw new RangeError(`Not a local date-time: ${localIso}`);
  const guess = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), Number(m[4]), Number(m[5]));
  // Two passes handle zones whose offset differs either side of the guess (DST).
  let t = guess;
  for (let i = 0; i < 2; i += 1) {
    const p = zonedParts(t, tz);
    const asIfUtc = Date.UTC(Number(p.date.slice(0, 4)), Number(p.date.slice(5, 7)) - 1, Number(p.date.slice(8, 10)), p.hour, p.minute);
    t = guess - (asIfUtc - t);
  }
  return new Date(t);
}

/** The Today header: "Saturday 10 Oct". */
export function headerDay(now: Date = new Date(), tz: string = TZ, locale?: Lang): string {
  const iso = todayIn(tz, now);
  return `${weekdayName(day(iso).getUTCDay(), { locale, long: true })} ${num(dayOfMonth(iso), locale)} ${monthOf(iso, locale)}`;
}

/**
 * The Hijri (Umm al-Qura) day and month, e.g. "Rabiʿ II 29". Falls back to null where the runtime's Intl
 * has no islamic-umalqura calendar, so callers can simply leave it out.
 */
export function hijriLabel(now: Date = new Date(), tz: string = TZ, locale?: Lang): string | null {
  if (localeOr(locale) === 'ar') return hijriDay(todayIn(tz, now), { locale: 'ar', year: false });
  try {
    const f = new Intl.DateTimeFormat('en-u-ca-islamic-umalqura', { timeZone: tz, day: 'numeric', month: 'long' });
    const parts = f.formatToParts(now);
    const month = parts.find((p) => p.type === 'month')?.value;
    const d = parts.find((p) => p.type === 'day')?.value;
    if (!month || !d || /^\d+$/.test(month)) return null;
    return `${month} ${d}`;
  } catch {
    return null;
  }
}

/** Days of passport validity left on a given day (negative when expired). */
export const validityDaysLeft = (expiryIso: string, onIso: string) => daysBetween(onIso, expiryIso);

/** A passport is expired on a day if its expiry is before that day. */
export const isExpiredOn = (expiryIso: string, onIso: string) => daysBetween(onIso, expiryIso) < 0;
