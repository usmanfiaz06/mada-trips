import type { OpeningPeriod } from "./types";

/*
 * Open now, worked out from the weekly hours and the place's UTC offset at the moment a card is made (a cached
 * "open now" would be wrong an hour later). Google's periods start on Sunday (day 0); a period without a close is
 * open around the clock; a close on an earlier day than its open wraps past Saturday night.
 */

const WEEK = 7 * 1440;
const at = (p: { day: number; hour: number; minute: number }) => p.day * 1440 + p.hour * 60 + p.minute;
const hhmm = (m: number) => `${String(Math.floor((m % 1440) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

/** The place's local minute of the week (0 = Sunday 00:00). */
export function localMinute(now: Date, utcOffsetMinutes: number): { minute: number; day: number } {
  const local = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const day = local.getUTCDay();
  return { minute: day * 1440 + local.getUTCHours() * 60 + local.getUTCMinutes(), day };
}

/**
 * Open right now, and when it closes ("23:00") or next opens within a day ("09:00"). Null when there are no hours or
 * no offset to read them by.
 */
export function openState(periods: OpeningPeriod[] | null | undefined, utcOffsetMinutes: number | null | undefined, now = new Date()): { now: boolean; closes: string | null; opens: string | null } | null {
  if (!periods?.length || utcOffsetMinutes == null) return null;
  const { minute } = localMinute(now, utcOffsetMinutes);
  if (periods.some((p) => !p.close)) return { now: true, closes: null, opens: null };
  let opensIn: number | null = null;
  for (const p of periods) {
    const o = at(p.open);
    let c = at(p.close!);
    if (c <= o) c += WEEK;
    for (const m of [minute, minute + WEEK]) {
      if (m >= o && m < c) return { now: true, closes: hhmm(c % WEEK), opens: null };
    }
    const wait = (o - minute + WEEK) % WEEK;
    if (opensIn === null || wait < opensIn) opensIn = wait;
  }
  return { now: false, closes: null, opens: opensIn !== null && opensIn <= 1440 ? hhmm((minute + opensIn) % WEEK) : null };
}

/** Today's line from Google's week (Monday first), without the day's name: "9:00 AM – 11:00 PM". */
export function todayHours(week: string[] | null | undefined, utcOffsetMinutes: number | null | undefined, now = new Date()): string | null {
  if (!week?.length || week.length !== 7 || utcOffsetMinutes == null) return null;
  const { day } = localMinute(now, utcOffsetMinutes);
  const line = week[(day + 6) % 7] ?? null;
  return line ? line.replace(/^[^:]+:\s*/, "").trim() || null : null;
}
