import { useEffect, useState } from 'react';
import { t } from '../i18n';

/*
 * "Updated 12 min ago": how old what's on screen is. Relative within 2 hours, then hours, then a date
 * (COPY.md §4: relative time within 2 hours, then a clock time).
 */

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const pad = (n: number) => String(n).padStart(2, '0');

export function freshnessLabel(updatedAt: number | string | Date | null | undefined, now = Date.now()): string | null {
  if (updatedAt === null || updatedAt === undefined) return null;
  const at = typeof updatedAt === 'number' ? updatedAt : new Date(updatedAt).getTime();
  if (!Number.isFinite(at) || at <= 0) return null;
  const mins = Math.floor(Math.max(0, now - at) / 60_000);
  if (mins < 1) return t('fresh.justNow');
  if (mins < 120) return t('fresh.minutes', { minutes: mins });
  const hours = Math.floor(mins / 60);
  if (hours < 24) return t('fresh.hours', { hours });
  const d = new Date(at);
  return t('fresh.date', { date: `${WEEKDAY[d.getDay()]} ${d.getDate()} ${MONTH[d.getMonth()]}, ${pad(d.getHours())}:${pad(d.getMinutes())}` });
}

/** True when data is older than `maxAgeMs` (default 5 min): show the Stale badge. */
export const isStale = (updatedAt: number | null | undefined, maxAgeMs = 5 * 60_000, now = Date.now()) => !!updatedAt && now - updatedAt > maxAgeMs;

/** The label, kept current (re-renders every 30 s). */
export function useFreshness(updatedAt: number | string | Date | null | undefined): string | null {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(id);
  }, []);
  return freshnessLabel(updatedAt, now);
}
