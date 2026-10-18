import { ERROR_CODES, RequestRideBody, mockRideMatch, rideView, t, type ErrorCode, type StoredRide } from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock } from '../mock-api';

/*
 * EXPO_PUBLIC_API_MODE=mock for a car right now: the same contract as platform/src/app/api/app/v1/rides, with the
 * same mock supplier (shared rideView): a driver in a few seconds where it has cars (Riyadh, Jeddah, Istanbul…), and
 * no car free anywhere else (Abha, Tabuk), so both sides of the honest answer can be seen.
 */

const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
function err(code: ErrorCode, message?: string): WireResponse {
  return { status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy) } } };
}
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

const rides = new Map<string, StoredRide & { ownerId: string; clientKey: string }>();

export const ridesMock: AreaMock = async (w, ctx) => {
  const parts = (w.path.split('?')[0] ?? '').split('/').filter(Boolean);
  if (parts[0] !== 'rides') return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const owner = ctx.user.id;
  const now = Date.now();

  if (w.method === 'POST' && parts.length === 1) {
    const v = RequestRideBody.safeParse(w.body);
    if (!v.success) return err('VALIDATION');
    const b = v.data;
    const seen = [...rides.values()].find((r) => r.ownerId === owner && r.clientKey === b.clientKey);
    if (seen) return ok({ ride: rideView(seen, now) }, 201);
    const id = uuid();
    const r = { id, ownerId: owner, clientKey: b.clientKey, when: b.when, city: b.city, meetingPoint: b.meetingPoint, destination: b.destination ?? null, tripId: b.tripId ?? null, requestedAt: new Date(now).toISOString(), cancelledAt: null, supplier: 'mock' as const, match: mockRideMatch(id, b.city, b) };
    rides.set(id, r);
    return ok({ ride: rideView(r, now) }, 201);
  }
  const r = rides.get(parts[1] ?? '');
  if (!r || r.ownerId !== owner) return err('NOT_FOUND');
  if (w.method === 'GET' && parts.length === 2) return ok({ ride: rideView(r, now) });
  if (w.method === 'POST' && parts[2] === 'cancel') {
    const cur = rideView(r, now);
    if (cur.status === 'cancelled') return ok({ ride: cur });
    if (!cur.cancellable) return err('VALIDATION', 'This car can’t be cancelled now.');
    r.cancelledAt = new Date(now).toISOString();
    return ok({ ride: rideView(r, now) });
  }
  return err('NOT_FOUND');
};
