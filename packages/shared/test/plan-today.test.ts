import { describe, expect, it } from 'vitest';
import { todayCards, type Plan, type PlanItem } from '../src';

/* Today's cards from a plan (U9): only times and distances the plan has; nothing a month out, to-dos from a week. */

const START = '2027-12-12';
const item = (o: Partial<PlanItem> & Pick<PlanItem, 'day' | 'sort' | 'kind' | 'title'>): PlanItem => ({
  id: crypto.randomUUID(), mode: null, note: null, place: null, from: null, to: null, startsAt: null, endsAt: null, tz: null, nights: null, status: 'idea', statusLine: null,
  booking: null, requestId: null, offerId: null, drive: null, source: 'ask', ...o,
});
const city = (name: string) => ({ name, kind: 'city' as const, code: null, city: name, country: 'MY' });
const plan = (items: PlanItem[], checks: Plan['checks'] = []): Plan => ({
  id: crypto.randomUUID(), tripId: '0f6e2d1c-8b3a-4e59-a7c2-3d1b9e8f4a60', version: 1, title: 'Riyadh → Penang', kind: 'road', origin: null, originNeeded: false, returnTo: null,
  startDate: START, endDate: '2027-12-15', days: 4, pace: 'normal', templateId: null, travellerIds: [], notes: [], items, checks, totals: null, createdBy: 'ask', updatedAt: '2026-10-21T00:00:00Z',
});
const drive = { km: 150, minutes: 130, tolls: true, borders: [], source: 'map', asOf: null };

describe('todayCards', () => {
  const p = plan([
    item({ day: 0, sort: 10, kind: 'stay', title: 'Stay in Melaka', place: city('Melaka'), nights: 1, status: 'booked', booking: { kind: 'stay', id: crypto.randomUUID(), name: 'Casa del Rio', ref: null } }),
    item({ day: 1, sort: 10, kind: 'leg', mode: 'drive', title: 'Melaka → Kuala Lumpur', to: city('Kuala Lumpur'), drive, startsAt: '2027-12-13T10:00' }),
    item({ day: 2, sort: 10, kind: 'leg', mode: 'drive', title: 'Kuala Lumpur → Penang', to: city('Penang'), drive: { ...drive, minutes: 270, estimate: true } }),
    item({ day: 2, sort: 20, kind: 'car', title: 'Car', status: 'requested' }),
  ], [{ key: 'car', state: 'todo', text: '', who: [], nights: [], days: [2] }, { key: 'passports', state: 'warn', text: '', who: ['p1'], nights: [], days: [] }]);

  it('the day before: tomorrow’s check-in, and what’s left', () => {
    const c = todayCards(p, '2027-12-11', [], new Map([['p1', 'Sara']]));
    expect(c[0]).toMatchObject({ kind: 'checkin', when: 'tomorrow', hotel: 'Casa del Rio', city: 'Melaka' });
    // A problem before a to-do.
    expect(c.filter((x) => x.kind === 'todo').map((x) => x.kind === 'todo' && x.check)).toEqual(['passports', 'car']);
    expect(c.find((x) => x.kind === 'todo' && x.check === 'passports')).toMatchObject({ names: ['Sara'], state: 'warn' });
  });

  it('a measured drive with its time; an estimate or a car not booked says nothing', () => {
    expect(todayCards(p, '2027-12-13')).toEqual([expect.objectContaining({ kind: 'drive', when: 'today', minutes: 130, to: 'Kuala Lumpur', leaveBy: '10:00' })]);
    expect(todayCards(p, '2027-12-14')).toEqual([]);
  });

  it('a month out: only a passport problem; a week out: the rest too', () => {
    expect(todayCards(p, '2027-11-20').map((x) => x.kind === 'todo' && x.check)).toEqual(['passports']);
    expect(todayCards(p, '2027-12-06').map((x) => x.kind === 'todo' && x.check)).toEqual(['passports', 'car']);
    expect(todayCards(p, '2027-10-01')).toEqual([]);
  });

  it('a booked pickup: the booking’s time in the place’s zone and its meeting point', () => {
    const id = crypto.randomUUID();
    const q = plan([item({ day: 0, sort: 5, kind: 'leg', mode: 'transfer', title: 'Pickup', tz: 'Asia/Kuala_Lumpur', status: 'booked', booking: { kind: 'pickup', id, name: null, ref: null } })]);
    expect(todayCards(q, START, [{ id, at: new Date('2027-12-12T01:30:00Z'), meetingPoint: 'Terminal 2' }])).toEqual([expect.objectContaining({ kind: 'pickup', when: 'today', time: '09:30', place: 'Terminal 2', car: false })]);
  });
});
