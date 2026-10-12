import { describe, expect, it } from 'vitest';
import { QueryClient } from '@tanstack/react-query';
import { travelEnds } from '../../src/lib/travel-ends';

/* The day a booking brings the travellers home, for the passport check's "6 months after you're back". */
describe('travel ends', () => {
  it('reads the picked flight from the search results already on the phone', () => {
    const qc = new QueryClient();
    qc.setQueryData(['booking', 'flights', 'istanbul'], { options: [
      { id: 'a', out: { date: '2027-03-09' }, back: { date: '2027-03-15' } },
      { id: 'b', out: { date: '2027-03-10' }, back: null },
    ] });
    expect(travelEnds(qc, { kind: 'trip', flightOfferId: 'a', travellerIds: ['x'] })).toBe('2027-03-15');
    expect(travelEnds(qc, { kind: 'trip', flightOfferId: 'b', travellerIds: ['x'] })).toBe('2027-03-10');
    expect(travelEnds(qc, { kind: 'trip', flightOfferId: 'gone', travellerIds: ['x'] })).toBeNull();
  });

  it('reads the chosen fare in an agent’s quote, landing a day later when it does', () => {
    const qc = new QueryClient();
    const legs = [{ direction: 'out', date: '2027-01-02', arrDate: null }, { direction: 'back', date: '2027-01-20', arrDate: '2027-01-21' }];
    const request = { quote: { flight: { options: [{ id: 'f1', legs }, { id: 'f2', legs: legs.slice(0, 1) }] } } } as never;
    expect(travelEnds(qc, { kind: 'quote', requestId: 'r', optionId: 'f1' }, request)).toBe('2027-01-21');
    expect(travelEnds(qc, { kind: 'quote', requestId: 'r', optionId: 'f2' }, request)).toBe('2027-01-02');
    expect(travelEnds(qc, { kind: 'esim', count: 1 })).toBeNull();
  });
});
