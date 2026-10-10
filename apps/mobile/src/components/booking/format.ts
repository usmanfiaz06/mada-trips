import { dayLabel, dayOfMonth, monthOf, yearOf } from '@mada/shared';

/* Dates as the prototype says them: "Thu 15 Oct", the year only when it isn't this year ("20 Jun 2027"). */

export const dayName = (iso: string, today: string) => dayLabel(iso, { today });
const yr = (iso: string, today: string) => (yearOf(iso) !== Number(today.slice(0, 4)) ? ` ${yearOf(iso)}` : '');

export function rangeName(a: string, b: string | null | undefined, today: string): string {
  if (!b) return `${dayOfMonth(a)} ${monthOf(a)}${yr(a, today)}`;
  if (monthOf(a) === monthOf(b) && yearOf(a) === yearOf(b)) return `${dayOfMonth(a)}–${dayOfMonth(b)} ${monthOf(b)}${yr(b, today)}`;
  return `${dayOfMonth(a)} ${monthOf(a)}${yearOf(a) !== yearOf(b) ? yr(a, today) : ''} – ${dayOfMonth(b)} ${monthOf(b)}${yr(b, today)}`;
}
