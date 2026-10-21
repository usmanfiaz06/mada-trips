import { ERROR_CODES, addDays, t, type BookingRequestView, type ErrorCode, type HotelDetails, type SupplierVoucher, type TransferOption, type TripDetail } from '@mada/shared';
import type { Wire, WireResponse } from '../api';
import type { AreaMock } from '../mock-api';
import { tripsMock } from './trips';

/*
 * EXPO_PUBLIC_API_MODE=mock for airport pickups, vouchers and hotel details (Hotelbeds): the same contract as
 * platform/src/app/api/app/v1/trips/[id]/transfers, /vouchers and /hotels, with the server's fixture prices in riyals.
 * Istanbul has a car, a minivan and a shuttle from IST; a trip whose stay was booked has a hotel voucher.
 */

const ok = (json: unknown, status = 200): WireResponse => ({ status, json });
function err(code: ErrorCode, message?: string): WireResponse {
  return { status: ERROR_CODES[code].status, json: { error: { code, message: message ?? t(ERROR_CODES[code].copy) } } };
}
const uuid = () => '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (Number(c) ^ (Math.random() * 16) >> (Number(c) / 4)).toString(16));

type State = { seen: Map<string, string>; requested: Map<string, { id: string; vehicle: string; status: string }>; options: Map<string, TransferOption & { tripId: string }>; cancelled: Set<string>; clientKeys: Map<string, BookingRequestView> };
const states = new Map<string, State>();
const stateOf = (userId: string) => { let s = states.get(userId); if (!s) { s = { seen: new Map(), requested: new Map(), options: new Map(), cancelled: new Set(), clientKeys: new Map() }; states.set(userId, s); } return s; };

const HOTELS: Record<string, HotelDetails> = {
  m_mockhotel99701: {
    code: 'm_mockhotel99701', name: 'Galata Tower Suites', category: '4 stars', address: 'Bereketzade Mah., Galata Kulesi Sk. No: 14, Beyoglu, 34421, Istanbul', phone: '+902120000001',
    description: 'Rooms on a quiet lane three minutes from Galata Tower, with breakfast on the roof.', images: [], facilities: [{ name: 'Wi-fi', paid: false }, { name: 'Car park', paid: true }, { name: 'Airport shuttle', paid: true }],
    latitude: 41.0258, longitude: 28.974,
  },
  // The demo trip's stay (trips.ts seed), so its stay card opens a hotel page.
  m_mockhotel99702: {
    code: 'm_mockhotel99702', name: 'Bereketzade Hotel', category: '4 stars', address: 'Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul', phone: '+90 212 000 0000',
    description: 'Quiet rooms on a lane three minutes from Galata Tower. Connecting rooms on request, breakfast on the roof.', images: [], facilities: [{ name: 'Wi-fi', paid: false }, { name: 'Breakfast', paid: false }, { name: 'Connecting rooms', paid: false }, { name: 'Airport shuttle', paid: true }],
    latitude: 41.0262, longitude: 28.9727,
  },
};

/** The demo hotels' words in Arabic, as GET /hotels/{code}/translation answers once the translator has run. */
const HOTELS_AR: Record<string, { description: string; facilities: Record<string, string> }> = {
  m_mockhotel99701: { description: 'غرف في زقاق هادئ على بعد ثلاث دقائق من برج غلطة، والفطور على السطح.', facilities: { 'Wi-fi': 'واي فاي', 'Car park': 'موقف سيارات', 'Airport shuttle': 'توصيل من المطار' } },
  m_mockhotel99702: { description: 'غرف هادئة في زقاق على بعد ثلاث دقائق من برج غلطة. غرف متصلة عند الطلب، والفطور على السطح.', facilities: { 'Wi-fi': 'واي فاي', Breakfast: 'فطور', 'Connecting rooms': 'غرف متصلة', 'Airport shuttle': 'توصيل من المطار' } },
};

async function tripOf(w: Wire, ctx: Parameters<AreaMock>[1], id: string): Promise<TripDetail | null> {
  const r = await tripsMock({ ...w, method: 'GET', path: `/trips/${id}`, body: undefined }, ctx);
  return r && r.status === 200 ? (r.json as { trip: TripDetail }).trip : null;
}

function optionsFor(tripId: string, people: number, landing: string): (TransferOption & { tripId: string })[] {
  const exp = new Date(Date.now() + 20 * 60_000).toISOString();
  const free = addDays(landing.slice(0, 10), -1);
  const list: (TransferOption & { tripId: string })[] = [
    { id: uuid(), tripId, kind: 'shared', vehicle: 'Shuttle', category: 'Standard', maxPax: 99, minutes: 85, total: { amount: Math.ceil((11.2 * people * 4.15 * 1.0150 * 1.15)) * 100, currency: 'SAR' }, freeCancelUntil: addDays(landing.slice(0, 10), -2), refundable: true, pickupNote: 'Go to the transfer desk in the arrivals hall. Shuttles leave every 45 minutes.', imageUrl: null, expiresAt: exp },
    { id: uuid(), tripId, kind: 'private', vehicle: 'Minivan', category: 'Standard', maxPax: 7, minutes: 50, total: { amount: 25_200, currency: 'SAR' }, freeCancelUntil: free, refundable: true, pickupNote: 'The driver waits in the arrivals hall, by meeting point 4, with a sign with your name.', imageUrl: null, expiresAt: exp },
    { id: uuid(), tripId, kind: 'private', vehicle: 'Car', category: 'Standard', maxPax: 3, minutes: 50, total: { amount: 18_700, currency: 'SAR' }, freeCancelUntil: free, refundable: true, pickupNote: 'The driver waits in the arrivals hall, by meeting point 4, with a sign with your name.', imageUrl: null, expiresAt: exp },
  ];
  return list.filter((o) => o.maxPax >= people).sort((a, b) => a.total.amount - b.total.amount);
}

function stayVoucher(trip: TripDetail, s: State): SupplierVoucher | null {
  const st = trip.stays[0];
  if (!st) return null;
  // One stay voucher per trip in the mock: it takes the trip's id.
  const vid = trip.id;
  const ref = '1-3982401';
  const out = new Date(Date.parse(`${st.checkIn}T00:00:00Z`) + st.nights * 86_400_000).toISOString().slice(0, 10);
  const status = s.cancelled.has(vid) ? 'cancelled' : 'confirmed';
  return {
    id: vid, kind: 'stay', status, reference: ref, agencyReference: trip.bookingRef, bookedOn: trip.bookedAt.slice(0, 10), holder: trip.travellers[0]?.fullName ?? 'Omar Alharbi',
    paxes: trip.travellers.map((p, i) => ({ room: trip.travellers.length > 2 && i >= Math.ceil(trip.travellers.length / 2) ? 2 : 1, name: p.fullName, child: !!p.birthYear && 2027 - p.birthYear < 18, age: p.birthYear && 2027 - p.birthYear < 18 ? 2027 - p.birthYear : null })),
    hotel: { name: st.name, address: st.address, category: '4 stars', destination: trip.city, phone: st.phone ?? '+90 212 000 0001' },
    checkIn: st.checkIn, checkOut: out, room: st.roomType ?? 'Double Standard', board: 'Bed And Breakfast',
    transfer: null, remarks: 'Check-in hour 14:00. A refundable deposit of EUR 50 per room is taken at the hotel. Guests must show the passport used for the booking.',
    cancellation: st.cancellation, payableThrough: `Payable through THE PARTNER ON YOUR BOOKING (mock), acting as agent for the service operating company, details of which can be provided upon request. VAT: XX00000000 Reference: ${ref}`,
    canCancel: status === 'confirmed',
  };
}

export const transfersMock: AreaMock = async (w, ctx) => {
  const [path] = w.path.split('?');
  const parts = (path ?? '').split('/').filter(Boolean);
  const isTransfers = parts[0] === 'trips' && (parts[2] === 'transfers' || parts[2] === 'vouchers');
  if (!isTransfers && parts[0] !== 'vouchers' && parts[0] !== 'hotels') return null;
  const { user } = ctx;
  // A hotel page is open to anyone (the server's openRoute); "Translate" has the desk's Arabic for the demo hotels.
  if (parts[0] === 'hotels') {
    const h = HOTELS[decodeURIComponent(parts[1] ?? '')];
    if (!h) return err('NOT_FOUND');
    if (parts[2] === 'translation') {
      const to = new URLSearchParams(w.path.split('?')[1] ?? '').get('to') === 'en' ? 'en' : 'ar';
      if (to === 'en') return ok({ lang: 'en', description: h.description, facilities: h.facilities.map((f) => f.name), machine: false });
      const ar = HOTELS_AR[h.code];
      return ar ? ok({ lang: 'ar', description: ar.description, facilities: h.facilities.map((f) => ar.facilities[f.name] ?? f.name), machine: true }) : err('NOT_CONFIGURED');
    }
    return ok({ hotel: h });
  }
  if (!user) return err('UNAUTHORIZED');
  const s = stateOf(user.id);
  if (parts[0] === 'vouchers') {
    // A voucher belongs to a trip this account has listed vouchers for.
    const tripId = s.seen.get(parts[1] ?? '');
    const trip = tripId ? await tripOf(w, ctx, tripId) : null;
    const v = trip ? stayVoucher(trip, s) : null;
    if (trip && v) {
      if (parts[2] === 'cancel') {
        const confirm = !!(w.body as { confirm?: boolean } | undefined)?.confirm;
        if (v.status === 'cancelled') return err('VALIDATION', 'This booking is already cancelled.');
        if (confirm) s.cancelled.add(v.id);
        return ok({ simulated: !confirm, fee: { amount: 0, currency: 'SAR' }, supplierFee: { amount: 0, currency: 'EUR' }, voucher: stayVoucher(trip, s) }, confirm ? 201 : 200);
      }
      return ok({ voucher: v });
    }
    return err('NOT_FOUND');
  }

  const trip = await tripOf(w, ctx, parts[1] ?? '');
  if (!trip) return err('NOT_FOUND');
  if (parts[2] === 'vouchers') {
    const v = stayVoucher(trip, s);
    if (v) s.seen.set(v.id, trip.id);
    return ok({ vouchers: v ? [v] : [] });
  }
  const outs = trip.segments.filter((x) => x.direction === 'out');
  const land = outs[outs.length - 1];
  const people = Math.max(1, trip.travellers.length);
  const base = { airport: land?.to ?? null, airportName: land ? (land.to === 'IST' ? 'Istanbul Airport' : land.to) : null, hotel: trip.stays[0]?.name ?? trip.noStay?.label ?? null, arrival: land?.arriveLocal.slice(0, 16) ?? null, people, options: [] as TransferOption[], request: null };
  const asked = s.requested.get(trip.id);
  if (w.method === 'GET') {
    if (asked) return ok({ ...base, outcome: 'requested', request: asked });
    if (!land) return ok({ ...base, outcome: 'no_flight' });
    if (!trip.stays.length && !trip.noStay) return ok({ ...base, outcome: 'no_hotel' });
    if (!/^(IST|SAW)$/.test(land.to)) return ok({ ...base, outcome: 'none' });
    const options = optionsFor(trip.id, people, land.arriveLocal);
    for (const o of options) s.options.set(o.id, o);
    return ok({ ...base, outcome: 'ok', options: options.map(({ tripId: _t, ...o }) => o) });
  }
  if (w.method === 'POST') {
    const b = (w.body ?? {}) as { optionId?: string; clientKey?: string };
    if (b.clientKey && s.clientKeys.has(b.clientKey)) return ok({ request: s.clientKeys.get(b.clientKey) }, 201);
    const o = b.optionId ? s.options.get(b.optionId) : undefined;
    if (!o || o.tripId !== trip.id) return err('NOT_FOUND');
    const now = new Date().toISOString();
    const request: BookingRequestView = {
      id: uuid(), kind: 'car', status: 'sent', title: t('request.title.pickup', { city: trip.city }), summary: `${o.vehicle} · ${t(o.kind === 'private' ? 'pickup.private' : 'pickup.shared')}`,
      detail: `${base.airport} → ${base.hotel ?? trip.city}`, note: null, travellerIds: trip.travellerIds, agent: { name: trip.agent.name }, quote: null,
      promisedBy: new Date(Date.now() + 3_600_000).toISOString(), createdAt: now, updatedAt: now,
    };
    s.requested.set(trip.id, { id: request.id, vehicle: o.vehicle, status: 'sent' });
    if (b.clientKey) s.clientKeys.set(b.clientKey, request);
    return ok({ request }, 201);
  }
  return err('NOT_FOUND');
};
