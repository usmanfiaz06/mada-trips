import { useEffect, useState } from 'react';
import { firstNameOf, localizeDigits, monthName, type Person, type PersonDetails, type TripDetail as Trip } from '@mada/shared';
import { t } from './i18n';

/*
 * What the Wallet works out from the household and the next trip (prototype store.jsx `passportIssue`, Account.jsx
 * `passportStatus`, `ageBand`): whether a passport is valid for the trip, the status pill, the age band.
 * Days are calendar days in UTC, so a phone's time zone never moves one.
 */

const DAY = 86_400_000;
const M = (i: number) => monthName(i);
const N = (n: number | string) => localizeDigits(String(n));
export const toUtc = (iso: string) => Date.parse(`${iso.slice(0, 10)}T00:00:00Z`);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / DAY);
export const addDays = (iso: string, n: number) => new Date(toUtc(iso) + n * DAY).toISOString().slice(0, 10);
export const todayIso = () => new Date().toISOString().slice(0, 10);
/** "22 Jun 2031" */
export const fullDay = (iso: string) => `${N(Number(iso.slice(8, 10)))} ${M(Number(iso.slice(5, 7)) - 1)} ${N(iso.slice(0, 4))}`;
/** "9 Mar" */
export const shortDay = (iso: string) => `${N(Number(iso.slice(8, 10)))} ${M(Number(iso.slice(5, 7)) - 1)}`;
/** "Jun 2031" */
export const monthYear = (iso: string) => `${M(Number(iso.slice(5, 7)) - 1)} ${N(iso.slice(0, 4))}`;
/** "12 Oct", with the year when it isn't this year. */
export function fmtDate(isoOrMs: string | number, withYear = false) {
  const d = new Date(isoOrMs);
  const same = d.getFullYear() === new Date().getFullYear();
  return `${N(d.getDate())} ${M(d.getMonth())}${withYear || !same ? ` ${N(d.getFullYear())}` : ''}`;
}
export const hhmm = (iso: string) => { const d = new Date(iso); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
/** "+966 50 000 4127" */
export const prettyPhone = (e164: string | null | undefined) => {
  const d = (e164 ?? '').replace(/^\+966/, '');
  return d ? `+966 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5)}` : t('account.notAdded');
};

/** Days a passport must still be valid after landing, by destination country. Türkiye asks for 150. */
const NEED_DAYS: Record<string, number> = { 'Türkiye': 150, Turkey: 150 };
export const needDays = (country: string | null | undefined) => NEED_DAYS[country ?? ''] ?? 180;

export type NextTrip = { id: string; city: string; country: string; land: string; travellerIds: string[]; trip: Trip };

/** The next trip that hasn't ended, from the Trips area. */
export function nextTrip(trips: Trip[] | undefined): NextTrip | null {
  const today = todayIso();
  const t0 = (trips ?? []).filter((x) => x.status !== 'cancelled' && (x.endDate ?? x.startDate) >= today).sort((a, b) => a.startDate.localeCompare(b.startDate))[0];
  if (!t0) return null;
  const out = t0.segments.find((s) => s.direction === 'out');
  return { id: t0.id, city: t0.city, country: t0.country ?? '', land: out ? out.arriveLocal.slice(0, 10) : t0.startDate, travellerIds: t0.travellerIds, trip: t0 };
}

export type Validity =
  | { kind: 'none' }
  | { kind: 'expired'; expiry: string }
  | { kind: 'valid'; expiry: string }
  | { kind: 'ready'; trip: NextTrip; need: number; until: string; left: number }
  | { kind: 'spare'; trip: NextTrip; need: number; until: string; left: number }
  | { kind: 'blocked'; trip: NextTrip; need: number; until: string; left: number; expiry: string }
  | { kind: 'notOnTrip'; trip: NextTrip; expiry: string };

/** Is this passport good for the next trip? With no trip, the plain expiry (FLOWS.md §7). */
export function validity(p: Person | undefined, trip: NextTrip | null): Validity {
  const expiry = p?.passport?.expiry;
  if (!p || !expiry) return { kind: 'none' };
  if (expiry < todayIso()) return { kind: 'expired', expiry };
  if (!trip) return { kind: 'valid', expiry };
  if (!trip.travellerIds.includes(p.id)) return { kind: 'notOnTrip', trip, expiry };
  const need = needDays(trip.country);
  const until = addDays(trip.land, need);
  const left = daysBetween(trip.land, expiry);
  if (left < need) return { kind: 'blocked', trip, need, until, left, expiry };
  if (left < need + 30) return { kind: 'spare', trip, need, until, left };
  return { kind: 'ready', trip, need, until, left };
}

export type PassportStatus = { key: 'none' | 'problem' | 'expired' | 'soon' | 'ok'; label: string; tone: 'muted' | 'warn' | 'gold' | 'ok'; text?: string };

/** The household pill: Not scanned, Needs renewing, Expired, Expiring, Scanned. */
export function passportStatus(p: Person | undefined, trip: NextTrip | null): PassportStatus {
  if (!p?.passport) return { key: 'none', label: t('household.status.none'), tone: 'muted' };
  const v = validity(p, trip);
  if (v.kind === 'blocked') return { key: 'problem', label: t('household.status.problem'), tone: 'warn', text: t('wallet.validity.blockedBody', { name: p.firstName || t('household.youPlain'), date: fullDay(v.expiry), country: v.trip.country, need: v.need, until: shortDay(v.until) }) };
  if (v.kind === 'expired') return { key: 'expired', label: t('household.status.expired'), tone: 'warn', text: t('household.status.expiredText', { date: fullDay(v.expiry) }) };
  const left = daysBetween(todayIso(), p.passport.expiry);
  if (left < 365) return { key: 'soon', label: t('household.status.soon'), tone: 'gold', text: t('household.status.soonText', { date: fullDay(p.passport.expiry) }) };
  return { key: 'ok', label: t('household.status.ok'), tone: 'ok' };
}

export type AgeBand = { age: number; short: 'Infant' | 'Child' | 'Teen' | 'Adult'; label: string; note: string | null };
export function ageBand(dob: string | null | undefined): AgeBand | null {
  if (!dob) return null;
  const now = new Date();
  const d = new Date(toUtc(dob));
  let age = now.getUTCFullYear() - d.getUTCFullYear();
  if (now.getUTCMonth() < d.getUTCMonth() || (now.getUTCMonth() === d.getUTCMonth() && now.getUTCDate() < d.getUTCDate())) age -= 1;
  if (age < 2) return { age, short: 'Infant', label: t('household.age.infant'), note: t('household.age.infantNote') };
  if (age < 12) return { age, short: 'Child', label: t('household.age.child', { age }), note: t('household.age.childNote') };
  if (age < 18) return { age, short: 'Teen', label: t('household.age.teen', { age }), note: t('household.age.teenNote') };
  return { age, short: 'Adult', label: t('household.age.adult', { age }), note: null };
}

const REL_DEFAULT: Record<Person['relation'], string> = { self: 'You', spouse: 'Spouse', child: 'Family', parent: 'Parent', family: 'Family', friend: 'Friend', helper: 'Helper', colleague: 'Colleague' };
/** "Spouse", "Daughter", "Helper": the word the person chose, else the booking relation. */
export function relationOf(p: Person, d?: PersonDetails | null): string {
  if (p.isSelf) return t('household.youPlain');
  const label = d?.relationLabel ?? REL_DEFAULT[p.relation];
  return t(`household.relation.${label}` as 'household.relation.Spouse');
}

export const isHelper = (p: Person, d?: PersonDetails | null) => p.relation === 'helper' || d?.relationLabel === 'Helper';

/** The interface name: first name, or "You" for the account holder without one. */
export const nameOf = (p: Person | undefined, selfName = '') => (p?.isSelf ? (selfName || p.firstName || t('household.youPlain')) : p?.firstName || firstNameOf(p?.givenNames ?? ''));
/** "Omar Alharbi" from the passport names. */
export const fullNameOf = (p: Person | undefined) => [p?.givenNames, p?.surname].filter(Boolean).join(' ').toLowerCase().replace(/\b\p{L}/gu, (c) => c.toUpperCase());

/** Reset state when a sheet opens (React's "adjust state when a prop changes", without an effect). */
export function useOnOpen(visible: boolean, reset: () => void) {
  const [was, setWas] = useState(visible);
  if (visible !== was) {
    setWas(visible);
    if (visible) reset();
  }
}

/** Re-run when a value changes (same pattern): keeps a field in step with the server's copy. */
export function useOnChange<V>(value: V, apply: (v: V) => void) {
  const [prev, setPrev] = useState(value);
  if (!Object.is(prev, value)) {
    setPrev(value);
    apply(value);
  }
}

/** Now, as state: stable during render, refreshed every `everyMs`. */
export function useNow(everyMs = 30_000) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), everyMs); return () => clearInterval(id); }, [everyMs]);
  return now;
}
