import { ERROR_CODES, addDays, money, t, todayIn, type BookReadyResponse, type ErrorCode, type OrderDraft, type OrderPreview } from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock } from '../mock-api';
import { bookingMock } from './booking';
import { esimMock } from './esim';

/*
 * GET /trips/{id}/plan/ready in mock mode ("Book what's ready", ASK-INTEGRATED §7.2): a Riyadh → Istanbul plan with a
 * flight, a stay and an eSIM priced from the mock's own searches (sample fares), and the flight home whose price ran
 * out. The flight is a sample fare from the catalogue, as the server marks it. Each line is priced by the mock order sheet, so the sheet books them through the same POST /orders as always.
 */

const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy) } } });

const ITEM = { out: 'a7d3c1e0-5b2f-4c8a-9e61-0d4b7f2a9c11', stay: 'b8e4d2f1-6c3a-4d9b-8f72-1e5c8a3b0d22', esim: 'c9f5e3a2-7d4b-4ea0-9a83-2f6d9b4c1e33', home: 'd0a6f4b3-8e5c-4fb1-8b94-3a7e0c5d2f44' } as const;
const cache = new Map<string, { at: number; out: BookReadyResponse }>();

export const planReadyMock: AreaMock = async (w, ctx) => {
  const m = /^\/trips\/([0-9a-f-]{36})\/plan\/ready$/.exec(w.path.split('?')[0] ?? '');
  if (!m || w.method !== 'GET') return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const tripId = m[1]!;
  const key = `${ctx.user.id}:${tripId}:${w.path.split('?')[1] ?? ''}`;
  const hit = cache.get(key);
  // The offers behind it live 10 minutes in the mock: the same sheet until then.
  if (hit && Date.now() - hit.at < 8 * 60_000) return ok(hit.out);
  const call = async (method: 'GET' | 'POST', path: string, body?: unknown) => {
    const area = path.startsWith('/esim') ? esimMock : bookingMock;
    const r = await area({ method, path, body, token: w.token }, ctx);
    return (r?.status ?? 500) < 300 ? (r!.json as Record<string, unknown>) : null;
  };
  const people = ctx.user.people;
  const self = people.find((p) => p.isSelf) ?? people[0]!;
  const travellerIds = [self.id];
  const start = addDays(todayIn(), 52);
  const flights = await call('POST', '/search/flights', { from: 'RUH', destination: 'istanbul', depart: start, return: null, travellerIds, cabin: 'economy' }) as { options?: { id: string }[] } | null;
  const stays = await call('POST', '/search/stays', { destination: 'istanbul', checkIn: start, nights: 2, travellerIds }) as { options?: { id: string }[] } | null;
  const esims = await call('GET', '/esim/plans?destination=istanbul&days=3') as { recommended?: string | null; plans?: { id: string }[] } | null;
  const drafts: { itemId: string; kind: BookReadyResponse['items'][number]['kind']; mode: BookReadyResponse['items'][number]['mode']; day: number | null; title: string; draft: OrderDraft }[] = [];
  if (flights?.options?.[0]) drafts.push({ itemId: ITEM.out, kind: 'leg', mode: 'flight', day: 0, title: 'Riyadh → Istanbul', draft: { kind: 'trip', flightOfferId: flights.options[0].id, bundle: false, travellerIds, tripId, planItemIds: [ITEM.out] } });
  if (stays?.options?.[0]) drafts.push({ itemId: ITEM.stay, kind: 'stay', mode: null, day: 0, title: 'Stay in Istanbul', draft: { kind: 'stay', stayOfferId: stays.options[0].id, travellerIds, tripId, planItemIds: [ITEM.stay] } });
  const pkg = esims?.recommended ?? esims?.plans?.[0]?.id;
  if (pkg) drafts.push({ itemId: ITEM.esim, kind: 'note', mode: null, day: null, title: 'eSIM for Türkiye', draft: { kind: 'esim', count: travellerIds.length, packageId: pkg, where: 'TR', tripId, travellerIds, planItemIds: [ITEM.esim] } });
  const items: BookReadyResponse['items'] = [];
  for (const d of drafts) {
    const r = await call('POST', '/orders/preview', { draft: d.draft, useCredit: false }) as { preview?: OrderPreview } | null;
    const p = r?.preview;
    if (!p) continue;
    items.push({ itemId: d.itemId, kind: d.kind, mode: d.mode, day: d.day, title: d.title, draft: d.draft as BookReadyResponse['items'][number]['draft'], lines: p.lines, total: p.total, rule: p.rule, demo: p.demoFare ?? d.kind === 'leg', quote: false, expiresAt: p.holdExpiresAt });
  }
  const out: BookReadyResponse = {
    tripId, title: 'Riyadh → Istanbul', items,
    expired: [{ itemId: ITEM.home, title: 'Istanbul → Riyadh', kind: 'leg', mode: 'flight', day: 2 }],
    total: money(items.reduce((a, i) => a + i.total.amount, 0)), demo: items.some((i) => i.demo),
  };
  cache.set(key, { at: Date.now(), out });
  return ok(out);
};
