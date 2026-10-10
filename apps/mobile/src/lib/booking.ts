import { useQuery, useQueryClient } from '@tanstack/react-query';
import { create } from 'zustand';
import {
  AskParseResponse, CreateOrderResponse, EntryCheckResponse, FlightSearchResponse, MessagesResponse, OfferResponse, OrderResponse, OrdersResponse,
  PlanResponse, PlansResponse, PreviewResponse, RequestResponse, RequestsResponse, StaySearchResponse, BookingRequestView, ThreadMessage,
  type CreateOrderBody, type CreateRequestBody, type DemoFlag, type EntryCheckRequest, type FlightSearchRequest, type OrderDraft, type PreviewBody, type StaySearchRequest,
} from '@mada/shared';
import { z } from 'zod';
import { ApiError, request } from './api';
import { API_MODE } from './config';
import { t } from './i18n';
import { useSession } from './session';
import { toast } from './toast';

/*
 * Booking's client (M2): Ask, search, entry checks, plans, requests and their threads, the order sheet, orders and the
 * wait for the desk. Every response is checked against the shared schema. Demo switches (mock suppliers only) travel
 * as ?demo=…; "offline" is simulated here, so the app's offline paths can be shown without pulling the cable.
 */

/* ───────────── demo switches ───────────── */

type DemoState = { on: Set<DemoFlag>; toggle: (f: DemoFlag) => void; set: (f: DemoFlag, v: boolean) => void };
export const useDemo = create<DemoState>((set) => ({
  on: new Set(),
  toggle: (f) => set((s) => { const on = new Set(s.on); if (on.has(f)) on.delete(f); else on.add(f); return { on }; }),
  set: (f, v) => set((s) => { const on = new Set(s.on); if (v) on.add(f); else on.delete(f); return { on }; }),
}));
export const demoOn = (f: DemoFlag) => useDemo.getState().on.has(f);

/** The switches that matter to the server, as a query string. */
function q(path: string): string {
  const flags = [...useDemo.getState().on].filter((f) => f !== 'offline' && f !== 'faceIdFails');
  return flags.length ? `${path}${path.includes('?') ? '&' : '?'}demo=${flags.join(',')}` : path;
}

function guardOffline() {
  if (demoOn('offline')) throw new ApiError('OFFLINE', t('error.offline'), 0);
}

async function call<S extends z.ZodType>(method: 'GET' | 'POST', path: string, schema: S, body?: unknown): Promise<z.infer<S>> {
  guardOffline();
  return request({ method, path: q(path), body }, schema);
}

const QuoteOut = z.object({ request: BookingRequestView, messages: z.array(ThreadMessage) });

export const bookingApi = {
  parse: (text: string, tripCity?: string | null) => call('POST', '/ask/parse', AskParseResponse, { text, tripCity }),
  searchFlights: (b: FlightSearchRequest) => call('POST', '/search/flights', FlightSearchResponse, b),
  searchStays: (b: StaySearchRequest) => call('POST', '/search/stays', StaySearchResponse, b),
  entry: (b: EntryCheckRequest) => call('POST', '/search/entry', EntryCheckResponse, b),
  offer: (id: string) => call('GET', `/offers/${id}`, OfferResponse),
  reprice: (id: string) => call('POST', `/offers/${id}/price`, OfferResponse, {}),
  plans: () => call('GET', '/plans', PlansResponse),
  plan: (id: string) => call('GET', `/plans/${encodeURIComponent(id)}`, PlanResponse),
  requests: () => call('GET', '/requests', RequestsResponse),
  request: (id: string) => call('GET', `/requests/${id}`, RequestResponse),
  createRequest: (b: CreateRequestBody) => call('POST', '/requests', RequestResponse, b),
  messages: (id: string) => call('GET', `/requests/${id}/messages`, MessagesResponse),
  postMessage: (id: string, text: string) => call('POST', `/requests/${id}/messages`, MessagesResponse, { text }),
  acceptOffer: (quoteId: string, messageId: string) => call('POST', `/quotes/${quoteId}/accept-offer`, QuoteOut, { messageId }),
  preview: (b: PreviewBody) => call('POST', '/orders/preview', PreviewResponse, b),
  createOrder: (b: CreateOrderBody) => call('POST', '/orders', CreateOrderResponse, b),
  order: (id: string) => request({ method: 'GET', path: `/orders/${id}` }, OrderResponse),
  activeOrders: () => request({ method: 'GET', path: '/orders' }, OrdersResponse),
  otp: (id: string, code: string) => call('POST', `/orders/${id}/3ds`, OrderResponse, { code }),
  answer: (id: string, answer: 'yes' | 'call' | 'accept_fare' | 'stop' | 'retry_by_phone' | 'cancel') => call('POST', `/orders/${id}/answer`, OrderResponse, { answer }),
};

export const bookingKeys = {
  plans: ['booking', 'plans'] as const,
  plan: (id: string) => ['booking', 'plan', id] as const,
  requests: ['booking', 'requests'] as const,
  request: (id: string) => ['booking', 'request', id] as const,
  messages: (id: string) => ['booking', 'messages', id] as const,
  order: (id: string) => ['booking', 'order', id] as const,
};

const useOn = () => useSession((s) => s.status === 'signedIn');
export const usePlans = () => useQuery({ queryKey: bookingKeys.plans, enabled: useOn(), queryFn: async () => (await bookingApi.plans()).plans });
export const usePlan = (id: string) => useQuery({ queryKey: bookingKeys.plan(id), enabled: useOn() && !!id, queryFn: async () => (await bookingApi.plan(id)).plan });
/** A request, polled while Mada is working on it. */
export function useBookingRequest(id: string | null) {
  return useQuery({
    queryKey: bookingKeys.request(id ?? ''), enabled: useOn() && !!id, queryFn: async () => (await bookingApi.request(id!)).request,
    refetchInterval: (qr) => (qr.state.data && ['sent', 'reviewing', 'paid'].includes(qr.state.data.status) ? 1500 : false),
  });
}
export function useThread(id: string | null) {
  return useQuery({
    queryKey: bookingKeys.messages(id ?? ''), enabled: useOn() && !!id, queryFn: () => bookingApi.messages(id!),
    refetchInterval: (qr) => (qr.state.data?.agentTyping || qr.state.data?.messages.at(-1)?.from === 'me' ? 800 : 8000),
  });
}
/** The order with the desk, polled every second until it settles. */
export function useOrder(id: string) {
  return useQuery({
    queryKey: bookingKeys.order(id), enabled: useOn() && !!id, queryFn: async () => (await bookingApi.order(id)).order,
    refetchInterval: (qr) => (qr.state.data && ['confirmed', 'cancelled', 'declined'].includes(qr.state.data.status) ? false : 1000),
  });
}
export const useInvalidateBooking = () => { const qc = useQueryClient(); return () => qc.invalidateQueries({ queryKey: ['booking'] }); };

/* ───────────── what Ask hands the order sheet ───────────── */

export type PayDraft = {
  draft: OrderDraft;
  /** For the sheet before the preview arrives. */
  title: string;
  /** Destination key for entry checks and photos. */
  destination?: string | null;
  /** "See other options" goes back to Ask with this. */
  askAgain?: string | null;
};
type DraftState = { current: PayDraft | null; set: (d: PayDraft) => void; clear: () => void };
export const usePayDraft = create<DraftState>((set) => ({ current: null, set: (d) => set({ current: d }), clear: () => set({ current: null }) }));

/* ───────────── close and finish in the background ───────────── */

const watching = new Set<string>();
/** The With Mada screen was closed: keep polling, and say so the moment Mada confirms it. */
export function finishInBackground(orderId: string) {
  if (watching.has(orderId)) return;
  watching.add(orderId);
  toast(t('wait.background'));
  const tick = async (n: number) => {
    if (!watching.has(orderId) || n > 300) { watching.delete(orderId); return; }
    try {
      const { order } = await bookingApi.order(orderId);
      if (order.status === 'confirmed') {
        watching.delete(orderId);
        toast(t('wait.confirmedToast', { agent: order.confirmedBy?.name ?? order.agent?.name ?? 'Mada', ref: order.ref ?? '' }));
        return;
      }
      if (['cancelled', 'declined'].includes(order.status)) { watching.delete(orderId); return; }
    } catch { /* offline: try again */ }
    setTimeout(() => tick(n + 1), 2000);
  };
  setTimeout(() => tick(0), 1500);
}
export const stopWatching = (orderId: string) => watching.delete(orderId);

/* ───────────── requests saved offline ───────────── */

type Queued = { clientId: string; body: CreateRequestBody };
type QueueState = { items: Queued[]; add: (q: Queued) => void; remove: (id: string) => void };
export const useRequestQueue = create<QueueState>((set) => ({
  items: [],
  add: (q) => set((s) => ({ items: [...s.items.filter((x) => x.clientId !== q.clientId), q] })),
  remove: (id) => set((s) => ({ items: s.items.filter((x) => x.clientId !== id) })),
}));

/** Sends a request, or keeps it to send when the connection is back (FLOWS.md §4). Returns null when queued. */
export async function sendRequest(body: CreateRequestBody) {
  const clientId = body.clientId ?? `rq-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  try {
    return (await bookingApi.createRequest({ ...body, clientId })).request;
  } catch (e) {
    if (e instanceof ApiError && e.code === 'OFFLINE') { useRequestQueue.getState().add({ clientId, body: { ...body, clientId } }); scheduleFlush(); return null; }
    throw e;
  }
}
let flushTimer: ReturnType<typeof setTimeout> | null = null;
function scheduleFlush() {
  if (flushTimer) return;
  flushTimer = setTimeout(async () => {
    flushTimer = null;
    for (const item of useRequestQueue.getState().items) {
      try { await bookingApi.createRequest(item.body); useRequestQueue.getState().remove(item.clientId); } catch { /* still offline */ }
    }
    if (useRequestQueue.getState().items.length) scheduleFlush();
  }, 3000);
}

/* ───────────── the payment provider, on the phone ───────────── */

/**
 * Card details go straight to the payment provider (MyFatoorah's embedded session) and come back as a token; Mada never
 * sees the number. Until the SDK is wired (it needs the merchant account), the mock provider tokenises here and the
 * number never leaves this function.
 */
export async function tokenizeCard(card: { number: string; expiry: string; cvv: string; name: string }): Promise<{ token: string; last4: string }> {
  const digits = card.number.replace(/\D/g, '');
  await new Promise((r) => setTimeout(r, API_MODE === 'mock' ? 300 : 500));
  const rand = Math.random().toString(36).slice(2, 12);
  return { token: `tok_mock_${rand}${digits.slice(-2)}`, last4: digits.slice(-4) };
}

/** One per slide: a retried request never books twice. */
export const newIdempotencyKey = () => `slide-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
