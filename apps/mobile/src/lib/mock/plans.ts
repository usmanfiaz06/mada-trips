import {
  ERROR_CODES, PLANS, PlanOpsRequest, TODAY_PASSPORT_DAYS, addDays, daysBetween, localeOr, planTitle, t, todayCards, todayIn,
  type ChatCard, type ErrorCode, type Plan, type PlanCheck, type PlanItem, type PlanPlace, type PlanOp,
} from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { applyLocal, carOn, gapNights } from '../plan-logic';
import { mockPlanningTrip, mockStaysOf, mockTripsOf } from './trips';
import { mockTripChat, setMockTripChat } from './ask-threads';

/*
 * EXPO_PUBLIC_API_MODE=mock for the living plan (docs/app/ASK-INTEGRATED.md §3, §9.3; U8): the same endpoints as
 * platform/src/app/api/app/v1/trips/[id]/plan/**, /trips/plan, /trips/{id}/change-requests (a companion's edit) and
 * /trips/{id}/chat (the shared trip chat), in memory. Plans come from the two templates (AlUla, Istanbul) and the road
 * trip the demo conversation shows; every write checks the version it was made on (409 PLAN_CHANGED), and a stay
 * booked on the trip shows on its nights. Sample places and times only: the drive numbers are the fixture's, as the
 * drive interface's fixture is on the server.
 *
 * Mock only, for e2e and screenshots: `__MADA_DEMO__.planRole = 'suggest' | 'edit' | 'view'` reads the plan as a
 * companion; `__madaMockPlan.bump(tripId)` changes the plan "on another phone" (its version moves on).
 */

type Stored = { plan: Plan; owner: string };
const plans = new Map<string, Stored>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, extra: Record<string, unknown> = {}): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy), ...extra } } });
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

/** The road trip the demo conversation's plan card is about (ask-chat-demo.ts). */
export const DEMO_ROAD_TRIP = '0f6e2d1c-8b3a-4e59-a7c2-3d1b9e8f4a60';
const DEMO_ROAD_PLAN = '5b0c6a3e-2f41-4c7d-9e18-6a4b2d9f0c11';

const roleNow = (): 'owner' | 'view' | 'suggest' | 'edit' => {
  const r = (globalThis as { __MADA_DEMO__?: { planRole?: string } }).__MADA_DEMO__?.planRole;
  return r === 'view' || r === 'suggest' || r === 'edit' ? r : 'owner';
};

const P = (name: string, code: string | null, country: string, kind: PlanPlace['kind'] = 'city'): PlanPlace => ({ name, kind, code, city: name, country });
const RUH = P('Riyadh', 'RUH', 'SA');
const blank = (o: Partial<PlanItem> & Pick<PlanItem, 'day' | 'sort' | 'kind' | 'title'>): PlanItem => ({
  id: uuid(), mode: null, note: null, place: null, from: null, to: null, startsAt: null, endsAt: null, tz: null, nights: null, status: 'idea', statusLine: null, booking: null,
  requestId: null, offerId: null, drive: null, source: 'template', price: null, quote: null, ...o,
});
const at = (start: string, day: number, hhmm: string | null) => (hhmm ? `${addDays(start, day)}T${hhmm}` : null);

/** A template (PLANS) as a living plan from the traveller's start: the flights out and home are legs from it. */
function fromTemplate(templateId: string, start: string, origin: PlanPlace): { items: PlanItem[]; days: number; dest: PlanPlace } | null {
  const tpl = PLANS[templateId];
  if (!tpl) return null;
  const dest = templateId === 'alula2' ? P('AlUla', 'ULH', 'SA') : P('Istanbul', 'IST', 'TR');
  const items: PlanItem[] = [];
  tpl.plan.forEach((d, day) => d.stops.forEach((s, i) => {
    const sort = (i + 1) * 10;
    if (s.icon === 'flight') {
      const out = day === 0;
      items.push(blank({ day, sort, kind: 'leg', mode: 'flight', title: out ? `${origin.name} → ${dest.name}` : `${dest.name} → ${origin.name}`, from: out ? origin : dest, to: out ? dest : origin, startsAt: origin.code === 'RUH' ? at(start, day, s.time) : null }));
    } else if (s.icon === 'stay') {
      items.push(blank({ day, sort, kind: 'stay', title: `Stay in ${dest.name}`, place: dest, nights: Math.max(1, tpl.days - 1) }));
    } else {
      items.push(blank({ day, sort, kind: s.icon === 'food' ? 'meal' : 'activity', title: s.title, place: { ...dest, kind: 'place', name: s.title, code: null }, startsAt: at(start, day, s.time) }));
    }
  }));
  // A template without its own flights (Istanbul): the legs out and home from the start, untimed, and a stay.
  if (!items.some((i) => i.kind === 'leg' && i.day === 0)) items.unshift(blank({ day: 0, sort: 1, kind: 'leg', mode: 'flight', title: `${origin.name} → ${dest.name}`, from: origin, to: dest, source: 'ask' }));
  if (!items.some((i) => i.kind === 'stay')) items.push(blank({ day: 0, sort: 5, kind: 'stay', title: `Stay in ${dest.name}`, place: dest, nights: Math.max(1, tpl.days - 1), source: 'ask' }));
  if (!items.some((i) => i.kind === 'leg' && i.day === tpl.days - 1 && i.to?.name === origin.name)) items.push(blank({ day: tpl.days - 1, sort: 900, kind: 'leg', mode: 'flight', title: `${dest.name} → ${origin.name}`, from: dest, to: origin, source: 'ask' }));
  return { items, days: tpl.days, dest };
}

/** The demo road trip: Riyadh → Singapore, a drive through Melaka and Kuala Lumpur to Penang, and home. */
function roadTrip(start: string): { items: PlanItem[]; days: number; dest: PlanPlace } {
  const SIN = P('Singapore', 'SIN', 'SG'), MEL = P('Melaka', null, 'MY'), KUL = P('Kuala Lumpur', 'KUL', 'MY'), PEN = P('Penang', 'PEN', 'MY');
  const drive = (km: number, minutes: number, borders: string[] = []) => ({ km, minutes, tolls: true, borders, source: 'map', asOf: new Date().toISOString(), crossings: borders.length ? [{ from: 'SG', to: 'MY', name: 'Woodlands Causeway' }] : [] });
  const items = [
    blank({ day: 0, sort: 10, kind: 'leg', mode: 'flight', title: 'Riyadh → Singapore', from: RUH, to: SIN, source: 'ask' }),
    blank({ day: 0, sort: 20, kind: 'stay', title: 'Stay in Singapore', place: SIN, nights: 2, source: 'ask' }),
    blank({ day: 1, sort: 10, kind: 'activity', title: 'Gardens by the Bay', place: { ...SIN, kind: 'place', name: 'Gardens by the Bay', code: null }, source: 'ask' }),
    blank({ day: 2, sort: 10, kind: 'leg', mode: 'drive', title: 'Singapore → Melaka', from: SIN, to: MEL, drive: drive(240, 205, ['Malaysia']), source: 'ask' }),
    blank({ day: 2, sort: 20, kind: 'car', title: 'Car for days 3–6', nights: 4, status: 'requested', statusLine: t('plan.line.withTeam', { time: '18:40' }), source: 'ask' }),
    blank({ day: 2, sort: 30, kind: 'stay', title: 'Stay in Melaka', place: MEL, nights: 1, source: 'ask' }),
    blank({ day: 3, sort: 10, kind: 'leg', mode: 'drive', title: 'Melaka → Kuala Lumpur', from: MEL, to: KUL, drive: drive(150, 130), source: 'ask' }),
    blank({ day: 3, sort: 20, kind: 'stay', title: 'Stay in Kuala Lumpur', place: KUL, nights: 2, source: 'ask' }),
    blank({ day: 3, sort: 30, kind: 'activity', title: 'Petronas Towers', place: { ...KUL, kind: 'place', name: 'Petronas Towers', code: null }, startsAt: at(start, 3, '18:00'), source: 'ask' }),
    blank({ day: 5, sort: 10, kind: 'leg', mode: 'drive', title: 'Kuala Lumpur → Penang', from: KUL, to: PEN, drive: drive(355, 270), source: 'ask' }),
    blank({ day: 6, sort: 10, kind: 'leg', mode: 'flight', title: 'Penang → Riyadh', from: PEN, to: RUH, source: 'ask' }),
  ];
  return { items, days: 7, dest: SIN };
}

function store(user: MockUser, tripId: string, planId: string, built: { items: PlanItem[]; days: number; dest: PlanPlace }, start: string, templateId: string | null, title: string, photo: string | null): Stored {
  const end = addDays(start, built.days - 1);
  mockPlanningTrip(user, { id: tripId, city: built.dest.name, country: built.dest.country === 'TR' ? 'Türkiye' : built.dest.country === 'SA' ? 'Saudi Arabia' : built.dest.country === 'SG' ? 'Singapore' : null, photo, startDate: start, endDate: end });
  const self = user.people.find((p) => p.isSelf);
  const plan: Plan = {
    id: planId, tripId, version: 1, title, kind: built.days > 3 ? 'road' : 'simple', origin: { ...RUH, source: 'memory' }, originNeeded: false, returnTo: RUH,
    startDate: start, endDate: end, days: built.days, pace: 'normal', templateId, travellerIds: self ? [self.id] : [], notes: [], items: built.items, checks: [], totals: null,
    createdBy: templateId ? 'template' : 'ask', updatedAt: new Date().toISOString(),
  };
  const s = { plan, owner: user.id };
  plans.set(tripId, s);
  return s;
}

function demoRoad(user: MockUser): Stored {
  const have = plans.get(DEMO_ROAD_TRIP);
  if (have) return have;
  const start = addDays(todayIn(), 52);
  return store(user, DEMO_ROAD_TRIP, DEMO_ROAD_PLAN, roadTrip(start), start, null, 'Riyadh → Singapore → Penang', 'inflight-window');
}

/** A plan made from a template for this account, on a new planning trip ("Use this plan", the demo conversation). */
export function mockCreatePlan(user: MockUser, templateId: string, start = addDays(todayIn(), 45)): Plan | null {
  const built = fromTemplate(templateId, start, RUH);
  if (!built) return null;
  const tpl = PLANS[templateId]!;
  return store(user, uuid(), uuid(), built, start, templateId, planTitle(RUH, [built.dest]), tpl.photo).plan;
}

/** The plan as it reads now: stays booked on the trip on their nights, the checks, the access of the reader. */
function read(user: MockUser, s: Stored): { plan: Plan; access: { role: 'owner' | 'view' | 'suggest' | 'edit'; prices: boolean; ownerName: string | null }; people: { name: string; initial: string }[] } {
  const stays = mockStaysOf(user, s.plan.tripId);
  const used = new Set<string>();
  const items = s.plan.items.map((i) => {
    if (i.kind !== 'stay' || i.day == null || i.status === 'skipped') return i;
    const day = addDays(s.plan.startDate, i.day);
    const st = stays.find((x) => x.checkIn === day && !used.has(x.id) && x.status !== 'cancelled');
    if (!st) return i;
    used.add(st.id);
    const status = st.confirmation ? 'confirmed' as const : 'booked' as const;
    return { ...i, status, statusLine: `${status === 'confirmed' ? 'Confirmed' : 'Booked'} · ${st.name}`, booking: { kind: 'stay' as const, id: st.id, name: st.name, ref: st.confirmation } };
  });
  const plan = { ...s.plan, items };
  const checks: PlanCheck[] = [{ key: 'passports', state: 'ok', text: 'Passports', who: [], nights: [], days: [] }];
  const gaps = gapNights(plan);
  checks.push({ key: 'stays', state: gaps.length ? 'todo' : 'ok', text: 'Stays', who: [], nights: gaps, days: [] });
  const carDays = Array.from({ length: plan.days }, (_, d) => d).filter((d) => carOn(plan, d) === 'needed');
  if (carDays.length) checks.push({ key: 'car', state: 'todo', text: 'Car', who: [], nights: [], days: carDays });
  if (plan.items.some((i) => i.to?.country && i.to.country !== 'SA')) checks.push({ key: 'esim', state: 'todo', text: 'eSIM', who: [], nights: [], days: [] });
  const role = roleNow();
  const lang = localeOr() === 'ar' ? 'ar' : 'en';
  const me = user.name || 'Omar';
  const people = role === 'owner' ? [{ name: me, initial: me.charAt(0).toUpperCase() }] : [{ name: lang === 'ar' ? 'خالد' : 'Khalid', initial: lang === 'ar' ? 'خ' : 'K' }, { name: me, initial: me.charAt(0).toUpperCase() }];
  return { plan: { ...plan, checks }, access: { role, prices: role === 'owner', ownerName: role === 'owner' ? null : lang === 'ar' ? 'خالد' : 'Khalid' }, people };
}

const BOOKED = new Set(['held', 'booked', 'confirmed']);

function apply(user: MockUser, s: Stored, version: number, ops: PlanOp[]): WireResponse {
  if (version !== s.plan.version) return err('PLAN_CHANGED', { details: { version: s.plan.version } });
  const now = read(user, s).plan;
  for (const op of ops) {
    if (op.op === 'add') { if (op.day != null && op.day >= now.days) return err('VALIDATION', { fields: { day: `The plan has ${now.days} days` } }); continue; }
    const it = now.items.find((i) => i.id === op.itemId);
    if (!it) return err('NOT_FOUND');
    if (BOOKED.has(it.status) && !(op.op === 'update' && Object.keys(op.item).every((k) => k === 'note'))) return err('VALIDATION', { fields: { itemId: 'Booked: change it through the booking' }, details: { booked: true, itemId: it.id } });
  }
  const next = applyLocal(s.plan, ops);
  s.plan = { ...next, version: s.plan.version + 1, updatedAt: new Date().toISOString() };
  return ok({ plan: read(user, s).plan, changes: ops.map((o) => ({ op: o.op === 'skip' || o.op === 'unskip' ? 'status' : o.op, itemId: 'itemId' in o ? o.itemId : null, day: 'day' in o ? o.day : null, title: '' })), untouched: [] });
}

/** Mock only: the plan changed on another phone (its version moves on, nothing else). */
(globalThis as { __madaMockPlan?: unknown }).__madaMockPlan = { bump: (tripId: string) => { const s = plans.get(tripId); if (s) s.plan = { ...s.plan, version: s.plan.version + 1 }; return !!s; } };

/** The plan card the demo conversation shows for a plan (the server's tools-plan.ts card, a few rows a day). */
export function mockPlanCard(user: MockUser, plan: Plan): ChatCard {
  const self = user.people.find((p) => p.isSelf);
  return {
    type: 'plan', planId: plan.id, tripId: plan.tripId, version: plan.version, title: plan.title, start: plan.startDate, end: plan.endDate,
    origin: plan.origin ? { name: plan.origin.name, code: plan.origin.code ?? null, source: plan.origin.source } : null, originNeeded: plan.originNeeded,
    travellers: self ? [{ name: self.firstName || user.name, self: true }] : [],
    days: Array.from({ length: Math.min(7, plan.days) }, (_, day) => ({ day, items: plan.items.filter((i) => i.day === day).sort((a, b) => a.sort - b.sort).slice(0, 5).map((i) => ({
      kind: i.kind, mode: i.mode, title: i.title, place: i.place?.city ?? i.place?.name ?? null, from: i.from?.name ?? null, to: i.to?.name ?? null, status: i.status, nights: i.nights,
      at: i.startsAt?.slice(11, 16) ?? null, km: i.drive?.km ?? null, minutes: i.drive?.minutes ?? null, borders: i.drive?.borders ?? [], booking: i.booking?.name ?? null,
    })) })),
    more: Math.max(0, plan.days - 7), todo: [{ key: 'stays', state: 'todo', days: [] }, { key: 'esim', state: 'todo', days: [] }],
  };
}

export function resetPlansMock() { plans.clear(); }

/**
 * GET /trips/plan-today (U9): the nearest plan and its cards, built by the same shared todayCards() the server uses.
 * Mock only: `__MADA_DEMO__.planToday = n` reads the day as n days from the plan's start (-1: the day before), so
 * e2e and screenshots can stand on a near day.
 */
function planToday(user: MockUser): WireResponse {
  const shift = (globalThis as { __MADA_DEMO__?: { planToday?: number } }).__MADA_DEMO__?.planToday;
  const mine = [...plans.values()].filter((s) => s.owner === user.id).map((s) => read(user, s).plan).sort((a, b) => a.startDate.localeCompare(b.startDate));
  const today = todayIn();
  const near = typeof shift === 'number' ? mine.find((p) => p.endDate >= today) ?? mine[0]
    : mine.find((p) => p.endDate >= today && p.startDate <= addDays(today, TODAY_PASSPORT_DAYS));
  if (!near) return ok({ trip: null, cards: [] });
  const day = typeof shift === 'number' ? addDays(near.startDate, shift) : today;
  return ok({ trip: { id: near.tripId, title: near.title, startDate: near.startDate, endDate: near.endDate, startsIn: daysBetween(day, near.startDate) }, cards: todayCards(near, day) });
}

export const plansMock: AreaMock = async (w, ctx) => {
  const path = w.path.split('?')[0] ?? '';
  if (path === '/trips/plan-today' && w.method === 'GET') return ctx.user ? planToday(ctx.user) : err('UNAUTHORIZED');
  const create = path === '/trips/plan';
  const m = /^\/trips\/([0-9a-f-]{36})\/(plan|change-requests|chat)(?:\/(ops|items|origin|events))?(?:\/([0-9a-f-]{36}))?$/.exec(path);
  if (!create && !m) return null;
  if (m?.[2] === 'plan' && m[3] === undefined && w.method !== 'GET' && w.method !== 'POST') return null;
  if (m?.[2] === 'change-requests' && (m[4] || w.method !== 'POST')) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const user = ctx.user;
  const body = (w.body ?? {}) as Record<string, unknown>;
  if (create) {
    if (w.method !== 'POST') return null;
    const plan = mockCreatePlan(user, String(body.templateId ?? 'istanbul3'), typeof body.start === 'string' ? body.start : undefined);
    return plan ? ok(read(user, plans.get(plan.tripId)!), 201) : err('NOT_FOUND');
  }
  const [, tripId, area, sub, itemId] = m!;
  if (area === 'chat') {
    if (!mockTripsOf(user).some((x) => x.id === tripId)) return err('NOT_FOUND');
    if (w.method === 'GET') return ok(mockTripChat(user, tripId!));
    return ok(setMockTripChat(user, tripId!, w.method === 'POST'));
  }
  const s = tripId === DEMO_ROAD_TRIP ? demoRoad(user) : plans.get(tripId!);
  if (!s || s.owner !== user.id) return err('NOT_FOUND');
  if (area === 'change-requests') {
    const role = roleNow();
    if (role === 'owner') return err('VALIDATION', { fields: { tripId: 'Your own trip: change the plan directly' } });
    if (role === 'view') return err('FORBIDDEN');
    const ops = (body.ops ?? []) as PlanOp[];
    if (role === 'edit') { const r = apply(user, s, s.plan.version, ops); if (r.status >= 300) return r; return ok({ applied: true, changeId: null, text: 'Done.' }, 201); }
    return ok({ applied: false, changeId: uuid(), text: `Change request sent: ${String(body.summary ?? '')}` }, 201);
  }
  if (!sub && w.method === 'GET') return ok(read(user, s));
  if (roleNow() !== 'owner') return err('NOT_FOUND');
  if (sub === 'events') return ok({ events: [] });
  if (sub === 'ops' && w.method === 'POST') {
    const b = PlanOpsRequest.safeParse(w.body);
    if (!b.success) return err('VALIDATION');
    return apply(user, s, b.data.version, b.data.ops);
  }
  if (sub === 'items' && !itemId && w.method === 'POST') return apply(user, s, Number(body.version), [{ op: 'add', day: body.day as number, afterItemId: (body.afterItemId as string) ?? null, item: body.item as never }]);
  if (sub === 'items' && itemId && w.method === 'DELETE') return apply(user, s, Number(new URLSearchParams(w.path.split('?')[1] ?? '').get('version')), [{ op: 'remove', itemId }]);
  if (sub === 'items' && itemId && w.method === 'PATCH') {
    const ops: PlanOp[] = [];
    if (body.item) ops.push({ op: 'update', itemId, item: body.item as never });
    if (body.day !== undefined || body.afterItemId !== undefined || body.first) ops.push({ op: 'move', itemId, day: (body.day as number) ?? null, afterItemId: body.afterItemId as string | undefined, first: !!body.first });
    if (body.skipped !== undefined) ops.push({ op: body.skipped ? 'skip' : 'unskip', itemId });
    return apply(user, s, Number(body.version), ops);
  }
  if (sub === 'origin' && w.method === 'PUT') {
    if (body.version !== undefined && body.version !== s.plan.version) return err('PLAN_CHANGED', { details: { version: s.plan.version } });
    const name = String((body.origin as { name?: string })?.name ?? '').trim();
    if (!name) return err('VALIDATION');
    const place = P(name.charAt(0).toUpperCase() + name.slice(1), null, 'SA');
    const legs = s.plan.items.map((i) => {
      if (i.kind !== 'leg' || i.mode !== 'flight' || BOOKED.has(i.status)) return i;
      if (i.from?.name === s.plan.origin?.name) return { ...i, from: place, title: `${place.name} → ${i.to?.name ?? ''}`, startsAt: null, statusLine: null };
      if (i.to?.name === s.plan.origin?.name) return { ...i, to: place, title: `${i.from?.name ?? ''} → ${place.name}`, startsAt: null, statusLine: null };
      return i;
    });
    const stops = s.plan.title.split(' → ').slice(1);
    s.plan = { ...s.plan, items: legs, origin: { ...place, source: 'said' }, returnTo: place, title: [place.name, ...stops].join(' → '), version: s.plan.version + 1 };
    return ok({ plan: read(user, s).plan, changes: [{ op: 'origin', itemId: null, day: null, title: place.name }], untouched: [] });
  }
  return null;
};

export const daysOf = (p: Pick<Plan, 'startDate' | 'endDate'>) => daysBetween(p.startDate, p.endDate) + 1;
