import { MANUAL_SLA_MINUTES, pauseClock, resumeClock, type TicketPriority } from "./sla";

/*
 * The ticket lifecycle (DESK-PLAN.md §4.4). Pure, so the desk, the queue's sync and the tests agree on every move:
 *
 *   new ──take/assign──▶ open ──reply sent──▶ waiting_customer ──customer replies──▶ open
 *                         │  └─needs supplier──▶ waiting_supplier ──answer──▶ open
 *                         └─resolve──▶ resolved ──72h quiet──▶ closed
 *   resolved ──customer writes again / the source needs us again──▶ open (reopened_count + 1)
 *   any but closed ──merge──▶ closed (merged_into_id set)
 *
 * While waiting on the customer or a supplier the SLA clock stands still.
 */

export const TICKET_STATUSES = ["new", "open", "waiting_customer", "waiting_supplier", "resolved", "closed"] as const;
export type TicketStatus = (typeof TICKET_STATUSES)[number];
export type TicketMove =
  | "take" | "assign" | "reply" | "wait_customer" | "wait_supplier" | "customer_replied" | "supplier_answered"
  | "source_live" | "resolve" | "reopen" | "close" | "merge";

export const OPEN_STATUSES: readonly TicketStatus[] = ["new", "open", "waiting_customer", "waiting_supplier"];
export const PAUSED_STATUSES: readonly TicketStatus[] = ["waiting_customer", "waiting_supplier"];
/** How long a resolved ticket stays reopenable before it closes for good. */
export const CLOSE_AFTER_HOURS = 72;

const TABLE: Record<TicketStatus, Partial<Record<TicketMove, TicketStatus>>> = {
  new: { take: "open", assign: "open", reply: "waiting_customer", wait_customer: "waiting_customer", wait_supplier: "waiting_supplier", customer_replied: "new", source_live: "new", resolve: "resolved", merge: "closed" },
  open: { take: "open", assign: "open", reply: "waiting_customer", wait_customer: "waiting_customer", wait_supplier: "waiting_supplier", customer_replied: "open", source_live: "open", resolve: "resolved", merge: "closed" },
  waiting_customer: { take: "waiting_customer", assign: "waiting_customer", reply: "waiting_customer", wait_supplier: "waiting_supplier", customer_replied: "open", source_live: "open", resolve: "resolved", merge: "closed" },
  waiting_supplier: { take: "waiting_supplier", assign: "waiting_supplier", reply: "waiting_supplier", wait_customer: "waiting_customer", supplier_answered: "open", customer_replied: "open", source_live: "open", resolve: "resolved", merge: "closed" },
  resolved: { reopen: "open", customer_replied: "open", source_live: "open", close: "closed", merge: "closed" },
  closed: {},
};

/** Where a move takes a ticket, or null when it can't be made from here. */
export function nextStatus(from: TicketStatus, move: TicketMove): TicketStatus | null {
  return TABLE[from]?.[move] ?? null;
}

export type TicketClock = {
  status: TicketStatus; slaStartedAt: Date; slaMinutes: number; dueAt: Date; pausedAt: Date | null; firstResponseAt: Date | null;
  resolvedAt: Date | null; closedAt: Date | null; reopenedCount: number; escalationLevel: number;
};
export type TicketPatch = Partial<TicketClock>;

/**
 * The change a move makes: the status, the SLA clock (paused, resumed, restarted on a reopen) and the timestamps.
 * Throws when the move isn't allowed from the ticket's status.
 */
export function applyMove(t: TicketClock, move: TicketMove, now: Date): TicketPatch {
  const to = nextStatus(t.status, move);
  if (!to) throw new Error(`A ${t.status.replace("_", " ")} ticket can't ${move.replace("_", " ")}`);
  const patch: TicketPatch = { status: to };
  if (move === "reply" && !t.firstResponseAt) patch.firstResponseAt = now;
  const wasPaused = PAUSED_STATUSES.includes(t.status), paused = PAUSED_STATUSES.includes(to);
  if (to === "resolved" || to === "closed") {
    patch.pausedAt = null;
    if (to === "resolved") patch.resolvedAt = now;
    if (to === "closed") { patch.closedAt = now; if (!t.resolvedAt) patch.resolvedAt = now; }
  } else if (t.status === "resolved") {
    // Reopened: a fresh promise from now, and the old escalation is spent.
    Object.assign(patch, { reopenedCount: t.reopenedCount + 1, resolvedAt: null, pausedAt: null, slaStartedAt: now, dueAt: new Date(now.getTime() + t.slaMinutes * 60_000), escalationLevel: 0 });
  } else if (paused && !wasPaused) {
    patch.pausedAt = pauseClock(t, now).pausedAt;
  } else if (!paused && wasPaused) {
    const c = resumeClock(t, now);
    Object.assign(patch, { pausedAt: c.pausedAt, dueAt: c.dueAt });
  }
  return patch;
}

/** The clock a new ticket starts with. */
export function startClock(now: Date, minutes: number, due?: Date | null) {
  return { slaStartedAt: now, slaMinutes: minutes, dueAt: due ?? new Date(now.getTime() + minutes * 60_000), pausedAt: null };
}
export const manualMinutes = (p: TicketPriority) => MANUAL_SLA_MINUTES[p];

/** T-000123: what people say on the phone and type into search. */
export const ticketRef = (n: number) => `T-${String(n).padStart(6, "0")}`;
export function parseTicketRef(s: string): number | null {
  const m = /^\s*t-?0*(\d{1,9})\s*$/i.exec(s);
  return m ? Number(m[1]) : null;
}
