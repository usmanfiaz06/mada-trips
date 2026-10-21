import {
  AddTravellerRequest, CHANGE_REQUEST_TTL_H, DecideChangeRequest, ERROR_CODES, TripInviteRequest, addDays, localeOr, maskPhone, nameIn, t, todayIn,
  type ChangeRequestView, type ErrorCode, type SharedTripView, type TravellerRole, type TripCompanion, type TripTravellersResponse,
} from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { mockTripsOf } from './trips';

/*
 * EXPO_PUBLIC_API_MODE=mock for companions (docs/app/ASK-INTEGRATED.md §5, U5): the same contract as
 * platform/src/app/api/app/v1/trips/{id}/travellers, /change-requests and /trips/shared. The signed-in traveller's
 * upcoming trip has his household going, Abdullah (a friend on Mada, "Can suggest") and Faisal (invited by SMS), and
 * one change Abdullah asked for, waiting. With `__MADA_DEMO__.askPeople` a trip someone else organised is shared with
 * him too, so the companion's side can be seen. The demo conversation's cards (ask-chat-demo.ts) tap into these.
 */

type Trav = TripCompanion;
type TripState = { travellers: Trav[]; sharePrices: boolean };
type Change = Omit<ChangeRequestView, 'mine'> & { ownerId: string };

const trips = new Map<string, TripState>();
const changes = new Map<string, Change>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: t(ERROR_CODES[code].copy) } } });
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const HOUR = 3_600_000;

/** The demo's two Abdullahs and the friend on Mada, as the choice card names them. */
export const DEMO_ABDULLAH = { person: 'ab000000-0000-4000-8000-000000000001', user: 'ab000000-0000-4000-8000-000000000002' } as const;
/** The demo's pending change, and the trip shared with him. */
export const DEMO_CHANGE_ID = 'c4a00000-0000-4000-8000-000000000001';
const SHARED_TRIP_ID = '5ba00000-0000-4000-8000-000000000001';

const lang = (): 'en' | 'ar' => (localeOr() === 'ar' ? 'ar' : 'en');
const demoFlag = () => !!(globalThis as { __MADA_DEMO__?: { askPeople?: boolean } }).__MADA_DEMO__?.askPeople;
const initial = (s: string) => (s.trim()[0] ?? '?').toUpperCase();
const trav = (o: Partial<Trav> & Pick<Trav, 'id' | 'name' | 'how'>): Trav => ({ kind: 'person', initial: initial(o.name), owner: false, role: 'suggest', status: 'going', onMada: false, personId: null, ...o });

export function mockTripTitle(user: MockUser, tripId: string): string {
  const trip = mockTripsOf(user).find((x) => x.id === tripId);
  return trip ? t('chat.title.route', { from: nameIn('Riyadh', lang()), to: nameIn(trip.city, lang()) }, lang()) : '';
}
const upcomingOf = (user: MockUser) => mockTripsOf(user).find((x) => x.status !== 'cancelled' && x.status !== 'completed');

function stateOf(user: MockUser, tripId: string): TripState | null {
  if (!mockTripsOf(user).some((x) => x.id === tripId)) return null;
  let s = trips.get(tripId);
  if (!s) {
    const l = lang();
    const self = user.people.find((p) => p.isSelf);
    const household = user.people.filter((p) => !p.isSelf).slice(0, 2);
    s = {
      sharePrices: false,
      travellers: [
        trav({ id: uuid(), name: user.name || self?.firstName || 'Omar', how: t('people.how.self', undefined, l), owner: true, role: null, personId: self?.id ?? null }),
        ...household.map((p) => trav({ id: uuid(), name: p.firstName, how: t('people.how.household', { relation: t(`person.rel.${p.relation}` as never, undefined, l) }, l), personId: p.id })),
        trav({ id: 'ee000000-0000-4000-8000-000000000003', kind: 'user', name: l === 'ar' ? 'عبدالله' : 'Abdullah', how: t('people.how.circle', { circle: l === 'ar' ? 'رحلات الرياض' : 'Riyadh Hiking' }, l), onMada: true }),
        trav({ id: 'ee000000-0000-4000-8000-000000000004', kind: 'invite', name: l === 'ar' ? 'فيصل' : 'Faisal', how: t('people.how.invited', { phone: '+966 5•• ••• 233' }, l), status: 'invited', onMada: true }),
      ],
    };
    trips.set(tripId, s);
    if (upcomingOf(user)?.id === tripId && !changes.has(DEMO_CHANGE_ID)) seedChange(user, tripId);
  }
  return s;
}

function seedChange(user: MockUser, tripId: string) {
  const l = lang();
  const now = Date.now();
  changes.set(DEMO_CHANGE_ID, {
    id: DEMO_CHANGE_ID, tripId, tripTitle: mockTripTitle(user, tripId), byName: l === 'ar' ? 'عبدالله' : 'Abdullah', ownerName: user.name || 'Omar', ownerId: user.id,
    summary: l === 'ar' ? 'ليلتين في البوسفور بدل ليلة، ونرجع يوم الجمعة' : 'Two nights by the Bosphorus instead of one, back on Friday',
    lines: [
      { op: 'update', title: l === 'ar' ? 'فندق على البوسفور' : 'Hotel by the Bosphorus', day: 3, field: 'nights', from: '1', to: '2', text: 'Hotel by the Bosphorus: 1 → 2 nights' },
      { op: 'move', title: l === 'ar' ? 'رحلة العودة' : 'Flight home', day: 5, field: 'day', from: '5', to: '6', text: 'Flight home: day 5 → day 6' },
    ],
    costs: true, status: 'pending', reason: null, createdAt: new Date(now - 40 * 60_000).toISOString(), expiresAt: new Date(now + (CHANGE_REQUEST_TTL_H * HOUR) - 40 * 60_000).toISOString(), decidedAt: null,
  });
}

/** The pending demo change, for the seeded line in the owner's chat (mock/ask-threads.ts). */
export function mockDemoChange(user: MockUser): ChangeRequestView | null {
  const trip = upcomingOf(user);
  if (!trip) return null;
  stateOf(user, trip.id);
  const c = changes.get(DEMO_CHANGE_ID);
  return c ? viewOf(c, user.id) : null;
}

/** A change the demo companion's chat asks for (ask-chat-demo.ts): waiting for the organiser. */
export function mockAskChange(user: MockUser, summary: string): ChangeRequestView {
  const l = lang();
  const id = uuid();
  const now = Date.now();
  const c: Change = {
    id, tripId: SHARED_TRIP_ID, tripTitle: l === 'ar' ? 'الرياض ← العلا' : 'Riyadh → AlUla', byName: user.name || 'Omar', ownerName: l === 'ar' ? 'خالد' : 'Khalid', ownerId: 'khalid',
    summary, lines: [{ op: 'update', title: l === 'ar' ? 'سكن في العلا' : 'Stay in AlUla', day: 0, field: 'nights', from: '1', to: '2', text: 'Stay in AlUla: 1 → 2 nights' }],
    costs: false, status: 'pending', reason: null, createdAt: new Date(now).toISOString(), expiresAt: new Date(now + CHANGE_REQUEST_TTL_H * HOUR).toISOString(), decidedAt: null,
  };
  changes.set(id, c);
  return viewOf(c, user.id);
}

const viewOf = (c: Change, viewerId: string): ChangeRequestView => {
  const { ownerId, ...rest } = c;
  return { ...rest, mine: ownerId === viewerId };
};

const listOf = (user: MockUser, tripId: string, s: TripState): TripTravellersResponse => ({
  tripId, title: mockTripTitle(user, tripId), canManage: true, sharePrices: s.sharePrices, travellers: s.travellers,
  pending: [...changes.values()].filter((c) => c.tripId === tripId && c.status === 'pending').length,
});

function sharedOf(user: MockUser): SharedTripView | null {
  if (!demoFlag()) return null;
  const l = lang();
  const start = addDays(todayIn(), 24);
  return {
    tripId: SHARED_TRIP_ID, title: l === 'ar' ? 'الرياض ← العلا' : 'Riyadh → AlUla', startDate: start, endDate: addDays(start, 2), ownerName: l === 'ar' ? 'خالد' : 'Khalid',
    role: 'suggest', status: 'going', inviteId: null,
    items: [
      { id: '5ba00000-0000-4000-8000-0000000000a1', day: 0, kind: 'leg', mode: 'flight', title: l === 'ar' ? 'الرياض ← العلا' : 'Riyadh → AlUla', place: null, at: '07:30', nights: null, booked: true },
      { id: '5ba00000-0000-4000-8000-0000000000a2', day: 0, kind: 'stay', mode: null, title: l === 'ar' ? 'سكن في العلا' : 'Stay in AlUla', place: l === 'ar' ? 'العلا' : 'AlUla', at: null, nights: 2, booked: false },
      { id: '5ba00000-0000-4000-8000-0000000000a3', day: 1, kind: 'activity', mode: null, title: l === 'ar' ? 'جولة الحجر' : 'Hegra guided tour', place: l === 'ar' ? 'الحجر' : 'Hegra', at: '09:00', nights: null, booked: false },
      { id: '5ba00000-0000-4000-8000-0000000000a4', day: 2, kind: 'leg', mode: 'flight', title: l === 'ar' ? 'العلا ← الرياض' : 'AlUla → Riyadh', place: null, at: '19:40', nights: null, booked: true },
    ],
    people: [{ name: l === 'ar' ? 'خالد' : 'Khalid', initial: l === 'ar' ? 'خ' : 'K', owner: true }, { name: user.name || 'Omar', initial: initial(user.name || 'Omar'), owner: false }],
    changes: [...changes.values()].filter((c) => c.tripId === SHARED_TRIP_ID).map((c) => viewOf(c, user.id)),
  };
}

export function resetTripPeopleMock() { trips.clear(); changes.clear(); }

export const tripPeopleMock: AreaMock = async (w, ctx) => {
  const path = w.path.split('?')[0] ?? '';
  const shared = path === '/trips/shared' || path.startsWith('/trips/shared/');
  const m = /^\/trips\/([^/]+)\/(travellers|change-requests)(?:\/([^/]+))?(?:\/(decide))?$/.exec(path);
  if (!shared && !m) return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const user = ctx.user;
  if (shared) {
    const view = sharedOf(user);
    if (w.method === 'GET' && path === '/trips/shared') return ok({ trips: view ? [(({ items: _i, people: _p, changes: _c, ...card }) => card)(view)] : [] });
    if (w.method === 'GET') return view && path === `/trips/shared/${view.tripId}` ? ok({ trip: view }) : err('NOT_FOUND');
    return ok({ trips: [] });
  }
  const [, tripId, area, sub, decide] = m!;
  if (area === 'change-requests') {
    const c = sub ? changes.get(sub) : undefined;
    if (!c || c.tripId !== tripId) return err('NOT_FOUND');
    if (w.method === 'GET' && !decide) {
      if (c.status === 'pending' && Date.parse(c.expiresAt) <= Date.now()) c.status = 'expired';
      return ok({ change: viewOf(c, user.id) });
    }
    if (w.method === 'POST' && decide) {
      if (c.ownerId !== user.id) return err('FORBIDDEN');
      const b = DecideChangeRequest.safeParse(w.body);
      if (!b.success) return err('VALIDATION');
      if (c.status === 'pending') {
        Object.assign(c, { status: b.data.decision === 'approve' ? 'approved' : 'declined', reason: b.data.decision === 'decline' ? b.data.reason ?? null : null, decidedAt: new Date().toISOString() });
        // Decided in the trip chat: everyone there reads the outcome (§5.5).
        const { mockTripChatLine } = await import('./ask-threads');
        const l = lang();
        mockTripChatLine(user, c.tripId, (c.status as string) === 'approved' ? t('people.line.approved', { owner: c.ownerName, summary: c.summary }, l) : t('people.line.declined', { owner: c.ownerName }, l));
        // It costs money (U9): the team prices it, and the payer's chat gets the card with Book · Not now. The mock desk
        // prices it at once (a sample price for screenshots and e2e; the server's comes from the desk's quote).
        if ((c.status as string) === 'approved' && c.costs && c.ownerId === user.id) {
          const { mockOwnerTripLine } = await import('./ask-threads');
          const { mockQuotedChange } = await import('./booking');
          const what = c.lines.find((x) => x.field === 'nights')?.title ?? c.summary;
          const requestId = mockQuotedChange(user, { title: what, detail: c.summary, total: 650_00 });
          mockOwnerTripLine(user, c.tripId, { who: 'mada', text: t('people.line.priced', { name: c.byName }, l), kept: [{ type: 'pay_change', tripId: c.tripId, changeId: c.id, byName: c.byName, tripTitle: c.tripTitle, what, requestId, amount: 650_00, promisedBy: null }], at: new Date().toISOString() });
        }
      }
      return ok({ change: viewOf(c, user.id) });
    }
    return null;
  }
  const s = stateOf(user, tripId!);
  if (!s) return err('NOT_FOUND');
  if (!sub) {
    if (w.method === 'GET') return ok(listOf(user, tripId!, s));
    if (w.method === 'PATCH') { s.sharePrices = !!(w.body as { sharePrices?: boolean })?.sharePrices; return ok(listOf(user, tripId!, s)); }
    if (w.method === 'POST') {
      const b = AddTravellerRequest.safeParse(w.body);
      if (!b.success) return err('VALIDATION');
      const l = lang();
      const d = b.data;
      if ('name' in d) s.travellers.push(trav({ id: uuid(), name: d.name, how: t('people.how.named', undefined, l) }));
      else if ('userId' in d) { if (!s.travellers.some((x) => x.kind === 'user' && x.status === 'invited')) s.travellers.push(trav({ id: uuid(), kind: 'user', name: l === 'ar' ? 'عبدالله' : 'Abdullah', how: t('people.how.friend', undefined, l), status: 'invited', onMada: true })); }
      else {
        const known = user.people.find((p) => p.id === d.personId);
        const name = known?.firstName ?? (l === 'ar' ? 'عبدالله' : 'Abdullah');
        if (!s.travellers.some((x) => x.personId === d.personId)) s.travellers.push(trav({ id: uuid(), name, how: t('people.how.household', { relation: t('person.rel.family', undefined, l) }, l), personId: d.personId }));
      }
      return ok(listOf(user, tripId!, s), 201);
    }
    return null;
  }
  if (sub === 'invite' && w.method === 'POST') {
    const b = TripInviteRequest.safeParse(w.body);
    if (!b.success) return err('VALIDATION');
    const tr = trav({ id: uuid(), kind: 'invite', name: b.data.name, how: t('people.how.invited', { phone: maskPhone(b.data.phone) }, lang()), status: 'invited', onMada: true, role: (b.data.role ?? 'suggest') as TravellerRole });
    s.travellers.push(tr);
    return ok({ result: 'sent', traveller: tr }, 201);
  }
  const tr = s.travellers.find((x) => x.id === sub);
  if (!tr) return err('NOT_FOUND');
  if (w.method === 'PATCH') {
    const role = (w.body as { role?: TravellerRole })?.role;
    if (tr.owner || !role || !['view', 'suggest', 'edit'].includes(role)) return err('VALIDATION');
    tr.role = role;
    return ok(listOf(user, tripId!, s));
  }
  if (w.method === 'DELETE') {
    if (tr.owner) return err('VALIDATION');
    s.travellers = s.travellers.filter((x) => x.id !== tr.id);
    return ok(listOf(user, tripId!, s));
  }
  return null;
};
