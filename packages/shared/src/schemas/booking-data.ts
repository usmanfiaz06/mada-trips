/*
 * Reference data for booking (M2): where we sell, the options the catalogue supplier returns, the entry rules, the
 * curated plans, the request forms and the promo codes. Lifted from the prototype (docs/app/prototype-app/src/screens
 * Ask.jsx, Pay.jsx, Plan.jsx and store.jsx). Prices are in riyals here because that is how suppliers and agents quote
 * them; everything that leaves the server converts to halalas through sarToHalalas.
 *
 * Nothing in here is ever written by the model: these are supplier and agent price tables (SCOPE.md §6).
 */

export type HomeAirportCode = 'RUH' | 'JED' | 'DMM';
export const HOME_AIRPORTS: readonly HomeAirportCode[] = ['RUH', 'JED', 'DMM'];
export const AIRPORT_NAMES: Record<string, string> = { RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam' };

/* ───────────── where we sell ───────────── */

export type BookingDestination = {
  key: string;
  name: string;
  /** Main airport. */
  code: string;
  /** ISO 3166-1 alpha-2, the key of RULES. */
  country: string;
  /** A photo in apps/mobile/assets/photos (the -sm file name without extension). */
  photo: string;
  /** What people type for it. */
  words: RegExp;
  /** Not sold live: Faisal searches by hand and replies with a held price. */
  byHand?: { ppSar: number; text: string };
};

export const DESTINATIONS: Record<string, BookingDestination> = {
  istanbul: { key: 'istanbul', name: 'Istanbul', code: 'IST', country: 'TR', photo: 'istanbul-galata', words: /istanbul|türkiye|turkiye|turkey/ },
  dubai: { key: 'dubai', name: 'Dubai', code: 'DXB', country: 'AE', photo: 'dubai-skyline', words: /dubai/ },
  cairo: { key: 'cairo', name: 'Cairo', code: 'CAI', country: 'EG', photo: 'cairo-pyramids', words: /cairo/ },
  london: { key: 'london', name: 'London', code: 'LHR', country: 'GB', photo: 'london-kensington', words: /london/ },
  baku: { key: 'baku', name: 'Baku', code: 'GYD', country: 'AZ', photo: 'baku-old-city', words: /baku/ },
  jeddah: { key: 'jeddah', name: 'Jeddah', code: 'JED', country: 'SA', photo: 'jeddah-al-balad', words: /jeddah|jiddah/ },
  alula: { key: 'alula', name: 'AlUla', code: 'ULH', country: 'SA', photo: 'alula-elephant-rock', words: /al[- ]?ula/ },
  abha: { key: 'abha', name: 'Abha', code: 'AHB', country: 'SA', photo: 'abha-mountains', words: /abha/ },
  tbilisi: { key: 'tbilisi', name: 'Tbilisi', code: 'TBS', country: 'GE', photo: 'tbilisi-old-town', words: /tbilisi|georgia/, byHand: { ppSar: 1380, text: 'flynas direct on Thursdays and Sundays, 4h 05m' } },
  paris: { key: 'paris', name: 'Paris', code: 'CDG', country: 'FR', photo: 'inflight-window', words: /paris/, byHand: { ppSar: 3400, text: 'Saudia direct to Charles de Gaulle, 6h 50m' } },
  bali: { key: 'bali', name: 'Bali', code: 'DPS', country: 'ID', photo: 'inflight-wing', words: /bali\b/, byHand: { ppSar: 3900, text: 'Saudia direct to Denpasar three times a week, 9h 40m' } },
  maldives: { key: 'maldives', name: 'the Maldives', code: 'MLE', country: 'MV', photo: 'maldives-overwater', words: /maldives/, byHand: { ppSar: 3600, text: 'Saudia direct to Malé, 5h 30m' } },
};

/** A city we know nothing about: Faisal searches by hand at this rough price per person. */
export const OTHER_CITY_BY_HAND = { ppSar: 2400, text: 'one stop, about 9 hours' };

export const destinationByCode = (code: string) => Object.values(DESTINATIONS).find((d) => d.code === code || (d.key === 'istanbul' && code === 'SAW')) ?? null;

/* ───────────── airlines ───────────── */

export const CARRIERS: Record<string, { name: string; brand: string; terminal: string }> = {
  SV: { name: 'Saudia', brand: '#0b6b52', terminal: 'Terminal 3' },
  XY: { name: 'flynas', brand: '#5b2a86', terminal: 'Terminal 2' },
  TK: { name: 'Turkish Airlines', brand: '#c8102e', terminal: 'Terminal 1' },
  F3: { name: 'flyadeal', brand: '#9bc31c', terminal: 'Terminal 5' },
};

/* ───────────── the catalogue flight supplier (mock GDS) ───────────── */

/** best / lowest / earliest / bags are the labels the prototype uses on its cards. */
export type OptionLabel = 'best' | 'lowest' | 'earliest' | 'fastest' | 'bags' | 'quiet' | 'water';

export type CatalogueFlight = {
  key: string; label: OptionLabel; carrier: string; number: string; backNumber: string;
  dep: string; arr: string; durationMin: number; ppSar: number; reason: string; bags: string; change: string; refund: string;
  /** Arrival airport when it isn't the destination's main one (flynas to SAW). */
  to?: string;
  /** "One stop in Istanbul". */
  stop?: string;
};

export const CATALOGUE_FLIGHTS: Record<string, CatalogueFlight[]> = {
  istanbul: [
    { key: 'sv263', label: 'best', carrier: 'SV', number: 'SV263', backNumber: 'SV264', dep: '09:40', arr: '13:55', durationMin: 255, ppSar: 2160, reason: 'Direct. Lands before check-in.', bags: '2 × 23 kg', change: 'SAR 300 per person', refund: 'Refund minus SAR 400 per person' },
    { key: 'xy125', label: 'lowest', carrier: 'XY', number: 'XY125', backNumber: 'XY126', dep: '06:15', arr: '10:40', durationMin: 265, ppSar: 1745, to: 'SAW', reason: 'The other airport, about 50 minutes from Galata.', bags: '1 × 20 kg', change: 'SAR 250 per person', refund: 'Not refundable' },
    { key: 'tk141', label: 'earliest', carrier: 'TK', number: 'TK141', backNumber: 'TK140', dep: '02:10', arr: '06:20', durationMin: 250, ppSar: 2328, reason: 'A full first day, after a short night.', bags: '2 × 23 kg', change: 'Free', refund: 'Refund minus SAR 300 per person' },
  ],
  dubai: [
    { key: 'sv554', label: 'best', carrier: 'SV', number: 'SV554', backNumber: 'SV555', dep: '08:05', arr: '11:10', durationMin: 125, ppSar: 1240, reason: 'Arrives at Terminal 1 before lunch.', bags: '2 × 23 kg', change: 'SAR 200 per person', refund: 'Refund minus SAR 300 per person' },
    { key: 'xy201', label: 'lowest', carrier: 'XY', number: 'XY201', backNumber: 'XY202', dep: '14:40', arr: '17:45', durationMin: 125, ppSar: 690, reason: 'Cabin bag only. A 20 kg bag is SAR 120 more.', bags: '7 kg cabin bag', change: 'SAR 150 per person', refund: 'Not refundable' },
  ],
  cairo: [
    { key: 'sv305', label: 'best', carrier: 'SV', number: 'SV305', backNumber: 'SV306', dep: '10:15', arr: '11:40', durationMin: 145, ppSar: 1180, reason: 'A daytime flight. Meals on board.', bags: '2 × 23 kg', change: 'SAR 200 per person', refund: 'Refund minus SAR 300 per person' },
    { key: 'xy501', label: 'lowest', carrier: 'XY', number: 'XY501', backNumber: 'XY502', dep: '06:30', arr: '07:55', durationMin: 145, ppSar: 820, reason: 'Early start, a full first day.', bags: '1 × 20 kg', change: 'SAR 150 per person', refund: 'Not refundable' },
  ],
  london: [
    { key: 'sv119', label: 'best', carrier: 'SV', number: 'SV119', backNumber: 'SV120', dep: '01:50', arr: '05:45', durationMin: 415, ppSar: 3950, reason: 'Direct to Heathrow. Sleep on the way.', bags: '2 × 23 kg', change: 'SAR 400 per person', refund: 'Refund minus SAR 600 per person' },
    { key: 'tk145', label: 'lowest', carrier: 'TK', number: 'TK145', backNumber: 'TK146', dep: '03:05', arr: '10:50', durationMin: 645, ppSar: 2780, stop: 'One stop in Istanbul', reason: 'One stop in Istanbul, 1h 50m to change.', bags: '2 × 23 kg', change: 'SAR 300 per person', refund: 'Refund minus SAR 450 per person' },
  ],
  baku: [
    { key: 'xy241', label: 'best', carrier: 'XY', number: 'XY241', backNumber: 'XY242', dep: '09:20', arr: '14:00', durationMin: 220, ppSar: 1150, reason: 'The only direct flight. Arrives mid-afternoon.', bags: '1 × 20 kg', change: 'SAR 150 per person', refund: 'Not refundable' },
    { key: 'tk143', label: 'bags', carrier: 'TK', number: 'TK143', backNumber: 'TK144', dep: '02:10', arr: '11:35', durationMin: 505, ppSar: 1890, stop: 'One stop in Istanbul', reason: 'One stop in Istanbul. Two bags each.', bags: '2 × 23 kg', change: 'Free', refund: 'Refund minus SAR 300 per person' },
  ],
  jeddah: [
    { key: 'sv1021', label: 'best', carrier: 'SV', number: 'SV1021', backNumber: 'SV1022', dep: '07:00', arr: '08:50', durationMin: 110, ppSar: 420, reason: 'Every hour through the day. This one beats the traffic.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { key: 'xy35', label: 'lowest', carrier: 'XY', number: 'XY35', backNumber: 'XY36', dep: '13:15', arr: '15:00', durationMin: 105, ppSar: 290, reason: 'Cabin bag only.', bags: '7 kg cabin bag', change: 'SAR 100 per person', refund: 'Not refundable' },
  ],
  alula: [
    { key: 'sv1561', label: 'best', carrier: 'SV', number: 'SV1561', backNumber: 'SV1562', dep: '09:30', arr: '11:05', durationMin: 95, ppSar: 680, reason: 'In time for lunch in the Old Town.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { key: 'xy581', label: 'lowest', carrier: 'XY', number: 'XY581', backNumber: 'XY582', dep: '16:20', arr: '17:50', durationMin: 90, ppSar: 510, reason: 'Arrives for sunset.', bags: '1 × 20 kg', change: 'SAR 100 per person', refund: 'Not refundable' },
  ],
  abha: [
    { key: 'sv1703', label: 'best', carrier: 'SV', number: 'SV1703', backNumber: 'SV1704', dep: '08:10', arr: '09:50', durationMin: 100, ppSar: 470, reason: 'Morning in the mountains.', bags: '1 × 23 kg', change: 'SAR 100 per person', refund: 'Refund minus SAR 150 per person' },
    { key: 'xy115', label: 'lowest', carrier: 'XY', number: 'XY115', backNumber: 'XY116', dep: '18:00', arr: '19:35', durationMin: 95, ppSar: 330, reason: 'After work. Cabin bag only.', bags: '7 kg cabin bag', change: 'SAR 100 per person', refund: 'Not refundable' },
  ],
};

/** How many fares the search looked at, for "Checked 14 flights". */
export const CHECKED_FARES: Record<string, number> = { istanbul: 14 };

/** Cabin and one-way multipliers on the catalogue's economy return price per person. */
export const CABIN_FACTOR = { economy: 1, premium: 1.7, business: 3.2, first: 3.2 } as const;
export const ONE_WAY_FACTOR = 0.55;
/** A baby on a lap pays a tenth of the adult fare. */
export const INFANT_FACTOR = 0.1;

/** Seat rows by cabin, for the seats a booking carries (store.jsx seatsFor). */
export const SEAT_ROW = { economy: 14, premium: 8, business: 3, first: 3 } as const;

/* ───────────── the catalogue hotel supplier (mock RateHawk) ───────────── */

export type CatalogueHotel = {
  key: string; label: OptionLabel; name: string; area: string; nightSar: number; note: string; rating: number; address: string;
  /** Photo and focal point for the card. */
  photo: string; focal: string;
  /** What the card says for one or two people (prototype hotelNote). */
  noteSmall: { one: string; two: string };
};

export const CATALOGUE_HOTELS: Record<string, CatalogueHotel[]> = {
  istanbul: [
    { key: 'galata', label: 'best', name: 'Rooms near Galata Tower', area: 'Beyoğlu · 3 min to the tower', nightSar: 980, note: 'Connecting rooms on request. 3 minutes from the tower.', rating: 9.1, address: 'Bereketzade Mah., Galata Kulesi Sk. No: 12, 34421 Beyoğlu/İstanbul', photo: 'istanbul-galata', focal: '35% 40%', noteSmall: { one: 'A quiet room on a high floor.', two: 'A quiet room for two on a high floor.' } },
    { key: 'sultan', label: 'quiet', name: 'Garden hotel in Sultanahmet', area: 'Old City · walk to the Blue Mosque', nightSar: 760, note: 'Family suite. Breakfast included.', rating: 8.8, address: 'Cankurtaran Mah., Akbıyık Cd. No: 21, 34122 Fatih/İstanbul', photo: 'istanbul-sultanahmet', focal: '50% 45%', noteSmall: { one: 'Breakfast included.', two: 'Breakfast included.' } },
    { key: 'bosphorus', label: 'water', name: 'Bosphorus view rooms', area: 'Beşiktaş · sea view', nightSar: 1420, note: 'Two rooms side by side. Late checkout.', rating: 9.3, address: 'Sinanpaşa Mah., Beşiktaş Cd. No: 8, 34353 Beşiktaş/İstanbul', photo: 'istanbul-bosphorus', focal: '55% 45%', noteSmall: { one: 'Sea view. Late checkout.', two: 'Sea view. Late checkout.' } },
  ],
};
/** Two people or fewer share one room, at this share of the family price. */
export const SMALL_ROOM_FACTOR = 0.55;
export const STAY_NIGHTS_DEFAULT = 6;
/** Airport pickup both ways; half for one way. */
export const PICKUP_SAR = 440;

/* ───────────── entry rules (production reads Timatic) ───────────── */

export type EntryRule = {
  name: string;
  domestic?: boolean;
  /** Days of passport validity needed after landing, when the country asks for it. */
  passportDays?: number;
  SAU?: { ok?: string; eta?: boolean };
  /** Philippine passports (the household helper in the prototype). */
  PHL?: { ok?: string; need?: string; text?: string };
};

export const ENTRY_RULES: Record<string, EntryRule> = {
  TR: { name: 'Türkiye', passportDays: 150, SAU: { ok: 'Visa-free for 90 days.' }, PHL: { need: 'Türkiye e-Visa', text: '{name} needs a Türkiye e-Visa. A Philippine passport gets one online only with a valid US, UK or Schengen visa. Without one, it’s a visa from the consulate in Riyadh, about 10 working days.' } },
  AE: { name: 'the UAE', SAU: { ok: 'No visa needed.' }, PHL: { need: 'UAE visit visa', text: '{name} needs a UAE visit visa before flying. It takes about 3 working days.' } },
  EG: { name: 'Egypt', SAU: { ok: 'Visa on arrival, USD 25.' }, PHL: { need: 'Egypt visa', text: '{name} needs an Egypt visa from the embassy in Riyadh before flying, about 7 working days.' } },
  GB: { name: 'the UK', SAU: { eta: true, ok: 'A UK ETA for each Saudi passport: online, GBP 16, usually 3 days.' }, PHL: { need: 'UK visit visa', text: '{name} needs a UK visit visa. VFS Riyadh appointments take about 3 weeks.' } },
  AZ: { name: 'Azerbaijan', SAU: { ok: 'Visa on arrival.' }, PHL: { need: 'Azerbaijan e-Visa', text: '{name} needs an Azerbaijan e-Visa. It’s online, about 3 working days.' } },
  GE: { name: 'Georgia', SAU: { ok: 'Visa-free for a year.' }, PHL: { ok: 'Visa-free with a valid Saudi iqama.' } },
  SA: { name: 'Saudi Arabia', domestic: true },
};
export const NATIONALITY_ADJECTIVE: Record<string, string> = { SAU: 'Saudi', PHL: 'Philippine' };

/** When the passport-problem demo switch is on, the first child's passport ends on this day (FLOWS.md §2). */
export const DEMO_SHORT_PASSPORT = '2027-07-02';
/** In mock mode a helper's iqama ends on this day unless the traveller says it was renewed (prototype IQAMA). */
export const DEMO_HELPER_IQAMA = '2027-03-12';

/* ───────────── curated plans ───────────── */

export type PlanStop = { time: string; icon: 'flight' | 'stay' | 'star' | 'food' | 'car'; title: string; note: string };
export type CuratedPlan = {
  id: string; title: string; sub: string; photo: string; city: string; days: number;
  /** Agent price table, riyals: flights for two, the stay, experiences for four. */
  price: { flights: number; stay: number; experiences: number };
  plan: { day: string; stops: PlanStop[] }[];
};

export const PLANS: Record<string, CuratedPlan> = {
  alula2: {
    id: 'alula2', title: 'Two days in AlUla', sub: 'Old Town, Hegra and a desert sunset', photo: 'alula-elephant-rock', city: 'AlUla', days: 2,
    price: { flights: 1380, stay: 1650, experiences: 870 },
    plan: [
      { day: 'Day 1', stops: [
        { time: '07:30', icon: 'flight', title: 'Riyadh → AlUla', note: '1h 20m direct. Window seats on the right for the canyon view.' },
        { time: '10:00', icon: 'stay', title: 'Check in at a desert resort', note: 'Two connecting rooms. Pool, family dining.' },
        { time: '16:00', icon: 'star', title: 'AlUla Old Town', note: 'Mud-brick lanes, 900 rooms. Comfortable shoes.' },
        { time: '18:10', icon: 'star', title: 'Elephant Rock at sunset', note: 'Lounge seating. Arrive 30 minutes before.' },
        { time: '20:00', icon: 'food', title: 'Dinner under the stars', note: 'Halal, family seating. Table held for 4.' },
      ] },
      { day: 'Day 2', stops: [
        { time: '09:00', icon: 'star', title: 'Hegra guided tour', note: '2.5 hours. Tickets for all 4, timed entry.' },
        { time: '13:00', icon: 'food', title: 'Lunch in the oasis', note: 'Shade and farm-to-table. Kids’ menu.' },
        { time: '15:30', icon: 'star', title: 'Harrat Viewpoint', note: 'The whole valley from above. 20 minutes by car.' },
        { time: '19:40', icon: 'flight', title: 'AlUla → Riyadh', note: 'Home by 21:00.' },
      ] },
    ],
  },
  istanbul3: {
    id: 'istanbul3', title: 'Three easy days in Istanbul with kids', sub: 'Palaces, ferries and the best künefe', photo: 'istanbul-bosphorus', city: 'Istanbul', days: 3,
    price: { flights: 0, stay: 0, experiences: 2140 },
    plan: [
      { day: 'Day 1', stops: [
        { time: '10:00', icon: 'star', title: 'Topkapı Palace, skip the line', note: 'Closed Tuesdays. 2 hours is enough with kids.' },
        { time: '13:00', icon: 'food', title: 'Lunch in Sultanahmet', note: 'Halal, outdoor tables.' },
        { time: '19:30', icon: 'star', title: 'Bosphorus dinner cruise', note: 'From Kabataş pier. Booked for 6.' },
      ] },
      { day: 'Day 2', stops: [
        { time: '10:30', icon: 'car', title: 'Ferry to Kadıköy', note: '20 minutes. Kids feed the gulls.' },
        { time: '11:00', icon: 'food', title: 'Kadıköy food walk', note: 'Tastings for 4, about 3 hours.' },
      ] },
      { day: 'Day 3', stops: [
        { time: '10:00', icon: 'star', title: 'Princes’ Islands day trip', note: 'No cars on the islands. Bikes and carriages.' },
        { time: '19:00', icon: 'food', title: 'Künefe near Galata Tower', note: 'Noor’s tip: go before 8.' },
      ] },
    ],
  },
};

/* ───────────── requests Faisal completes ───────────── */

export const NEED_KEYS = ['wheelchairGate', 'wheelchairSeat', 'diabetic', 'lowSalt', 'soft', 'toilet', 'oxygen'] as const;
export type NeedKey = (typeof NEED_KEYS)[number];
export const NEED_LABELS: Record<NeedKey, string> = {
  wheelchairGate: 'Wheelchair to the gate', wheelchairSeat: 'Wheelchair to the seat', diabetic: 'Diabetic meal', lowSalt: 'Low-salt meal',
  soft: 'Soft food', toilet: 'Seat near the toilet', oxygen: 'Travelling with oxygen',
};
export const NEED_WORDS: [NeedKey, RegExp][] = [
  ['wheelchairSeat', /wheel ?chair|can'?t walk|cannot walk|walking frame|walker/],
  ['diabetic', /diabet|sugar/],
  ['lowSalt', /low[- ]salt|blood pressure|hypertension|heart/],
  ['soft', /soft food|soft meal|dentures|chewing/],
  ['toilet', /toilet|bathroom|restroom/],
  ['oxygen', /oxygen|concentrator/],
];

export type RequestFormKind = 'visa' | 'umrah' | 'car' | 'food' | 'todo' | 'flight' | 'stay' | 'general';
export type FormQuestion = { k: string; q: string; options?: string[]; people?: boolean; needs?: boolean; multi?: boolean; from?: [RegExp, string][] };

/** One question at a time, as chips (FLOWS.md §4). Question copy lives in the catalogue under request.q.*. */
export const REQUEST_FORMS: Record<RequestFormKind, FormQuestion[]> = {
  visa: [
    { k: 'where', q: 'request.q.whichVisa', options: ['Schengen', 'UK', 'United States', 'Somewhere else'], from: [[/schengen|france|germany|italy|spain|europe/, 'Schengen'], [/\buk\b|britain|london|england/, 'UK'], [/\bus\b|\busa\b|america|united states/, 'United States']] },
    { k: 'who', q: 'request.q.forWho', people: true },
    { k: 'when', q: 'request.q.whenTravel', options: ['This summer', 'In the next 3 months', 'Not sure yet'] },
  ],
  umrah: [
    { k: 'when', q: 'request.q.when', options: ['In Ramadan', 'After Eid', 'Pick dates later'], from: [[/ramadan/, 'In Ramadan'], [/after eid/, 'After Eid']] },
    { k: 'who', q: 'request.q.whoGoing', people: true },
    { k: 'needs', q: 'request.q.needs', needs: true },
    { k: 'stay', q: 'request.q.makkahStay', options: ['Steps from the Haram', 'Good value, short ride'], from: [[/haram|close|near|walk/, 'Steps from the Haram']] },
  ],
  car: [
    { k: 'where', q: 'request.q.where', options: ['Istanbul', 'Riyadh', 'Somewhere else'], from: [[/istanbul/, 'Istanbul'], [/riyadh/, 'Riyadh']] },
    { k: 'size', q: 'request.q.size', options: ['7 seats for the family', 'Standard car'] },
    { k: 'days', q: 'request.q.howLong', options: ['1 day', '3 days', 'The whole trip'] },
  ],
  food: [
    { k: 'where', q: 'request.q.where', options: ['Istanbul, near the hotel', 'Riyadh'] },
    { k: 'when', q: 'request.q.when', options: ['Tonight', 'Tomorrow', 'First night of the trip'], from: [[/tonight/, 'Tonight'], [/tomorrow/, 'Tomorrow'], [/first night/, 'First night of the trip']] },
    { k: 'pref', q: 'request.q.matters', options: ['Halal', 'Family seating', 'A view', 'Quiet'], multi: true },
  ],
  todo: [
    { k: 'pick', q: 'request.q.pick', options: ['Bosphorus dinner cruise', 'Princes’ Islands day trip', 'Topkapı Palace tickets', 'A food walk in Kadıköy'], multi: true },
    { k: 'who', q: 'request.q.whoGoing', people: true },
    { k: 'needs', q: 'request.q.needs', needs: true },
  ],
  flight: [],
  stay: [],
  general: [],
};

/** The desk's price table for what it quotes by hand (riyals). The mock desk uses it; a real agent types the price in Ops. */
export const DESK_PRICES = {
  todo: { 'Bosphorus dinner cruise': 190, 'Princes’ Islands day trip': 160, 'Topkapı Palace tickets': 85, 'A food walk in Kadıköy': 140 } as Record<string, number>,
  visaAppointment: 450,
  car: 980,
  umrahAdult: 2300, umrahChild: 1650, umrahInfant: 350, umrahNearHaram: 450, umrahWheelchair: 300,
  /** Entry-check services. */
  ukEtaEach: 60, eVisa: 350, reentry: 200, passportRenewal: 150,
  /** "Stay closer to the Haram" in a reply: the King Abdulaziz Gate, per person. */
  closerToHaram: 380,
  esimEach: 39,
};

/* ───────────── promo codes ───────────── */

export const PROMOS: Record<string, { percent: number; maxSar: number; validUntil: string; endedLabel: string }> = {
  EID10: { percent: 10, maxSar: 300, validUntil: '2027-04-30', endedLabel: '30 April' },
  RAMADAN: { percent: 10, maxSar: 300, validUntil: '2026-03-30', endedLabel: '30 March' },
};

/* ───────────── cards ───────────── */

/** mada BINs (Saudi debit network). A card starting with one is a mada card even though it also routes as Visa or Mastercard. */
export const MADA_BINS = [
  '440647', '440795', '446404', '457865', '588845', '588846', '588848', '588850', '604906', '968201', '968202', '968203', '968204', '968205', '968206',
  '968207', '968208', '968209', '968210', '968211', '417633', '446393', '457997', '474491', '636120', '468540', '468541', '468542', '468543', '409201',
  '458456', '484783', '462220', '455708', '410621', '455036', '486094', '486095', '486096', '504300', '440533', '489318', '489319', '445564', '401757',
  '410685', '432328', '428671', '428672', '428673', '446672', '543357', '434107', '431361', '521076', '535825', '529415', '543085', '524130', '554180',
  '549760', '524514', '529741', '537767', '535989', '536023', '513213', '585265', '588983', '588982', '589005', '508160', '531095', '530906', '532013',
  '422817', '422818', '422819', '428331', '483010', '483011', '483012', '589206', '419593', '439954', '407197', '407395', '520058', '530060', '531196',
];
