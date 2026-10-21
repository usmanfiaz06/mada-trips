import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ChangeRequestResponse, SHARED_TRIPS_ROUTE, SharedTripResponse, SharedTripsResponse, TripInviteResponse, TripTravellersResponse,
  changeRequestRoute, sharedInviteRoute, sharedTripRoute, tripInviteRoute, tripTravellerRoute, tripTravellersRoute,
  type AddTravellerRequest, type DecideChangeRequest, type TravellerRole, type TripInviteRequest,
} from '@mada/shared';
import { request } from './api';
import { useSession } from './session';

/*
 * Companions (docs/app/ASK-INTEGRATED.md §5, U5): who goes on a trip and each one's role (the owner's Travellers
 * screen), the choice and invite cards' taps, a change a companion asked for (read again live by both chats, decided
 * by the owner), and the trips others share with you. Every tap goes through the server, which checks it's yours.
 */

export const peopleApi = {
  list: (tripId: string) => request({ method: 'GET', path: tripTravellersRoute(tripId) }, TripTravellersResponse),
  add: (tripId: string, body: AddTravellerRequest) => request({ method: 'POST', path: tripTravellersRoute(tripId), body }, TripTravellersResponse),
  role: (tripId: string, travellerId: string, role: TravellerRole) => request({ method: 'PATCH', path: tripTravellerRoute(tripId, travellerId), body: { role } }, TripTravellersResponse),
  remove: (tripId: string, travellerId: string) => request({ method: 'DELETE', path: tripTravellerRoute(tripId, travellerId) }, TripTravellersResponse),
  sharePrices: (tripId: string, sharePrices: boolean) => request({ method: 'PATCH', path: tripTravellersRoute(tripId), body: { sharePrices } }, TripTravellersResponse),
  invite: (tripId: string, body: TripInviteRequest) => request({ method: 'POST', path: tripInviteRoute(tripId), body }, TripInviteResponse),
  change: (tripId: string, changeId: string) => request({ method: 'GET', path: changeRequestRoute(tripId, changeId) }, ChangeRequestResponse),
  decide: (tripId: string, changeId: string, body: DecideChangeRequest) => request({ method: 'POST', path: `${changeRequestRoute(tripId, changeId)}/decide`, body }, ChangeRequestResponse),
  shared: () => request({ method: 'GET', path: SHARED_TRIPS_ROUTE }, SharedTripsResponse),
  sharedTrip: (tripId: string) => request({ method: 'GET', path: sharedTripRoute(tripId) }, SharedTripResponse),
  answer: (inviteId: string, answer: 'accept' | 'decline') => request({ method: 'POST', path: sharedInviteRoute(inviteId, answer), body: {} }, SharedTripsResponse),
};

export const pk = {
  travellers: (tripId: string) => ['trip-people', tripId] as const,
  change: (tripId: string, changeId: string) => ['trip-change', tripId, changeId] as const,
  shared: ['trips-shared'] as const,
  sharedTrip: (tripId: string) => ['trips-shared', tripId] as const,
};

const signedIn = () => useSession.getState().status === 'signedIn';

export function useTravellers(tripId: string | null | undefined) {
  return useQuery({ queryKey: pk.travellers(tripId ?? ''), queryFn: () => peopleApi.list(tripId!), enabled: !!tripId && signedIn() });
}

/** A change request's live state: both chats show the same card, so it is read again (every 20 s while open). */
export function useChange(tripId: string, changeId: string, open: boolean) {
  return useQuery({ queryKey: pk.change(tripId, changeId), queryFn: () => peopleApi.change(tripId, changeId).then((r) => r.change), enabled: signedIn(), refetchInterval: open ? 20_000 : false });
}

export function useSharedTrips() {
  const status = useSession((s) => s.status);
  return useQuery({ queryKey: pk.shared, queryFn: peopleApi.shared, enabled: status === 'signedIn' });
}

export function useSharedTrip(tripId: string) {
  return useQuery({ queryKey: pk.sharedTrip(tripId), queryFn: () => peopleApi.sharedTrip(tripId), enabled: signedIn() });
}

/** Set the list in the cache after a write, so the screen shows what the server now holds. */
export function useTravellersWrite(tripId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (run: () => Promise<Awaited<ReturnType<typeof peopleApi.list>>>) => run(),
    onSuccess: (data) => { qc.setQueryData(pk.travellers(tripId), data); void qc.invalidateQueries({ queryKey: ['trips'] }); },
  });
}
