import { useQuery } from '@tanstack/react-query';
import { RIDE_ROUTES, RideResponse, type RequestRideBody, type SupportMessage } from '@mada/shared';
import { request } from './api';
import { useSession } from './session';
import { walletApi } from './wallet';

/*
 * A car right now: POST /rides, GET /rides/{id}, POST /rides/{id}/cancel (shared/schemas/now-path.ts). The ride is
 * read every few seconds while it moves (requesting → driver on the way → here), and not at all once it's settled.
 */

export const ridesApi = {
  request: (b: RequestRideBody) => request({ method: 'POST', path: RIDE_ROUTES.rides, body: b }, RideResponse),
  ride: (id: string) => request({ method: 'GET', path: RIDE_ROUTES.ride(id) }, RideResponse),
  cancel: (id: string) => request({ method: 'POST', path: RIDE_ROUTES.cancel(id), body: {} }, RideResponse),
};

export const rideKeys = { ride: (id: string) => ['rides', id] as const };

export function useRide(id: string | null) {
  const signedIn = !!useSession((s) => s.tokens);
  return useQuery({
    queryKey: rideKeys.ride(id ?? ''), queryFn: () => ridesApi.ride(id!), enabled: !!id && signedIn,
    refetchInterval: (q) => { const s = q.state.data?.ride.status; return s === 'requesting' ? 2000 : s === 'assigned' ? 15_000 : false; },
  });
}

/**
 * No car was free: Mada finds one by hand. The message goes to Mada as urgent, so the desk sees it first, and the
 * answer carries the call-back time. Returns that time, or null if the answer had none.
 */
export async function askMadaForCar(text: string, tripId: string | null): Promise<string | null> {
  const { thread } = await walletApi.openThread(tripId ? { tripId } : {});
  const r = await walletApi.sendMessage(thread.id, { body: text, topic: 'urgent' });
  return r.messages.map((m: SupportMessage) => m.card?.callback?.by).find(Boolean) ?? null;
}
