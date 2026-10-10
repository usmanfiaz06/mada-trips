import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

/* ---------- reference data ---------- */

/* 'omar' is the id of the account holder, whoever they are. syncSelf() fills it from s.user on every render,
   so a new account shows its own passport name and the demo account shows Omar. Never read a name from here
   for the account holder without going through s.user. */
const OMAR = { id: 'omar', name: 'Omar', full: 'Omar Alharbi', initial: 'O', role: 'You', born: '1984', number: 'A08•••41', expires: 'Jun 2031', expiresISO: '2031-06-22', sex: 'M' };
export const PEOPLE = {
  omar: { id: 'omar', name: 'You', full: 'You', initial: '', role: 'You', born: '', number: 'Not scanned', expires: 'Not scanned', expiresISO: null, sex: null, self: true },
  hessa: { id: 'hessa', name: 'Hessa', full: 'Hessa Alharbi', initial: 'H', role: 'Spouse', born: '1988', number: 'A11•••07', expires: 'Jan 2029', expiresISO: '2029-01-15', sex: 'F' },
  sara: { id: 'sara', name: 'Sara', full: 'Sara Alharbi', initial: 'S', role: 'Daughter, 13', born: '2013', number: 'A23•••96', expires: '14 Aug 2027', expiresISO: '2027-08-14', sex: 'F' },
  ahmed: { id: 'ahmed', name: 'Ahmed', full: 'Ahmed Alharbi', initial: 'A', role: 'Son, 10', born: '2016', number: 'A23•••97', expires: 'Mar 2030', expiresISO: '2030-03-21', sex: 'M' },
  lina: { id: 'lina', name: 'Lina', full: 'Lina Reyes', initial: 'L', role: 'Helper', born: '1991', number: 'P71•••32', expires: 'Nov 2028', expiresISO: '2028-11-02', sex: 'F', helper: true },
};
const mrzName = (full) => 'P<SAU' + String(full || '').toUpperCase().replace(/[^A-Z\s]/g, '').trim().split(/\s+/).reverse().join('<<').padEnd(39, '<').slice(0, 39);
export function registerPerson(p) {
  PEOPLE[p.id] = p;
  if (!MRZ[p.id]) MRZ[p.id] = [mrzName(p.full), 'Not scanned yet'];
}
const OMAR_MRZ = ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', 'A08•••41<6SAU8403117M3106228<<<<<<<<<<<<<<02'];
export const MRZ = {
  omar: ['', 'Not scanned yet'],
  hessa: ['P<SAUALHARBI<<HESSA<<<<<<<<<<<<<<<<<<<<<<<<', 'A11•••07<3SAU8807244F2901159<<<<<<<<<<<<<<06'],
  sara: ['P<SAUALHARBI<<SARA<<<<<<<<<<<<<<<<<<<<<<<<<', 'A23•••96<1SAU1305128F2708147<<<<<<<<<<<<<<04'],
  ahmed: ['P<SAUALHARBI<<AHMED<<<<<<<<<<<<<<<<<<<<<<<<', 'A23•••97<9SAU1609032M3003211<<<<<<<<<<<<<<08'],
  lina: ['P<PHLREYES<<LINA<<<<<<<<<<<<<<<<<<<<<<<<<<<', 'P71•••32<4PHL9104186F2811023<<<<<<<<<<<<<<00'],
};

/* The account holder, from what they gave us: the passport scan, or what they typed. Nothing invented. */
export function syncSelf(s) {
  const u = s.user || {};
  const full = u.full || '';
  const name = u.name || (full ? full.split(' ')[0] : '');
  const pp = u.passport || {};
  PEOPLE.omar = {
    id: 'omar', role: 'You', self: true,
    name: name || 'You',
    full: full || name || 'You',
    initial: (name || full).charAt(0).toUpperCase(),
    born: pp.born || '', number: pp.number || 'Not scanned', expires: pp.expires || 'Not scanned', expiresISO: pp.expiresISO || null, sex: pp.sex || null,
  };
  MRZ.omar = u.mrz || (full ? [mrzName(full), 'Not scanned yet'] : ['', 'Not scanned yet']);
}

export const FLIGHTS = [
  { id: 'best', label: 'Best for you', airline: 'Saudia', iata: 'SV', brand: '#0b6b52', code: 'SV263', back: 'SV264', dep: '09:40', arr: '13:55', from: 'RUH', to: 'IST', dur: '4h 15m', pp: 2160, reason: 'Direct. Lands before check-in.', bags: '2 × 23 kg', change: 'SAR 300 per person', refund: 'Refund minus SAR 400 per person' },
  { id: 'low', label: 'Lowest price', airline: 'flynas', iata: 'XY', brand: '#5b2a86', code: 'XY125', back: 'XY126', dep: '06:15', arr: '10:40', from: 'RUH', to: 'SAW', dur: '4h 25m', pp: 1745, reason: 'The other airport, about 50 minutes from Galata.', bags: '1 × 20 kg', change: 'SAR 250 per person', refund: 'Not refundable' },
  { id: 'early', label: 'Earliest', airline: 'Turkish Airlines', iata: 'TK', brand: '#c8102e', code: 'TK141', back: 'TK140', dep: '02:10', arr: '06:20', from: 'RUH', to: 'IST', dur: '4h 10m', pp: 2328, reason: 'A full first day, after a short night.', bags: '2 × 23 kg', change: 'Free', refund: 'Refund minus SAR 300 per person' },
];
export const HOTELS = [
  { id: 'galata', label: 'Best for you', name: 'Rooms near Galata Tower', area: 'Beyoğlu · 3 min to the tower', night: 980, note: 'Connecting rooms on request. 3 minutes from the tower.', rating: '9.1',
    address: 'Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul', short: 'Galata Kulesi Sk. 12, Beyoğlu', walk: '3 min walk to Galata Tower', phone: '+90 212 000 0000', fromAirport: '45 min' },
  { id: 'sultan', label: 'Most quiet', name: 'Garden hotel in Sultanahmet', area: 'Old City · walk to the Blue Mosque', night: 760, note: 'Family suite. Breakfast included.', rating: '8.8',
    address: 'Cankurtaran Mah., Akbıyık Cd. No: 21, 34122 Fatih/İstanbul', short: 'Akbıyık Cd. 21, Sultanahmet', walk: '6 min walk to the Blue Mosque', phone: '+90 212 000 0001', fromAirport: '50 min' },
  { id: 'bosphorus', label: 'On the water', name: 'Bosphorus view rooms', area: 'Beşiktaş · sea view', night: 1420, note: 'Two rooms side by side. Late checkout.', rating: '9.3',
    address: 'Sinanpaşa Mah., Beşiktaş Cd. No: 8, 34353 Beşiktaş/İstanbul', short: 'Beşiktaş Cd. 8, Beşiktaş', walk: 'On the water in Beşiktaş', phone: '+90 212 000 0002', fromAirport: '40 min' },
];
export const STAY_NIGHTS = 6;
export const PICKUP = 440;

export const PHASES = [
  { id: 'none', label: 'Nothing planned' },
  { id: 'booked', label: 'Weeks before' },
  { id: 'daybefore', label: 'Day before' },
  { id: 'travelday', label: 'Travel day' },
  { id: 'delayed', label: 'Delay predicted' },
  { id: 'cancelled', label: 'Flight cancelled' },
  { id: 'inair', label: 'In the air' },
  { id: 'landed', label: 'Landed' },
  { id: 'home', label: 'Back home' },
];

export const DEMO_SWITCHES = [
  { id: 'offline', label: 'Offline' },
  { id: 'decline', label: 'Card declines' },
  { id: 'priceUp', label: 'Price rises at payment' },
  { id: 'noResults', label: 'No flights found' },
  { id: 'supplierDown', label: 'Airline not answering' },
  { id: 'agentQuestion', label: 'Faisal asks a question' },
  { id: 'passportProblem', label: 'Passport problem' },
  { id: 'scanFails', label: 'Scan fails' },
  { id: 'faceIdFails', label: 'Face ID fails' },
  { id: 'needs3ds', label: 'Bank asks for a code' },
  { id: 'fareGone', label: 'Fare sold out while booking' },
  { id: 'ticketingFails', label: 'Tickets fail to issue' },
  { id: 'slowAgent', label: 'Airline is slow' },
  /* When the app itself can't do its job: the connection, our servers, the app version, the session. */
  { id: 'weak', label: 'Weak connection', group: 'app' },
  { id: 'serverDown', label: 'Server down', group: 'app' },
  { id: 'maintenance', label: 'Maintenance', group: 'app' },
  { id: 'updateRequired', label: 'Update required', group: 'app' },
  { id: 'sessionExpired', label: 'Session expired', group: 'app' },
  { id: 'rateLimited', label: 'Too many tries', group: 'app' },
  { id: 'crashed', label: 'App crashed', group: 'app' },
  /* Inside a flow: one step can't finish, everything around it still works. */
  { id: 'payDrops', label: 'Connection drops while paying', group: 'flow' },
  { id: 'searchTimeout', label: 'Search times out', group: 'flow' },
  { id: 'sendFails', label: 'Messages don’t send', group: 'flow' },
  { id: 'uploadFails', label: 'Upload stops midway', group: 'flow' },
  { id: 'imagesFail', label: 'Photos don’t load', group: 'flow' },
  { id: 'permissionsDenied', label: 'Permissions turned off', group: 'flow' },
];

/* Everything that's waiting to reach Mada: made offline, still sending, or didn't go. One list, read by the
   connection pill and the Outbox sheet. Each item says what it is and how to drop it. */
export function outboxItems(s) {
  const offline = !!s.demo?.offline;
  const items = [];
  (s.support || []).forEach((m) => {
    if (m.from !== 'me' || !(m.queued || m.failed)) return;
    items.push({ id: 'sp-' + m.id, kind: 'message', title: m.text ? `“${m.text.length > 42 ? m.text.slice(0, 40) + '…' : m.text}”` : 'A photo', sub: 'Message to Mada', state: m.failed ? 'failed' : 'queued', ref: { type: 'support', id: m.id }, at: m.at });
  });
  Object.entries(s.requestThreads || {}).forEach(([rid, th]) => (th || []).forEach((m) => {
    if (m.queued) items.push({ id: 'rt-' + rid + m.id, kind: 'message', title: `“${String(m.text || '').slice(0, 40)}”`, sub: 'Reply in a request', state: 'queued', ref: { type: 'thread', rid, id: m.id }, at: m.at });
  }));
  (s.requests || []).forEach((r) => { if (r.status === 'queued') items.push({ id: 'rq-' + r.id, kind: 'request', title: r.title || r.short || 'A request', sub: 'Request to Mada', state: 'queued', ref: { type: 'request', id: r.id }, at: r.created }); });
  (s.tripRequests || []).forEach((r) => { if (r.queued) items.push({ id: 'tr-' + r.id, kind: 'request', title: r.title || 'A trip request', sub: 'Request for your trip', state: 'queued', ref: { type: 'tripRequest', id: r.id }, at: r.created }); });
  if (s.disruptionQueue) items.push({ id: 'dq', kind: 'choice', title: 'Your choice for the new flight', sub: 'For Faisal to confirm with the airline', state: 'queued', ref: { type: 'disruption' }, at: s.disruptionQueue.at });
  (s.outbox || []).forEach((o) => items.push({ ...o, ref: { type: 'outbox', id: o.id } }));
  return items.map((x) => (x.state === 'queued' && !offline && x.ref.type !== 'outbox' ? { ...x, state: 'sending' } : x));
}
/* Takes one thing out of the Outbox without sending it. */
export function discardOutbox(p, ref) {
  if (ref.type === 'support') return { support: (p.support || []).filter((m) => m.id !== ref.id) };
  if (ref.type === 'thread') return { requestThreads: { ...p.requestThreads, [ref.rid]: (p.requestThreads[ref.rid] || []).filter((m) => m.id !== ref.id) } };
  if (ref.type === 'request') return { requests: p.requests.filter((r) => r.id !== ref.id) };
  if (ref.type === 'tripRequest') return { tripRequests: (p.tripRequests || []).filter((r) => r.id !== ref.id) };
  if (ref.type === 'disruption') return { disruptionQueue: null };
  return { outbox: (p.outbox || []).filter((o) => o.id !== ref.id) };
}

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ } };
export const HAPTIC = { tap: 8, select: 10, knock: 14, success: [0, 18, 90, 36], warn: [0, 30, 70, 30], thunk: [0, 40], soft: [0, 12, 60, 12] };
export const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];

/* ---------- dates: ISO day strings, always in UTC so a phone's time zone never shifts a day ---------- */

export const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export const TRIP_YEAR = 2027; /* the year Ask searches in this prototype: 1 Mar 2027 is a Monday */
export const isoDate = (y, m, d) => new Date(Date.UTC(y, typeof m === 'string' ? MONTHS.indexOf(m) : m, d)).toISOString().slice(0, 10);
export const toDate = (iso) => new Date(iso + 'T00:00:00Z');
export const addDays = (iso, n) => { const d = toDate(iso); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
export const daysBetween = (a, b) => Math.round((toDate(b) - toDate(a)) / 864e5);
export const weekday = (iso) => WDAYS[toDate(iso).getUTCDay()];
export const dayOf = (iso) => toDate(iso).getUTCDate();
export const monthOf = (iso) => MONTHS[toDate(iso).getUTCMonth()];
export const shortDay = (iso) => (iso ? `${dayOf(iso)} ${monthOf(iso)}` : '');
export const dayLabel = (iso) => (iso ? `${weekday(iso)} ${dayOf(iso)} ${monthOf(iso)}` : '');
export const fullDay = (iso) => (iso ? `${dayOf(iso)} ${monthOf(iso)} ${toDate(iso).getUTCFullYear()}` : '');
export function parseDayLabel(label, year = TRIP_YEAR) {
  const m = /(\d{1,2})\s+([A-Z][a-z]{2})/.exec(label || '');
  return m && MONTHS.includes(m[2]) ? isoDate(year, m[2], Number(m[1])) : null;
}
export function rangeLabel(a, b) {
  if (!a) return '';
  if (!b || b === a) return shortDay(a);
  return monthOf(a) === monthOf(b) ? `${dayOf(a)}–${dayOf(b)} ${monthOf(b)}` : `${shortDay(a)} – ${shortDay(b)}`;
}
export function rangeLong(a, b) {
  if (!a) return '';
  if (!b) return `${dayLabel(a)} · one way`;
  return monthOf(a) === monthOf(b) ? `${weekday(a)} ${dayOf(a)} – ${weekday(b)} ${dayOf(b)} ${monthOf(b)}` : `${dayLabel(a)} – ${dayLabel(b)}`;
}
export const addMin = (hhmm, mins) => { const [h, m] = String(hhmm || '00:00').split(':').map(Number); const t = (((h * 60 + m + mins) % 1440) + 1440) % 1440; return `${String(Math.floor(t / 60)).padStart(2, '0')}:${String(t % 60).padStart(2, '0')}`; };
const durMin = (d) => { const m = /(\d+)h\s*(\d+)m/.exec(d || ''); return m ? Number(m[1]) * 60 + Number(m[2]) : 0; };

/* ---------- flight lookup for tracking any flight number ---------- */

export const AIRPORTS = {
  RUH: { city: 'Riyadh', tz: 3 }, JED: { city: 'Jeddah', tz: 3 }, DMM: { city: 'Dammam', tz: 3 }, MED: { city: 'Madinah', tz: 3 }, AHB: { city: 'Abha', tz: 3 },
  DXB: { city: 'Dubai', tz: 4 }, AUH: { city: 'Abu Dhabi', tz: 4 }, DOH: { city: 'Doha', tz: 3 }, IST: { city: 'Istanbul', tz: 3 }, SAW: { city: 'Istanbul', tz: 3 },
  CAI: { city: 'Cairo', tz: 2 }, LHR: { city: 'London', tz: 0 }, FRA: { city: 'Frankfurt', tz: 1 },
};
export const AIRLINES = {
  SV: { name: 'Saudia', brand: '#0b6b52', routes: [['RUH', 'JED', '1h 50m'], ['JED', 'RUH', '1h 45m'], ['RUH', 'DXB', '2h 05m'], ['DMM', 'RUH', '1h 10m'], ['JED', 'CAI', '2h 10m'], ['RUH', 'IST', '4h 15m'], ['RUH', 'LHR', '7h 10m'], ['JED', 'MED', '1h 05m']] },
  XY: { name: 'flynas', brand: '#5b2a86', routes: [['RUH', 'JED', '1h 50m'], ['JED', 'DMM', '2h 15m'], ['RUH', 'DXB', '2h 05m'], ['RUH', 'SAW', '4h 25m'], ['JED', 'CAI', '2h 10m'], ['DMM', 'JED', '2h 20m']] },
  F3: { name: 'flyadeal', brand: '#9bc31c', routes: [['RUH', 'JED', '1h 50m'], ['JED', 'RUH', '1h 45m'], ['RUH', 'AHB', '1h 45m'], ['JED', 'DMM', '2h 15m'], ['RUH', 'MED', '1h 35m']] },
  EK: { name: 'Emirates', brand: '#d71a21', routes: [['DXB', 'RUH', '2h 00m'], ['RUH', 'DXB', '2h 05m'], ['JED', 'DXB', '2h 55m'], ['DXB', 'JED', '3h 05m'], ['DMM', 'DXB', '1h 20m']] },
  QR: { name: 'Qatar Airways', brand: '#5c0632', routes: [['DOH', 'RUH', '1h 35m'], ['RUH', 'DOH', '1h 30m'], ['JED', 'DOH', '2h 35m'], ['DOH', 'DMM', '1h 05m']] },
  TK: { name: 'Turkish Airlines', brand: '#c8102e', routes: [['IST', 'RUH', '4h 05m'], ['RUH', 'IST', '4h 15m'], ['JED', 'IST', '4h 10m'], ['IST', 'JED', '4h 00m'], ['DMM', 'IST', '4h 30m']] },
  MS: { name: 'EgyptAir', brand: '#1d3f8f', routes: [['CAI', 'RUH', '2h 20m'], ['RUH', 'CAI', '2h 35m'], ['CAI', 'JED', '2h 05m'], ['JED', 'CAI', '2h 10m']] },
  EY: { name: 'Etihad', brand: '#bd8b13', routes: [['AUH', 'RUH', '2h 05m'], ['RUH', 'AUH', '2h 00m'], ['JED', 'AUH', '3h 00m'], ['AUH', 'DMM', '1h 15m']] },
  BA: { name: 'British Airways', brand: '#075aaa', routes: [['LHR', 'RUH', '6h 30m'], ['RUH', 'LHR', '7h 10m']] },
  LH: { name: 'Lufthansa', brand: '#0a1d3d', routes: [['FRA', 'RUH', '5h 40m'], ['RUH', 'FRA', '6h 10m']] },
};
export const FLIGHT_NO = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{1,4})$/;
/* A plausible schedule from the number alone. Production asks the flight-status provider; this keeps one number on one route. */
export function lookupFlight(raw) {
  const m = FLIGHT_NO.exec(String(raw || '').trim().toUpperCase());
  if (!m) return null;
  const [, iata, numS] = m;
  const num = Number(numS);
  const code = iata + num;
  const al = AIRLINES[iata];
  if (!al) return { code, iata, num, known: false };
  const [from, to, dur] = al.routes[num % al.routes.length];
  const dep = `${String(5 + ((num * 7) % 17)).padStart(2, '0')}:${String(((num * 13) % 12) * 5).padStart(2, '0')}`;
  const arr = addMin(dep, durMin(dur) + ((AIRPORTS[to]?.tz ?? 3) - (AIRPORTS[from]?.tz ?? 3)) * 60);
  return { code, iata, num, known: true, airline: al.name, brand: al.brand, from, to, dep, arr, dur };
}

/* ---------- trip facts: one place for seats, terminal, drivers, pickup time, hotel address ---------- */

const SEAT_ROW = { Business: 3, Premium: 8, Economy: 14 };
export const seatsFor = (n, cabin, back) => Array.from({ length: Math.max(1, n) }, (_, i) => `${(SEAT_ROW[cabin] || 14) + (back ? 2 : 0)}${'ABCDEF'[i % 6]}`);
export const seatText = (seats = []) => (seats.length > 1 ? `${seats[0]}–${seats[seats.length - 1]}` : seats[0] || '');
const TERMINAL = { SV: 'Terminal 3', XY: 'Terminal 2', TK: 'Terminal 1', F3: 'Terminal 5' };
export const termShort = (t) => String(t || '').replace('Terminal ', 'T');
export const PICKUP_OFFSET = -155; /* Khalid comes 2h 35m before take-off: 31 min to King Khalid, bag drop with time to spare */

export function makeFlight(f, { outISO, backISO, cabin = 'Economy', n = 1 }) {
  return {
    ...f, cabin,
    dateISO: outISO, date: dayLabel(outISO), _dl: dayLabel(outISO),
    back: backISO ? f.back : null, backDep: backISO ? '15:10' : null, backArr: backISO ? '19:20' : null,
    backDateISO: backISO || null, backDate: backISO ? dayLabel(backISO) : null, _bl: backISO ? dayLabel(backISO) : null,
    terminal: TERMINAL[f.iata] || 'Terminal 3', gate: 'B12', seats: seatsFor(n, cabin), backSeats: backISO ? seatsFor(n, cabin, true) : [],
  };
}
export function makePickup(n, price, { outISO, oneway } = {}) {
  return {
    price, status: 'booked', oneway: !!oneway, dateISO: outISO || null,
    home: { driver: 'Khalid', car: n > 3 ? 'Black GMC Yukon' : 'Grey Lexus ES', room: n > 3 ? 'room for 8 bags' : 'room for 4 bags', phone: '+966 55 014 2287', offset: PICKUP_OFFSET, waits: '10 min' },
    arrive: { driver: 'Ahmet', car: 'Grey Mercedes Vito', plate: '34 MDA 21', door: 'Door 3', phone: '+90 532 418 6610', waits: '60 min' },
  };
}
/* The home pickup for the flight out, as one object everyone reads. */
export function pickupPlan(t) {
  const f = t?.flight;
  const pk = t?.pickup;
  if (!f || !pk || !pk.home || pk.status === 'cancelled') return null;
  const time = addMin(f.dep, pk.home?.offset ?? PICKUP_OFFSET);
  return { ...(pk.home || {}), time, dateISO: pk.dateISO || f.dateISO, wake: addMin(time, -45), airportBy: addMin(time, 35), bagDrop: addMin(f.dep, -60), arrive: pk.arrive || {} };
}
export const boardsAt = (f) => (f ? addMin(f.dep, -45) : '');
export const signName = (t) => ((PEOPLE[t?.travellers?.[0]]?.full || '').split(' ').slice(-1)[0] || 'your name').toUpperCase();
export const stayOf = (t) => (t?.stay && t.stay.status !== 'cancelled' ? t.stay : null);
export const stayEnd = (st) => (st?.fromISO ? addDays(st.fromISO, st.nights) : null);

/* Price of the rooms and pickups offered next to a flight. Ask and Pay both read this, so the numbers match. */
export function bundleQuote(n, search = {}) {
  const nights = search.nights ? search.nights : search.type !== 'oneway' && search.dep && search.ret ? Math.max(1, search.ret - search.dep) : STAY_NIGHTS;
  const stay = Math.round(HOTELS[0].night * nights * (n > 2 ? 1 : 0.55));
  const pickup = search.type === 'oneway' ? PICKUP / 2 : PICKUP;
  return { nights, stay, pickup, total: stay + pickup };
}

/* Labels follow the ISO dates; a label set directly (older code) moves the ISO date instead. */
export function normalizeTrip(t) {
  if (!t) return t;
  const out = { ...t };
  if (out.flight) {
    const f = { ...out.flight };
    if (!f.dateISO || (f.date && f._dl && f.date !== f._dl)) f.dateISO = parseDayLabel(f.date) || f.dateISO || isoDate(TRIP_YEAR, 'Mar', 9);
    f.date = dayLabel(f.dateISO); f._dl = f.date;
    if (f.back) {
      if (!f.backDateISO || (f.backDate && f._bl && f.backDate !== f._bl)) f.backDateISO = parseDayLabel(f.backDate) || f.backDateISO || addDays(f.dateISO, 6);
      f.backDate = dayLabel(f.backDateISO); f._bl = f.backDate;
    } else { f.backDateISO = null; f.backDate = null; }
    if (!f.seats) f.seats = seatsFor((out.travellers || []).length, f.cabin);
    if (f.back && !f.backSeats?.length) f.backSeats = seatsFor((out.travellers || []).length, f.cabin, true);
    if (!f.terminal) f.terminal = TERMINAL[f.iata] || 'Terminal 3';
    out.flight = f;
    out.oneway = !f.back;
  }
  if (out.stay && !out.stay.fromISO) out.stay = { ...out.stay, fromISO: out.flight?.dateISO || isoDate(TRIP_YEAR, 'Mar', 9) };
  if (out.pickup && !out.pickup.dateISO && out.flight) out.pickup = { ...out.pickup, dateISO: out.flight.dateISO };
  if (out.pickup && out.pickup.home === undefined) { const pk = makePickup((out.travellers || []).length, out.pickup.price, { outISO: out.pickup.dateISO }); out.pickup = { ...pk, ...out.pickup, home: pk.home, arrive: pk.arrive }; }
  const a = out.flight?.dateISO || out.stay?.fromISO;
  const b = out.flight ? out.flight.backDateISO : stayEnd(out.stay);
  if (a) { out.dates = rangeLabel(a, b); out.datesLong = rangeLong(a, b); }
  return out;
}

/* The demo trip: Omar's family, Istanbul for Eid. Stay paid with Tabby, the rest in full. */
export function seedTrip(s) {
  const travellers = s.household.length ? s.household.filter((id) => id !== 'lina') : ['omar'];
  const n = travellers.length;
  const outISO = isoDate(TRIP_YEAR, 'Mar', 9);
  const backISO = isoDate(TRIP_YEAR, 'Mar', 15);
  const f = FLIGHTS[0];
  const stayPrice = HOTELS[0].night * STAY_NIGHTS;
  const flightPrice = f.pp * n;
  const lines = [
    { key: 'flight', icon: 'flight', text: `${n} ${n === 1 ? 'traveller' : 'travellers'} · ${f.airline}, direct`, price: flightPrice },
    { key: 'stay', icon: 'stay', text: `${n > 2 ? 'Connecting rooms' : 'A room'} near Galata Tower · ${STAY_NIGHTS} nights`, price: stayPrice },
    { key: 'pickup', icon: 'car', text: 'Airport pickup both ways', price: PICKUP },
  ];
  const card = s.cards?.find((c) => c.id === s.defaultCard);
  return normalizeTrip({
    id: 'ist', city: 'Istanbul', country: 'Türkiye', img: 'img/istanbul.jpg',
    travellers, flightId: f.id, cabin: 'Economy', infants: 0, oneway: false,
    flight: makeFlight(f, { outISO, backISO, cabin: 'Economy', n }),
    stay: { ...HOTELS[0], nights: STAY_NIGHTS, fromISO: outISO, price: stayPrice, status: 'booked', plan: 'tabby' },
    pickup: makePickup(n, PICKUP, { outISO }),
    flightPrice, lines,
    paid: { subtotal: flightPrice + stayPrice + PICKUP, discount: 0, creditUsed: 0, charged: flightPrice + stayPrice + PICKUP, card: card?.label || 'Apple Pay' },
    payPlan: 'full',
    pnr: 'X7K2QD', ref: 'X7K2QD',
    bookedAt: Date.UTC(2027, 1, 14, 7, 42),
    card: s.defaultCard,
  });
}

/* ---------- state ---------- */

const KEY = 'mada-proto-v1';

/* A brand-new account: nothing claimed, nothing borrowed from the demo. */
export const fresh = () => ({
  onboarded: false,
  guest: false,
  user: null,
  household: [],
  passportSaved: false,
  notifications: null,
  location: null,
  cards: [],
  credit: { balance: 0, history: [] },
  inbox: [],
  defaultCard: 'applepay',
  trip: null,
  pastTrips: [],
  trackedFlights: [],
  docs: [],
  requests: [],
  refunds: [],
  phase: 'none',
  settings: { alerts: 'quiet' },
  circles: { around: false, aroundWho: 'picked', hello: null, hidden: [], reported: [] },
  groups: [],
  friends: [],
  following: [],
  savedPosts: [],
  friendRequests: [],
  invites: [],
  stamps: [],
  demo: { offline: false, decline: false, priceUp: false, noResults: false, supplierDown: false, agentQuestion: false, fareGone: false, ticketingFails: false, slowAgent: false, needs3ds: false, passportProblem: false, scanFails: false, faceIdFails: false, weak: false, serverDown: false, maintenance: false, updateRequired: false, sessionExpired: false, rateLimited: false, crashed: false, payDrops: false, searchTimeout: false, sendFails: false, uploadFails: false, imagesFail: false, permissionsDenied: false },
  outbox: [],
  tab: 'today',
  stack: [],
  walletUnlocked: false,
});

/* The demo account (phone 50 000 4127): Omar's family, cards, circles and history. Applied only by the demo panel,
   the "Welcome back" path in Onboarding, and test seeds. */
export function demoAccount() {
  return {
    demoSeed: true,
    onboarded: true,
    guest: false,
    user: { name: 'Omar', full: 'Omar Alharbi', passport: { born: OMAR.born, number: OMAR.number, expires: OMAR.expires, expiresISO: OMAR.expiresISO, sex: 'M', nationality: 'Saudi Arabia', dob: '1984-03-11' }, mrz: OMAR_MRZ },
    household: ['omar', 'hessa', 'sara', 'ahmed'],
    passportSaved: true,
    notifications: true,
    cards: [
      { id: 'visa41', label: 'Visa ending 41', brand: 'visa', exp: '08/28' },
      { id: 'mada07', label: 'mada ending 07', brand: 'mada', exp: '02/27' },
    ],
    defaultCard: 'visa41',
    pastTrips: [{ id: 'baku', city: 'Baku', dates: '30 Mar – 4 Apr 2026', when: 'Last Eid', who: 4, note: 'Eid with the four of you' }],
    docs: [
      { id: 'dn-omar', person: 'omar', type: 'National ID', sub: 'Valid until 2030', seeded: true },
      { id: 'dv-omar', person: 'omar', type: 'Schengen visa', icon: 'visa', sub: 'Multi-entry until Jun 2028', seeded: true },
      { id: 'dn-hessa', person: 'hessa', type: 'National ID', sub: 'Valid until 2031', seeded: true },
      { id: 'dv-hessa', person: 'hessa', type: 'Schengen visa', icon: 'visa', sub: 'Multi-entry until Jun 2028', seeded: true },
      { id: 'df-sara', person: 'sara', type: 'Family card entry', sub: 'Valid', seeded: true },
      { id: 'df-ahmed', person: 'ahmed', type: 'Family card entry', sub: 'Valid', seeded: true },
    ],
    stamps: ['AZ', 'AE', 'BH', 'EG', 'GE', 'GB', 'FR', 'MY', 'MA', 'JO', 'QA', 'OM', 'ID', 'CH'],
    groups: [
      { id: 'eid', name: 'Istanbul for Eid', img: 'img/istanbul.jpg', members: ['omar', 'hessa', 'abdullah', 'noor', 'sara', 'ahmed'], admin: 'omar', unread: 2, sub: 'vote on the cruise', trip: 'Istanbul · 9–15 Mar', muted: false },
      { id: 'family', name: 'Family', img: null, members: ['omar', 'hessa', 'sara', 'ahmed'], admin: 'omar', unread: 0, sub: 'documents', trip: null, muted: false },
      { id: 'season', name: 'Riyadh Season', img: 'img/riyadh.jpg', members: ['omar', 'abdullah', 'khalid', 'faris', 'maha', 'yousef', 'noor', 'reem'], admin: 'abdullah', unread: 0, sub: '2 events', trip: null, muted: true },
    ],
    friends: ['abdullah', 'noor', 'khalid', 'faris'],
    friendRequests: ['reem'],
    invites: [
      { id: 'i1', name: 'Maha', via: 'WhatsApp', when: '2 days ago', status: 'pending' },
      { id: 'i2', name: 'Yousef', via: 'Link', when: 'Last week', status: 'joined' },
    ],
    account: {
      email: { address: 'k7x2m9q4pz@privaterelay.appleid.com', relay: true, source: 'apple', at: null },
      phone: { digits: '501234127', source: 'signup', at: null },
      methods: { apple: true, google: false, phone: true },
      prefs: { seat: 'window', together: true, meal: 'halal', assist: [], loyalty: [{ id: 'l1', program: 'alfursan', number: '48213377' }], notes: '' },
      faceId: true,
      devices: [
        { id: 'this', name: 'This iPhone', sub: 'iPhone 15 Pro · Riyadh · now', current: true },
        { id: 'ipad', name: 'iPad', sub: 'Riyadh · 2 days ago' },
        { id: 'web', name: 'madatrips.sa on a Mac', sub: 'Chrome · Jeddah · 3 weeks ago' },
      ],
      signedOut: false,
    },
  };
}
/* Puts the demo account on top of the current state. Keeps demo switches and anything tracked as a guest. */
export function withDemo(p) {
  const d = demoAccount();
  return { ...d, trackedFlights: [...(d.trackedFlights || []), ...(p.trackedFlights || [])], demo: p.demo, account: { ...(p.account?.photo ? { photo: p.account.photo, photoAt: p.account.photoAt } : {}), ...d.account } };
}

const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const saved = JSON.parse(raw);
      /* Test seeds write { seed: 'demo', ...overrides } to start from the demo account. */
      const base = saved.seed === 'demo' ? { ...fresh(), ...demoAccount() } : fresh();
      const st = { ...base, ...saved, user: saved.seed === 'demo' ? { ...base.user, ...(saved.user || {}) } : saved.user ?? base.user, account: saved.seed === 'demo' ? { ...base.account, ...(saved.account || {}) } : saved.account, stack: [] };
      delete st.seed;
      if (saved.seed === 'demo') st.demoSeed = true;
      if (st.trip) st.trip = normalizeTrip(st.trip);
      (st.extraPeople || []).forEach(registerPerson);
      return st;
    }
  } catch (e) { /* storage unavailable */ }
  return fresh();
};

const Ctx = createContext(null);

export function StoreProvider({ children }) {
  const [s, setS] = useState(load);
  const [toastMsg, setToast] = useState(null);
  const [bannerMsg, setBanner] = useState(null);
  const toastTimer = useRef(null);
  const bannerTimer = useRef(null);
  syncSelf(s);

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...s, stack: [] })); } catch (e) { /* storage unavailable */ }
  }, [s]);

  /* Any change to the trip keeps its dates and labels in step, whoever made it. */
  const set = useCallback((patch) => setS((prev) => {
    const next = { ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) };
    if (next.trip && next.trip !== prev.trip) next.trip = normalizeTrip(next.trip);
    return next;
  }), []);

  const api = {
    s,
    set,
    go: (tab) => set({ tab, stack: [] }),
    push: (name, params = {}) => set((p) => ({ stack: [...p.stack, { name, params, key: Date.now() + Math.random() }] })),
    pop: () => set((p) => ({ stack: p.stack.slice(0, -1) })),
    replace: (name, params = {}) => set((p) => ({ stack: [...p.stack.slice(0, -1), { name, params, key: Date.now() + Math.random() }] })),
    reset: (tab = 'today') => set({ tab, stack: [] }),
    toast: (text) => {
      clearTimeout(toastTimer.current);
      setToast({ text, id: Date.now() });
      toastTimer.current = setTimeout(() => setToast(null), 3200);
    },
    /* Every banner is also kept in the inbox, so a missed one isn't lost. `to` is where a tap goes: { tab } or { push: [name, params] }. */
    banner: (b) => {
      clearTimeout(bannerTimer.current);
      const id = Date.now();
      setBanner({ ...b, id });
      set((p) => ({ inbox: [{ id: 'n' + id, title: b.title, body: b.body, to: b.to || null, at: id, read: false, kind: b.kind || 'trip' }, ...(p.inbox || [])].slice(0, 50) }));
      buzz(b.haptic || HAPTIC.warn);
      bannerTimer.current = setTimeout(() => setBanner(null), 5200);
    },
    dismissBanner: () => setBanner(null),
    openBanner: (b) => {
      setBanner(null);
      set((p) => ({ inbox: (p.inbox || []).map((n) => (n.at === b.id ? { ...n, read: true } : n)) }));
      if (b.to?.push) set((p) => ({ stack: [...p.stack, { name: b.to.push[0], params: b.to.push[1] || {}, key: Date.now() + Math.random() }] }));
      else if (b.to?.tab) set({ tab: b.to.tab, stack: [] });
    },
    toastMsg,
    bannerMsg,
    people: () => s.household.map((id) => PEOPLE[id]).filter(Boolean),
    hardReset: () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } setS(fresh()); },
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/* ---------- derived helpers ---------- */

/* Türkiye asks for 150 days of passport validity after you land. Worked out from the real dates. */
export function passportIssue(s, personId) {
  const p = PEOPLE[personId];
  const land = s.trip?.flight?.dateISO || s.trip?.stay?.fromISO || isoDate(TRIP_YEAR, 'Mar', 9);
  const need = addDays(land, 150);
  if (s.demo.passportProblem && personId === 'ahmed') {
    return { blocking: true, text: `Ahmed’s passport expires on 2 Jul 2027. Türkiye needs 150 days after you land, so it must be valid until ${shortDay(need)}.`, need, left: daysBetween(land, '2027-07-02') };
  }
  if (!p?.expiresISO) return null;
  const left = daysBetween(land, p.expiresISO);
  if (left < 150) return { blocking: true, text: `${p.name}’s passport expires on ${fullDay(p.expiresISO)}. Türkiye needs 150 days after you land, so it must be valid until ${shortDay(need)}.`, need, left };
  if (left < 180) return { blocking: false, text: `Fine for Istanbul: Türkiye asks for 150 days after you land, ${p.name} has ${left}.`, need, left };
  return null;
}

export function tripTravellers(s) {
  return (s.trip?.travellers || []).map((id) => PEOPLE[id]).filter(Boolean);
}

/* "the four of you", "you two", "you" */
export const ofYou = (n) => (n <= 1 ? 'you' : n === 2 ? 'you two' : `the ${NUM_WORD[n] || n} of you`);

/* The day the app is living in. Weeks before and nothing planned: the phone's own date. On the trip: the trip's day. */
export function appDay(s) {
  const t = s.trip;
  const out = t?.flight?.dateISO || t?.stay?.fromISO;
  if (!out || !s.onboarded) return null;
  if (s.phase === 'daybefore') return addDays(out, -1);
  if (['travelday', 'delayed', 'cancelled', 'inair', 'landed'].includes(s.phase)) return out;
  if (s.phase === 'home') return t.flight?.backDateISO || stayEnd(t.stay) || addDays(out, STAY_NIGHTS);
  return null;
}

/* Where to forward bookings made elsewhere. */
export function forwardAddress(s) {
  const n = (s.user?.name || '').toLowerCase().normalize('NFD').replace(/[^a-z]/g, '');
  const tail = (s.account?.phone?.digits || '').slice(-4);
  if (!n && !tail) return null;
  return `${n || 'trips'}${s.demoSeed || !tail ? '' : tail}@trips.madatrips.sa`;
}
