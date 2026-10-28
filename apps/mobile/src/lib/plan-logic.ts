import { daysBetween, type Plan, type PlanItem, type PlanOp } from '@mada/shared';

/*
 * The plan screen's own logic, pure so it is tested on its own (docs/app/ASK-INTEGRATED.md §9.3). An edit shows at once
 * (applied here to the plan on screen), goes to the server with the version it was made on, and waits in a queue
 * while the phone is offline. The server decides: a queue made on a version that has moved on elsewhere is dropped,
 * and the screen says "Changed elsewhere. Here's the latest."
 */

export type QueuedEdit = {
  id: string;
  tripId: string;
  /** The plan's version this edit was made on (the server checks it). */
  version: number;
  ops: PlanOp[];
  /** What it was about, for "Not saved: …" when it can't be kept. */
  title: string;
  at: number;
};

const BOOKED = new Set(['held', 'booked', 'confirmed']);
export const isBooked = (i: Pick<PlanItem, 'status'>) => BOOKED.has(i.status);

/** Items of a day in the order the plan shows them. */
export function dayItems(plan: Pick<Plan, 'items'>, day: number | null): PlanItem[] {
  return plan.items.filter((i) => i.day === day).sort((a, b) => a.sort - b.sort);
}

/**
 * The op that moves an item one place up or down within its day: after the item two above (or to the top), or after
 * the one below. Null when it's already first or last.
 */
export function moveOp(plan: Pick<Plan, 'items'>, itemId: string, dir: 'up' | 'down'): Extract<PlanOp, { op: 'move' }> | null {
  const it = plan.items.find((i) => i.id === itemId);
  if (!it) return null;
  const list = dayItems(plan, it.day);
  const at = list.findIndex((i) => i.id === itemId);
  if (dir === 'up') {
    if (at <= 0) return null;
    return at === 1 ? { op: 'move', itemId, day: it.day, first: true } : { op: 'move', itemId, day: it.day, afterItemId: list[at - 2]!.id };
  }
  if (at < 0 || at >= list.length - 1) return null;
  return { op: 'move', itemId, day: it.day, afterItemId: list[at + 1]!.id };
}

let tempSeq = 0;
/** An id for an item added on the phone before the server gave it one. */
export const tempId = () => `00000000-0000-4000-8000-${String(++tempSeq).padStart(12, '0')}`;

/** The plan as it will be once these ops land: what the screen shows straight away (the server's answer replaces it). */
export function applyLocal(plan: Plan, ops: PlanOp[]): Plan {
  let items = plan.items.map((i) => ({ ...i }));
  const renumber = (day: number | null) => {
    items.filter((i) => i.day === day).sort((a, b) => a.sort - b.sort).forEach((i, n) => { i.sort = (n + 1) * 10; });
  };
  for (const op of ops) {
    if (op.op === 'add') {
      const same = items.filter((i) => i.day === op.day).sort((a, b) => a.sort - b.sort);
      const after = op.afterItemId ? same.find((i) => i.id === op.afterItemId) : undefined;
      const sort = after ? after.sort + 0.5 : (same.at(-1)?.sort ?? 0) + 10;
      const dayDate = op.day != null ? addDay(plan.startDate, op.day) : null;
      items.push({
        id: tempId(), day: op.day, sort, kind: op.item.kind, mode: op.item.mode ?? null, title: op.item.title, note: op.item.note ?? null,
        // A place from Ask's place cards keeps where it is and Google's id; others are named by the server.
        place: op.item.place?.gid ? { name: op.item.place.name, kind: 'place', code: null, lat: op.item.place.lat ?? null, lng: op.item.place.lng ?? null, gid: op.item.place.gid } : null, from: null, to: null,
        startsAt: op.item.at && dayDate ? `${dayDate}T${op.item.at}` : null, endsAt: null, tz: null, nights: op.item.nights ?? null, status: 'idea', statusLine: null, booking: null,
        requestId: null, offerId: null, drive: null, source: 'manual', price: null, quote: null,
      });
      renumber(op.day);
      continue;
    }
    const it = items.find((i) => i.id === op.itemId);
    if (!it) continue;
    if (op.op === 'remove') items = items.filter((i) => i.id !== op.itemId);
    else if (op.op === 'skip') it.status = 'skipped';
    else if (op.op === 'unskip') it.status = 'idea';
    else if (op.op === 'update') {
      if (op.item.title) it.title = op.item.title;
      if (op.item.note !== undefined) it.note = op.item.note ?? null;
    } else if (op.op === 'move') {
      const from = it.day;
      it.day = op.day;
      const others = items.filter((i) => i.day === op.day && i.id !== it.id).sort((a, b) => a.sort - b.sort);
      // Halves fall between neighbours; the renumbering below makes them whole again.
      if (op.first) it.sort = (others[0]?.sort ?? 10) - 0.5;
      else {
        const after = op.afterItemId ? others.find((i) => i.id === op.afterItemId) : undefined;
        it.sort = after ? after.sort + 0.5 : (others.at(-1)?.sort ?? 0) + 10;
      }
      // A timed item keeps its time of day on its new day.
      if (it.startsAt && op.day != null && from !== op.day) it.startsAt = `${addDay(plan.startDate, op.day)}T${it.startsAt.slice(11, 16)}`;
      renumber(op.day);
      if (from !== op.day) renumber(from);
    }
  }
  return { ...plan, items };
}

const addDay = (start: string, n: number) => {
  const d = new Date(`${start}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** The plan on screen: the server's, with the edits still waiting to sync applied on top. */
export function withQueued(plan: Plan, queue: QueuedEdit[]): Plan {
  return queue.filter((q) => q.tripId === plan.tripId).reduce((p, q) => applyLocal(p, q.ops), plan);
}

export type FlushStep =
  | { kind: 'sent'; edit: QueuedEdit }
  | { kind: 'conflict'; lost: QueuedEdit[] };

/**
 * Send the queued edits of one trip, in order, each on the version the one before it produced. The first that the
 * server refuses as changed elsewhere drops it and the rest (they were made on top of it): the server's plan wins.
 * send resolves with the plan's new version, or throws { code: 'PLAN_CHANGED' } / any other error (left queued).
 */
export async function flushQueue(queue: QueuedEdit[], tripId: string, send: (e: QueuedEdit) => Promise<number>, onStep: (s: FlushStep) => void): Promise<QueuedEdit[]> {
  const mine = queue.filter((q) => q.tripId === tripId);
  let rest = queue.filter((q) => q.tripId !== tripId);
  let version: number | null = null;
  for (let i = 0; i < mine.length; i++) {
    const e = version != null ? { ...mine[i]!, version } : mine[i]!;
    try {
      version = await send(e);
      onStep({ kind: 'sent', edit: e });
    } catch (err) {
      if ((err as { code?: string })?.code === 'PLAN_CHANGED' || (err as { code?: string })?.code === 'NOT_FOUND') {
        onStep({ kind: 'conflict', lost: mine.slice(i) });
        return rest;
      }
      // Still offline or the server is busy: these wait for the next try.
      rest = [...rest, ...mine.slice(i)];
      return rest;
    }
  }
  return rest;
}

/* ───────────── what the screen says ───────────── */

/** Nights the plan covers with no stay ("Night 3: no stay yet"), 0-based, from the stay items. */
export function gapNights(plan: Pick<Plan, 'startDate' | 'endDate' | 'items'>): number[] {
  const nights = Math.max(0, daysBetween(plan.startDate, plan.endDate));
  const covered = new Set<number>();
  for (const i of plan.items) {
    if (i.kind !== 'stay' || i.day == null || i.status === 'skipped' || i.status === 'cancelled') continue;
    for (let n = 0; n < (i.nights ?? 1); n++) covered.add(i.day + n);
  }
  const out: number[] = [];
  for (let n = 0; n < nights; n++) if (!covered.has(n)) out.push(n);
  return out;
}

/** The car on a day: booked (a car item booked over it), requested, needed (a drive with no car), or nothing to say. */
export function carOn(plan: Pick<Plan, 'items'>, day: number): 'booked' | 'requested' | 'needed' | null {
  const cars = plan.items.filter((i) => i.kind === 'car' && i.day != null && i.status !== 'skipped' && i.status !== 'cancelled' && day >= i.day && day < i.day + Math.max(1, i.nights ?? 1));
  if (cars.some((c) => isBooked(c))) return 'booked';
  if (cars.some((c) => c.status === 'requested')) return 'requested';
  const drives = plan.items.some((i) => i.day === day && i.kind === 'leg' && i.mode === 'drive' && i.status !== 'skipped');
  return drives ? 'needed' : null;
}
