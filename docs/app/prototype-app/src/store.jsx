import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';

/* ---------- reference data ---------- */

export const PEOPLE = {
  omar: { id: 'omar', name: 'Omar', full: 'Omar Alharbi', initial: 'O', role: 'You', born: '1984', number: 'A08•••41', expires: 'Jun 2031', expiresISO: '2031-06-22', sex: 'M' },
  hessa: { id: 'hessa', name: 'Hessa', full: 'Hessa Alharbi', initial: 'H', role: 'Spouse', born: '1988', number: 'A11•••07', expires: 'Jan 2029', expiresISO: '2029-01-15', sex: 'F' },
  sara: { id: 'sara', name: 'Sara', full: 'Sara Alharbi', initial: 'S', role: 'Daughter, 13', born: '2013', number: 'A23•••96', expires: '14 Aug 2027', expiresISO: '2027-08-14', sex: 'F' },
  ahmed: { id: 'ahmed', name: 'Ahmed', full: 'Ahmed Alharbi', initial: 'A', role: 'Son, 10', born: '2016', number: 'A23•••97', expires: 'Mar 2030', expiresISO: '2030-03-21', sex: 'M' },
  lina: { id: 'lina', name: 'Lina', full: 'Lina Reyes', initial: 'L', role: 'Helper', born: '1991', number: 'P71•••32', expires: 'Nov 2028', expiresISO: '2028-11-02', sex: 'F', helper: true },
};
export function registerPerson(p) {
  PEOPLE[p.id] = p;
  if (!MRZ[p.id]) MRZ[p.id] = ['P<SAU' + p.full.toUpperCase().replace(/\s+/g, '<<').padEnd(39, '<').slice(0, 39), 'Not scanned yet'];
}
export const MRZ = {
  omar: ['P<SAUALHARBI<<OMAR<<<<<<<<<<<<<<<<<<<<<<<<<', 'A08•••41<6SAU8403117M3106228<<<<<<<<<<<<<<02'],
  hessa: ['P<SAUALHARBI<<HESSA<<<<<<<<<<<<<<<<<<<<<<<<', 'A11•••07<3SAU8807244F2901159<<<<<<<<<<<<<<06'],
  sara: ['P<SAUALHARBI<<SARA<<<<<<<<<<<<<<<<<<<<<<<<<', 'A23•••96<1SAU1305128F2708147<<<<<<<<<<<<<<04'],
  ahmed: ['P<SAUALHARBI<<AHMED<<<<<<<<<<<<<<<<<<<<<<<<', 'A23•••97<9SAU1609032M3003211<<<<<<<<<<<<<<08'],
  lina: ['P<PHLREYES<<LINA<<<<<<<<<<<<<<<<<<<<<<<<<<<', 'P71•••32<4PHL9104186F2811023<<<<<<<<<<<<<<00'],
};

export const FLIGHTS = [
  { id: 'best', label: 'Best for you', airline: 'Saudia', iata: 'SV', brand: '#0b6b52', code: 'SV263', back: 'SV264', dep: '09:40', arr: '13:55', from: 'RUH', to: 'IST', dur: '4h 15m', pp: 2160, reason: 'Lands before check-in. Window seats together.', bags: '2 × 23 kg', change: 'SAR 300 per person', refund: 'Refund minus SAR 400 per person' },
  { id: 'low', label: 'Lowest price', airline: 'flynas', iata: 'XY', brand: '#5b2a86', code: 'XY125', back: 'XY126', dep: '06:15', arr: '10:40', from: 'RUH', to: 'SAW', dur: '4h 25m', pp: 1745, reason: 'The other airport, about 50 minutes from Galata.', bags: '1 × 20 kg', change: 'SAR 250 per person', refund: 'Not refundable' },
  { id: 'early', label: 'Earliest', airline: 'Turkish Airlines', iata: 'TK', brand: '#c8102e', code: 'TK141', back: 'TK140', dep: '02:10', arr: '06:20', from: 'RUH', to: 'IST', dur: '4h 10m', pp: 2328, reason: 'A full first day, after a short night.', bags: '2 × 23 kg', change: 'Free', refund: 'Refund minus SAR 300 per person' },
];
export const HOTELS = [
  { id: 'galata', label: 'Best for you', name: 'Rooms near Galata Tower', area: 'Beyoğlu · 3 min to the tower', night: 980, note: 'Connecting rooms, like you asked for last Eid.', rating: '9.1' },
  { id: 'sultan', label: 'Most quiet', name: 'Garden hotel in Sultanahmet', area: 'Old City · walk to the Blue Mosque', night: 760, note: 'Family suite. Breakfast included.', rating: '8.8' },
  { id: 'bosphorus', label: 'On the water', name: 'Bosphorus view rooms', area: 'Beşiktaş · sea view', night: 1420, note: 'Two rooms side by side. Late checkout.', rating: '9.3' },
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
];

export const fmt = (n) => Math.round(n).toLocaleString('en-US');
export const buzz = (p) => { try { if (navigator.vibrate) navigator.vibrate(p); } catch (e) { /* not supported */ } };
export const HAPTIC = { tap: 8, select: 10, knock: 14, success: [0, 18, 90, 36], warn: [0, 30, 70, 30], thunk: [0, 40], soft: [0, 12, 60, 12] };

/* ---------- state ---------- */

const KEY = 'mada-proto-v1';

export const fresh = () => ({
  onboarded: false,
  guest: false,
  user: null,
  household: [],
  passportSaved: false,
  notifications: null,
  location: null,
  cards: [
    { id: 'visa41', label: 'Visa ending 41', brand: 'VISA' },
    { id: 'mada07', label: 'mada ending 07', brand: 'mada' },
  ],
  defaultCard: 'visa41',
  trip: null,
  pastTrips: [{ id: 'baku', city: 'Baku', dates: '30 Mar – 4 Apr 2026', note: 'Eid with the four of you' }],
  requests: [],
  refunds: [],
  phase: 'none',
  settings: { alerts: 'quiet' },
  circles: { around: false, aroundWho: 'picked', hello: null, hidden: [], reported: [] },
  groups: [
    { id: 'eid', name: 'Istanbul for Eid', img: 'img/istanbul.jpg', members: ['omar', 'hessa', 'abdullah', 'noor', 'sara', 'ahmed'], admin: 'omar', unread: 2, sub: 'vote on the cruise', trip: 'Istanbul · 9–15 Mar', muted: false },
    { id: 'family', name: 'Family', img: null, members: ['omar', 'hessa', 'sara', 'ahmed'], admin: 'omar', unread: 0, sub: 'documents', trip: null, muted: false },
    { id: 'season', name: 'Riyadh Season', img: 'img/riyadh.jpg', members: ['omar', 'abdullah', 'khalid', 'faris', 'maha', 'yousef', 'noor', 'reem'], admin: 'abdullah', unread: 0, sub: '2 events', trip: null, muted: true },
  ],
  friends: ['abdullah', 'noor', 'khalid', 'faris'],
  following: [],
  savedPosts: [],
  friendRequests: ['reem'],
  invites: [
    { id: 'i1', name: 'Maha', via: 'WhatsApp', when: '2 days ago', status: 'pending' },
    { id: 'i2', name: 'Yousef', via: 'Link', when: 'Last week', status: 'joined' },
  ],
  demo: { offline: false, decline: false, priceUp: false, noResults: false, supplierDown: false, agentQuestion: false, passportProblem: false, scanFails: false, faceIdFails: false },
  tab: 'today',
  stack: [],
  walletUnlocked: false,
});

const load = () => {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) { const st = { ...fresh(), ...JSON.parse(raw), stack: [] }; (st.extraPeople || []).forEach(registerPerson); return st; }
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

  useEffect(() => {
    try { localStorage.setItem(KEY, JSON.stringify({ ...s, stack: [] })); } catch (e) { /* storage unavailable */ }
  }, [s]);

  const set = useCallback((patch) => setS((prev) => ({ ...prev, ...(typeof patch === 'function' ? patch(prev) : patch) })), []);

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
    banner: (b) => {
      clearTimeout(bannerTimer.current);
      setBanner({ ...b, id: Date.now() });
      buzz(b.haptic || HAPTIC.warn);
      bannerTimer.current = setTimeout(() => setBanner(null), 5200);
    },
    dismissBanner: () => setBanner(null),
    toastMsg,
    bannerMsg,
    people: () => s.household.map((id) => PEOPLE[id]).filter(Boolean),
    hardReset: () => { try { localStorage.removeItem(KEY); } catch (e) { /* ignore */ } setS(fresh()); },
  };
  return <Ctx.Provider value={api}>{children}</Ctx.Provider>;
}

export const useStore = () => useContext(Ctx);

/* ---------- derived helpers ---------- */

export function passportIssue(s, personId) {
  if (s.demo.passportProblem && personId === 'ahmed') {
    return { blocking: true, text: 'Ahmed’s passport expires on 2 Jul 2027. Türkiye needs 150 days after you land, so it must be valid until 6 Aug.' };
  }
  if (personId === 'sara') return { blocking: false, text: 'Fine for Istanbul: Türkiye asks for 150 days after you land, Sara has 158.' };
  return null;
}

export function tripTravellers(s) {
  return (s.trip?.travellers || []).map((id) => PEOPLE[id]).filter(Boolean);
}

export function seedTrip(s) {
  const travellers = s.household.length ? s.household.filter((id) => id !== 'lina') : ['omar', 'hessa', 'sara', 'ahmed'];
  const flight = FLIGHTS[0];
  const n = travellers.length;
  return {
    id: 'ist', city: 'Istanbul', dates: '9–15 Mar', datesLong: 'Tue 9 – Mon 15 Mar',
    travellers, flightId: flight.id,
    flight: { ...flight, date: 'Tue 9 Mar', backDep: '15:10', backArr: '19:20', backDate: 'Mon 15 Mar' },
    stay: { ...HOTELS[0], nights: STAY_NIGHTS, price: HOTELS[0].night * STAY_NIGHTS, status: 'booked' },
    pickup: { price: PICKUP, status: 'booked' },
    flightPrice: flight.pp * n,
    pnr: 'X7K2QD',
    card: s.defaultCard,
  };
}
