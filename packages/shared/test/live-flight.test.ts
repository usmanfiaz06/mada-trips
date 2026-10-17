import { describe, expect, it } from 'vitest';
import { checkInWindow, liveFlightState, liveSegment, liveWindow } from '../src/schemas/boarding';
import type { SegmentDetail, TripDetail } from '../src/schemas/trips';

const seg = (o: Partial<SegmentDetail> = {}): SegmentDetail => ({
  id: '00000000-0000-4000-8000-000000000001', carrier: 'SV', carrierName: 'Saudia', flightNumber: 'SV263', from: 'RUH', to: 'IST',
  departLocal: '2027-03-09T09:40', departTz: 'Asia/Riyadh', arriveLocal: '2027-03-09T13:55', arriveTz: 'Europe/Istanbul', durationMin: 255,
  cabin: 'economy', terminal: 'Terminal 3', gate: 'B12', seats: ['14A', '14B'], baggage: null, status: 'scheduled', statusSource: null, pnr: 'X7K2QD',
  direction: 'out', bookedGate: 'B12', delayMin: null, predictedDelay: false, statusAt: null, brand: '#0b6b52', ...o,
});
const trip = (s: SegmentDetail[], pickups: TripDetail['pickups'] = []) => ({ segments: s, pickups, travellers: [] }) as unknown as Pick<TripDetail, 'segments' | 'pickups' | 'travellers'>;
// 09:40 Riyadh = 06:40Z.
const at = (hhmm: string) => Date.parse(`2027-03-09T${hhmm}:00Z`);

describe('the lock-screen flight', () => {
  it('starts 4 hours before take-off and ends 30 minutes after landing', () => {
    const s = seg();
    expect(liveWindow(s, at('02:39'))).toBe('before');
    expect(liveWindow(s, at('02:41'))).toBe('live');
    expect(liveWindow(s, at('11:25'))).toBe('live');
    expect(liveWindow(s, at('11:26'))).toBe('over');
  });
  it('says when to leave, then the gate, then boarding, the air and landing', () => {
    const tr = trip([seg()]);
    const s1 = liveFlightState(tr, at('04:00'))!;
    expect(s1).toMatchObject({ flight: 'SV263', gate: 'B12', seat: '14A–14B', boards: '08:55', departs: '09:40', status: 'on_time', statusText: 'On time', leave: '07:05', leaveText: 'Leave for the airport at 07:05' });
    expect(liveFlightState(trip([seg({ gate: 'C4' })]), at('05:00'))).toMatchObject({ status: 'gate_changed', statusText: 'Gate changed to C4' });
    expect(liveFlightState(trip([seg({ delayMin: 40, status: 'delayed' })]), at('04:00'))).toMatchObject({ status: 'delayed', statusText: 'Delayed 40 min', departs: '10:20', boards: '09:35' });
    expect(liveFlightState(tr, at('06:00'))).toMatchObject({ status: 'boarding', leave: null });
    expect(liveFlightState(tr, at('08:00'))).toMatchObject({ status: 'departed', statusText: 'In the air' });
    expect(liveFlightState(tr, at('11:00'))).toMatchObject({ status: 'landed' });
  });
  it('speaks Arabic', () => {
    expect(liveFlightState(trip([seg()]), at('04:00'), 'ar')!.statusText).toBe('في وقتها');
  });
  it('follows the next flight that has not landed', () => {
    const back = seg({ id: '00000000-0000-4000-8000-000000000002', flightNumber: 'SV264', direction: 'back', departLocal: '2027-03-15T15:10', departTz: 'Europe/Istanbul', arriveLocal: '2027-03-15T19:20', arriveTz: 'Asia/Riyadh' });
    expect(liveSegment(trip([back, seg()]), at('04:00'))!.flightNumber).toBe('SV263');
    expect(liveSegment(trip([back, seg()]), Date.parse('2027-03-12T10:00:00Z'))!.flightNumber).toBe('SV264');
  });
  it('knows when check-in opens', () => {
    const w = checkInWindow(seg(), at('04:00'));
    expect(w).toMatchObject({ airline: 'Saudia', opensLocal: '09:40', open: true, opensAt: '2027-03-08T06:40:00.000Z' });
    expect(checkInWindow(seg(), Date.parse('2027-03-08T06:00:00Z')).open).toBe(false);
  });
});
