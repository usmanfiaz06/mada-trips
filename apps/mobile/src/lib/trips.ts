import { useEffect, useState } from 'react';
import { Platform } from 'react-native';
import { dehydrate, hydrate, onlineManager, useMutation, useQuery, useQueryClient, type QueryKey } from '@tanstack/react-query';
import { create } from 'zustand';
import { z } from 'zod';
import {
  ChangeFlightResponse, ChangeOptionsResponse, DisruptionChoiceResponse, DisruptionResponse, FlightStatusResponse, InvoiceResponse, ItineraryResponse, MoveResponse,
  PaymentsResponse, RefundQuoteResponse, RefundResponse, TRIP_ROUTES, TrackedResponse, TripAskResponse, TripPhase, TripRefreshResponse, TripResponse, TripsResponse,
  Notification, TrackedFlightView,
  type ChangeFlightRequest, type ChangeKind, type Company, type CreateRefundRequest, type CreateTripAskRequest, type DisruptionKind, type PatchTripRequest, type TrackFlightRequest,
} from '@mada/shared';
import { ApiError, request } from './api';
import { API_MODE } from './config';
import { queryClient } from './queries';
import { useSession } from './session';

/*
 * The trip companion's client: every call to the Core API for trips, refunds, invoices, tracked flights, the inbox and
 * devices, the React Query hooks the screens use, and three things travel days need:
 *  - the trip clock's demo override (mock mode or demo hints only),
 *  - an offline copy of everything under ['trips'] so travel-day screens open without signal,
 *  - an outbox: a choice made offline is saved on the phone and sent once there's a connection.
 */

/* ───────── small persistent storage (localStorage on the web, a file in the app's documents on a phone) ───────── */

const web = Platform.OS === 'web';
async function fileFor(name: string) {
  const { File, Paths } = await import('expo-file-system');
  return new File(Paths.document, name);
}
export async function kvGet(key: string): Promise<string | null> {
  try {
    if (web) return globalThis.localStorage?.getItem(key) ?? null;
    const f = await fileFor(`${key}.json`);
    return f.exists ? await f.text() : null;
  } catch { return null; }
}
export async function kvSet(key: string, value: string | null): Promise<void> {
  try {
    if (web) { if (value === null) globalThis.localStorage?.removeItem(key); else globalThis.localStorage?.setItem(key, value); return; }
    const f = await fileFor(`${key}.json`);
    if (value === null) { if (f.exists) f.delete(); return; }
    if (!f.exists) f.create();
    f.write(value);
  } catch { /* storage unavailable: the app still works online */ }
}

/* ───────── the demo override (EXPERIENCE: the prototype's demo panel) ───────── */

export const DEMO_ALLOWED = API_MODE === 'mock' || __DEV__ || process.env.EXPO_PUBLIC_DEMO_HINTS === 'yes';

type DemoState = { phase: TripPhase | null; offline: boolean; setPhase: (p: TripPhase | null) => void; setOffline: (o: boolean) => void };
function initialPhase(): TripPhase | null {
  if (!DEMO_ALLOWED || !web) return null;
  try {
    const q = new URLSearchParams(globalThis.location?.search ?? '').get('phase');
    const p = TripPhase.safeParse(q ?? globalThis.localStorage?.getItem('mada.demo.phase'));
    return p.success ? p.data : null;
  } catch { return null; }
}
function initialOffline(): boolean {
  if (!DEMO_ALLOWED || !web) return false;
  try { return new URLSearchParams(globalThis.location?.search ?? '').get('offline') === '1'; } catch { return false; }
}
export const useDemo = create<DemoState>((set) => ({
  phase: initialPhase(),
  offline: initialOffline(),
  setPhase(phase) {
    set({ phase });
    try { if (web) { if (phase) globalThis.localStorage?.setItem('mada.demo.phase', phase); else globalThis.localStorage?.removeItem('mada.demo.phase'); } } catch { /* */ }
    void queryClient.invalidateQueries({ queryKey: ['trips'] });
  },
  setOffline(offline) {
    set({ offline });
    onlineManager.setOnline(!offline);
  },
}));
if (useDemo.getState().offline) onlineManager.setOnline(false);

/** Appends the demo phase so the server's trip clock shows that moment (ignored outside mock mode). */
const withPhase = (path: string) => {
  const p = useDemo.getState().phase;
  if (!p || !DEMO_ALLOWED) return path;
  return `${path}${path.includes('?') ? '&' : '?'}demoPhase=${p}`;
};

/** In the demo, "Offline" really is offline: nothing leaves the phone. */
function guard() {
  if (useDemo.getState().offline) throw new ApiError('OFFLINE', 'You’re offline.', 0);
}
const get = <S extends z.ZodType>(path: string, schema: S) => { guard(); return request({ method: 'GET', path: withPhase(path) }, schema); };
const send = <S extends z.ZodType>(method: 'POST' | 'PATCH' | 'DELETE', path: string, body: unknown, schema: S) => { guard(); return request({ method, path: withPhase(path), body }, schema); };

export const newKey = () => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;

const Ok = z.object({ ok: z.boolean() }).passthrough();
const NotificationsResponse = z.object({ items: z.array(Notification), next: z.string().nullable(), unread: z.number().int() });
const RefundsResponse = z.object({ refunds: z.array(RefundResponse.shape.refund) });
const RequestsResponse = z.object({ requests: z.array(TripAskResponse.shape.request.unwrap()) });

export const tripsApi = {
  list: () => get(TRIP_ROUTES.trips, TripsResponse),
  trip: (id: string) => get(TRIP_ROUTES.trip(id), TripResponse),
  patch: (id: string, patch: PatchTripRequest) => send('PATCH', TRIP_ROUTES.trip(id), patch, TripResponse),
  itinerary: (id: string) => get(TRIP_ROUTES.itinerary(id), ItineraryResponse),
  refresh: (id: string) => send('POST', TRIP_ROUTES.refresh(id), {}, TripRefreshResponse),
  payments: (id: string) => get(TRIP_ROUTES.payments(id), PaymentsResponse),
  refundQuote: (id: string) => get(TRIP_ROUTES.refundQuote(id), RefundQuoteResponse),
  refund: (id: string, body: CreateRefundRequest) => send('POST', TRIP_ROUTES.refunds(id), body, RefundResponse),
  cancelStay: (id: string, clientKey: string) => send('POST', TRIP_ROUTES.cancelStay(id), { clientKey }, RefundResponse),
  changeOptions: (id: string, kind: ChangeKind) => get(TRIP_ROUTES.changeOptions(id, kind), ChangeOptionsResponse),
  change: (id: string, body: ChangeFlightRequest) => send('POST', TRIP_ROUTES.changes(id), body, ChangeFlightResponse),
  move: (id: string, body: { hotel: boolean; pickup: boolean }) => send('POST', TRIP_ROUTES.move(id), body, MoveResponse),
  requests: (id: string) => get(TRIP_ROUTES.asks(id), RequestsResponse),
  ask: (id: string, body: CreateTripAskRequest) => send('POST', TRIP_ROUTES.asks(id), body, TripAskResponse),
  disruption: (id: string, kind?: DisruptionKind) => get(TRIP_ROUTES.disruption(id, kind), DisruptionResponse),
  choose: (id: string, body: { kind: DisruptionKind; optionId: string; clientKey: string }) => send('POST', TRIP_ROUTES.disruption(id), body, DisruptionChoiceResponse),
  demo: () => send('POST', TRIP_ROUTES.demo, {}, z.object({ tripId: z.string() })),
  refunds: () => get('/refunds', RefundsResponse),
  refundOne: (id: string) => get(TRIP_ROUTES.refund(id), RefundResponse),
  invoice: (id: string) => get(TRIP_ROUTES.invoice(id), InvoiceResponse),
  company: (id: string, company: Company) => send('POST', TRIP_ROUTES.invoiceCompany(id), { company }, InvoiceResponse),
  issue: (id: string) => send('POST', TRIP_ROUTES.invoiceIssue(id), {}, InvoiceResponse),
  tracked: () => get(TRIP_ROUTES.tracked, TrackedResponse),
  track: (body: TrackFlightRequest) => send('POST', TRIP_ROUTES.tracked, body, z.object({ flight: TrackedFlightView })),
  untrack: (id: string) => send('DELETE', TRIP_ROUTES.trackedOne(id), undefined, Ok),
  importTracked: (flights: TrackFlightRequest[]) => send('POST', TRIP_ROUTES.trackedImport, { flights }, TrackedResponse),
  flightStatus: (no: string, date: string) => { guard(); return request({ method: 'GET', path: TRIP_ROUTES.flightStatus(no, date), auth: !!useSession.getState().tokens }, FlightStatusResponse); },
  notifications: () => get(TRIP_ROUTES.notifications, NotificationsResponse),
  markRead: (body: { ids: string[] } | { all: true }) => send('PATCH', TRIP_ROUTES.notifications, body, z.object({ ok: z.boolean(), unread: z.number() })),
  registerDevice: (pushToken: string, platform: 'ios' | 'android' | 'web', name?: string) => send('POST', TRIP_ROUTES.devices, { pushToken, platform, name }, z.object({ deviceId: z.string() })),
};

/* ───────── query keys and hooks ───────── */

export const tk = {
  all: ['trips'] as const,
  list: (phase: string | null) => ['trips', 'list', phase ?? 'real'] as const,
  trip: (id: string, phase: string | null) => ['trips', 'trip', id, phase ?? 'real'] as const,
  itinerary: (id: string, phase: string | null) => ['trips', 'itinerary', id, phase ?? 'real'] as const,
  payments: (id: string) => ['trips', 'payments', id] as const,
  quote: (id: string, phase: string | null) => ['trips', 'quote', id, phase ?? 'real'] as const,
  invoice: (id: string) => ['trips', 'invoice', id] as const,
  disruption: (id: string, kind: string | undefined, phase: string | null) => ['trips', 'disruption', id, kind ?? '', phase ?? 'real'] as const,
  requests: (id: string) => ['trips', 'requests', id] as const,
  inbox: ['trips', 'inbox'] as const,
  changeOptions: (id: string, kind: string) => ['trips', 'change', id, kind] as const,
};

const signedIn = () => useSession.getState().status === 'signedIn';

export function useTrips() {
  const status = useSession((s) => s.status);
  const phase = useDemo((s) => s.phase);
  return useQuery({ queryKey: tk.list(phase), queryFn: tripsApi.list, enabled: status === 'signedIn', refetchInterval: 4000 });
}
export function useTrip(id: string | null | undefined) {
  const phase = useDemo((s) => s.phase);
  return useQuery({ queryKey: tk.trip(id ?? '', phase), queryFn: () => tripsApi.trip(id!), enabled: !!id && signedIn() });
}
export function useItinerary(id: string) {
  const phase = useDemo((s) => s.phase);
  return useQuery({ queryKey: tk.itinerary(id, phase), queryFn: () => tripsApi.itinerary(id), enabled: signedIn() });
}
export function usePayments(id: string) {
  return useQuery({ queryKey: tk.payments(id), queryFn: () => tripsApi.payments(id), enabled: signedIn() });
}
export function useRefundQuote(id: string) {
  const phase = useDemo((s) => s.phase);
  return useQuery({ queryKey: tk.quote(id, phase), queryFn: () => tripsApi.refundQuote(id), enabled: signedIn() });
}
export function useInvoice(id: string) {
  return useQuery({ queryKey: tk.invoice(id), queryFn: () => tripsApi.invoice(id), enabled: signedIn() });
}
export function useDisruption(id: string, kind?: DisruptionKind) {
  const phase = useDemo((s) => s.phase);
  return useQuery({ queryKey: tk.disruption(id, kind, phase), queryFn: () => tripsApi.disruption(id, kind), enabled: signedIn() });
}
export function useTripRequests(id: string) {
  return useQuery({ queryKey: tk.requests(id), queryFn: () => tripsApi.requests(id), enabled: signedIn(), refetchInterval: 3000 });
}
export function useInbox() {
  const status = useSession((s) => s.status);
  return useQuery({ queryKey: tk.inbox, queryFn: tripsApi.notifications, enabled: status === 'signedIn' });
}
export function useChangeOptions(id: string, kind: ChangeKind | null) {
  return useQuery({ queryKey: tk.changeOptions(id, kind ?? ''), queryFn: () => tripsApi.changeOptions(id, kind!), enabled: !!kind && kind !== 'airline' && kind !== 'name' && signedIn() });
}

/** After any change to a trip, everything about trips is re-read. */
export function useTripMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({ mutationFn: fn, onSettled: () => qc.invalidateQueries({ queryKey: tk.all }) });
}

/* ───────── offline copy of the trip data ───────── */

const CACHE_KEY = 'mada.trips.cache.v1';
let restored = false;

/** Restores the last copy of the trip screens once at launch, then keeps writing it (debounced) as data changes. */
export function useOfflineTrips() {
  const [ready, setReady] = useState(restored);
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    if (!restored) {
      restored = true;
      void kvGet(CACHE_KEY).then((raw) => {
        if (raw) {
          try { hydrate(queryClient, JSON.parse(raw)); } catch { /* an old copy: ignore */ }
        }
        setReady(true);
      });
    }
    const unsub = queryClient.getQueryCache().subscribe(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        const state = dehydrate(queryClient, { shouldDehydrateQuery: (q) => q.queryKey[0] === 'trips' && q.state.status === 'success' });
        void kvSet(CACHE_KEY, JSON.stringify(state));
      }, 800);
    });
    return () => { clearTimeout(timer); unsub(); };
  }, []);
  return ready;
}

/** When a query last succeeded, for "Offline · last update at 06:41". */
export function lastUpdated(key: QueryKey): number | null {
  return queryClient.getQueryState(key)?.dataUpdatedAt ?? null;
}

export const isOfflineError = (e: unknown) => e instanceof ApiError && e.code === 'OFFLINE';

/* ───────── the outbox: choices made offline ───────── */

export type Queued =
  | { id: string; kind: 'disruption'; tripId: string; body: { kind: DisruptionKind; optionId: string; clientKey: string }; at: number }
  | { id: string; kind: 'ask'; tripId: string; body: CreateTripAskRequest; title: string; at: number };

type OutboxState = { items: Queued[]; add: (q: Queued) => void; remove: (id: string) => void; load: () => Promise<void> };
const OUTBOX_KEY = 'mada.trips.outbox.v1';
export const useOutbox = create<OutboxState>((set, getState) => ({
  items: [],
  add(q) { const items = [...getState().items, q]; set({ items }); void kvSet(OUTBOX_KEY, JSON.stringify(items)); },
  remove(id) { const items = getState().items.filter((x) => x.id !== id); set({ items }); void kvSet(OUTBOX_KEY, JSON.stringify(items)); },
  async load() { const raw = await kvGet(OUTBOX_KEY); if (raw) { try { set({ items: JSON.parse(raw) as Queued[] }); } catch { /* */ } } },
}));

let flushing = false;
/** Sends what's waiting. Each item carries its client key, so a retry never does it twice on the server. */
export async function flushOutbox(): Promise<number> {
  if (flushing || useDemo.getState().offline) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const q of [...useOutbox.getState().items]) {
      try {
        if (q.kind === 'disruption') await tripsApi.choose(q.tripId, q.body);
        else await tripsApi.ask(q.tripId, q.body);
        useOutbox.getState().remove(q.id);
        sent += 1;
      } catch (e) {
        if (isOfflineError(e)) break;
        useOutbox.getState().remove(q.id); // the server refused it on purpose: don't retry forever
      }
    }
  } finally { flushing = false; }
  if (sent) void queryClient.invalidateQueries({ queryKey: tk.all });
  return sent;
}

/** Keeps the outbox moving: on launch, whenever the connection comes back, and every 15 seconds while items wait. */
export function useOutboxPump() {
  const items = useOutbox((s) => s.items.length);
  const offline = useDemo((s) => s.offline);
  useEffect(() => { void useOutbox.getState().load(); }, []);
  useEffect(() => onlineManager.subscribe((online) => { if (online) void flushOutbox(); }), []);
  useEffect(() => {
    if (!items || offline) return;
    void flushOutbox();
    const t = setInterval(() => void flushOutbox(), 15_000);
    return () => clearInterval(t);
  }, [items, offline]);
}

/* ───────── guest tracked flights, carried over at sign-up ───────── */

export type GuestFlight = TrackFlightRequest & { id: string; known: boolean; carrierName: string | null; from: string | null; to: string | null; departLocal: string | null; arriveLocal: string | null; durationMin: number | null; brand: string | null };
type GuestState = { flights: GuestFlight[]; loaded: boolean; add: (f: GuestFlight) => void; remove: (id: string) => void; clear: () => void; load: () => Promise<void> };
const GUEST_KEY = 'mada.guest.tracked.v1';
export const useGuestFlights = create<GuestState>((set, getState) => ({
  flights: [], loaded: false,
  add(f) { const flights = [f, ...getState().flights.filter((x) => !(x.flightNumber === f.flightNumber && x.date === f.date))]; set({ flights }); void kvSet(GUEST_KEY, JSON.stringify(flights)); },
  remove(id) { const flights = getState().flights.filter((x) => x.id !== id); set({ flights }); void kvSet(GUEST_KEY, JSON.stringify(flights)); },
  clear() { set({ flights: [] }); void kvSet(GUEST_KEY, null); },
  async load() { const raw = await kvGet(GUEST_KEY); set({ loaded: true, ...(raw ? { flights: JSON.parse(raw) as GuestFlight[] } : {}) }); },
}));

/** Once signed in, flights tracked as a guest move onto the account. */
export function useCarryOverGuestFlights() {
  const status = useSession((s) => s.status);
  useEffect(() => { void useGuestFlights.getState().load(); }, []);
  useEffect(() => {
    if (status !== 'signedIn') return;
    const { flights } = useGuestFlights.getState();
    if (!flights.length) return;
    tripsApi.importTracked(flights.map(({ flightNumber, date, alerts }) => ({ flightNumber, date, alerts })))
      .then(() => { useGuestFlights.getState().clear(); void queryClient.invalidateQueries({ queryKey: tk.all }); })
      .catch(() => { /* try again next launch */ });
  }, [status]);
}

/* ───────── push registration ───────── */

let registered = false;
/** Registers this phone's Expo push token once alerts are allowed. Quietly does nothing on the web or a simulator. */
export async function registerForPush(): Promise<void> {
  if (registered || web || !signedIn()) return;
  try {
    const N = await import('expo-notifications');
    const perm = await N.getPermissionsAsync();
    if (!perm.granted) return;
    const token = (await N.getExpoPushTokenAsync()).data;
    await tripsApi.registerDevice(token, Platform.OS === 'ios' ? 'ios' : 'android');
    registered = true;
  } catch { /* no project id in development builds, or no network: try again next launch */ }
}
