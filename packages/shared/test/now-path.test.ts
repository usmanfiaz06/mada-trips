import { describe, expect, it } from 'vitest';
import {
  CALLBACK_MINUTES, RIDE_MATCH_MS, RIDE_NOW_MIN, carNowAsk, flightTruth, mockRideMatch, problemIn, rideView, supportIntent, supportReplies, t, tripIsNow, wantsNow,
  type StoredRide, type SupportContext,
} from '../src';

const T0 = Date.parse('2026-10-16T21:40:00Z');
const ride = (over: Partial<StoredRide> = {}): StoredRide => {
  const id = '6b0f6a52-2b8e-4b0e-9d3b-4c1f1c9b2a10';
  return { id, when: 'now', city: 'Riyadh', meetingPoint: 'At the hotel door', tripId: null, requestedAt: new Date(T0).toISOString(), cancelledAt: null, supplier: 'mock', match: mockRideMatch(id, 'Riyadh'), ...over };
};

describe('a car right now', () => {
  it('reads "now" in English and Riyadh Arabic, and never treats a rental as a ride now', () => {
    expect(wantsNow('I need a car now')).toBe(true);
    expect(wantsNow('سيارة الحين')).toBe(true);
    expect(wantsNow('a car for next week')).toBe(false);
    expect(wantsNow('I know a place')).toBe(false);
    expect(carNowAsk('general', 'Get me a taxi right now')).toBe(true);
    expect(carNowAsk('car', 'أبي سيارة الحين')).toBe(true);
    expect(carNowAsk('car', 'A car for my trip dates')).toBe(false);
    expect(carNowAsk('car', 'Rent a car now')).toBe(false);
  });

  it('is honest at every step: requesting, then the driver with car, plate, meeting point and price, then here', () => {
    const r = ride();
    const asking = rideView(r, T0 + 1000);
    expect(asking).toMatchObject({ status: 'requesting', driver: null, price: null, cancellable: true });
    const found = rideView(r, T0 + RIDE_MATCH_MS + 1);
    expect(found.status).toBe('assigned');
    expect(found.driver).toMatchObject({ name: expect.any(String), car: expect.any(String), plate: expect.any(String), phone: expect.stringMatching(/^\+966/) });
    expect(found.meetingPoint).toBe('At the hotel door');
    expect(found.price).toEqual({ amount: 3800, currency: 'SAR' });
    expect(Date.parse(found.pickupAt!) - T0).toBe(RIDE_NOW_MIN * 60_000);
    expect(rideView(r, T0 + RIDE_NOW_MIN * 60_000).status).toBe('arrived');
    // The same ride id always gets the same driver (the server and the app's mock agree).
    expect(mockRideMatch(r.id, 'Riyadh')).toEqual(r.match);
  });

  it('in 15 minutes is a time, not tomorrow', () => {
    const v = rideView(ride({ when: 'in15' }), T0 + RIDE_MATCH_MS);
    expect(Date.parse(v.pickupAt!) - T0).toBe(15 * 60_000);
  });

  it('says plainly when no car is free, and when nothing is connected', () => {
    expect(mockRideMatch('x', 'Abha')).toBeNull();
    expect(rideView(ride({ city: 'Abha', match: null }), T0 + 500).status).toBe('requesting');
    expect(rideView(ride({ city: 'Abha', match: null }), T0 + RIDE_MATCH_MS)).toMatchObject({ status: 'none', driver: null, cancellable: false });
    expect(rideView(ride({ supplier: 'none', match: null }), T0)).toMatchObject({ status: 'none', cancellable: false });
  });

  it('cancels', () => {
    expect(rideView(ride({ cancelledAt: new Date(T0 + 7000).toISOString() }), T0 + 8000)).toMatchObject({ status: 'cancelled', cancellable: false });
  });
});

describe('urgent at any hour', () => {
  const base: SupportContext = { trip: null, refund: null, deskPhone: '+966 56 668 2662', now: T0 };
  const liveTrip: SupportContext = { ...base, trip: { id: 'a3c1f3a0-0000-4000-8000-000000000001', bookingRef: null, airline: null, travellers: [], city: 'Istanbul', now: true } };

  it('knows a trip happening now: under way, or the first flight within 24 hours', () => {
    expect(tripIsNow({ startDate: '2026-10-14', endDate: '2026-10-20' }, T0)).toBe(true);
    expect(tripIsNow({ startDate: '2026-10-20', endDate: '2026-10-25', firstDepartUtc: '2026-10-17T08:00:00Z' }, T0)).toBe(true);
    expect(tripIsNow({ startDate: '2026-10-18', endDate: '2026-10-25', firstDepartUtc: '2026-10-18T08:00:00Z' }, T0)).toBe(false);
    expect(tripIsNow({ startDate: '2026-11-02', endDate: '2026-11-08' }, T0)).toBe(false);
  });

  it('with a trip within 24 hours: the disruption card for that trip, and no 997', () => {
    const [r] = supportReplies({ kind: 'intent', intent: 'urgent', text: 'It’s urgent' }, liveTrip);
    expect(r!.body).toBe(t('support.reply.urgentTrip', { city: 'Istanbul' }));
    expect(r!.card?.disruption).toEqual({ tripId: liveTrip.trip!.id, city: 'Istanbul' });
    expect(r!.card?.choices?.map((c) => c.key)).toEqual(['dx-delayed', 'dx-cancelled', 'dx-connection', 'dx-hotel', 'dx-docs', 'dx-emergency', 'dx-other']);
    expect(r!.body).not.toMatch(/997|112/);
  });

  it('a problem picked or typed: a call-back promise from Mada, with a time', () => {
    const [picked] = supportReplies({ kind: 'pick', choice: 'dx-cancelled', label: 'My flight is cancelled' }, liveTrip);
    expect(picked!.card?.callback).toEqual({ by: new Date(T0 + CALLBACK_MINUTES * 60_000).toISOString(), problem: 'cancelled' });
    expect(picked!.body).toContain(t('support.reply.callback'));
    expect(picked!.body).toContain(t('support.dx.next.cancelled'));
    expect(picked!.body).not.toMatch(/997/);
    const [typed] = supportReplies({ kind: 'intent', intent: 'urgent', text: 'urgent, I lost my passport' }, liveTrip);
    expect(typed!.card?.callback?.problem).toBe('docs');
  });

  it('without a trip: the promise straight away, with the emergency choice offered', () => {
    const [r] = supportReplies({ kind: 'intent', intent: 'urgent', text: 'urgent' }, base);
    expect(r!.card?.callback?.by).toBeTruthy();
    expect(r!.card?.choices).toEqual([{ key: 'dx-emergency', label: t('support.dx.emergency') }]);
    expect(r!.body).not.toMatch(/997/);
  });

  it('shows 997 only when someone is hurt or unsafe', () => {
    expect(supportIntent('Help, my son is hurt')).toBe('emergency');
    expect(supportIntent('urgent please')).toBe('urgent');
    expect(supportIntent('I lost my passport')).toBe('urgent');
    const [e] = supportReplies({ kind: 'intent', intent: 'emergency', text: 'my son is hurt' }, base);
    expect(e!.body).toContain('997');
    expect(e!.card).toMatchObject({ emergency: true, intent: 'emergency' });
    const [picked] = supportReplies({ kind: 'pick', choice: 'dx-emergency', label: '' }, liveTrip);
    expect(picked!.card?.emergency).toBe(true);
    expect(problemIn('my flight was cancelled')).toBe('cancelled');
    expect(problemIn('we need an ambulance')).toBe('emergency');
  });

  it('a car asked for in the chat goes to the car-now flow', () => {
    const [r] = supportReplies({ kind: 'intent', intent: 'free', text: 'I need a taxi now' }, base);
    expect(r!.card?.action?.to).toBe('/ask?prefill=I%20need%20a%20taxi%20now');
  });
});

describe('the disruption screen, honestly', () => {
  const seg = (over: Record<string, unknown> = {}) => ({ carrier: 'SV', flightNumber: 'SV 263', status: 'scheduled', delayMin: null, statusAt: '2026-10-16T21:30:00Z', ...over });
  it('says on time, with when it was checked', () => {
    expect(flightTruth([seg()])).toEqual({ state: 'on_time', flight: 'SV 263', delayMin: 0, checkedAt: '2026-10-16T21:30:00Z' });
    expect(flightTruth([seg({ delayMin: 10 })]).state).toBe('on_time');
  });
  it('says what is true otherwise', () => {
    expect(flightTruth([seg({ delayMin: 40, status: 'delayed' })])).toMatchObject({ state: 'delayed', delayMin: 40 });
    expect(flightTruth([seg({ status: 'landed' }), seg({ flightNumber: 'SV 264', status: 'on_time' })]).flight).toBe('SV 264');
    expect(flightTruth([seg({ status: 'landed' })]).state).toBe('landed');
    expect(flightTruth([]).state).toBe('none');
  });
});
