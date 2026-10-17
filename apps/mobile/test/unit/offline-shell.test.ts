import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { PickupDetail, Ride, SegmentDetail, StayDetail, TripDetail } from '@mada/shared';
import { useSession } from '@/lib/session';
import { kvRead } from '@/lib/net/kv';
import { enqueue, resetOutbox, useOutboxStore } from '@/lib/net/outbox';
import { saveNow, startPersistence } from '@/lib/net/persist';
import { loadedFiles } from '@/lib/net/shell';
import { resetNet, simulateOffline } from '@/lib/net/state';
import { essentials, isLow, LOW_AT, savedAt } from '@/lib/low-power';
import { queryClient } from '@/lib/queries';

vi.mock('@/lib/queries', async () => ({ queryClient: new (await import('@tanstack/react-query')).QueryClient() }));

/* The offline shell (critique item 14): nothing of one account is left after sign-out; the low-battery screen's picks. */

const tokens = { accessToken: 'a.b.c', accessExpiresAt: '2099-01-01T00:00:00Z', refreshToken: 'r', refreshExpiresAt: '2099-01-01T00:00:00Z' };

describe('signing out leaves nothing of the account', () => {
  beforeEach(async () => {
    resetOutbox();
    resetNet({ connected: true });
    startPersistence();
    await useSession.getState().signIn(tokens, { id: 'u1' } as never);
  });

  it('drops the saved trips and anything still waiting to send', async () => {
    queryClient.setQueryData(['trips', 'list'], { currentId: 't1' });
    expect(await saveNow()).toBe(true);
    expect(await kvRead('mada.cache.v1')).toContain('t1');
    simulateOffline(true);
    enqueue({ kind: 'support-message', label: 'Message to Mada', method: 'POST', path: '/support/threads/x/messages', body: { body: 'my passport is lost' } });
    await new Promise((r) => setTimeout(r, 0));
    expect(await kvRead('mada.outbox.v1')).toContain('passport');

    await useSession.getState().clear();
    await new Promise((r) => setTimeout(r, 0));
    expect(useOutboxStore.getState().items).toEqual([]);
    expect(await kvRead('mada.outbox.v1')).toBeNull();
    expect(await kvRead('mada.cache.v1')).toBeNull();
    expect(queryClient.getQueryData(['trips', 'list'])).toBeUndefined();
    simulateOffline(false);
  });
});

describe('the web shell keeps only the app itself', () => {
  it('lists bundles and app files from this origin, never the API or other sites', () => {
    const o = 'https://mada-app-staging.vercel.app';
    expect(loadedFiles([
      { name: `${o}/_expo/static/js/web/entry-abc.js` },
      { name: `${o}/assets/node_modules/@expo-google-fonts/inter-tight/400.ttf` },
      { name: `${o}/api/app/v1/trips` },
      { name: `${o}/api/app/v1/wallet/documents/1/file` },
      { name: 'https://images.example.com/hotel.jpg' },
      { name: 'not a url' },
    ], o)).toEqual(['/_expo/static/js/web/entry-abc.js', '/assets/node_modules/@expo-google-fonts/inter-tight/400.ttf']);
  });
});

const seg = (over: Partial<SegmentDetail>): SegmentDetail => ({
  id: 's1', carrier: 'SV', carrierName: 'Saudia', flightNumber: '263', from: 'RUH', to: 'IST', departLocal: '2026-10-18T09:40', departTz: 'Asia/Riyadh',
  arriveLocal: '2026-10-18T13:30', arriveTz: 'Europe/Istanbul', durationMin: 290, cabin: 'economy', terminal: '4', gate: 'B12', seats: ['23A'], baggage: null,
  status: 'scheduled', statusSource: null, pnr: 'AB12CD', direction: 'out', bookedGate: null, delayMin: null, predictedDelay: false, statusAt: null, brand: null, ...over,
} as SegmentDetail);
const pickup = (over: Partial<PickupDetail>): PickupDetail => ({
  id: 'p1', direction: 'from_airport', at: '2026-10-18T10:45:00Z', driverName: 'Emre', car: 'Mercedes Vito', plate: '34 ABC 12', meetingPoint: 'Door 8', phone: '+90 500 000 0000',
  price: { amount: 0, currency: 'SAR' }, status: 'booked', room: null, waits: null, offsetMin: null, city: 'Istanbul', ...over,
} as PickupDetail);
const stay = { id: 'h1', name: 'Bereketzade Hotel', address: 'Galata Kulesi Sk. No: 12', status: 'booked', nameAr: 'فندق بيريكت زاده' } as StayDetail;
const trip = (phase: string, over: Partial<TripDetail> = {}) => ({
  clock: { phase, now: '2026-10-18T05:00:00Z', today: '2026-10-18', demo: false }, segments: [seg({})], pickups: [pickup({})], stays: [stay], ...over,
} as unknown as TripDetail);
const NOW = Date.parse('2026-10-18T05:00:00Z');

describe('the low-battery screen', () => {
  it('suggests itself at 15% or less, not while charging, and never without a reading', () => {
    expect(isLow({ level: LOW_AT, charging: false })).toBe(true);
    expect(isLow({ level: 0.08, charging: true })).toBe(false);
    expect(isLow({ level: 0.4, charging: false })).toBe(false);
    expect(isLow(null)).toBe(false);
  });

  it('shows the next flight not yet flown, the booked car and the hotel', () => {
    const e = essentials(trip('travelday', { segments: [seg({ id: 'a', status: 'landed' }), seg({ id: 'b', flightNumber: '264' })] }), NOW);
    expect(e.flight?.flightNumber).toBe('264');
    expect(e.driver).toMatchObject({ name: 'Emre', car: 'Mercedes Vito · 34 ABC 12', place: 'Door 8' });
    expect(e.stay?.nameAr).toBe('فندق بيريكت زاده');
  });

  it('prefers a car asked for right now, once a driver is on the way', () => {
    const ride = { id: 'r1', status: 'assigned', meetingPoint: 'Hotel door', pickupAt: '2026-10-18T05:08:00Z', driver: { name: 'Fahad', phone: '+966500000000', car: 'Camry, white', plate: 'ABC 123' } } as Ride;
    expect(essentials(trip('landed'), NOW, [ride]).driver).toMatchObject({ name: 'Fahad', place: 'Hotel door' });
    expect(essentials(trip('landed'), NOW, [{ ...ride, status: 'requesting', driver: null }]).driver?.name).toBe('Emre');
  });

  it('leaves out a pickup long past or more than a day away, and everything once home', () => {
    expect(essentials(trip('landed', { pickups: [pickup({ at: '2026-10-17T20:00:00Z' })] }), NOW).driver).toBeNull();
    expect(essentials(trip('booked', { pickups: [pickup({ at: '2027-03-09T04:05:00Z' })] }), NOW).driver).toBeNull();
    expect(essentials(trip('home'), NOW)).toEqual({ flight: null, driver: null, stay: null });
    expect(essentials(null, NOW)).toEqual({ flight: null, driver: null, stay: null });
  });

  it('says when it was saved: the time today, the day too when older', () => {
    const at = new Date(2026, 9, 18, 14, 5).getTime();
    expect(savedAt(at, new Date(2026, 9, 18, 20, 0).getTime())).toBe('14:05');
    expect(savedAt(at, new Date(2026, 9, 19, 8, 0).getTime())).toBe('Sun 18 Oct, 14:05');
  });
});
