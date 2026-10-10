/**
 * Dates and times. Two kinds of value travel in the API:
 *  - Calendar days as ISO strings "2027-03-09". Day maths runs in UTC so a phone's time zone never shifts a day.
 *  - Instants as ISO date-times with an offset or Z. Flight times are local to their airport and carry the
 *    airport's IANA zone next to them, because "Lands 16:40 Istanbul time" is what the traveller needs.
 *
 * The business runs on Riyadh time (Asia/Riyadh, UTC+3, no daylight saving).
 * Display follows COPY.md §4: "Thu 14 Mar", "14–20 Mar", "3h 40m", relative within 2 hours then a clock time.
 */

export const TZ = 'Asia/Riyadh';

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;
export const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'] as const;
export const WEEKDAYS_LONG = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;

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

export const weekdayOf = (iso: string) => WEEKDAYS[day(iso).getUTCDay()]!;
export const monthOf = (iso: string) => MONTHS[day(iso).getUTCMonth()]!;
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

/** "Thu 14 Mar", with the year only when it isn't this year (COPY.md §4). */
export function dayLabel(iso: string, opts: { today?: string } = {}): string {
  const today = opts.today ?? todayIn();
  const base = `${weekdayOf(iso)} ${dayOfMonth(iso)} ${monthOf(iso)}`;
  return yearOf(iso) === Number(today.slice(0, 4)) ? base : `${base} ${yearOf(iso)}`;
}

/** "14 Mar" */
export const shortDay = (iso: string) => `${dayOfMonth(iso)} ${monthOf(iso)}`;

/** "14–20 Mar", "28 Feb – 3 Mar" (en dash for ranges, COPY.md §4). */
export function rangeLabel(a: string, b?: string | null): string {
  if (!b || b === a) return shortDay(a);
  if (monthOf(a) === monthOf(b) && yearOf(a) === yearOf(b)) return `${dayOfMonth(a)}–${dayOfMonth(b)} ${monthOf(b)}`;
  return `${shortDay(a)} – ${shortDay(b)}`;
}

/** "3h 40m", "45m", "2h" (COPY.md §4: hours and minutes, no spaces inside). */
export function durationLabel(minutes: number): string {
  if (!Number.isFinite(minutes) || minutes < 0) throw new RangeError('Duration must be a positive number of minutes');
  const m = Math.round(minutes);
  const h = Math.floor(m / 60);
  const r = m % 60;
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
export function headerDay(now: Date = new Date(), tz: string = TZ): string {
  const iso = todayIn(tz, now);
  return `${WEEKDAYS_LONG[day(iso).getUTCDay()]} ${dayOfMonth(iso)} ${monthOf(iso)}`;
}

/**
 * The Hijri (Umm al-Qura) day and month, e.g. "Rabiʿ II 29". Falls back to null where the runtime's Intl
 * has no islamic-umalqura calendar, so callers can simply leave it out.
 */
export function hijriLabel(now: Date = new Date(), tz: string = TZ): string | null {
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
