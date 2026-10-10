/*
 * Promised response times for the desk (SCOPE.md D2, "Every request carries a promised response time").
 * Pure functions: the inbox, the presence endpoint and the tests all use the same clock maths.
 */

export const DESK_KINDS = ["order", "ticketing", "chat", "request", "refund", "disruption", "moderation"] as const;
export type DeskKind = (typeof DESK_KINDS)[number];

/** Minutes from when work reaches the desk to when it must be answered. */
export const SLA_MINUTES: Record<DeskKind, number> = {
  order: 4,          // an order is confirmed within 4 minutes (the app shows "Confirmed by Faisal · 4 min")
  ticketing: 15,     // held seats are issued, or the card hold released, within 15 minutes
  chat: 10,          // first reply within 10 minutes, any hour (COPY.md: "replies within 10 minutes, any hour")
  request: 120,      // a quote within 2 hours unless the request promised a time
  refund: 24 * 60,   // a decision on a refund within a day
  disruption: 10,    // travellers on a disrupted flight hear the plan within 10 minutes
  moderation: 24 * 60,
};

export type SlaState = "ok" | "soon" | "breached" | "met";
export type Sla = { target: number; openedAt: Date; dueAt: Date; state: SlaState; minutesLeft: number; answeredAt: Date | null };

/**
 * Where a piece of work stands against its promise. `due` overrides the default target (a request's promisedBy).
 * "soon" is the last quarter of the window (at least the final minute), so short promises still warn in time.
 */
export function slaFor(kind: DeskKind, openedAt: Date, now: Date = new Date(), opts: { due?: Date | null; answeredAt?: Date | null; targetMinutes?: number } = {}): Sla {
  const target = opts.targetMinutes ?? SLA_MINUTES[kind];
  const dueAt = opts.due ?? new Date(openedAt.getTime() + target * 60_000);
  const window = Math.max(60_000, dueAt.getTime() - openedAt.getTime());
  const answeredAt = opts.answeredAt ?? null;
  if (answeredAt) {
    return { target, openedAt, dueAt, answeredAt, minutesLeft: Math.round((dueAt.getTime() - answeredAt.getTime()) / 60_000), state: answeredAt <= dueAt ? "met" : "breached" };
  }
  const left = dueAt.getTime() - now.getTime();
  const state: SlaState = left < 0 ? "breached" : left <= Math.max(60_000, window / 4) ? "soon" : "ok";
  return { target, openedAt, dueAt, answeredAt, minutesLeft: Math.floor(left / 60_000), state };
}

/** Breached first, then whatever is due soonest. Escalated work floats up within its band. */
export function compareUrgency(a: { sla: Sla; escalated?: boolean }, b: { sla: Sla; escalated?: boolean }) {
  const band = (x: { sla: Sla }) => (x.sla.state === "breached" ? 0 : x.sla.state === "soon" ? 1 : 2);
  return band(a) - band(b) || Number(!!b.escalated) - Number(!!a.escalated) || a.sla.dueAt.getTime() - b.sla.dueAt.getTime();
}

/** Median of first-reply times in minutes, rounded up, between 1 and 10. Null when there are too few to say. */
export function typicalReplyMinutes(samples: number[], min = 5): number | null {
  const xs = samples.filter((x) => Number.isFinite(x) && x >= 0).sort((a, b) => a - b);
  if (xs.length < min) return null;
  const mid = xs.length % 2 ? xs[(xs.length - 1) / 2]! : (xs[xs.length / 2 - 1]! + xs[xs.length / 2]!) / 2;
  return Math.min(10, Math.max(1, Math.ceil(mid)));
}
