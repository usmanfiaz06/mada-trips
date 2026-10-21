import { describe, expect, it } from 'vitest';
import type { Plan, PlanItem } from '@mada/shared';
import { applyLocal, carOn, flushQueue, gapNights, moveOp, withQueued, type QueuedEdit } from '../../src/lib/plan-logic';

// The plan screen's own logic (docs/app/ASK-INTEGRATED.md §9.3, U8): moves within a day, edits shown at once, the
// offline queue sent on the version each edit was made on, and a plan changed elsewhere winning.

const id = (n: number) => `00000000-0000-4000-8000-${String(900 + n).padStart(12, '0')}`;
const item = (n: number, day: number | null, sort: number, o: Partial<PlanItem> = {}): PlanItem => ({
  id: id(n), day, sort, kind: 'activity', mode: null, title: `Item ${n}`, note: null, place: null, from: null, to: null, startsAt: null, endsAt: null, tz: null, nights: null,
  status: 'idea', statusLine: null, booking: null, requestId: null, offerId: null, drive: null, source: 'ask', price: null, quote: null, ...o,
});
const plan = (items: PlanItem[], o: Partial<Plan> = {}): Plan => ({
  id: id(0), tripId: id(99), version: 3, title: 'Riyadh → AlUla', kind: 'simple', origin: null, originNeeded: false, returnTo: null, startDate: '2027-11-20', endDate: '2027-11-22',
  days: 3, pace: 'normal', templateId: null, travellerIds: [], notes: [], items, checks: [], totals: null, createdBy: 'ask', updatedAt: '2026-10-21T10:00:00Z', ...o,
});

describe('moving within a day', () => {
  const p = plan([item(1, 0, 10), item(2, 0, 20), item(3, 0, 30), item(4, 1, 10)]);
  it('up: after the one two above, or to the top', () => {
    expect(moveOp(p, id(3), 'up')).toEqual({ op: 'move', itemId: id(3), day: 0, afterItemId: id(1) });
    expect(moveOp(p, id(2), 'up')).toEqual({ op: 'move', itemId: id(2), day: 0, first: true });
    expect(moveOp(p, id(1), 'up')).toBeNull();
  });
  it('down: after the one below; never past the last', () => {
    expect(moveOp(p, id(1), 'down')).toEqual({ op: 'move', itemId: id(1), day: 0, afterItemId: id(2) });
    expect(moveOp(p, id(3), 'down')).toBeNull();
  });
  it('shows the new order at once, and a timed item keeps its time on its new day', () => {
    const order = (x: Plan, d: number) => x.items.filter((i) => i.day === d).sort((a, b) => a.sort - b.sort).map((i) => i.id);
    expect(order(applyLocal(p, [moveOp(p, id(3), 'up')!]), 0)).toEqual([id(1), id(3), id(2)]);
    expect(order(applyLocal(p, [moveOp(p, id(2), 'up')!]), 0)).toEqual([id(2), id(1), id(3)]);
    const timed = plan([item(1, 0, 10, { startsAt: '2027-11-20T16:00' }), item(2, 1, 10)]);
    const moved = applyLocal(timed, [{ op: 'move', itemId: id(1), day: 1 }]);
    expect(moved.items.find((i) => i.id === id(1))).toMatchObject({ day: 1, startsAt: '2027-11-21T16:00' });
  });
  it('adds, skips and removes', () => {
    const x = applyLocal(p, [{ op: 'add', day: 1, item: { kind: 'meal', title: 'Dinner', at: '20:00' } }, { op: 'skip', itemId: id(1) }, { op: 'remove', itemId: id(4) }]);
    expect(x.items.find((i) => i.title === 'Dinner')).toMatchObject({ day: 1, startsAt: '2027-11-21T20:00', status: 'idea' });
    expect(x.items.find((i) => i.id === id(1))!.status).toBe('skipped');
    expect(x.items.some((i) => i.id === id(4))).toBe(false);
  });
});

describe('the offline queue', () => {
  const p = plan([item(1, 0, 10), item(2, 0, 20)]);
  const q = (n: number, version: number): QueuedEdit => ({ id: `e${n}`, tripId: p.tripId, version, ops: [{ op: 'skip', itemId: id(n) }], title: `Item ${n}`, at: n });

  it('what waits is shown over the plan', () => {
    expect(withQueued(p, [q(1, 3)]).items.find((i) => i.id === id(1))!.status).toBe('skipped');
    expect(withQueued(p, [{ ...q(1, 3), tripId: id(55) }]).items.find((i) => i.id === id(1))!.status).toBe('idea');
  });

  it('syncs in order, each on the version the one before made', async () => {
    const sent: number[] = [];
    let v = 3;
    const rest = await flushQueue([q(1, 3), q(2, 3)], p.tripId, async (e) => { sent.push(e.version); if (e.version !== v) throw { code: 'PLAN_CHANGED' }; v += 1; return v; }, () => {});
    expect(sent).toEqual([3, 4]);
    expect(rest).toEqual([]);
  });

  it('changed elsewhere: the server wins, the queue for that trip is dropped and named', async () => {
    const steps: string[][] = [];
    const other = { ...q(2, 3), id: 'x', tripId: id(55) };
    const rest = await flushQueue([q(1, 3), q(2, 3), other], p.tripId, async () => { throw { code: 'PLAN_CHANGED' }; }, (s) => { if (s.kind === 'conflict') steps.push(s.lost.map((x) => x.title)); });
    expect(steps).toEqual([['Item 1', 'Item 2']]);
    expect(rest).toEqual([other]);
  });

  it('still offline: everything stays queued, in order', async () => {
    const rest = await flushQueue([q(1, 3), q(2, 3)], p.tripId, async () => { throw { code: 'OFFLINE' }; }, () => {});
    expect(rest.map((e) => e.id)).toEqual(['e1', 'e2']);
  });
});

describe('what the days say', () => {
  it('nights with no stay, and the car on a drive day', () => {
    const p = plan([
      item(1, 0, 10, { kind: 'stay', nights: 1 }),
      item(2, 1, 10, { kind: 'leg', mode: 'drive' }),
      item(3, 2, 10, { kind: 'leg', mode: 'drive' }),
      item(4, 2, 5, { kind: 'car', nights: 1, status: 'booked' }),
    ], { endDate: '2027-11-23', days: 4 });
    expect(gapNights(p)).toEqual([1, 2]);
    expect(carOn(p, 1)).toBe('needed');
    expect(carOn(p, 2)).toBe('booked');
    expect(carOn(p, 0)).toBeNull();
  });
});
