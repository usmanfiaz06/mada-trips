import { useQuery } from '@tanstack/react-query';
import { ESIM_ROUTES, EsimPlacesResponse, EsimPlansResponse, EsimResponse, EsimsResponse, EsimTopupsResponse } from '@mada/shared';
import { request } from './api';
import { useSession } from './session';

/*
 * eSIMs: GET /esim/plans, /esims (?order= | ?trip=), /esims/{id}, /esims/{id}/topups, POST /esims/{id}/installed
 * (shared/schemas/esim.ts). Paying goes through the order sheet with draft { kind: 'esim', packageId, where, … }.
 * An eSIM still being ordered is read again every couple of seconds; one on a trip every few minutes.
 */

export type PlansFor = { tripId?: string | null; destination?: string | null; countries?: string | null; region?: string | null; days?: number | null };

const qs = (o: Record<string, string | number | null | undefined>) => {
  const p = Object.entries(o).filter(([, v]) => v !== null && v !== undefined && v !== '').map(([k, v]) => `${k}=${encodeURIComponent(String(v))}`);
  return p.length ? `?${p.join('&')}` : '';
};

export const esimApi = {
  plans: (f: PlansFor, signal?: AbortSignal) => request({ method: 'GET', path: `${ESIM_ROUTES.plans}${qs({ tripId: f.tripId, destination: f.destination, countries: f.countries, region: f.region, days: f.days })}`, signal }, EsimPlansResponse),
  places: () => request({ method: 'GET', path: ESIM_ROUTES.places }, EsimPlacesResponse),
  list: (f: { order?: string | null; trip?: string | null }) => request({ method: 'GET', path: `${ESIM_ROUTES.esims}${qs(f)}` }, EsimsResponse),
  get: (id: string) => request({ method: 'GET', path: ESIM_ROUTES.esim(id) }, EsimResponse),
  topups: (id: string) => request({ method: 'GET', path: ESIM_ROUTES.topups(id) }, EsimTopupsResponse),
  installed: (id: string) => request({ method: 'POST', path: ESIM_ROUTES.installed(id), body: {} }, EsimResponse),
};

export const esimKeys = {
  plans: (f: PlansFor) => ['esim', 'plans', f.tripId ?? '', f.destination ?? '', f.countries ?? '', f.region ?? '', f.days ?? 0] as const,
  places: ['esim', 'places'] as const,
  list: (f: { order?: string | null; trip?: string | null }) => ['esim', 'list', f.order ?? '', f.trip ?? ''] as const,
  one: (id: string) => ['esim', 'one', id] as const,
  topups: (id: string) => ['esim', 'topups', id] as const,
};

const useSignedIn = () => !!useSession((s) => s.tokens);

export function useEsimPlans(f: PlansFor, enabled = true) {
  const signedIn = useSignedIn();
  return useQuery({ queryKey: esimKeys.plans(f), queryFn: ({ signal }) => esimApi.plans(f, signal), enabled: enabled && signedIn && !!(f.tripId || f.destination || f.countries || f.region), staleTime: 10 * 60_000, retry: false });
}
/** Every country and region the supplier sells (GET /esim/places), for "Where to?". */
export function useEsimPlaces(enabled = true) {
  const signedIn = useSignedIn();
  return useQuery({ queryKey: esimKeys.places, queryFn: async () => (await esimApi.places()).places, enabled: enabled && signedIn, staleTime: 60 * 60_000, retry: 1 });
}
export function useEsims(f: { order?: string | null; trip?: string | null }, enabled = true) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: esimKeys.list(f), queryFn: () => esimApi.list(f), enabled: enabled && signedIn && !!(f.order || f.trip),
    refetchInterval: (q) => (q.state.data?.esims.some((e) => e.status === 'ordering') ? 2000 : false),
  });
}
/** All my eSIMs (the wallet), newest first. */
export function useMyEsims() {
  const signedIn = useSignedIn();
  return useQuery({ queryKey: ['esim', 'list', 'all'] as const, queryFn: () => esimApi.list({}), enabled: signedIn, staleTime: 60_000 });
}
export function useEsim(id: string) {
  const signedIn = useSignedIn();
  return useQuery({
    queryKey: esimKeys.one(id), queryFn: () => esimApi.get(id), enabled: !!id && signedIn,
    refetchInterval: (q) => { const s = q.state.data?.esim.status; return s === 'ordering' ? 2000 : s === 'active' ? 5 * 60_000 : false; },
  });
}
export function useEsimTopups(id: string, enabled: boolean) {
  const signedIn = useSignedIn();
  return useQuery({ queryKey: esimKeys.topups(id), queryFn: () => esimApi.topups(id), enabled: enabled && !!id && signedIn, staleTime: 10 * 60_000, retry: false });
}

/** "5 GB · 30 days", "Unlimited · 7 days" or, for a daily plan, "1 GB a day · 7 days". */
export const planLabel = (p: { gb: number | null; days: number; daily?: boolean }, t: (k: 'es.plan.gb' | 'es.plan.unlimited' | 'es.plan.daily', v: Record<string, string | number>) => string) =>
  p.gb === null ? t('es.plan.unlimited', { days: p.days }) : p.daily ? t('es.plan.daily', { gb: p.gb, days: p.days }) : t('es.plan.gb', { gb: p.gb, days: p.days });
