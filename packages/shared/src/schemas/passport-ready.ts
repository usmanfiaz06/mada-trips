import type { Person } from './people';

/*
 * Is a traveller's passport ready for this booking? (The in-booking passport step: pay, visa, Umrah, flight requests.)
 *
 *   missing   no passport on file: "Add passport"
 *   expiring  on file, but expired, or under six months left on the day they come home: "Needs a look", with why
 *   ready     on file and good for the trip: a check mark
 *
 * Six months after the return is what most airlines and visa offices ask; with no return date known, it counts from
 * the day the check runs. Days are calendar days (ISO yyyy-mm-dd), so a time zone never moves one.
 */

export const PASSPORT_MONTHS_NEEDED = 6;

export type PassportReady =
  | { state: 'missing' }
  | { state: 'expiring'; reason: 'expired' | 'short'; expiry: string; /** The day it must still be valid on. */ needUntil: string }
  | { state: 'ready'; expiry: string };

/** "2026-12-31" + 6 months → "2027-06-30" (the last day of a shorter month when the day doesn't exist). */
export function addMonthsIso(iso: string, months: number): string {
  const y = Number(iso.slice(0, 4));
  const m = Number(iso.slice(5, 7)) - 1 + months;
  const d = Number(iso.slice(8, 10));
  const ty = y + Math.floor(m / 12);
  const tm = ((m % 12) + 12) % 12;
  const last = new Date(Date.UTC(ty, tm + 1, 0)).getUTCDate();
  return new Date(Date.UTC(ty, tm, Math.min(d, last))).toISOString().slice(0, 10);
}

export function passportReady(
  person: Pick<Person, 'passport'> | null | undefined,
  opts: { today: string; travelEnds?: string | null; months?: number },
): PassportReady {
  const expiry = person?.passport?.expiry;
  if (!expiry) return { state: 'missing' };
  const from = opts.travelEnds && opts.travelEnds > opts.today ? opts.travelEnds.slice(0, 10) : opts.today;
  const needUntil = addMonthsIso(from, opts.months ?? PASSPORT_MONTHS_NEEDED);
  if (expiry < opts.today) return { state: 'expiring', reason: 'expired', expiry, needUntil };
  if (expiry < needUntil) return { state: 'expiring', reason: 'short', expiry, needUntil };
  return { state: 'ready', expiry };
}

/** Which bookings ask for passports: flights, packages, visas and Umrah. A stay, a car or an eSIM doesn't. */
export const PASSPORT_KINDS = ['trip', 'package', 'flight', 'visa', 'umrah'] as const;
export const needsPassports = (kind: string | null | undefined) => (PASSPORT_KINDS as readonly string[]).includes(kind ?? '');

/*
 * The passport copy (a photo or PDF of the photo page), kept encrypted with the person's documents as kind "passport".
 * Its fields are what the traveller confirmed, minus the number: the full number only ever lives encrypted on the
 * person. One copy per person; a new one replaces the old.
 */
export const PASSPORT_COPY_KEYS = ['name', 'nationality', 'issuer', 'sex', 'dob', 'issued', 'expiry'] as const;
export type PassportCopyKey = (typeof PASSPORT_COPY_KEYS)[number];

/** Keep only the allowed keys, short and plain: a "number" key (or any other) never gets stored with the copy. */
export function passportCopyFields(fields: Record<string, string | null | undefined>): Record<PassportCopyKey, string> {
  const out = {} as Record<PassportCopyKey, string>;
  for (const k of PASSPORT_COPY_KEYS) {
    const v = (fields[k] ?? '').toString().trim().slice(0, 120);
    if (v) out[k] = v;
  }
  return out;
}
