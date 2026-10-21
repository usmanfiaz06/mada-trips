import type { Plan, PlanItem, TodayPlanCard } from './schemas/plans';

/*
 * Today's cards from a plan (ASK-INTEGRATED.md §1.3, U9), pure so the server (platform lib/app/plans/today.ts) and the
 * app's mock API build the same cards. A time or a distance is never made here: a pickup's time is the booking's, a
 * drive's minutes are what U4 measured (no source or an estimate: no card), "leave by" only when the item has a time.
 */

export const TODAY_NEAR_DAYS = 7;
export const TODAY_PASSPORT_DAYS = 30;

const hm = (local: string | null) => (local && /T\d\d:\d\d/.test(local) ? local.slice(11, 16) : null);
const live = (s: PlanItem['status']) => s !== 'skipped' && s !== 'cancelled';
const booked = (s: PlanItem['status']) => s === 'booked' || s === 'confirmed' || s === 'held';
const placeName = (p: PlanItem['place']) => (p ? p.city || p.name : null);
const timeIn = (at: Date, tz: string | null) => {
  const fmt = (zone: string) => at.toLocaleTimeString('en-GB', { timeZone: zone, hour: '2-digit', minute: '2-digit', hour12: false });
  try { return fmt(tz || 'Asia/Riyadh'); } catch { return fmt('Asia/Riyadh'); }
};

export type TodayPickup = { id: string; at: Date; meetingPoint: string | null };

/** Item cards for one day of the plan (0-based). */
export function todayDayCards(plan: Plan, day: number, when: 'today' | 'tomorrow', pickups: TodayPickup[] = []): TodayPlanCard[] {
  const href = `/trip/${plan.tripId}/plan`;
  const out: TodayPlanCard[] = [];
  const items = plan.items.filter((i) => i.day === day && live(i.status)).sort((a, b) => a.sort - b.sort);
  for (const it of items) {
    if (it.kind === 'leg' && it.mode === 'transfer' && it.booking?.kind === 'pickup') {
      const p = pickups.find((x) => x.id === it.booking!.id);
      if (p) out.push({ kind: 'pickup', when, time: timeIn(p.at, it.tz), place: p.meetingPoint, car: false, href: `/trip/${plan.tripId}` });
    } else if (it.kind === 'car' && booked(it.status)) {
      out.push({ kind: 'pickup', when, time: hm(it.startsAt), place: placeName(it.place), car: true, href });
    } else if (it.kind === 'stay' && booked(it.status)) {
      out.push({ kind: 'checkin', when, hotel: it.booking?.name || it.title, city: placeName(it.place), href });
    } else if (it.kind === 'leg' && it.mode === 'drive' && it.drive?.minutes && !it.drive.estimate && it.drive.source) {
      out.push({ kind: 'drive', when, minutes: it.drive.minutes, to: placeName(it.to) ?? it.title, leaveBy: hm(it.startsAt), href });
    }
  }
  return out;
}

/** What's left before the trip: passports from 30 days out, the rest from 7; a problem before a to-do; at most 3. */
export function todayTodoCards(plan: Plan, startsIn: number, names: Map<string, string> = new Map()): TodayPlanCard[] {
  const href = `/trip/${plan.tripId}/plan`;
  return plan.checks
    .filter((c) => (c.state === 'warn' || c.state === 'todo') && (c.key === 'passports' ? startsIn <= TODAY_PASSPORT_DAYS : startsIn <= TODAY_NEAR_DAYS))
    .sort((a, b) => (a.state === 'warn' ? 0 : 1) - (b.state === 'warn' ? 0 : 1))
    .slice(0, 3)
    .map((c): TodayPlanCard => ({
      kind: 'todo', check: c.key, state: c.state as 'todo' | 'warn', href,
      names: c.who.map((id) => names.get(id)).filter((n): n is string => !!n).slice(0, 6), days: (c.days.length ? c.days : c.nights).slice(0, 14),
    }));
}

/** Every card for `today`: today's and tomorrow's items once the trip is a day away or running, then what's left. */
export function todayCards(plan: Plan, today: string, pickups: TodayPickup[] = [], names: Map<string, string> = new Map()): TodayPlanCard[] {
  const dayMs = 86_400_000;
  const idx = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${plan.startDate}T00:00:00Z`)) / dayMs);
  const cards: TodayPlanCard[] = [];
  if (idx >= 0 && idx < plan.days) cards.push(...todayDayCards(plan, idx, 'today', pickups));
  if (idx + 1 >= 0 && idx + 1 < plan.days) cards.push(...todayDayCards(plan, idx + 1, 'tomorrow', pickups));
  if (idx <= 0) cards.push(...todayTodoCards(plan, -idx, names));
  return cards.slice(0, 8);
}
