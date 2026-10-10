import {
  AskParseRequest, CARRIERS, CATALOGUE_FLIGHTS, CATALOGUE_HOTELS, CHECKED_FARES, CreateOrderBody, CreateRequestBody, DESK_PRICES, DESTINATIONS, DemoFlag,
  ENTRY_RULES, ERROR_CODES, EntryCheckRequest, FlightSearchRequest, NEED_LABELS, OTHER_CITY_BY_HAND, PLANS, PreviewBody, REQUEST_FORMS, StaySearchRequest,
  addDays, addMinutes, bundleFor, checkPromo, demoPassportTarget, demoIqama, deskQuote, deskReply, entryChecks, fareSar, freeUntilLabel, infantSar, instalments,
  money, parseAskRules, personName, rangeLabel, requestTitle, roomsFor, roomsLabel, sarToHalalas, seatsFor, staySar, t, tn, todayIn,
  type BookingRequestView, type CopyKey, type ErrorCode, type FlightOption, type OrderLine, type OrderPreview, type OrderView, type Person, type RequestFormKind,
  type RequestQuote, type StayOption, type ThreadMessage,
} from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';
import { walletMock } from './wallet';
import { circlesMock } from './circles';
import { recordBookedTrip } from './trips';

/*
 * EXPO_PUBLIC_API_MODE=mock for booking (M2): the Core API's booking endpoints in memory, running the same shared rules
 * the server runs (the Ask parser, fares, bundles, entry checks, promo codes, the desk's price table and replies) and
 * the same order lifecycle, moved on by a scripted desk as the app polls. Demo switches arrive as ?demo=….
 */

type Offer = { id: string; owner: string; kind: 'flight' | 'stay'; option: FlightOption | StayOption; search: Record<string, unknown>; expiresAt: number };
type Req = { id: string; owner: string; view: BookingRequestView; details: { kind: string; answers: Record<string, string[]>; needs: Record<string, string[]>; note: string; search?: Record<string, unknown> | null; service?: string | null; serviceNeed?: string | null; clientId?: string | null }; created: number; messages: ThreadMessage[]; quoteSnapshot?: RequestQuote };
type Order = OrderView & { owner: string; nextAt: number | null; demo: Set<DemoFlag>; done: Set<string>; key: string; resume?: string; otpTries: number; created: number; travellers: Person[]; user: MockUser; snap: { flight: FlightOption | null; stay: StayOption | null; destination: string | null; discount: number } };

const offers = new Map<string, Offer>();
const requests = new Map<string, Req>();
const orders = new Map<string, Order>();
const creditSpent = new Map<string, number>();

const nowIso = () => new Date().toISOString();
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const err = (code: ErrorCode, message?: string, fields?: Record<string, string>): WireResponse => ({ status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy), ...(fields ? { fields } : null) } } });
const today = () => todayIn();
const HOLD = 20 * 60_000;
const REF = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const newRef = () => Array.from({ length: 6 }, () => REF[Math.floor(Math.random() * REF.length)]).join('');
/** Day hours: Faisal. At night (22:00–08:00 Riyadh) Noura covers, as the desk's presence says. */
const agentName = () => { const h = (new Date().getUTCHours() + 3) % 24; return h >= 22 || h < 8 ? 'Noura' : 'Faisal'; };
/** Riyadh offsets of the airports the catalogue flies to, for times on the way back. */
const TZ_OFF: Record<string, number> = { DXB: 60, CAI: -60, LHR: -180, GYD: 60 };

async function household(w: Wire, user: MockUser, ctx: Parameters<AreaMock>[1]): Promise<Person[]> {
  await walletMock({ method: 'GET', path: '/cards', token: w.token }, ctx); // the demo family arrives on first use
  return user.people.map((p) => (p.isSelf ? { ...p, firstName: p.firstName || user.name } : p));
}
async function creditBalance(w: Wire, user: MockUser, ctx: Parameters<AreaMock>[1]): Promise<number> {
  const r = await walletMock({ method: 'GET', path: '/credit', token: w.token }, ctx);
  const bal = (r?.json as { credit?: { balance?: { amount: number } } } | undefined)?.credit?.balance?.amount ?? 0;
  return Math.max(0, bal - (creditSpent.get(user.id) ?? 0));
}
async function cardOf(w: Wire, ctx: Parameters<AreaMock>[1], id: string) {
  const r = await walletMock({ method: 'GET', path: '/cards', token: w.token }, ctx);
  const cards = ((r?.json as { cards?: { id: string; label: string; brand: string }[] }).cards ?? []);
  return { card: cards.find((c) => c.id === id) ?? null, first: cards[0]?.id ?? null };
}

/* ───────────── search ───────────── */

function flightOptions(destKey: string, from: string, depart: string, ret: string | null, cabin: FlightOption['cabin'], n: number, infants: number): FlightOption[] {
  const dest = DESTINATIONS[destKey]!;
  return (CATALOGUE_FLIGHTS[destKey] ?? []).map((f) => {
    const to = f.to ?? dest.code;
    const pp = sarToHalalas(fareSar(f.ppSar, cabin, !ret));
    const inf = sarToHalalas(infantSar(pp / 100));
    const backArr = addMinutes('15:10', f.durationMin - (TZ_OFF[to] ?? 0));
    return {
      id: uuid(), label: f.label, carrier: f.carrier, airline: CARRIERS[f.carrier]!.name, brand: CARRIERS[f.carrier]!.brand,
      out: { flightNumber: f.number, from, to, date: depart, dep: f.dep, arr: f.arr, durationMin: f.durationMin },
      back: ret ? { flightNumber: f.backNumber, from: to, to: from, date: ret, dep: '15:10', arr: backArr, durationMin: f.durationMin } : null,
      stop: f.stop ?? null, reason: f.reason, bags: f.bags, changeRule: f.change, refundRule: f.refund, refundable: f.refund !== 'Not refundable', cabin, adults: n, infants,
      pricePerPerson: money(pp), infantPrice: money(inf), total: money(pp * n + inf * infants), expiresAt: new Date(Date.now() + HOLD).toISOString(),
    };
  });
}

function stayOptions(destKey: string, checkIn: string, nights: number, n: number): StayOption[] {
  return (CATALOGUE_HOTELS[destKey] ?? []).map((h) => ({
    id: uuid(), label: h.label, name: h.name, area: h.area, address: h.address, note: n > 2 ? h.note : n === 2 ? h.noteSmall.two : h.noteSmall.one,
    rating: h.rating.toFixed(1), photo: h.photo, focal: h.focal, checkIn, nights, rooms: roomsFor(n), roomsLabel: roomsLabel(n),
    total: money(sarToHalalas(staySar(h.nightSar, nights, n))), cancellation: 'Free to cancel until 7 days before. After that, the first night.',
    freeCancelUntil: addDays(checkIn, -7), expiresAt: new Date(Date.now() + HOLD).toISOString(),
  }));
}

/* ───────────── the order sheet ───────────── */

type Priced = { preview: OrderPreview; place: string; flight?: FlightOption; stay?: StayOption; travellers: Person[]; search?: Record<string, unknown> };

async function price(w: Wire, user: MockUser, ctx: Parameters<AreaMock>[1], body: ReturnType<typeof PreviewBody.parse>, bump = 0): Promise<Priced | WireResponse> {
  const d = body.draft;
  const people = await household(w, user, ctx);
  const pick = (ids: string[]) => ids.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
  let lines: OrderLine[] = [];
  let title = ''; let photo = 'istanbul-galata'; let rule = ''; let agent = true; let hold: number | null = null; let place = '';
  let travellers: Person[] = [];
  const out: Partial<Priced> = {};
  const L = (key: string, icon: OrderLine['icon'], text: string, amount: number): OrderLine => ({ key, icon, text, amount });
  if (d.kind === 'trip') {
    travellers = pick(d.travellerIds);
    if (travellers.length !== d.travellerIds.length) return err('NOT_FOUND');
    const o = offers.get(d.flightOfferId);
    if (!o || o.owner !== user.id || o.kind !== 'flight') return err('NOT_FOUND');
    let f = o.option as FlightOption;
    const s = o.search as { destination: string; from: string; depart: string; return: string | null; infants: number; cabin: FlightOption['cabin'] };
    if (f.adults !== travellers.length) {
      f = { ...flightOptions(s.destination, f.out.from, f.out.date, f.back?.date ?? null, f.cabin, travellers.length, f.infants).find((x) => x.out.flightNumber === f.out.flightNumber)!, id: o.id };
      o.option = f;
    }
    const dest = DESTINATIONS[s.destination]!;
    const n = travellers.length;
    const suffix = `${f.cabin !== 'economy' ? ` · ${t(`cal.cabin.${f.cabin}` as CopyKey)}` : ''}${f.back ? '' : ` · ${t('pay.line.oneWay')}`}`;
    lines.push(L('flight', 'flight', `${tn('pay.line.flight', n, { airline: f.airline, how: f.stop ? t('pay.line.oneStop') : t('pay.line.direct') })}${suffix}`, f.pricePerPerson.amount * n + bump));
    if (f.infants) lines.push(L('infants', 'flight', tn('pay.line.infants', f.infants), f.infantPrice.amount * f.infants));
    const bundle = d.bundle && dest.key === 'istanbul' && !!f.back;
    if (bundle) {
      const b = bundleFor(n, f.out.date, f.back!.date);
      lines.push(L('stay', 'stay', t('pay.line.stay', { rooms: n > 2 ? t('pay.line.connecting') : t('pay.line.aRoom'), count: b.nights }), sarToHalalas(b.staySar)));
      lines.push(L('pickup', 'car', t('pay.line.pickupBoth'), sarToHalalas(b.pickupSar)));
    }
    rule = (f.refundable ? t('pay.rule.refund', { fee: f.refundRule.replace(/^Refund minus /, '') }) : t('pay.rule.noRefund', { fee: f.changeRule })) + (bundle ? ` ${t('pay.rule.rooms', { date: freeUntilLabel(f.out.date) })}` : '');
    title = `${dest.name} · ${rangeLabel(f.out.date, f.back?.date ?? null)}`;
    photo = dest.photo; place = dest.name; hold = o.expiresAt; out.flight = f; out.search = { ...s, bundle };
  } else if (d.kind === 'stay') {
    travellers = pick(d.travellerIds);
    const o = offers.get(d.stayOfferId);
    if (!o || o.owner !== user.id || o.kind !== 'stay') return err('NOT_FOUND');
    let s = o.option as StayOption;
    const se = o.search as { destination: string };
    if (s.rooms !== roomsFor(travellers.length)) { s = { ...stayOptions(se.destination, s.checkIn, s.nights, travellers.length).find((x) => x.name === s.name)!, id: o.id }; o.option = s; }
    lines = [L('stay', 'stay', t('pay.line.hotel', { rooms: s.roomsLabel, dates: rangeLabel(s.checkIn, addDays(s.checkIn, s.nights)), count: s.nights }), s.total.amount)];
    rule = t('pay.rule.stay', { date: freeUntilLabel(s.checkIn) }); title = s.name; photo = s.photo; place = DESTINATIONS[se.destination]?.name ?? ''; hold = o.expiresAt; out.stay = s; out.search = se;
  } else if (d.kind === 'package') {
    const plan = PLANS[d.planId];
    if (!plan) return err('NOT_FOUND');
    travellers = pick(d.travellerIds);
    const n = travellers.length;
    if (plan.price.flights) lines.push(L('flight', 'flight', t('pay.line.planFlights', { count: n, city: plan.city }), sarToHalalas((plan.price.flights * n) / 2)));
    if (plan.price.stay) lines.push(L('stay', 'stay', tn('pay.line.planStay', Math.max(1, plan.days - 1), { rooms: n > 2 ? t('pay.line.connecting') : t('pay.line.aRoom') }), sarToHalalas(plan.price.stay)));
    lines.push(L('tours', 'star', t('pay.line.planTours', { count: n }), sarToHalalas((plan.price.experiences * n) / 4)));
    rule = t('pay.rule.package'); title = plan.title; photo = plan.photo; place = plan.city;
  } else if (d.kind === 'quote') {
    const r = requests.get(d.requestId);
    if (!r || r.owner !== user.id || !r.view.quote || r.view.quote.status !== 'open') return err('NOT_FOUND');
    lines = [L('quote', 'doc', r.view.kind === 'visa' ? t('pay.line.quoteVisa') : t('pay.line.quote'), r.view.quote.total.amount)];
    rule = t('pay.rule.quote'); title = r.view.title; agent = false; photo = r.view.kind === 'umrah' ? 'makkah-clock-tower' : 'istanbul-galata'; place = title;
    travellers = pick(r.view.travellerIds);
  } else if (d.kind === 'share') {
    // Read the circle the way the app does (Circles' own mock), so the amount comes from the split, never the link.
    const r = await circlesMock({ method: 'GET', path: `/circles/${d.circleId}/messages`, token: w.token }, ctx);
    const page = r && r.status === 200 ? (r.json as { items: { id: string; split: { what: string; shares: { key: string; ids: string[]; amount: number; paid: boolean }[] } | null }[] }) : null;
    const m = page?.items.find((x) => x.id === d.messageId && x.split);
    const sh = m?.split?.shares.find((x) => x.key === d.shareKey && x.ids.includes(user.id));
    if (!m || !sh) return err('NOT_FOUND');
    if (sh.paid) return err('VALIDATION', t('pay.shareGone'));
    const name = (await circlesMock({ method: 'GET', path: `/circles/${d.circleId}`, token: w.token }, ctx))?.json as { circle?: { name?: string } } | undefined;
    lines = [L('share', 'doc', t('pay.line.share', { what: m.split!.what }), sh.amount)];
    rule = t('pay.rule.share'); title = t('pay.title.share', { circle: name?.circle?.name ?? '' }); agent = false; photo = 'riyadh-kingdom-centre'; place = title;
  } else {
    lines = [L('esim', 'globe', t('pay.line.esim', { count: d.count }), sarToHalalas(DESK_PRICES.esimEach * d.count))];
    rule = t('pay.rule.esim'); title = t('pay.title.esim'); agent = false; place = title;
  }
  const subtotal = lines.reduce((a, l) => a + l.amount, 0);
  const travel = d.kind !== 'share'; // promo codes, credit and instalments are for travel
  const promo = travel ? checkPromo(body.promo, today(), subtotal) : null;
  const discount = promo?.status === 'applied' ? promo.discount : 0;
  const balance = await creditBalance(w, user, ctx);
  const used = travel && body.useCredit ? Math.max(0, Math.min(balance, subtotal - discount)) : 0;
  const total = subtotal - discount - used;
  const preview: OrderPreview = {
    kind: d.kind, title, photo, lines, subtotal: money(subtotal), promo: promo ? { code: promo.code, status: promo.status, message: promo.message, discount: money(discount) } : null,
    credit: { balance: money(balance), used: money(used) }, total: money(total), rule, agent, holdExpiresAt: hold ? new Date(hold).toISOString() : null,
    instalments: travel && total >= 100_000 ? { tabby: money(instalments(total, 4)[0]!), tamara: money(instalments(total, 3)[0]!) } : null,
    travellerIds: travellers.map((p) => p.id), missingPassports: d.kind === 'trip' || d.kind === 'package' ? travellers.filter((p) => !p.passport).map((p) => p.id) : [],
  };
  return { preview, place, travellers, ...out };
}

/* ───────────── the scripted desk ───────────── */

const tickMs = (o: Order) => (o.demo.has('slowAgent') ? 4200 : 1200);
const viewOf = ({ owner: _o, nextAt: _n, demo: _d, done: _dn, key: _k, resume: _r, otpTries: _ot, created, travellers: _tr, user: _u, snap: _s, ...v }: Order): OrderView =>
  ({ ...v, slow: !['confirmed', 'cancelled', 'declined', 'needs_answer', 'fare_changed', 'ticketing_failed', 'requires_action'].includes(v.status) && Date.now() - created > 8000 });

function confirm(o: Order) {
  o.status = 'confirmed'; o.step = 3; o.ref = o.ref ?? newRef(); o.confirmedBy = o.agent; o.confirmedAt = nowIso(); o.nextAt = null;
  // Like the server's desk: a confirmed flight or stay becomes a trip, so it shows in Trips and on Today.
  if ((o.kind === 'trip' || o.kind === 'stay') && !o.tripId && (o.snap.flight || o.snap.stay)) {
    const dest = o.snap.destination ? DESTINATIONS[o.snap.destination] : null;
    o.tripId = recordBookedTrip({
      owner: o.user, ref: o.ref, agentName: o.agent?.name ?? agentName(), city: dest?.name ?? o.place, country: dest ? ENTRY_RULES[dest.country]?.name ?? null : null, photo: dest?.photo ?? o.photo,
      travellers: o.travellers, flight: o.snap.flight, stay: o.snap.stay, bundle: o.bundle, lines: o.lines, extra: o.extra.amount, discount: o.snap.discount, creditUsed: o.creditUsed.amount,
      paymentLabel: o.paymentLabel, plan: o.plan, bookedAt: new Date(o.created).toISOString(),
    });
  }
  if (o.kind === 'quote' && o.requestId) { const r = requests.get(o.requestId); if (r) { r.view.status = 'paid'; r.view.quote = r.view.quote ? { ...r.view.quote, status: 'accepted' } : null; r.view.updatedAt = nowIso(); } }
  if (o.kind === 'package') {
    const id = uuid();
    requests.set(id, { id, owner: o.owner, created: Date.now(), messages: [], details: { kind: 'package', answers: {}, needs: {}, note: '' },
      view: { id, kind: 'package', status: 'done', title: t('request.title.package', { title: o.title }), summary: '', detail: '', note: null, travellerIds: o.travellerIds, agent: o.agent, quote: null, promisedBy: null, createdAt: nowIso(), updatedAt: nowIso() } });
  }
}

function advance(o: Order, now = Date.now()) {
  for (let i = 0; i < 6 && o.nextAt && o.nextAt <= now; i += 1) {
    const due = o.nextAt;
    if (o.question?.calling) { o.question = null; o.status = (o.resume as OrderView['status']) ?? 'held'; }
    else if (o.status === 'pending_agent') {
      if (o.demo.has('fareGone') && o.kind === 'trip' && !o.done.has('fare')) {
        o.done.add('fare');
        const each = sarToHalalas(120);
        const tot = each * Math.max(1, o.travellerIds.length);
        o.status = 'fare_changed'; o.fareChange = { perPerson: money(each), total: money(tot), newTotal: money(o.total.amount + o.extra.amount + tot) };
      } else { o.status = 'held'; o.step = 1; }
    } else if (o.status === 'held') {
      if (o.demo.has('agentQuestion') && !o.done.has('question')) {
        o.done.add('question');
        const p = o.travellers.find((x) => !x.isSelf) ?? o.travellers[0];
        const self = o.travellers.find((x) => x.isSelf);
        const given = `${(p?.givenNames || p?.firstName || '').split(/\s+/)[0] ?? ''} ${p && !p.isSelf ? self?.firstName ?? '' : ''}`.trim().toUpperCase();
        o.resume = 'held'; o.status = 'needs_answer';
        o.question = { text: p && !p.isSelf ? t('wait.question.names', { name: personName(p), given }) : t('wait.question.namesYours', { given }), options: ['yes', 'call'], calling: false };
      } else { o.status = 'price_locked'; o.step = 2; }
    } else if (o.status === 'price_locked') {
      if (o.demo.has('ticketingFails') && !o.done.has('ticketing')) { o.done.add('ticketing'); o.status = 'ticketing_failed'; o.problem = 'timed out'; }
      else if (o.kind === 'trip') { o.status = 'issuing'; o.step = 3; }
      else confirm(o);
    } else if (o.status === 'issuing') confirm(o);
    const waiting = ['needs_answer', 'fare_changed', 'ticketing_failed', 'confirmed', 'cancelled', 'declined', 'requires_action'].includes(o.status);
    o.nextAt = waiting ? null : due + tickMs(o);
  }
}

function progressRequest(r: Req, people: Person[], now = Date.now()) {
  const age = now - r.created;
  if (r.view.status === 'sent' && age > 4000) r.view.status = 'reviewing';
  if (r.view.status === 'reviewing' && age > 9000) {
    const travellers = r.view.travellerIds.map((id) => people.find((p) => p.id === id)).filter((p): p is Person => !!p);
    const s = r.details.search as { destination?: string | null; carrier?: string | null; cabin?: FlightOption['cabin'] | null; return?: string | null } | null | undefined;
    let byHand = null;
    if (s && r.view.kind === 'flight') {
      const dest = s.destination ? DESTINATIONS[s.destination] : null;
      const sv = s.carrier === 'SV' && dest ? CATALOGUE_FLIGHTS[dest.key]?.find((f) => f.carrier === 'SV') : null;
      const hand = sv ? { ppSar: sv.ppSar, text: `Saudia ${sv.number}, direct, leaving ${sv.dep}` } : dest?.byHand ?? OTHER_CITY_BY_HAND;
      byHand = { ...hand, cabin: (s.cabin === 'first' ? 'business' : s.cabin) ?? 'economy', oneway: !s.return } as const;
    }
    const q = deskQuote({ kind: r.view.kind, answers: r.details.answers, travellers, needs: r.details.needs as never, note: r.details.note, today: today(), service: r.details.service ?? null, serviceNeed: r.details.serviceNeed ?? null, byHand });
    r.view.status = 'quoted';
    r.view.updatedAt = nowIso();
    if (q) {
      r.view.quote = {
        id: uuid(), total: money(sarToHalalas(q.totalSar)), text: q.text, lead: q.lead, needLines: q.needLines, status: 'open', expiresAt: new Date(now + 86_400_000).toISOString(),
        breakdown: q.breakdown.map((b) => ({ personId: b.personId, name: b.name, lines: b.lines.map((l) => ({ label: l.label, amount: sarToHalalas(l.sar) })) })),
      };
    } else r.messages.push({ id: uuid(), from: 'agent', authorName: r.view.agent?.name ?? null, text: 'Got it. I’ll check and reply here within 20 minutes.', offer: null, createdAt: nowIso() });
  }
  if (r.view.status === 'paid' && now - Date.parse(r.view.updatedAt) > 15_000) r.view.status = 'done';
}

/* ───────────── the handler ───────────── */

export const bookingMock: AreaMock = async (w, ctx) => {
  const [path, query = ''] = w.path.split('?');
  const owned = /^\/(ask\/parse|search\/|offers\/|plans|requests|quotes\/|orders)/.test(path!);
  if (!owned) return null;
  const user = ctx.user;
  if (!user) return err('UNAUTHORIZED');
  const demo = new Set((new URLSearchParams(query).get('demo') ?? '').split(',').filter((x) => DemoFlag.safeParse(x).success) as DemoFlag[]);
  const key = `${w.method} ${path}`;
  const body = (w.body ?? {}) as Record<string, unknown>;
  const m = (re: RegExp) => re.exec(path!);
  const bad = (issues: { path: PropertyKey[]; message: string }[]) => err('VALIDATION', undefined, Object.fromEntries(issues.map((i) => [i.path.map(String).join('.') || '_', i.message])));
  const people = await household(w, user, ctx);
  const mine = (ids: string[]) => ids.every((id) => people.some((p) => p.id === id));

  if (key === 'POST /ask/parse') {
    const p = AskParseRequest.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const r = parseAskRules(p.data.text, { today: today(), people });
    return ok({ intent: { kind: r.kind, destination: r.destination, destinationName: r.destinationName, from: r.from, depart: r.depart, return: r.return, tripType: r.tripType, monthOnly: r.monthOnly, cabin: r.cabin, cabinNote: r.cabinNote, travellerIds: r.ids, travellerCount: r.count, infants: r.infants, needs: r.needs, needsMentioned: r.needsMentioned, answers: r.answers, ask: r.ask, source: 'rules' } });
  }
  if (key === 'POST /search/flights') {
    const p = FlightSearchRequest.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const q = p.data;
    const dest = DESTINATIONS[q.destination];
    if (!dest) return err('VALIDATION', undefined, { destination: 'Unknown destination' });
    if (!mine(q.travellerIds)) return err('NOT_FOUND');
    const base = { destination: dest.key, destinationName: dest.name, from: q.from, depart: q.depart, return: q.return, cabin: q.cabin, unavailable: [] as { carrier: string; airline: string }[], bundle: null, cachedUntil: new Date(Date.now() + 600_000).toISOString() };
    await new Promise((r) => setTimeout(r, 500));
    if (dest.byHand) return ok({ ...base, outcome: 'by_hand', checked: 0, options: [] });
    let depart = q.depart;
    if (demo.has('noResults')) {
      if (!q.flexibleDays) return ok({ ...base, outcome: 'none', checked: CHECKED_FARES[dest.key] ?? 9, options: [] });
      const later = addDays(q.depart, 1);
      if (!q.return || later < q.return) depart = later;
    }
    const from = dest.code === q.from ? (q.from === 'RUH' ? 'JED' : 'RUH') : q.from;
    let opts = flightOptions(dest.key, from, depart, q.return, q.cabin, q.travellerIds.length, q.infants);
    const unavailable: { carrier: string; airline: string }[] = [];
    if (demo.has('supplierDown') && opts.some((o) => o.carrier === 'SV')) { opts = opts.filter((o) => o.carrier !== 'SV'); unavailable.push({ carrier: 'SV', airline: 'Saudia' }); }
    for (const o of opts) offers.set(o.id, { id: o.id, owner: user.id, kind: 'flight', option: o, search: { destination: dest.key, from, depart, return: q.return, infants: q.infants, cabin: q.cabin, travellerIds: q.travellerIds }, expiresAt: Date.now() + HOLD });
    const b = dest.key === 'istanbul' && q.return ? bundleFor(q.travellerIds.length, depart, q.return) : null;
    return ok({
      ...base, depart, outcome: opts.length ? (unavailable.length ? 'partial' : 'ok') : 'none', checked: CHECKED_FARES[dest.key] ?? 9, options: opts, unavailable,
      bundle: b ? { nights: b.nights, stay: money(sarToHalalas(b.staySar)), pickup: money(sarToHalalas(b.pickupSar)), total: money(sarToHalalas(b.totalSar)), hotelName: b.hotel.name, rooms: b.rooms } : null,
    });
  }
  if (key === 'POST /search/stays') {
    const p = StaySearchRequest.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const dest = DESTINATIONS[p.data.destination];
    if (!dest) return err('VALIDATION');
    if (!mine(p.data.travellerIds)) return err('NOT_FOUND');
    await new Promise((r) => setTimeout(r, 400));
    const base = { destination: dest.key, destinationName: dest.name, cachedUntil: new Date(Date.now() + 600_000).toISOString() };
    if (!CATALOGUE_HOTELS[dest.key]) return ok({ ...base, outcome: 'by_hand', options: [] });
    if (demo.has('noResults')) return ok({ ...base, outcome: 'none', options: [] });
    const opts = stayOptions(dest.key, p.data.checkIn, p.data.nights, p.data.travellerIds.length);
    for (const o of opts) offers.set(o.id, { id: o.id, owner: user.id, kind: 'stay', option: o, search: { destination: dest.key, checkIn: p.data.checkIn, nights: p.data.nights, travellerIds: p.data.travellerIds }, expiresAt: Date.now() + HOLD });
    return ok({ ...base, outcome: 'ok', options: opts });
  }
  if (key === 'POST /search/entry') {
    const p = EntryCheckRequest.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    if (!DESTINATIONS[p.data.destination]) return err('VALIDATION');
    const travellers = p.data.travellerIds.map((id) => people.find((x) => x.id === id)).filter((x): x is Person => !!x);
    if (travellers.length !== p.data.travellerIds.length) return err('NOT_FOUND');
    return ok(entryChecks({ destination: p.data.destination, travellers, depart: p.data.depart, return: p.data.return, answers: p.data.answers, today: today(), demo: { passportProblemFor: demo.has('passportProblem') ? demoPassportTarget(people) : null }, iqamaOf: demoIqama }));
  }
  let r = m(/^\/offers\/([^/]+)(\/price)?$/);
  if (r) {
    const o = offers.get(r[1]!);
    if (!o || o.owner !== user.id) return err('NOT_FOUND');
    let changedBy: number | null = null;
    if (r[2] && w.method === 'POST') { o.expiresAt = Date.now() + HOLD; o.option = { ...o.option, expiresAt: new Date(o.expiresAt).toISOString() }; changedBy = 0; }
    return ok({ kind: o.kind, flight: o.kind === 'flight' ? o.option : null, stay: o.kind === 'stay' ? o.option : null, expired: o.expiresAt <= Date.now(), changedBy });
  }
  if (key === 'GET /plans' || m(/^\/plans\/([^/]+)$/)) {
    const n = Math.max(1, people.filter((p) => p.relation !== 'helper').length);
    const sum = (p: (typeof PLANS)[string]) => ({ id: p.id, title: p.title, sub: p.sub, photo: p.photo, city: p.city, days: p.days, stops: p.plan.reduce((a, d) => a + d.stops.length, 0), total: money(sarToHalalas((p.price.flights * n) / 2 + p.price.stay + (p.price.experiences * n) / 4)), travellers: n });
    if (key === 'GET /plans') return ok({ plans: Object.values(PLANS).map(sum) });
    const plan = PLANS[decodeURIComponent(m(/^\/plans\/([^/]+)$/)![1]!)];
    return plan ? ok({ plan: { ...sum(plan), plan: plan.plan } }) : err('NOT_FOUND');
  }

  /* requests */
  const all = () => [...requests.values()].filter((x) => x.owner === user.id);
  if (key === 'GET /requests') { all().forEach((x) => progressRequest(x, people)); return ok({ requests: all().sort((a, b) => b.created - a.created).map((x) => x.view) }); }
  if (key === 'POST /requests') {
    const p = CreateRequestBody.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const b = p.data;
    const seen = b.clientId ? all().find((x) => x.details.clientId === b.clientId) : null;
    if (seen) return ok({ request: seen.view }, 201);
    if (!mine(b.travellerIds)) return err('NOT_FOUND');
    const travellers = b.travellerIds.map((id) => people.find((x) => x.id === id)!);
    const names = travellers.map((x) => personName(x)).join(', ');
    const form = REQUEST_FORMS[b.kind as RequestFormKind] ?? [];
    const needSummary = travellers.filter((x) => (b.needs[x.id] ?? []).length).map((x) => `${personName(x)}: ${(b.needs[x.id] ?? []).map((k) => NEED_LABELS[k].toLowerCase()).join(', ')}`).join(' · ');
    const summary = form.map((f) => (f.people ? names : f.needs ? needSummary : (b.answers[f.k] ?? []).join(', '))).filter(Boolean).join(' · ');
    let title = requestTitle(b.kind, b.answers, b.query);
    let detail = [summary || (b.kind === 'general' || b.kind === 'flight' ? '' : b.query), b.note ? `“${b.note}”` : ''].filter(Boolean).join(' · ') || b.query;
    if (b.service) {
      const who = travellers.find((x) => x.id === b.serviceFor?.personId);
      const name = who ? personName(who) : '';
      title = b.service === 'uk_eta' ? t('request.title.eta') : b.service === 'evisa' ? t('request.title.evisa', { need: b.serviceFor?.need ?? 'Visa', name }) : b.service === 'reentry' ? t('request.title.reentry', { name }) : t('request.title.renewal', { name });
      detail = names;
    } else if (b.search) {
      const s = b.search;
      const city = (s.destination && DESTINATIONS[s.destination]?.name) || s.destinationName || '';
      const dates = s.depart ? (s.return ? rangeLabel(s.depart, s.return) : `${rangeLabel(s.depart)}, one way`) : t('request.datesLater');
      title = b.kind === 'stay' ? t('request.title.staysIn', { city }) : s.carrier ? t('request.title.airlineByHand', { airline: 'Saudia', city, dates }) : t('request.title.flightsTo', { city, dates });
      detail = b.kind === 'stay' ? `${dates} · ${names}` : `From ${s.from ?? 'RUH'} · ${names}`;
    }
    const id = uuid();
    const req: Req = {
      id, owner: user.id, created: Date.now(), messages: [],
      details: { kind: b.kind, answers: b.answers, needs: b.needs, note: b.note, search: b.search ?? null, service: b.service ?? null, serviceNeed: b.serviceFor?.need ?? null, clientId: b.clientId ?? null },
      view: { id, kind: b.kind, status: 'sent', title, summary, detail, note: b.note || null, travellerIds: b.travellerIds, agent: { name: agentName() }, quote: null, promisedBy: new Date(Date.now() + 7_200_000).toISOString(), createdAt: nowIso(), updatedAt: nowIso() },
    };
    requests.set(id, req);
    return ok({ request: req.view }, 201);
  }
  r = m(/^\/requests\/([^/]+)(\/messages)?$/);
  if (r) {
    const req = requests.get(r[1]!);
    if (!req || req.owner !== user.id) return err('NOT_FOUND');
    progressRequest(req, people);
    if (!r[2]) return ok({ request: req.view });
    if (w.method === 'POST') {
      const text = String(body.text ?? '').trim();
      if (!text) return err('VALIDATION');
      req.messages.push({ id: uuid(), from: 'me', authorName: null, text, offer: null, createdAt: nowIso() });
    }
    const last = req.messages.at(-1);
    let typing = false;
    if (last?.from === 'me') {
      if (Date.now() - Date.parse(last.createdAt) >= 1600) {
        const rep = deskReply(req.view.kind, last.text, Math.max(1, req.view.travellerIds.length));
        req.messages.push({ id: uuid(), from: 'agent', authorName: req.view.agent?.name ?? null, text: rep.text, offer: rep.offer ? { label: rep.offer.label, perPerson: money(sarToHalalas(rep.offer.perPersonSar)), accepted: false } : null, createdAt: nowIso() });
      } else typing = true;
    }
    return ok({ messages: req.messages, agentTyping: typing }, w.method === 'POST' ? 201 : 200);
  }
  r = m(/^\/quotes\/([^/]+)(\/accept-offer)?$/);
  if (r) {
    const req = all().find((x) => x.view.quote?.id === r![1]);
    if (!req || !req.view.quote) return err('NOT_FOUND');
    if (!r[2]) return ok({ quote: req.view.quote });
    const msg = req.messages.find((x) => x.id === body.messageId);
    if (!msg?.offer || msg.offer.accepted || req.view.quote.status !== 'open') return err('VALIDATION');
    const offer = msg.offer;
    const NEAR = 'Room steps from the Haram';
    const breakdown = req.view.quote.breakdown.map((b) => {
      if (/^On a lap/.test(b.lines[0]?.label ?? '')) return b;
      const had = b.lines.find((l) => l.label === NEAR);
      return { ...b, lines: [...b.lines.filter((l) => l.label !== NEAR), { label: offer.label, amount: offer.perPerson.amount + (had?.amount ?? 0) }] };
    });
    const total = breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.amount, 0), 0);
    const fmt = (h: number) => Math.round(h / 100).toLocaleString('en-US');
    req.view.quote = { ...req.view.quote, breakdown, total: money(total), text: `${req.view.quote.text} Now at the King Abdulaziz Gate, 2 minutes’ walk to the Haram. New total SAR ${fmt(total)}.`, lead: req.view.quote.lead ? `${req.view.quote.lead} Now at the King Abdulaziz Gate, 2 minutes’ walk to the Haram.` : null };
    msg.offer = { ...offer, accepted: true };
    req.messages.push({ id: uuid(), from: 'me', authorName: null, text: t('request.switchYes'), offer: null, createdAt: nowIso() });
    req.messages.push({ id: uuid(), from: 'agent', authorName: req.view.agent?.name ?? null, text: `Done. You’re at the King Abdulaziz Gate. New total SAR ${fmt(total)}. Pay when you’re ready.`, offer: null, createdAt: new Date(Date.now() + 5).toISOString() });
    return ok({ request: req.view, messages: req.messages });
  }

  /* orders */
  if (key === 'POST /orders/preview') {
    const p = PreviewBody.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const priced = await price(w, user, ctx, p.data);
    return 'status' in priced ? priced : ok({ preview: priced.preview });
  }
  if (key === 'POST /orders') {
    const p = CreateOrderBody.safeParse(body);
    if (!p.success) return bad(p.error.issues);
    const b = p.data;
    const prior = [...orders.values()].find((o) => o.owner === user.id && o.key === b.idempotencyKey);
    if (prior) return ok({ outcome: prior.status === 'requires_action' ? 'requires_action' : 'created', order: viewOf(prior) }, 201);
    await new Promise((res) => setTimeout(res, 600));
    const priced = await price(w, user, ctx, b, demo.has('priceUp') && b.draft.kind === 'trip' ? 14_000 : 0);
    if ('status' in priced) return priced;
    const pv = priced.preview;
    if (pv.holdExpiresAt && Date.parse(pv.holdExpiresAt) <= Date.now()) return ok({ outcome: 'hold_ended', preview: pv });
    if (b.expectedTotal !== pv.total.amount) return ok({ outcome: 'price_changed', previousTotal: money(b.expectedTotal), preview: pv, changedBy: money(pv.total.amount - b.expectedTotal) });
    if (b.draft.kind === 'trip' || b.draft.kind === 'stay') {
      const s = priced.search as { destination: string; depart?: string; return?: string | null; checkIn?: string };
      const checks = entryChecks({ destination: s.destination, travellers: priced.travellers, depart: s.depart ?? s.checkIn ?? today(), return: s.return ?? null, answers: {}, today: today(), demo: { passportProblemFor: demo.has('passportProblem') ? demoPassportTarget(people) : null } });
      const blocked = checks.checks.find((c) => c.key === 'passport' && c.blocking);
      if (blocked) return ok({ outcome: 'blocked', message: blocked.text });
    }
    const pay = b.payment;
    if (b.draft.kind === 'share' && (b.plan !== 'full' || pay.method === 'credit')) return err('VALIDATION');
    let label = t('pay.paidCredit');
    let requires3ds = false;
    if (pv.total.amount > 0 && pay.method !== 'credit') {
      if (b.plan !== 'full' && pay.method !== 'applepay' && pv.total.amount >= 100_000) label = b.plan === 'tabby' ? 'Tabby' : 'Tamara';
      else if (pay.method === 'applepay') label = 'Apple Pay';
      else if (pay.method === 'new_card') { label = t('pay.card.label', { brand: pay.brand === 'visa' ? 'Visa' : pay.brand === 'mastercard' ? 'Mastercard' : 'mada', last: pay.last4.slice(-2) }); requires3ds = true; }
      else {
        const { card, first } = await cardOf(w, ctx, pay.cardId);
        if (!card) return err('NOT_FOUND');
        label = card.label;
        if (demo.has('decline') && first === card.id) return ok({ outcome: 'declined', message: t('pay.declined.body') });
        requires3ds = demo.has('needs3ds');
      }
    }
    const agentKind = ['trip', 'stay', 'package'].includes(pv.kind);
    const f = priced.flight;
    const o: Order = {
      id: uuid(), kind: pv.kind, status: requires3ds ? 'requires_action' : 'pending_agent', step: 0, title: pv.title, place: priced.place,
      depart: f?.out.date ?? null, departTime: f?.out.dep ?? null, from: f?.out.from ?? null, oneway: f ? !f.back : false, photo: pv.photo,
      carrier: f?.carrier ?? null, airline: f?.airline ?? null, flightNumber: f?.out.flightNumber ?? null, cabin: f?.cabin ?? null, seats: f ? seatsFor(priced.travellers.length, f.cabin) : [],
      travellerIds: pv.travellerIds, lines: pv.lines, total: pv.total, extra: money(0), plan: label === 'Tabby' ? 'tabby' : label === 'Tamara' ? 'tamara' : 'full', paymentLabel: label,
      creditUsed: pv.credit.used, bundle: !!(priced.search as { bundle?: boolean } | undefined)?.bundle, ref: null, agent: { name: agentName() }, confirmedBy: null,
      question: null, fareChange: null, problem: null, slow: false, tripId: null, requestId: b.draft.kind === 'quote' ? b.draft.requestId : null,
      action: requires3ds ? { kind: 'otp', triesLeft: 3, label, amount: pv.total } : null, createdAt: nowIso(), confirmedAt: null,
      owner: user.id, nextAt: requires3ds ? null : Date.now() + 1200, demo, done: new Set(), key: b.idempotencyKey, otpTries: 0, created: Date.now(), travellers: priced.travellers,
      user, snap: { flight: priced.flight ?? null, stay: priced.stay ?? null, destination: (priced.search as { destination?: string } | undefined)?.destination ?? null, discount: pv.promo?.status === 'applied' ? pv.promo.discount.amount : 0 },
    };
    if (demo.has('slowAgent')) o.nextAt = Date.now() + 4200;
    orders.set(o.id, o);
    if (pv.credit.used.amount) creditSpent.set(user.id, (creditSpent.get(user.id) ?? 0) + pv.credit.used.amount);
    if (requires3ds) return ok({ outcome: 'requires_action', order: viewOf(o) }, 201);
    if (!agentKind) { confirm(o); return ok({ outcome: 'paid', order: viewOf(o) }, 201); }
    return ok({ outcome: 'created', order: viewOf(o) }, 201);
  }
  if (key === 'GET /orders') {
    const mineOrders = [...orders.values()].filter((o) => o.owner === user.id);
    mineOrders.forEach((o) => advance(o));
    return ok({ orders: mineOrders.filter((o) => o.status !== 'cancelled' && o.status !== 'declined').map(viewOf) });
  }
  r = m(/^\/orders\/([^/]+)(\/3ds|\/answer)?$/);
  if (r) {
    const o = orders.get(r[1]!);
    if (!o || o.owner !== user.id) return err('NOT_FOUND');
    if (r[2] === '/3ds') {
      if (o.status !== 'requires_action') return err('VALIDATION');
      if (body.code === '123456') {
        o.action = null;
        if (['trip', 'stay', 'package'].includes(o.kind)) { o.status = 'pending_agent'; o.nextAt = Date.now() + tickMs(o); } else confirm(o);
      } else {
        o.otpTries += 1;
        if (o.otpTries >= 3) { o.status = 'declined'; o.action = null; creditSpent.set(user.id, Math.max(0, (creditSpent.get(user.id) ?? 0) - o.creditUsed.amount)); }
        else o.action = { ...o.action!, triesLeft: 3 - o.otpTries };
      }
      return ok({ order: viewOf(o) });
    }
    if (r[2] === '/answer') {
      const a = String(body.answer ?? '');
      if (a === 'yes' && o.status === 'needs_answer') { o.question = null; o.status = 'held'; o.nextAt = Date.now() + tickMs(o); }
      else if (a === 'call' && o.status === 'needs_answer') { o.question = { ...o.question!, calling: true }; o.status = 'held'; o.nextAt = Date.now() + 3000; }
      else if (a === 'accept_fare' && o.status === 'fare_changed') { o.extra = money(o.extra.amount + (o.fareChange?.total.amount ?? 0)); o.fareChange = null; o.status = 'pending_agent'; o.nextAt = Date.now() + tickMs(o); }
      else if (a === 'retry_by_phone' && o.status === 'ticketing_failed') { o.problem = null; o.status = 'price_locked'; o.step = 2; o.nextAt = Date.now() + tickMs(o); }
      else if ((a === 'stop' || a === 'cancel') && !['confirmed', 'cancelled'].includes(o.status)) { o.status = 'cancelled'; o.nextAt = null; creditSpent.set(user.id, Math.max(0, (creditSpent.get(user.id) ?? 0) - o.creditUsed.amount)); }
      else return err('VALIDATION');
      return ok({ order: viewOf(o) });
    }
    advance(o);
    return ok({ order: viewOf(o) });
  }
  return err('NOT_FOUND');
};

/** For the e2e script and tests: forget everything (a fresh install). */
export function resetBookingMock() { offers.clear(); requests.clear(); orders.clear(); creditSpent.clear(); }
