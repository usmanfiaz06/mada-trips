import {
  DESTINATIONS, ERROR_CODES, ESIM_FIXTURE_PACKAGES, EsimPlansQuery, addDays, esimCountriesOf, esimDays, esimPrice, esimStatusOf, esimWhereKey, iosInstallLink,
  mockEsimSim, mockEsimUsage, money, personName, suggestEsimPlans, t, tn, todayIn, topupPlans,
  type CopyKey, type EsimPackage, type EsimView, type ErrorCode, type OrderLine, type Person, type RequestResult,
} from '@mada/shared';
import type { WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { mockTrip } from './trips';

/*
 * EXPO_PUBLIC_API_MODE=mock for eSIMs: the same contract as platform/src/app/api/app/v1/esim(s), with the same shared
 * fixtures and rules (plans per country, region or global; price from the net price; the iPhone link), so the app looks
 * the same against the mock and the server. The order sheet's line and the purchase after payment are called from
 * mock/booking.ts. `?demo=esimFails`: the supplier says no, and the order comes back refunded.
 */

export type EsimSnap = {
  packageId: string; coverage: EsimPackage['coverage']; gb: number | null; days: number; operator: string; topup: boolean; unit: number; count: number;
  travellerIds: string[]; tripId: string | null; topupOf: string | null; apn: EsimPackage['apn']; roaming: boolean;
};
type Stored = Omit<EsimView, 'travellerName' | 'where' | 'usage' | 'status'> & { owner: string; status: EsimView['status']; key: string };

const esims = new Map<string, Stored>();
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, message?: string): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy) } } });
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const whereName = (c: { code: string; name: string }) => { const k = esimWhereKey(c.code); return k ? t(k as CopyKey) : c.name; };
const sizeText = (gb: number | null, days: number) => (gb === null ? t('es.size.unlimited', { days }) : t('es.size.gb', { gb, days }));
const packagesFor = (countries: string[]) => ESIM_FIXTURE_PACKAGES.filter((p) => p.coverage.kind !== 'local' || (countries.length === 1 && p.coverage.code === countries[0]));
const topupsOf = (s: Stored): EsimPackage[] =>
  ESIM_FIXTURE_PACKAGES.filter((x) => x.coverage.code === s.plan.coverage.code && x.days <= 30 && x.topup).map((x) => ({ ...x, id: `${x.id}-topup` }));

export function resetEsimMock() { esims.clear(); }

/** The order sheet's line for a plan or a top-up (mock/booking.ts price). Null when the package isn't sold. */
export function priceEsimMock(people: Person[], ownerId: string, d: { count: number; packageId?: string; where?: string; tripId?: string | null; travellerIds?: string[]; topupOf?: string }): { lines: OrderLine[]; title: string; rule: string; place: string; travellers: Person[]; snap: EsimSnap } | null {
  if (d.topupOf) {
    const s = esims.get(d.topupOf);
    if (!s || s.owner !== ownerId || !s.iccid) return null;
    const p = topupsOf(s).find((x) => x.id === d.packageId);
    if (!p) return null;
    const unit = esimPrice(p.netUsd);
    const where = whereName(s.plan.coverage);
    return {
      lines: [{ key: 'esim', icon: 'globe', text: t('pay.line.esimTopup', { size: sizeText(p.gb, p.days) }), amount: unit }], title: t('pay.title.esimTopup', { where }), rule: t('pay.rule.esimPlan'), place: where, travellers: [],
      snap: { packageId: p.id, coverage: s.plan.coverage, gb: p.gb, days: p.days, operator: s.plan.operator, topup: true, unit, count: 1, travellerIds: [], tripId: s.tripId, topupOf: s.id, apn: p.apn, roaming: p.roaming },
    };
  }
  const code = d.where ?? '';
  const p = packagesFor(/^[A-Z]{2}$/.test(code) ? [code] : []).find((x) => x.id === d.packageId);
  if (!p) return null;
  const travellers = (d.travellerIds ?? []).map((id) => people.find((x) => x.id === id)).filter((x): x is Person => !!x);
  const count = travellers.length || d.count;
  const unit = esimPrice(p.netUsd);
  const where = whereName(p.coverage);
  return {
    lines: [{ key: 'esim', icon: 'globe', text: tn('pay.line.esimPlan', count, { where, size: sizeText(p.gb, p.days) }), amount: unit * count }], title: t('pay.title.esimFor', { where }), rule: t('pay.rule.esimPlan'), place: where, travellers,
    snap: { packageId: p.id, coverage: p.coverage, gb: p.gb, days: p.days, operator: p.operator, topup: p.topup, unit, count, travellerIds: travellers.map((x) => x.id), tripId: d.tripId ?? null, topupOf: null, apn: p.apn, roaming: p.roaming },
  };
}

/** After the payment: the eSIMs from the supplier, or the refund as the order's outcome when it says no. */
export function fulfilEsimMock(o: { id: string; owner: string; total: number; creditUsed: number }, s: EsimSnap, fail: boolean): RequestResult | null {
  const now = new Date().toISOString();
  if (s.topupOf) {
    const e = esims.get(s.topupOf);
    if (e && !fail) { e.topups = [...e.topups, { gb: s.gb, days: s.days, at: now }]; return null; }
  } else if (!fail) {
    for (let i = 0; i < s.count; i += 1) {
      const sim = mockEsimSim(`mada:${o.id}`, i);
      const id = uuid();
      esims.set(id, {
        id, owner: o.owner, key: `${o.id}:${i}`, orderId: o.id, tripId: s.tripId, travellerId: s.travellerIds[i] ?? null, status: 'ready',
        plan: { id: s.packageId, coverage: s.coverage, gb: s.gb, days: s.days, operator: s.operator, topup: s.topup }, iccid: sim.iccid,
        install: { lpa: sim.lpa, smdp: sim.smdp, matchingId: sim.matchingId, iosLink: iosInstallLink(sim.lpa), apn: s.apn, roaming: s.roaming },
        topups: [], result: null, installedAt: null, createdAt: now,
      });
    }
    return null;
  }
  const result: RequestResult = {
    kind: 'refused', reason: 'sold_out', with: null, note: null, next: ['talk'], by: null, at: now,
    money: o.total > 0 ? { kind: 'refund', amount: money(o.total), by: addDays(todayIn(), 10) } : o.creditUsed > 0 ? { kind: 'credit', amount: money(o.creditUsed), by: null } : { kind: 'none', amount: null, by: null },
  };
  if (!s.topupOf) {
    for (let i = 0; i < s.count; i += 1) {
      const id = uuid();
      esims.set(id, {
        id, owner: o.owner, key: `${o.id}:${i}`, orderId: o.id, tripId: s.tripId, travellerId: s.travellerIds[i] ?? null, status: 'refunded',
        plan: { id: s.packageId, coverage: s.coverage, gb: s.gb, days: s.days, operator: s.operator, topup: s.topup }, iccid: null, install: null, topups: [], result, installedAt: null, createdAt: now,
      });
    }
  }
  return result;
}

function view(s: Stored, people: Person[]): EsimView {
  const usage = s.iccid && s.status !== 'refunded' ? mockEsimUsage(s.plan, s.installedAt) : null;
  const status = esimStatusOf(s.status, usage, !!s.installedAt);
  const { owner: _o, key: _k, ...rest } = s;
  const p = s.travellerId ? people.find((x) => x.id === s.travellerId) : null;
  return { ...rest, status, usage, where: whereName(s.plan.coverage), travellerName: p ? personName(p) : null };
}

export const esimMock: AreaMock = async (w, ctx) => {
  const path = w.path.split('?')[0] ?? '';
  const parts = path.split('/').filter(Boolean);
  if (parts[0] !== 'esim' && parts[0] !== 'esims') return null;
  if (!ctx.user) return err('UNAUTHORIZED');
  const user: MockUser = ctx.user;
  const people = user.people;
  const qs = new URLSearchParams(w.path.split('?')[1] ?? '');

  if (w.method === 'GET' && path === '/esim/plans') {
    const q = EsimPlansQuery.safeParse(Object.fromEntries(qs));
    if (!q.success) return err('VALIDATION');
    let countries: string[] = [];
    let days = q.data.days ?? 7;
    let start: string | null = null;
    let tripId: string | null = null;
    let onTrip: Person[] = people;
    if (q.data.tripId) {
      const trip = mockTrip(user, q.data.tripId, `/trips/${q.data.tripId}`);
      if (!trip) return err('NOT_FOUND');
      countries = esimCountriesOf({ city: trip.city, country: trip.country });
      days = q.data.days ?? esimDays(trip.startDate, trip.endDate);
      start = trip.startDate; tripId = trip.id;
      const ids = trip.travellerIds;
      onTrip = people.filter((p) => ids.includes(p.id));
      if (!onTrip.length) onTrip = people;
    } else if (q.data.countries) countries = q.data.countries.split(',');
    else if (q.data.destination) { const d = DESTINATIONS[q.data.destination.toLowerCase()]; countries = d ? [d.country] : /^[A-Z]{2}$/.test(q.data.destination) ? [q.data.destination] : []; }
    const has = new Set([...esims.values()].filter((e) => e.owner === user.id && tripId && e.tripId === tripId && e.status !== 'refunded').map((e) => e.travellerId));
    const base = { days, start, tripId, supplier: 'mock' as const, people: onTrip.map((p) => ({ id: p.id, name: personName(p) || t('es.list.forYou'), has: has.has(p.id) })) };
    const s = suggestEsimPlans(packagesFor(countries), { countries, days });
    if (!s.coverage || !s.plans.length) return ok({ ...base, outcome: 'none', where: null, plans: [], recommended: null, more: [] });
    return ok({ ...base, outcome: 'ok', where: { countries, code: s.coverage.code, kind: s.coverage.kind }, plans: s.plans, recommended: s.recommended, more: s.more });
  }
  if (w.method === 'GET' && path === '/esims') {
    const order = qs.get('order');
    const trip = qs.get('trip');
    const mine = [...esims.values()].filter((e) => e.owner === user.id && (!order || e.orderId === order) && (!trip || e.tripId === trip));
    return ok({ esims: mine.sort((a, b) => a.key.localeCompare(b.key)).map((e) => view(e, people)) });
  }
  const s = parts[0] === 'esims' ? esims.get(parts[1] ?? '') : undefined;
  if (!s || s.owner !== user.id) return err('NOT_FOUND');
  if (w.method === 'GET' && parts.length === 2) return ok({ esim: view(s, people) });
  if (w.method === 'GET' && parts[2] === 'topups') {
    const v = view(s, people);
    if (!s.iccid || s.status === 'refunded') return ok({ esim: v, plans: [] });
    return ok({ esim: v, plans: topupPlans(topupsOf(s).map((p) => ({ ...p, coverage: s.plan.coverage }))) });
  }
  if (w.method === 'POST' && parts[2] === 'installed') {
    if (!s.iccid || s.status === 'refunded') return err('VALIDATION');
    if (!s.installedAt) { s.installedAt = new Date().toISOString(); s.status = 'installed'; }
    return ok({ esim: view(s, people) });
  }
  return err('NOT_FOUND');
};
