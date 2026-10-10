import {
  ChangeFlightRequest, CompanyInvoiceRequest, CreateRefundRequest, CreateTripAskRequest, DisruptionChoiceRequest, ERROR_CODES, ImportTrackedRequest, MoveRequest,
  PatchTripRequest, SELLER, FLIGHT_POSITION_ATTRIBUTION, TrackFlightRequest, TripPhase, AIRLINE_INFO, SWITCH_OFFERS,
  addDays, applyChange, arrivalPickup, askSpec, buildItinerary, calendarEvents, changeOptions, creditLines, dayLabel, demoNow, demoView, derivePhase, deskStatus,
  disruptionOptions, fareRulesFor, formatSar, homePickup, instalments, invoiceHtml, invoiceLinesFor, invoiceNumber, liveStay, moveNeeded, nameDistance, nightPrice,
  outSegment, rangeLong, rebookPatch, refundQuoteItems, sameTimeAsHome, shareText, stayEnd, switchCredit, t, timing, todayIn, tripRefundAmount, zatcaQr, zonedToInstant,
  type CopyKey, type DisruptionKind, type ErrorCode, type InvoiceDoc, type InvoiceLine, type Notification, type RefundView, type TrackedFlightView, type TripCard,
  type TripDetail, type TripPayment, type TripPhase as Phase, type TripRequestView, type TripTraveller, type Vars,
} from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock, MockUser } from '../mock-api';

/*
 * EXPO_PUBLIC_API_MODE=mock for the trip companion: the same endpoints as platform/src/app/api/app/v1/{trips,refunds,
 * invoices,tracked,notifications,devices,flights/{no}/status}, in memory, running the same rules from @mada/shared
 * (trip clock, refund rules, change options, disruption options, itinerary, invoice lines). The demo account
 * (+966 50 000 4127) gets the prototype's Istanbul trip on first use; POST /trips/demo seeds it for anyone.
 */

type Charge = TripPayment & { lines: InvoiceLine[]; tripId: string };
type Doc = { id: string; number: string; tripId: string; chargeId: string; kind: 'simplified' | 'tax' | 'credit_note'; status: 'draft' | 'issued'; customer: string; company: TripDetail['company']; lines: InvoiceLine[]; againstId: string | null; paidWith: string | null; issuedAt: string };
type Req = TripRequestView & { scripted: 'yes' | 'no' | null; clientKey: string | null };
type Ref = RefundView & { items: { chargeId: string; credited: number; creditNoteId: string | null }[]; clientKey: string };
type State = {
  trips: Omit<TripDetail, 'clock'>[];
  charges: Charge[];
  docs: Doc[];
  requests: Req[];
  refunds: Ref[];
  inbox: (Notification & { readAt: string | null })[];
  tracked: TrackedFlightView[];
  credit: number;
  idem: Map<string, unknown>;
  seeded: boolean;
};

const states = new Map<string, State>();
const counters = new Map<string, number>();
const nowIso = () => new Date().toISOString();
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));
const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
const SAR = (amount: number) => ({ amount, currency: 'SAR' as const });
const tk = (k: string, v?: Vars) => t(k as CopyKey, v);
function err(code: ErrorCode, message?: string, fields?: Record<string, string>): WireResponse {
  return { status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy), ...(fields ? { fields } : {}) } } };
}

function stateOf(user: MockUser): State {
  let s = states.get(user.id);
  if (!s) {
    s = { trips: [], charges: [], docs: [], requests: [], refunds: [], inbox: [], tracked: [], credit: 0, idem: new Map(), seeded: false };
    states.set(user.id, s);
  }
  if (!s.seeded && user.phone === '+966500004127') seed(user, s);
  return s;
}

function nextNumber(kind: Doc['kind'], at: string) {
  const year = Number(at.slice(0, 4));
  const series = invoiceNumber(kind, year, 0).slice(0, 5);
  const n = (counters.get(series) ?? 4180) + 1;
  counters.set(series, n);
  return invoiceNumber(kind, year, n);
}

function issueDoc(s: State, d: Omit<Doc, 'id' | 'number'> & { number?: string }): Doc {
  const doc: Doc = { ...d, id: uuid(), number: d.number ?? (d.status === 'draft' ? `DRAFT-${uuid().slice(0, 8).toUpperCase()}` : nextNumber(d.kind, d.issuedAt)) };
  s.docs.push(doc);
  return doc;
}

const customerOf = (trip: Omit<TripDetail, 'clock'>) => trip.travellers[0]?.fullName ?? 'The traveller';
const paidWith = (c: Pick<Charge, 'method' | 'label' | 'plan' | 'creditUsed'>) => (c.method === 'tabby' ? 'Tabby · 4 payments' : c.method === 'tamara' ? 'Tamara · 3 payments' : c.label ?? c.method) + (c.creditUsed.amount ? ` and ${formatSar(c.creditUsed.amount)} Mada credit` : '');

function addCharge(s: State, trip: Omit<TripDetail, 'clock'>, c: Omit<Charge, 'id' | 'invoiceId' | 'invoiceNumber' | 'creditNoteId' | 'refunded' | 'lines' | 'tripId'> & { discount?: number; label: string | null }): Charge {
  const lines = invoiceLinesFor(c.item, c.amount.amount, { trip: { ...trip, clock: clockFor(trip, null) }, title: c.title, discount: c.discount });
  const { discount: _d, ...rest } = c;
  const charge: Charge = { ...rest, tripId: trip.id, id: uuid(), invoiceId: null, invoiceNumber: null, creditNoteId: null, refunded: null, lines };
  const doc = issueDoc(s, { tripId: trip.id, chargeId: charge.id, kind: 'simplified', status: 'issued', customer: customerOf(trip), company: null, lines, againstId: null, paidWith: paidWith(charge), issuedAt: c.paidAt });
  charge.invoiceId = doc.id;
  charge.invoiceNumber = doc.number;
  s.charges.push(charge);
  return charge;
}

/* ───────── the demo trip (prototype store.jsx seedTrip) ───────── */

function seed(user: MockUser, s: State, outDay = '2027-03-09', backDay = '2027-03-15') {
  s.seeded = true;
  const selfName = user.name || 'Omar';
  const travellers: TripTraveller[] = [
    { id: user.people.find((p) => p.isSelf)?.id ?? uuid(), firstName: selfName, fullName: `${selfName} Alharbi`, initial: selfName.charAt(0), relation: 'self', isSelf: true, birthYear: 1984, passportExpiry: '2031-06-22' },
    { id: uuid(), firstName: 'Hessa', fullName: 'Hessa Alharbi', initial: 'H', relation: 'spouse', isSelf: false, birthYear: 1988, passportExpiry: '2029-01-15' },
    { id: uuid(), firstName: 'Sara', fullName: 'Sara Alharbi', initial: 'S', relation: 'child', isSelf: false, birthYear: 2013, passportExpiry: '2027-08-14' },
    { id: uuid(), firstName: 'Ahmed', fullName: 'Ahmed Alharbi', initial: 'A', relation: 'child', isSelf: false, birthYear: 2016, passportExpiry: '2030-03-21' },
  ];
  const n = travellers.length;
  const seats = (row: number) => travellers.map((_, i) => `${row}${'ABCDEF'[i % 6]}`);
  const outId = uuid();
  const trip: Omit<TripDetail, 'clock'> = {
    id: uuid(), city: 'Istanbul', country: 'Türkiye', imageUrl: 'istanbul-galata', startDate: outDay, endDate: backDay, travellerIds: travellers.map((p) => p.id),
    segments: [
      { id: outId, carrier: 'SV', carrierName: 'Saudia', flightNumber: 'SV263', from: 'RUH', to: 'IST', departLocal: `${outDay}T09:40`, departTz: 'Asia/Riyadh', arriveLocal: `${outDay}T13:55`, arriveTz: 'Europe/Istanbul', durationMin: 255, cabin: 'economy', terminal: 'Terminal 3', gate: 'B12', seats: seats(14), baggage: '2 × 23 kg', status: 'scheduled', statusSource: 'Schedule', pnr: 'X7K2QD', direction: 'out', bookedGate: 'B12', delayMin: null, predictedDelay: false, statusAt: null, brand: '#0b6b52' },
      { id: uuid(), carrier: 'SV', carrierName: 'Saudia', flightNumber: 'SV264', from: 'IST', to: 'RUH', departLocal: `${backDay}T15:10`, departTz: 'Europe/Istanbul', arriveLocal: `${backDay}T19:20`, arriveTz: 'Asia/Riyadh', durationMin: 250, cabin: 'economy', terminal: 'Terminal 1', gate: null, seats: seats(16), baggage: '2 × 23 kg', status: 'scheduled', statusSource: 'Schedule', pnr: 'X7K2QD', direction: 'back', bookedGate: null, delayMin: null, predictedDelay: false, statusAt: null, brand: '#0b6b52' },
    ],
    stays: [{ id: uuid(), name: 'Rooms near Galata Tower', area: 'Beyoğlu · 3 min to the tower', address: 'Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul', checkIn: outDay, nights: 6, rooms: 2, price: SAR(5880_00), cancellation: 'Free to cancel until 7 days before', status: 'booked', confirmation: 'GT-48213', phone: '+90 212 000 0000', addressShort: 'Galata Kulesi Sk. 12, Beyoğlu', walk: '3 min walk to Galata Tower', fromAirport: '45 min', roomType: null, plan: 'tabby' }],
    pickups: [
      { id: uuid(), direction: 'to_airport', at: new Date(zonedToInstant(`${outDay}T09:40`, 'Asia/Riyadh').getTime() - 155 * 60_000).toISOString(), driverName: 'Khalid', car: 'Black GMC Yukon', plate: null, meetingPoint: 'Your door', phone: '+966 55 014 2287', price: SAR(220_00), status: 'booked', room: 'room for 8 bags', waits: '10 min', offsetMin: -155, city: 'Riyadh' },
      { id: uuid(), direction: 'from_airport', at: zonedToInstant(`${outDay}T13:55`, 'Europe/Istanbul').toISOString(), driverName: 'Ahmet', car: 'Grey Mercedes Vito', plate: '34 MDA 21', meetingPoint: 'Door 3', phone: '+90 532 418 6610', price: SAR(220_00), status: 'booked', room: null, waits: '60 min', offsetMin: null, city: 'Istanbul' },
    ],
    status: 'booked', bookingRef: 'X7K2QD', confirmedBy: { id: 'faisal', name: 'Faisal', photoUrl: null }, imported: false, createdAt: '2027-02-14T07:42:00.000Z',
    travellers, fare: fareRulesFor('SV'), prices: { flights: SAR(2160_00 * n), stays: SAR(5880_00), pickups: SAR(440_00), discount: SAR(0), total: SAR(2160_00 * n + 5880_00 + 440_00) },
    noStay: null, rebooked: false, vouchers: [], bagReport: null, picks: [], rating: null, company: null,
    weather: { tempC: 14, summary: 'Light rain. Dry by Thursday.', tip: 'Light rain. Pack the umbrella.', rain: true }, disruption: null, openRequests: 0,
    agent: { name: 'Faisal', initial: 'F', online: true, covering: null }, bookedAt: '2027-02-14T07:42:00.000Z',
  };
  s.trips.push(trip);
  const paidAt = '2027-02-14T07:42:00.000Z';
  const plan = instalments(5880_00, 4).map((a, i) => ({ seq: i + 1, dueOn: addDays('2027-02-14', i * 30), amount: SAR(a), paid: i < 1 }));
  addCharge(s, trip, { item: 'flight', title: 'Flights · Saudia', sub: `SV263 and SV264 · ${n} travellers`, amount: SAR(2160_00 * n), method: 'card', label: 'Visa ending 41', paidAt, plan: null, creditUsed: SAR(0) });
  addCharge(s, trip, { item: 'stay', title: 'Rooms near Galata Tower', sub: '6 nights · from 9 Mar', amount: SAR(5880_00), method: 'tabby', label: 'Visa ending 41', paidAt, plan, creditUsed: SAR(0) });
  addCharge(s, trip, { item: 'pickup', title: 'Airport pickup both ways', sub: 'Khalid in Riyadh · Ahmet in Istanbul', amount: SAR(440_00), method: 'card', label: 'Visa ending 41', paidAt, plan: null, creditUsed: SAR(0) });
  s.trips.push({ ...trip, id: uuid(), city: 'Baku', country: 'Azerbaijan', imageUrl: 'baku-old-city', startDate: '2026-03-30', endDate: '2026-04-04', status: 'completed', segments: [], stays: [], pickups: [], bookingRef: 'B4KU26', weather: null });
}

/* ───────── the clock ───────── */

function phaseOf(path: string): Phase | null {
  const q = path.split('?')[1];
  if (!q) return null;
  const p = TripPhase.safeParse(new URLSearchParams(q).get('demoPhase'));
  return p.success ? p.data : null;
}
function clockFor(base: Omit<TripDetail, 'clock'>, demo: Phase | null): TripDetail['clock'] {
  if (demo) {
    const at = demoNow(base, demo, new Date());
    return { phase: demo, now: at.toISOString(), today: todayIn(outSegment(base)?.departTz, at), demo: true };
  }
  const now = new Date();
  return { phase: derivePhase(base, now), now: now.toISOString(), today: todayIn(outSegment(base)?.departTz, now), demo: false };
}
function view(s: State, base: Omit<TripDetail, 'clock'>, demo: Phase | null): TripDetail {
  progressDesk(s);
  const v = demo ? demoView(base, demo) : base;
  const open = s.requests.filter((r) => r.tripId === base.id && !['done', 'confirmed', 'cancelled'].includes(r.status)).length;
  const mine = s.charges.filter((c) => c.tripId === base.id);
  const sum = (items: string[]) => mine.filter((c) => items.includes(c.item)).reduce((a, c) => a + c.amount.amount, 0);
  const total = mine.reduce((a, c) => a + c.amount.amount, 0);
  return { ...v, clock: clockFor(base, demo), openRequests: open, prices: { ...v.prices, flights: SAR(sum(['flight'])), stays: SAR(sum(['stay'])), pickups: SAR(sum(['pickup'])), total: SAR(total || v.prices.total.amount) } };
}

function progressDesk(s: State) {
  const now = Date.now();
  for (const r of s.requests) {
    if (!r.scripted || r.quote || !['sent', 'reviewing'].includes(r.status)) continue;
    const next = deskStatus(Date.parse(r.createdAt), now, r.scripted, r.withWhom);
    if (next !== r.status) {
      r.status = next;
      r.updatedAt = nowIso();
      if (next === 'confirmed' || next === 'done' || next === 'cancelled') r.outcome = r.scripted;
    }
  }
  for (const f of s.refunds) {
    if (f.anyway && f.stage === 'requested' && now - Date.parse(f.createdAt) > 7000) { f.stage = 'rejected'; f.updatedAt = nowIso(); }
  }
}

function notify(s: State, n: { kind: Notification['kind']; level: Notification['level']; copy: string; vars?: Vars; href?: string | null }) {
  s.inbox.unshift({ id: uuid(), kind: n.kind, level: n.level, title: tk(`${n.copy}.title`, n.vars).slice(0, 32), body: tk(`${n.copy}.body`, n.vars).slice(0, 90), href: n.href ?? null, readAt: null, createdAt: nowIso() });
}

/* ───────── payments, refunds, invoices ───────── */

function payments(s: State, tripId: string): TripPayment[] {
  return s.charges.filter((c) => c.tripId === tripId).map(({ lines: _l, tripId: _t, ...c }) => {
    const items = s.refunds.filter((r) => r.stage !== 'rejected' && !r.anyway).flatMap((r) => r.items).filter((i) => i.chargeId === c.id);
    const credited = items.reduce((a, i) => a + i.credited, 0);
    return { ...c, refunded: items.length ? SAR(credited) : null, creditNoteId: items.find((i) => i.creditNoteId)?.creditNoteId ?? null };
  });
}

function docJson(s: State, d: Doc): { invoice: InvoiceDoc; html: string } {
  const total = d.lines.reduce((a, l) => a + l.gross, 0);
  const vat = d.lines.reduce((a, l) => a + l.vat, 0);
  const against = d.againstId ? s.docs.find((x) => x.id === d.againstId)?.number ?? null : null;
  const qr = zatcaQr({ seller: SELLER.legal, vatNumber: SELLER.vat, issuedAt: d.issuedAt, total, vat });
  const invoice: InvoiceDoc = {
    id: d.id, number: d.number, tripId: d.tripId, paymentId: d.chargeId, total: SAR(total), vat: SAR(vat), issuedAt: d.issuedAt, zatcaStatus: d.status === 'draft' ? 'not_required' : 'pending', pdfUrl: null,
    kind: d.kind, status: d.status, seller: { ...SELLER }, customer: d.customer, company: d.company, lines: d.lines, net: SAR(total - vat), againstNumber: against, paidWith: d.paidWith, qr,
    related: s.docs.filter((x) => x.chargeId === d.chargeId).map((x) => ({ id: x.id, number: x.number, kind: x.kind, status: x.status })),
  };
  return { invoice, html: invoiceHtml({ kind: d.kind, status: d.status, number: d.number, issuedAt: d.issuedAt, customer: d.customer, company: d.company, lines: d.lines, againstNumber: against, paidWith: d.paidWith, qr }) };
}

function createRefund(s: State, trip: TripDetail, input: { paymentIds: string[]; reason: string; destination: 'original' | 'credit'; clientKey: string }, title?: string): Ref | WireResponse {
  const existing = s.refunds.find((r) => r.clientKey === input.clientKey);
  if (existing) return existing;
  const pays = payments(s, trip.id);
  const chosen = pays.filter((p) => input.paymentIds.includes(p.id));
  if (chosen.length !== input.paymentIds.length) return err('NOT_FOUND');
  if (chosen.some((p) => p.refunded)) return err('VALIDATION', 'That’s already refunded.');
  const quotes = refundQuoteItems(trip, chosen);
  if (quotes.some((q) => q.back.amount === 0 && !q.askAnyway)) return err('VALIDATION', 'Nothing comes back for that under the rules.');
  const anyway = quotes.reduce((a, q) => a + q.back.amount, 0) === 0;
  const instal = quotes.filter((q) => q.method === 'tabby' || q.method === 'tamara');
  const destination: RefundView['destination'] = anyway ? 'original' : instal.length && instal.length === quotes.length ? 'instalments' : input.destination;
  const what = chosen.map((p) => (p.item === 'flight' ? 'flights' : p.item === 'stay' ? 'the stay' : p.item === 'pickup' ? 'the pickup' : p.title.toLowerCase()));
  const amount = anyway ? chosen.reduce((a, p) => a + p.amount.amount, 0) : quotes.reduce((a, q) => a + q.cash.amount, 0);
  const now = nowIso();
  const driver = homePickup(trip)?.driverName ?? 'The driver';
  const r: Ref = {
    id: uuid(), tripId: trip.id, title: title ?? `${trip.city} · ${what.length < 2 ? what.join('') : `${what.slice(0, -1).join(', ')} and ${what[what.length - 1]}`}`, amount: SAR(amount),
    stage: anyway ? 'requested' : destination === 'credit' ? 'sent' : 'requested', destination, provider: destination === 'instalments' ? instal[0]!.method : null,
    card: chosen.find((p) => p.method !== 'tabby')?.label ?? 'your card', anyway,
    reject: anyway ? (chosen[0]?.item === 'pickup' ? `${driver}’s company charges in full inside 24 hours, and he has turned down other work for your morning. I asked twice.` : 'The place is already holding the booking for you and won’t release it this close. I asked twice.') : null,
    alt: anyway ? (chosen[0]?.item === 'pickup' ? 'I can move the ride to another day in the next 3 months instead, free.' : 'I can move it to another day this trip, free.') : null,
    law: quotes.some((q) => q.law), airline: outSegment(trip)?.carrierName ?? null,
    cancelledInstalments: instal.length ? { count: instal.reduce((a, q) => a + (q.cancelled?.count ?? 0), 0), amount: SAR(instal.reduce((a, q) => a + (q.cancelled?.amount.amount ?? 0), 0)) } : null,
    expectedBy: destination === 'credit' ? now : new Date(Date.now() + 14 * 86_400_000).toISOString(), sentAt: destination === 'credit' ? now : null, createdAt: now, updatedAt: now,
    items: [], clientKey: input.clientKey,
  };
  for (const q of quotes) {
    const c = s.charges.find((x) => x.id === q.paymentId)!;
    const credited = anyway ? 0 : q.back.amount;
    let cn: string | null = null;
    if (credited) cn = issueDoc(s, { tripId: trip.id, chargeId: c.id, kind: 'credit_note', status: 'issued', customer: customerOf(trip), company: null, lines: creditLines(c.lines, credited), againstId: c.invoiceId, paidWith: null, issuedAt: now }).id;
    r.items.push({ chargeId: c.id, credited, creditNoteId: cn });
    if (q.item === 'stay' && !anyway) trip.stays.forEach((st) => { const base = s.trips.find((x) => x.id === trip.id)!; base.stays = base.stays.map((x) => (x.id === st.id ? { ...x, status: 'cancelled' } : x)); });
  }
  if (destination === 'credit') { s.credit += amount; notify(s, { kind: 'refund_moved', level: 'active', copy: 'notify.trip.credit', vars: { amount: formatSar(amount) }, href: '/trips?tab=requests' }); }
  s.requests.unshift(reqOf({ tripId: trip.id, kind: 'refund', area: 'refund', status: destination === 'credit' ? 'done' : 'sent', title: r.title, short: 'Refund', detail: input.reason, withWhom: 'faisal', scripted: null }));
  s.refunds.unshift(r);
  return r;
}

function reqOf(o: Partial<Req> & Pick<Req, 'tripId' | 'kind' | 'area' | 'title' | 'withWhom'>): Req {
  const now = nowIso();
  return { id: uuid(), status: 'sent', short: null, detail: null, withName: null, outcome: null, alt: null, yesText: null, quote: null, quoteText: null, createdAt: now, updatedAt: now, scripted: null, clientKey: null, ...o };
}

/* ───────── handlers ───────── */

function card(t: TripDetail): TripCard {
  const out = outSegment(t);
  const back = t.segments.find((x) => x.direction === 'back');
  return {
    id: t.id, city: t.city, country: t.country, imageUrl: t.imageUrl, startDate: t.startDate, endDate: t.endDate, status: t.status, phase: t.clock.phase,
    travellerNames: t.travellers.map((p) => p.firstName), justYou: t.travellers.length === 1 && !!t.travellers[0]?.isSelf, travellerCount: t.travellers.length,
    flight: out ? { code: out.flightNumber, date: out.departLocal.slice(0, 10), depart: out.departLocal.slice(11, 16), oneWay: !back } : null,
    stayName: liveStay(t)?.name ?? null, note: t.status === 'completed' ? `Eid with ${t.travellers.length > 1 ? `the ${['', 'one', 'two', 'three', 'four', 'five'][t.travellers.length] ?? t.travellers.length} of you` : 'you'}` : null,
    when: t.status === 'completed' ? 'Last Eid' : null,
  };
}

const pub = (r: Req): TripRequestView => { const { scripted: _s, clientKey: _c, ...v } = r; return v; };
const pubRefund = (r: Ref): RefundView => { const { items: _i, clientKey: _c, ...v } = r; return { ...v, reject: r.stage === 'rejected' ? r.reject : null, alt: r.stage === 'rejected' ? r.alt : null }; };

export const tripsMock: AreaMock = async (w: Wire, { user }) => {
  const [path, query] = w.path.split('?');
  const parts = (path ?? '').split('/').filter(Boolean);
  const head = parts[0];
  if (!['trips', 'refunds', 'invoices', 'tracked', 'notifications', 'devices', 'flights'].includes(head ?? '')) return null;
  if (head === 'flights' && parts[2] === 'position') {
    // Like the mock positions supplier: SVA263 over the Gulf of Aqaba at cruise; anything else isn't airborne.
    const no = decodeURIComponent(parts[1] ?? '').toUpperCase();
    const position = no === 'SV263' ? { lat: 29.12, lon: 35.02, altitudeFt: 37000, groundSpeedKt: 468, track: 322, onGround: false, seenAt: nowIso(), source: 'mock' } : null;
    return ok({ flightNumber: no, callsign: no === 'SV263' ? 'SVA263' : null, position, attribution: FLIGHT_POSITION_ATTRIBUTION });
  }
  if (head === 'flights' && parts[2] !== 'status') return null;
  const body = (w.body ?? {}) as Record<string, unknown>;
  const demo = phaseOf(w.path);
  const params = new URLSearchParams(query ?? '');

  // Guests may look up a flight's status.
  if (head === 'flights') {
    const no = decodeURIComponent(parts[1] ?? '').toUpperCase();
    const date = params.get('date') ?? '';
    const m = /^([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4})$/.exec(no);
    if (!m) return err('VALIDATION', undefined, { flightNo: 'Expected a flight number like SV263' });
    const info = lookup(no, date);
    return ok({ flight: info ? { ...info, updatedAt: nowIso() } : null });
  }
  if (!user) return err('UNAUTHORIZED');
  const s = stateOf(user);

  if (head === 'notifications') {
    if (w.method === 'GET') { const items = s.inbox.slice(0, 50); return ok({ items, next: null, unread: s.inbox.filter((n) => !n.readAt).length, notifications: items }); }
    const ids = (body.ids as string[] | undefined) ?? (parts[1] === 'read' || body.all ? s.inbox.map((n) => n.id) : []);
    if (parts[1] && parts[1] !== 'read') { const n = s.inbox.find((x) => x.id === parts[1]); if (!n) return err('NOT_FOUND'); n.readAt = body.read ? nowIso() : null; return ok({ notification: n }); }
    s.inbox.forEach((n) => { if (ids.includes(n.id) && !n.readAt) n.readAt = nowIso(); });
    return ok({ ok: true, unread: s.inbox.filter((n) => !n.readAt).length });
  }
  if (head === 'devices') return w.method === 'POST' ? ok({ deviceId: uuid() }, 201) : ok({ ok: true });

  if (head === 'tracked') {
    if (parts[1] === 'import') {
      const b = ImportTrackedRequest.safeParse(body);
      if (!b.success) return err('VALIDATION');
      b.data.flights.forEach((f) => track(s, f));
      return ok({ flights: s.tracked });
    }
    if (parts[1] && w.method === 'DELETE') { const before = s.tracked.length; s.tracked = s.tracked.filter((x) => x.id !== parts[1]); return before === s.tracked.length ? err('NOT_FOUND') : ok({ ok: true }); }
    if (w.method === 'POST') {
      const b = TrackFlightRequest.safeParse(body);
      if (!b.success) return err('VALIDATION');
      if (b.data.date < todayIn()) return err('VALIDATION', undefined, { date: 'Pick today or a day after' });
      return ok({ flight: track(s, b.data) }, 201);
    }
    return ok({ flights: s.tracked });
  }

  if (head === 'refunds') {
    progressDesk(s);
    if (parts[1]) { const r = s.refunds.find((x) => x.id === parts[1]); return r ? ok({ refund: pubRefund(r) }) : err('NOT_FOUND'); }
    return ok({ refunds: s.refunds.map(pubRefund) });
  }

  if (head === 'invoices') {
    const d = s.docs.find((x) => x.id === parts[1]);
    if (!d) return err('NOT_FOUND');
    if (parts[2] === 'company') {
      const b = CompanyInvoiceRequest.safeParse(body);
      if (!b.success) { const fields: Record<string, string> = {}; b.error.issues.forEach((i) => { fields[i.path.join('.')] = i.message; }); return err('VALIDATION', undefined, fields); }
      const siblings = s.docs.filter((x) => x.chargeId === d.chargeId);
      if (siblings.some((x) => x.kind === 'tax' && x.status === 'issued')) return err('VALIDATION', 'This tax invoice is issued. Mada can cancel it with a credit note and issue a new one.');
      const trip = s.trips.find((x) => x.id === d.tripId);
      if (trip) trip.company = b.data.company;
      let draft = siblings.find((x) => x.kind === 'tax' && x.status === 'draft');
      if (draft) draft.company = b.data.company;
      else draft = issueDoc(s, { ...d, kind: 'tax', status: 'draft', company: b.data.company, againstId: d.id, issuedAt: nowIso() });
      return ok(docJson(s, draft), 201);
    }
    if (parts[2] === 'issue') {
      if (d.status !== 'draft') return err('VALIDATION', 'This invoice is already issued.');
      d.status = 'issued'; d.issuedAt = nowIso(); d.number = nextNumber(d.kind, d.issuedAt);
      return ok(docJson(s, d));
    }
    return ok(docJson(s, d));
  }

  // /trips …
  if (parts.length === 1) {
    const details = s.trips.map((b) => view(s, b, null));
    const live = details.filter((d) => d.status !== 'cancelled' && d.clock.phase !== 'none');
    let current: TripDetail | null = live[0] ?? null;
    if (demo) {
      const c = current ?? details.find((d) => d.status === 'booked') ?? null;
      current = c && demo !== 'none' ? view(s, s.trips.find((b) => b.id === c.id)!, demo) : null;
    }
    const today = todayIn();
    const isPast = (d: TripDetail) => d.status === 'completed' || (d.status !== 'cancelled' && d.clock.phase === 'none' && (d.endDate ?? d.startDate) < today);
    return ok({
      clock: current?.clock ?? { phase: 'none', now: nowIso(), today, demo: !!demo }, currentId: current?.id ?? null,
      upcoming: details.filter((d) => d.status !== 'cancelled' && !isPast(d)).map((d) => card(current && current.id === d.id ? current : d)),
      past: details.filter(isPast).map(card), requests: s.requests.map(pub), refunds: s.refunds.map(pubRefund), tracked: s.tracked,
      unread: s.inbox.filter((n) => !n.readAt).length, credit: SAR(s.credit), stamps: details.filter(isPast).length,
    });
  }
  if (parts[1] === 'demo') { if (!s.trips.length) seed(user, s); return ok({ tripId: s.trips[0]!.id }, 201); }

  const base = s.trips.find((x) => x.id === parts[1]);
  if (!base) return err('NOT_FOUND');
  const trip = view(s, base, demo);
  const sub = parts[2];
  const reload = () => view(s, base, demo);

  if (!sub) {
    if (w.method === 'PATCH') {
      const b = PatchTripRequest.safeParse(body);
      if (!b.success) return err('VALIDATION', b.error.issues[0]?.message);
      const p = b.data;
      if (p.noStay !== undefined) base.noStay = p.noStay;
      if (p.bagReport) base.bagReport = p.bagReport;
      if (p.picks) base.picks = p.picks;
      if (p.rating) base.rating = { hotel: p.rating.hotel, driver: p.rating.driver, agent: p.rating.agent, note: p.rating.note, sentAt: p.rating.send ? nowIso() : null };
      if (p.pickupOffsetMin !== undefined) {
        const out = outSegment(base);
        base.pickups = base.pickups.map((x) => (x.direction === 'to_airport' && out ? { ...x, offsetMin: p.pickupOffsetMin!, at: new Date(zonedToInstant(out.departLocal, out.departTz).getTime() + p.pickupOffsetMin! * 60_000).toISOString() } : x));
      }
      const tr = reload();
      return ok({ trip: tr, move: moveNeeded(tr) });
    }
    return ok({ trip, move: moveNeeded(trip) });
  }
  if (sub === 'itinerary') {
    const days = buildItinerary({ trip, requests: s.requests.filter((r) => r.tripId === trip.id).map(pub), picks: trip.picks });
    const out = outSegment(trip);
    return ok({ tripId: trip.id, title: trip.city, datesLong: rangeLong(trip.startDate, trip.endDate), days, events: calendarEvents(trip, days), shareText: shareText(trip, days), move: moveNeeded(trip), sameTimeAsHome: out ? sameTimeAsHome(out) : true });
  }
  if (sub === 'refresh') {
    const out = outSegment(base);
    const changes = [];
    if (demo === 'travelday' && out && !base.rebooked && out.gate !== 'C4') {
      base.segments = base.segments.map((x) => (x.id === out.id ? { ...x, bookedGate: x.gate, gate: 'C4', statusSource: 'Live · airline', statusAt: nowIso() } : x));
      notify(s, { kind: 'gate_change', level: 'time_sensitive', copy: 'notify.gateChange', vars: { gate: 'C4', flight: out.flightNumber, minutes: 6 }, href: `/trip/${base.id}` });
      changes.push({ kind: 'gate', segmentId: out.id, from: out.gate, to: 'C4', title: 'Gate changed to C4', body: `${out.flightNumber} now boards from C4. It's a 6-minute walk.` });
    }
    return ok({ trip: reload(), changes });
  }
  if (sub === 'payments') {
    const p = payments(s, trip.id);
    return ok({ payments: p, total: SAR(p.reduce((a, x) => a + x.amount.amount, 0)), refunded: SAR(p.reduce((a, x) => a + (x.refunded?.amount ?? 0), 0)), credit: SAR(s.credit) });
  }
  if (sub === 'refunds' && parts[3] === 'quote') {
    const p = payments(s, trip.id);
    const tm = timing(trip.clock.phase);
    return ok({ items: refundQuoteItems(trip, p), airlineCancelled: tm.airlineCancelled, partlyUsed: tm.outUsed && !tm.allUsed, allUsed: tm.allUsed, card: p.find((x) => x.method !== 'tabby')?.label ?? 'your card' });
  }
  if (sub === 'refunds') {
    if (w.method === 'GET') return ok({ refunds: s.refunds.filter((r) => r.tripId === trip.id).map(pubRefund) });
    const b = CreateRefundRequest.safeParse(body);
    if (!b.success) return err('VALIDATION');
    const r = createRefund(s, trip, b.data);
    return 'status' in r && typeof r.status === 'number' ? (r as WireResponse) : ok({ refund: pubRefund(r as Ref) }, 201);
  }
  if (sub === 'stay') {
    const stay = payments(s, trip.id).find((p) => p.item === 'stay');
    if (!stay || !liveStay(trip)) return err('VALIDATION', 'There’s no stay to cancel.');
    const r = createRefund(s, trip, { paymentIds: [stay.id], reason: 'plans', destination: 'original', clientKey: String(body.clientKey ?? uuid()) }, `${trip.stays[0]!.name} · ${trip.stays[0]!.nights} nights`);
    return 'status' in r && typeof r.status === 'number' ? (r as WireResponse) : ok({ refund: pubRefund(r as Ref) }, 201);
  }
  if (sub === 'changes') {
    const n = Math.max(1, trip.travellers.length);
    if (w.method === 'GET') {
      const kind = (params.get('kind') ?? 'date') as Parameters<typeof changeOptions>[0];
      return ok({ kind, fare: trip.fare ?? fareRulesFor(outSegment(trip)?.carrier), options: changeOptions(kind, trip, kind === 'one' ? 1 : n), within24: timing(trip.clock.phase).within24 });
    }
    const b = ChangeFlightRequest.safeParse(body);
    if (!b.success) return err('VALIDATION');
    const input = b.data;
    const cached = s.idem.get(`change:${input.clientKey}`);
    if (cached) return ok(cached);
    const tm = timing(trip.clock.phase);
    const out = outSegment(trip)!;
    if (tm.within24) return err('VALIDATION', `Less than a day to go: ${out.carrierName} only changes tickets by phone. Ask Mada to call you.`);
    if (tm.airlineCancelled) return err('VALIDATION', `${out.carrierName} cancelled ${out.flightNumber}.`);
    let res: { result: 'done' | 'quoted' | 'sent'; say: string; total: number; request: Req };
    if (input.kind === 'name') {
      const p = trip.travellers.find((x) => x.id === input.travellerId);
      if (!p) return err('NOT_FOUND');
      const after = `${input.givenNames} ${input.surname}`.toUpperCase().trim();
      const small = nameDistance(p.fullName, after) <= 3;
      const r = reqOf({ tripId: trip.id, kind: 'name', area: 'change', title: small ? `Name fix for ${p.firstName}` : `Name change for ${p.firstName}`, short: small ? 'Name fixed' : 'Name change', detail: `${p.fullName.toUpperCase()} → ${after}`, withWhom: small ? 'airline' : 'faisal', withName: small ? out.carrierName : null, scripted: small ? 'yes' : 'no', yesText: 'New ticket number in your Wallet', alt: 'Mada will call you with the price of a new ticket.' });
      res = { result: 'sent', say: r.title, total: 0, request: r };
    } else if (input.kind === 'airline') {
      const o = SWITCH_OFFERS.find((x) => x.key === input.offerKey);
      if (!o) return err('NOT_FOUND');
      const net = Math.max(0, o.perPerson * n - switchCredit(trip));
      const r = reqOf({ tripId: trip.id, kind: 'airline', area: 'change', status: net ? 'quoted' : 'sent', title: `Switch to ${o.carrierName}`, short: 'airline switch', detail: `${o.code} · ${o.depart} · ${n} travellers`, withWhom: 'faisal', quote: net ? SAR(net) : null, quoteText: `We can hold ${n} seats on ${o.code} at ${o.depart}. After your ${out.carrierName} refund, the difference is ${formatSar(net)}. Pay and we’ll swap the tickets.` });
      res = { result: net ? 'quoted' : 'sent', say: r.title, total: net, request: r };
    } else {
      const opt = changeOptions(input.kind, trip, input.kind === 'one' ? 1 : n).find((o) => o.id === input.optionId);
      if (!opt) return err('NOT_FOUND');
      if (opt.soldOut) return err('VALIDATION', opt.sub);
      const who = input.kind === 'one' ? trip.travellers.find((p) => p.id === input.travellerId) : null;
      const kid = who?.birthYear && who.birthYear > new Date(trip.clock.now).getUTCFullYear() - 12;
      const count = input.kind === 'one' ? 1 : n;
      const total = (trip.fare?.changeFee ?? 0) * count + opt.diffPerPerson * count + (kid ? 350_00 : 0);
      const say = who ? `${who.firstName} flies home ${opt.say}` : opt.say;
      if (total > 0) {
        const r = reqOf({ tripId: trip.id, kind: input.kind, area: 'change', status: 'awaiting_payment', title: say, short: 'Flight changed', detail: formatSar(total), withWhom: 'airline', withName: out.carrierName, quote: SAR(total), quoteText: `${say}. Change fee and price difference: ${formatSar(total)}. Pay and we change it with ${out.carrierName}.` });
        res = { result: 'quoted', say, total, request: r };
      } else {
        const r = reqOf({ tripId: trip.id, kind: input.kind, area: 'change', status: input.kind === 'one' ? 'sent' : 'done', outcome: input.kind === 'one' ? null : 'yes', scripted: 'yes', title: say, short: 'Flight changed', detail: total < 0 ? `${formatSar(-total)} back as Mada credit` : 'No cost', withWhom: 'airline', withName: out.carrierName });
        if (input.kind !== 'one') {
          const patch = applyChange(input.kind, input.optionId, trip);
          if (patch) {
            base.segments = base.segments.map((x) => (x.id === patch.segmentId ? { ...x, ...patch.patch } : x));
            const o2 = outSegment(base)!;
            if (patch.segmentId === o2.id && input.kind === 'time') base.pickups = base.pickups.map((x) => (x.direction === 'to_airport' ? { ...x, at: new Date(zonedToInstant(o2.departLocal, o2.departTz).getTime() + (x.offsetMin ?? -155) * 60_000).toISOString() } : x));
          }
          if (total < 0) s.credit += -total;
        }
        res = { result: input.kind === 'one' ? 'sent' : 'done', say, total, request: r };
      }
    }
    s.requests.unshift(res.request);
    const tr = reload();
    const out2 = { ...res, request: pub(res.request), trip: tr, move: moveNeeded(tr) };
    s.idem.set(`change:${input.clientKey}`, out2);
    return ok(out2);
  }
  if (sub === 'move') {
    const b = MoveRequest.safeParse(body);
    if (!b.success) return err('VALIDATION');
    const m = moveNeeded(trip);
    if (!m) return err('VALIDATION', 'Everything is already on the flight’s day.');
    let back = 0;
    let quoted: Req | null = null;
    const out = outSegment(base)!;
    if (b.data.pickup && m.pickup) base.pickups = base.pickups.map((x) => (x.id === m.pickup!.pickupId ? { ...x, at: new Date(zonedToInstant(out.departLocal, out.departTz).getTime() + (x.offsetMin ?? -155) * 60_000).toISOString() } : x));
    if (b.data.hotel && m.hotel) {
      if (m.hotel.diff <= 0) {
        back = m.hotel.back;
        base.stays = base.stays.map((x) => (x.id === m.hotel!.stayId ? { ...x, checkIn: m.to, nights: m.hotel!.newNights, price: SAR(x.price.amount - back) } : x));
        if (back) refundPart(s, trip, 'stay', back, `${m.hotel.name} · one night less`);
      } else {
        quoted = reqOf({ tripId: trip.id, kind: 'nights', area: 'hotel', status: 'quoted', title: `Check in on ${dayLabel(m.to, { today: m.to })} instead`, short: 'earlier check-in', detail: m.hotel.name, withWhom: 'hotel', quote: SAR(m.hotel.diff), quoteText: `The hotel can take you from ${dayLabel(m.to, { today: m.to })}. ${formatSar(m.hotel.diff)}.` });
        s.requests.unshift(quoted);
      }
    }
    const tr = reload();
    return ok({ say: back ? `Moved. ${formatSar(back)} is on its way back.` : quoted ? 'Pickup moved. The extra night is with Mada.' : 'Moved. No cost.', back, quoted: quoted ? pub(quoted) : null, trip: tr, move: moveNeeded(tr) });
  }
  if (sub === 'requests') {
    progressDesk(s);
    if (w.method === 'GET') return ok({ requests: s.requests.filter((r) => r.tripId === trip.id).map(pub) });
    const b = CreateTripAskRequest.safeParse(body);
    if (!b.success) return err('VALIDATION');
    const cached = s.idem.get(`ask:${b.data.clientKey}`);
    if (cached) return ok(cached, 201);
    if (b.data.area === 'hotel' && b.data.kind === 'nights' && b.data.option === 'cut') {
      const st = liveStay(base)!;
      const night = nightPrice(st);
      const backAmt = timing(trip.clock.phase).early ? night : 0;
      base.stays = base.stays.map((x) => (x.id === st.id ? { ...x, nights: x.nights - 1, price: SAR(x.price.amount - backAmt) } : x));
      if (backAmt) refundPart(s, trip, 'stay', backAmt, `${st.name} · one night less`);
      const r = reqOf({ tripId: trip.id, kind: 'nights', area: 'hotel', status: 'confirmed', outcome: 'yes', title: `Leave on ${dayLabel(addDays(stayEnd(st), -1), { today: st.checkIn })}`, short: 'One night less', detail: backAmt ? `${formatSar(backAmt)} back to your card` : 'The hotel keeps the night', withWhom: 'hotel' });
      s.requests.unshift(r);
      const res = { request: pub(r), say: backAmt ? `Shortened. ${formatSar(backAmt)} is on its way back.` : 'Shortened. The hotel keeps that night, as per the rule.', trip: reload() };
      s.idem.set(`ask:${b.data.clientKey}`, res);
      return ok(res, 201);
    }
    const spec = askSpec(trip, b.data);
    if ('problem' in spec) return err('VALIDATION', spec.problem);
    const r = reqOf({ tripId: trip.id, kind: spec.kind, area: spec.area, status: spec.quote ? 'quoted' : 'sent', title: spec.title, short: spec.short, detail: spec.detail, withWhom: spec.withWhom, withName: spec.withName, alt: spec.alt, yesText: spec.yesText, quote: spec.quote ? SAR(spec.quote) : null, quoteText: spec.quoteText, scripted: spec.outcome, clientKey: b.data.clientKey });
    s.requests.unshift(r);
    if (spec.quote) notify(s, { kind: 'agent_reply', level: 'active', copy: 'notify.trip.price', vars: { what: spec.short, amount: formatSar(spec.quote) }, href: '/trips?tab=requests' });
    const res = { request: pub(r), say: null, trip: reload() };
    s.idem.set(`ask:${b.data.clientKey}`, res);
    return ok(res, 201);
  }
  if (sub === 'disruption') {
    const asked = params.get('kind');
    const kind: DisruptionKind | null = asked === 'night' || asked === 'cancel' || asked === 'delay' ? asked : trip.disruption?.kind ?? (trip.clock.phase === 'cancelled' ? 'cancel' : trip.clock.phase === 'delayed' ? 'delay' : null);
    if (w.method === 'GET') {
      if (!kind) return err('NOT_FOUND', 'Nothing has gone wrong with this flight.');
      return ok(disruptionView(trip, kind));
    }
    const b = DisruptionChoiceRequest.safeParse(body);
    if (!b.success) return err('VALIDATION');
    const cached = s.idem.get(`dz:${b.data.clientKey}`);
    if (cached) return ok(cached);
    const res = choose(s, base, trip, b.data.kind, b.data.optionId, b.data.clientKey);
    if ('status' in res && typeof res.status === 'number') return res as WireResponse;
    s.idem.set(`dz:${b.data.clientKey}`, res);
    return ok(res);
  }
  return null;
};

function refundPart(s: State, trip: TripDetail, item: string, amount: number, title: string) {
  const c = s.charges.find((x) => x.item === item && x.tripId === trip.id);
  if (!c) return;
  const now = nowIso();
  const cn = issueDoc(s, { tripId: trip.id, chargeId: c.id, kind: 'credit_note', status: 'issued', customer: customerOf(trip), company: null, lines: creditLines(c.lines, amount), againstId: c.invoiceId, paidWith: null, issuedAt: now }).id;
  s.refunds.unshift({ id: uuid(), tripId: trip.id, title, amount: SAR(amount), stage: 'requested', destination: 'original', provider: null, card: c.label ?? 'your card', anyway: false, reject: null, alt: null, law: false, airline: null, cancelledInstalments: null, expectedBy: new Date(Date.now() + 14 * 86_400_000).toISOString(), sentAt: null, createdAt: now, updatedAt: now, items: [{ chargeId: c.id, credited: amount, creditNoteId: cn }], clientKey: uuid() });
}

function disruptionView(trip: TripDetail, kind: DisruptionKind) {
  const out = outSegment(trip)!;
  const n = Math.max(1, trip.travellers.length);
  const everyone = n === 1 ? tk('dz.you') : tk('dz.allOf', { n });
  const night = kind === 'night';
  const agent = night ? (trip.agent.covering ?? { name: 'Noura', initial: 'N' }) : { name: trip.agent.name, initial: trip.agent.initial };
  const vars = { airline: out.carrierName, code: out.flightNumber, everyone, agent: agent.name };
  return {
    kind, headline: tk(`dz.${kind}.headline`, vars), sub: tk(`dz.${kind}.sub`, vars), options: disruptionOptions(kind, trip),
    tonight: night ? [
      { icon: 'stay', title: tk('dz.night.hotel'), body: tk('dz.night.hotelBody') },
      { icon: 'food', title: tk('dz.night.meals'), body: tk('dz.night.mealsBody', { everyone }) },
      { icon: 'flight', title: tk('dz.night.next', { time: '07:15' }), body: tk('dz.night.nextBody', { airline: out.carrierName, code: `${out.carrier}${Number(out.flightNumber.slice(2)) - 2}` }) },
    ] : [],
    agent: { name: agent.name, initial: agent.initial, line: tk(night ? 'dz.agent.night' : 'dz.agent.day', { agent: agent.name }) },
    source: trip.disruption?.source ?? tk(`dz.${kind}.source`, { airline: out.carrierName }), refundAmount: SAR(tripRefundAmount(trip)), heldUntil: night ? '05:30' : '09:30',
  };
}

function choose(s: State, base: Omit<TripDetail, 'clock'>, trip: TripDetail, kind: DisruptionKind, optionId: string, clientKey: string) {
  const opt = disruptionOptions(kind, trip).find((o) => o.id === optionId);
  if (!opt) return err('NOT_FOUND');
  const out = outSegment(trip)!;
  const n = Math.max(1, trip.travellers.length);
  const night = kind === 'night';
  const agentName = night ? (trip.agent.covering?.name ?? 'Noura') : trip.agent.name;
  if (opt.kind === 'refund') {
    const p = payments(s, trip.id);
    const r = createRefund(s, trip, { paymentIds: p.filter((x) => !x.refunded).map((x) => x.id), reason: 'airline', destination: 'original', clientKey }, tk('dz.refundTitle', { code: out.flightNumber }));
    if ('status' in r && typeof r.status === 'number') return r as WireResponse;
    base.status = 'cancelled';
    base.stays = base.stays.map((x) => ({ ...x, status: 'cancelled' }));
    base.pickups = base.pickups.map((x) => ({ ...x, status: 'cancelled' }));
    const ref = r as Ref;
    return { optionId, kind: 'refund', headline: tk('dz.done.refund', { amount: formatSar(ref.amount.amount) }), body: tk(night ? 'dz.done.refundBodyNight' : 'dz.done.refundBody', { card: ref.card, airline: out.carrierName }), agentLine: tk('dz.done.refundLine', { airline: out.carrierName }), trip: null, refund: pubRefund(ref) };
  }
  if (opt.kind === 'stay') {
    base.segments = base.segments.map((x) => (x.id === out.id ? { ...x, delayMin: 180, predictedDelay: false, status: 'delayed' } : x));
  } else {
    const patch = rebookPatch(kind, optionId, trip)!;
    base.segments = base.segments.map((x) => (x.id === out.id ? { ...x, ...patch, gate: null, bookedGate: null } : x));
    const dep = zonedToInstant(patch.departLocal!, out.departTz).getTime();
    base.pickups = base.pickups.map((x) => (x.direction === 'to_airport' ? { ...x, at: new Date(dep + (x.offsetMin ?? -155) * 60_000).toISOString() } : { ...x, at: zonedToInstant(patch.arriveLocal!, out.arriveTz).toISOString() }));
    base.rebooked = true;
    if (night) base.vouchers = [
      { id: 'v-hotel', kind: 'hotel', title: tk('dz.voucher.hotel'), body: tk('dz.voucher.hotelBody', { airline: out.carrierName }), code: `${out.carrier}H-48213` },
      { id: 'v-meal', kind: 'meal', title: tk('dz.voucher.meal', { n }), body: tk('dz.voucher.mealBody'), code: `${out.carrier}M-48213` },
    ];
  }
  base.disruption = { kind, segmentId: out.id, cause: null, source: tk(`dz.${kind}.source`, { airline: out.carrierName }), decided: optionId };
  notify(s, { kind: 'booking_confirmed', level: 'active', copy: 'notify.trip.rebooked', vars: { agent: agentName, what: opt.kind === 'stay' ? out.flightNumber : opt.title.split(' · ')[0]!, time: opt.departs ?? out.departLocal.slice(11, 16) }, href: `/trip/${trip.id}` });
  const flight = opt.title.split(' · ')[0]!.replace(/^\S+ /, '');
  const home = homePickup(trip);
  const pickupAt = home && opt.departs ? new Date(zonedToInstant(`2000-01-01T${opt.departs}`, 'UTC').getTime() + (home.offsetMin ?? -155) * 60_000).toISOString().slice(11, 16) : null;
  void arrivalPickup;
  const after = view(s, base, null);
  return opt.kind === 'stay'
    ? { optionId, kind: 'stay', headline: tk('dz.done.stay', { code: out.flightNumber }), body: tk('dz.done.stayBody', { airline: out.carrierName }), agentLine: tk('dz.done.line', { agent: agentName }), trip: after, refund: null }
    : { optionId, kind: 'rebook', headline: tk(n === 1 ? 'dz.done.rebook.one' : 'dz.done.rebook.other', { n, flight }), body: night ? tk('dz.done.nightBody', { time: optionId === 'morning' ? '05:15' : '07:30' }) : pickupAt ? tk('dz.done.rebookBody', { driver: home?.driverName ?? 'Your driver', time: pickupAt }) : tk('dz.done.rebookBodyNoCar'), agentLine: tk(night ? 'dz.done.nightLine' : 'dz.done.line', { agent: agentName }), trip: after, refund: null };
}

/* ───────── tracked flights: a schedule from the number alone, like the mock flightStatus supplier ───────── */

const ROUTES: Record<string, [string, string, number][]> = {
  SV: [['RUH', 'JED', 110], ['JED', 'RUH', 105], ['RUH', 'DXB', 125], ['DMM', 'RUH', 70], ['JED', 'CAI', 130], ['RUH', 'IST', 255], ['RUH', 'LHR', 430], ['JED', 'MED', 65]],
  XY: [['RUH', 'JED', 110], ['JED', 'DMM', 135], ['RUH', 'DXB', 125], ['RUH', 'SAW', 265], ['JED', 'CAI', 130], ['DMM', 'JED', 140]],
  F3: [['RUH', 'JED', 110], ['JED', 'RUH', 105], ['RUH', 'AHB', 105], ['JED', 'DMM', 135], ['RUH', 'MED', 95]],
  EK: [['DXB', 'RUH', 120], ['RUH', 'DXB', 125], ['JED', 'DXB', 175], ['DXB', 'JED', 185], ['DMM', 'DXB', 80]],
  QR: [['DOH', 'RUH', 95], ['RUH', 'DOH', 90], ['JED', 'DOH', 155], ['DOH', 'DMM', 65]],
  TK: [['IST', 'RUH', 245], ['RUH', 'IST', 255], ['JED', 'IST', 250], ['IST', 'JED', 240], ['DMM', 'IST', 270]],
};
const NAMES: Record<string, string> = { SV: 'Saudia', XY: 'flynas', F3: 'flyadeal', EK: 'Emirates', QR: 'Qatar Airways', TK: 'Turkish Airlines' };

function lookup(no: string, date: string) {
  const m = /^([A-Z][A-Z0-9]|[0-9][A-Z])(\d{1,4})$/.exec(no);
  if (!m) return null;
  const iata = m[1]!;
  const num = Number(m[2]);
  const routes = ROUTES[iata];
  if (!routes) return null;
  const [from, to, dur] = no === 'SV263' ? ['RUH', 'IST', 255] as const : routes[num % routes.length]!;
  const depMin = no === 'SV263' ? 9 * 60 + 40 : (5 + ((num * 7) % 17)) * 60 + ((num * 13) % 12) * 5;
  const f = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
  return {
    flightNumber: `${iata}${num}`, carrierName: NAMES[iata] ?? null, date, from, to, departLocal: `${date}T${f(depMin)}`, arriveLocal: `${date}T${f(depMin + dur)}`,
    status: (no === 'SV263' ? 'on_time' : 'scheduled') as TrackedFlightView['status'], gate: no === 'SV263' ? 'B12' : null, terminal: no === 'SV263' ? 'Terminal 3' : null,
    source: no === 'SV263' ? 'Live · airline' : 'Schedule', known: true, durationMin: dur, brand: AIRLINE_INFO[iata]?.brand ?? null,
  };
}

function track(s: State, f: { flightNumber: string; date: string; alerts: boolean }): TrackedFlightView {
  const info = lookup(f.flightNumber, f.date);
  const v: TrackedFlightView = {
    id: s.tracked.find((x) => x.flightNumber === f.flightNumber && x.date === f.date)?.id ?? uuid(), flightNumber: f.flightNumber, carrierName: info?.carrierName ?? NAMES[f.flightNumber.slice(0, 2)] ?? null,
    date: f.date, from: info?.from ?? null, to: info?.to ?? null, departLocal: info?.departLocal ?? null, arriveLocal: info?.arriveLocal ?? null, status: info?.status ?? 'scheduled',
    gate: info?.gate ?? null, terminal: info?.terminal ?? null, source: info?.source ?? null, updatedAt: nowIso(), alerts: f.alerts, known: !!info, durationMin: info?.durationMin ?? null, brand: AIRLINE_INFO[f.flightNumber.slice(0, 2)]?.brand ?? null,
  };
  s.tracked = [...s.tracked.filter((x) => x.id !== v.id), v].sort((a, b) => a.date.localeCompare(b.date));
  return v;
}
