/*
 * The trip companion's rules, as pure functions over the API shapes in ./trips.ts. The Core API runs them on real rows;
 * the app's mock API runs the same code in memory, so both always agree. No I/O, no clocks: `now` is passed in.
 *
 * Every number traces to a rule the traveller was shown (fare rules, the hotel's free window, GACA). Every word comes
 * from the catalogue (packages/shared/src/copy/en-trips.ts).
 */
import { t, tn, type CopyKey, type Vars } from '../copy';
import { addDays, addMinutes, dayLabel, dayOfMonth, daysBetween, durationLabel, monthOf, rangeLabel, shortDay, todayIn, weekdayOf, zonedToInstant, TZ } from '../dates';
import { bps, formatSar, vatInside, type Halalas } from '../money';
import { localeOr } from '../locale';
import type {
  ChangeKind, ChangeOption, DisruptionKind, DisruptionOption, FareRules, InvoiceLine, ItineraryDay, ItineraryItem, MoveNeeded, PickupDetail,
  RefundQuoteItem, SegmentDetail, StayDetail, TripDetail, TripPayment, TripPhase, TripRequestView, TripTraveller, CalendarEvent,
} from './trips';

const tk = (key: string, vars?: Vars) => t(key as CopyKey, vars);
const sar = (h: Halalas) => formatSar(h);
const SAR = 100;

/* ═══════════ reference data ═══════════ */

/** Airline colours for the mark, and fare rules per carrier (from the prototype's fares; per person, in halalas). */
export const AIRLINE_INFO: Readonly<Record<string, { name: string; brand: string; change: Halalas; refundable: boolean; refundFee: Halalas | null; bags: string; bagFee: Halalas; bagKg: number; terminal: string }>> = {
  SV: { name: 'Saudia', brand: '#0b6b52', change: 300 * SAR, refundable: true, refundFee: 400 * SAR, bags: '2 × 23 kg', bagFee: 250 * SAR, bagKg: 23, terminal: 'Terminal 3' },
  XY: { name: 'flynas', brand: '#5b2a86', change: 250 * SAR, refundable: false, refundFee: null, bags: '1 × 20 kg', bagFee: 180 * SAR, bagKg: 20, terminal: 'Terminal 2' },
  TK: { name: 'Turkish Airlines', brand: '#c8102e', change: 0, refundable: true, refundFee: 300 * SAR, bags: '2 × 23 kg', bagFee: 220 * SAR, bagKg: 23, terminal: 'Terminal 1' },
  F3: { name: 'flyadeal', brand: '#9bc31c', change: 200 * SAR, refundable: false, refundFee: null, bags: '1 × 20 kg', bagFee: 150 * SAR, bagKg: 20, terminal: 'Terminal 5' },
  EK: { name: 'Emirates', brand: '#d71a21', change: 300 * SAR, refundable: true, refundFee: 450 * SAR, bags: '2 × 23 kg', bagFee: 300 * SAR, bagKg: 23, terminal: 'Terminal 1' },
  QR: { name: 'Qatar Airways', brand: '#5c0632', change: 300 * SAR, refundable: true, refundFee: 400 * SAR, bags: '2 × 23 kg', bagFee: 300 * SAR, bagKg: 23, terminal: 'Terminal 1' },
};
const DEFAULT_AIRLINE = AIRLINE_INFO.SV!;

/** Airport and government taxes per person on a return ticket. Refundable even when the fare isn't. */
export const TAX_PER_PERSON: Halalas = 312 * SAR;
/** Mada's service fee inside each flight payment: the only part of a flight with 15% VAT. */
export const SERVICE_FEE: Halalas = 100 * SAR;
export const VAT_STANDARD_BPS = 1500;

export const SELLER = {
  name: 'Mada Trips', legal: 'Mada Travel and Tourism Co.', vat: '310245678900003', cr: 'CR 1010654321', address: 'King Fahd Rd, Al Olaya, Riyadh 12214',
} as const;

export const AIRPORT_NAME: Readonly<Record<string, string>> = {
  RUH: 'King Khalid', JED: 'King Abdulaziz', DMM: 'King Fahd', MED: 'Prince Mohammad bin Abdulaziz', IST: 'Istanbul Airport', SAW: 'Sabiha Gökçen',
  DXB: 'Dubai International', DOH: 'Hamad International', CAI: 'Cairo International', LHR: 'Heathrow', GYD: 'Heydar Aliyev', TBS: 'Tbilisi International',
};
export const AIRPORT_CITY: Readonly<Record<string, string>> = {
  RUH: 'Riyadh', JED: 'Jeddah', DMM: 'Dammam', MED: 'Madinah', AHB: 'Abha', ULH: 'AlUla', DXB: 'Dubai', AUH: 'Abu Dhabi', DOH: 'Doha',
  IST: 'Istanbul', SAW: 'Istanbul', CAI: 'Cairo', LHR: 'London', FRA: 'Frankfurt', GYD: 'Baku', TBS: 'Tbilisi',
};

/** What we know about a place, for the travel-day screens. Content, not prices. */
export type Destination = {
  city: string;
  country: string;
  /** Passport validity needed after landing, in days. */
  validityDays: number;
  plug: string | null;
  /** Hello, thank you … with the local word and how to say it. */
  words: [string, string, string][];
  language: string | null;
  /** First-evening picks offered in the air. */
  picks: { id: string; title: string; note: string; tag: string; time: string; photo: string }[];
  prayer: string | null;
  qibla: string | null;
  mosques: string | null;
  /** Ideas for a free day, in order; Friday and Sunday have their own. */
  freeDays: { title: string; sub: string; ask: string | null }[];
  friday: { title: string; sub: string }[];
  sunday: { title: string; sub: string }[];
  /** Arrival hall facts. */
  carousel: string | null;
  atm: string | null;
  taxi: string | null;
  metro: string | null;
  sayToDriver: string | null;
  photo: string;
  stamp: string;
};

const ISTANBUL: Destination = {
  city: 'Istanbul', country: 'Türkiye', validityDays: 150, plug: 'type F', language: 'Turkish',
  words: [['Hello', 'Merhaba', 'mer-ha-ba'], ['Thank you', 'Teşekkürler', 'teh-shek-kur-ler'], ['Please', 'Lütfen', 'lewt-fen'], ['The bill, please', 'Hesap, lütfen', 'heh-sap lewt-fen'], ['Where is…?', '… nerede?', 'neh-reh-deh']],
  picks: [
    { id: 'k1', title: 'Künefe near Galata Tower', note: 'Noor’s tip. Go before 8, it sells out.', tag: 'Dessert · 4 min walk', time: '19:00', photo: 'turkish-breakfast' },
    { id: 'k2', title: 'Sunset from the Galata Bridge', note: 'Fishermen, ferries and the old city in gold.', tag: 'Free · 10 min walk', time: '18:30', photo: 'istanbul-bosphorus' },
    { id: 'k3', title: 'Dinner with a Bosphorus view', note: 'Halal, family seating, table for 4 at 20:00.', tag: 'Dinner · 15 min drive', time: '20:00', photo: 'istanbul-galata' },
    { id: 'k4', title: 'An early night', note: 'Room service, and a slow start tomorrow.', tag: 'Rest', time: '21:00', photo: 'hotel-room' },
  ],
  prayer: 'Fajr 05:58 · Dhuhr 13:21 · Asr 16:37 · Maghrib 19:13 · Isha 20:36',
  qibla: 'Qibla from Galata is south-east, about 152°',
  mosques: 'Mosques near the hotel: Arap Camii (6 min walk), Kılıç Ali Paşa (10 min).',
  freeDays: [
    { title: 'Hagia Sophia and the Blue Mosque', sub: 'Go before 10, the queues are short. 8 min by tram.', ask: 'Tickets for Hagia Sophia on {day}' },
    { title: 'Basilica Cistern', sub: 'Book a time slot and skip the line.', ask: 'تذاكر صهريج البازيليك يوم {day}' },
    { title: 'A day on Büyükada', sub: 'The biggest of the Princes’ Islands. No cars, just bikes and walks.', ask: 'Ferry tickets to Büyükada on {day}' },
    { title: 'Ferry from Eminönü to Kadıköy', sub: '20 minutes on the water, about SAR 4 each.', ask: null },
  ],
  friday: [{ title: 'Jumu’ah at Süleymaniye Mosque', sub: 'Khutbah at 13:21. Be there by 12:45 for space inside.' }, { title: 'Grand Bazaar', sub: 'Open until 19:00. Closed on Sundays.' }],
  sunday: [{ title: 'Spice Bazaar', sub: 'Open today, unlike the Grand Bazaar. Lokum to take home.' }],
  carousel: 'carousel 7', atm: 'the ATM by Door 8 beats the exchange desk',
  taxi: 'About TRY 1,100 (SAR 125) · 45–60 min · yellow rank at Door 14. Ask for the meter: “taksimetre”.',
  metro: 'M11 to Gayrettepe, then M2 · about 70 min · TRY 60 each · hard with big bags',
  sayToDriver: 'Lütfen bu adrese gidin', photo: 'istanbul-galata', stamp: 'İSTANBUL · TÜRKİYE · ENTRY ·',
};

const GENERIC = (city: string, country: string | null): Destination => ({
  city, country: country ?? city, validityDays: 180, plug: null, language: null, words: [], picks: [], prayer: null, qibla: null, mosques: null,
  freeDays: [], friday: [], sunday: [], carousel: null, atm: null, taxi: null, metro: null, sayToDriver: null, photo: 'airport-terminal',
  stamp: `${city.toUpperCase()} · ENTRY ·`,
});

/** Istanbul in Arabic: the same facts, written for an Arabic reader (a first draft for the Saudi writer). */
const ISTANBUL_AR: Destination = {
  ...ISTANBUL,
  plug: 'نوع F', language: 'التركية',
  words: [['مرحبًا', 'Merhaba', 'مِرحَبا'], ['شكرًا', 'Teşekkürler', 'تَشَكّورلَر'], ['لو سمحت', 'Lütfen', 'لوتفَن'], ['الحساب، لو سمحت', 'Hesap, lütfen', 'حِساب لوتفَن'], ['أين…؟', '… nerede?', 'نيرِدِه']],
  picks: [
    { id: 'k1', title: 'كنافة قرب برج غلطة', note: 'نصيحة نور. اذهبوا قبل 8، تنفد بسرعة.', tag: 'حلويات · 4 د مشيًا', time: '19:00', photo: 'turkish-breakfast' },
    { id: 'k2', title: 'الغروب من جسر غلطة', note: 'صيادون وعبّارات والمدينة القديمة بلون الذهب.', tag: 'مجاني · 10 د مشيًا', time: '18:30', photo: 'istanbul-bosphorus' },
    { id: 'k3', title: 'عشاء بإطلالة على البوسفور', note: 'حلال، جلسات عائلية، طاولة لأربعة الساعة 20:00.', tag: 'عشاء · 15 د بالسيارة', time: '20:00', photo: 'istanbul-galata' },
    { id: 'k4', title: 'نوم مبكر', note: 'خدمة الغرف، وبداية هادئة غدًا.', tag: 'راحة', time: '21:00', photo: 'hotel-room' },
  ],
  prayer: 'الفجر 05:58 · الظهر 13:21 · العصر 16:37 · المغرب 19:13 · العشاء 20:36',
  qibla: 'القبلة من غلطة باتجاه الجنوب الشرقي، حوالي 152°',
  mosques: 'مساجد قرب الفندق: جامع العرب (6 د مشيًا)، وجامع قليج علي باشا (10 د).',
  freeDays: [
    { title: 'آيا صوفيا والجامع الأزرق', sub: 'اذهبوا قبل 10، الطوابير قصيرة. 8 د بالترام.', ask: 'تذاكر آيا صوفيا يوم {day}' },
    { title: 'صهريج البازيليك', sub: 'احجز موعدًا وتجاوز الطابور.', ask: 'تذاكر صهريج البازيليك يوم {day}' },
    { title: 'يوم في بيوك أدا', sub: 'أكبر جزر الأميرات. بلا سيارات، دراجات ومشي فقط.', ask: 'تذاكر عبّارة إلى بيوك أدا يوم {day}' },
    { title: 'عبّارة من أمين أونو إلى قاضي كوي', sub: '20 دقيقة على الماء، حوالي 4 ر.س للشخص.', ask: null },
  ],
  friday: [{ title: 'صلاة الجمعة في جامع السليمانية', sub: 'الخطبة الساعة 13:21. احضروا قبل 12:45 لتجدوا مكانًا في الداخل.' }, { title: 'البازار الكبير', sub: 'مفتوح حتى 19:00. مغلق يوم الأحد.' }],
  sunday: [{ title: 'سوق التوابل', sub: 'مفتوح اليوم، بخلاف البازار الكبير. خذوا معكم حلقوم تركي.' }],
  carousel: 'السير 7', atm: 'الصراف الآلي عند البوابة 8 أفضل من مكتب الصرافة',
  taxi: 'حوالي 1,100 ليرة (125 ر.س) · من 45 إلى 60 د · الموقف الأصفر عند البوابة 14. اطلب العدّاد: «taksimetre».',
  metro: 'M11 إلى غيرّت تبه، ثم M2 · حوالي 70 د · 60 ليرة للشخص · صعب مع الحقائب الكبيرة',
};

export function destinationOf(trip: Pick<TripDetail, 'city' | 'country'>): Destination {
  if (/istanbul/i.test(trip.city)) return localeOr() === 'ar' ? ISTANBUL_AR : ISTANBUL;
  return GENERIC(trip.city, trip.country);
}

/* ═══════════ small helpers ═══════════ */

export const hhmm = (local: string) => local.slice(11, 16);
export const dayPart = (local: string) => local.slice(0, 10);
export const moneyOf = (amount: Halalas) => ({ amount, currency: 'SAR' as const });
export const seatText = (seats: readonly string[]) => (seats.length > 1 ? `${seats[0]}–${seats[seats.length - 1]}` : seats[0] ?? '');
export const termShort = (terminal: string | null) => String(terminal ?? '').replace('Terminal ', 'T');
export const NUM_WORD = ['no', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine', 'ten'];
/** "you", "you two", "the four of you". */
export const ofYou = (n: number) => (n <= 1 ? tk('trip.ofYou.one') : n === 2 ? tk('trip.ofYou.two') : tk('trip.ofYou.many', { n: NUM_WORD[n] ?? n }));
export const joinPeople = (arr: readonly string[]) => (arr.length < 2 ? arr.join('') : `${arr.slice(0, -1).join(', ')} ${tk('trip.and')} ${arr[arr.length - 1]}`);

export function outSegment(trip: Pick<TripDetail, 'segments'>): SegmentDetail | null {
  return trip.segments.find((s) => s.direction === 'out') ?? null;
}
export function backSegment(trip: Pick<TripDetail, 'segments'>): SegmentDetail | null {
  return [...trip.segments].reverse().find((s) => s.direction === 'back') ?? null;
}
export function liveStay(trip: Pick<TripDetail, 'stays'>): StayDetail | null {
  return trip.stays.find((s) => s.status !== 'cancelled') ?? null;
}
export const stayEnd = (st: Pick<StayDetail, 'checkIn' | 'nights'>) => addDays(st.checkIn, st.nights);
export function homePickup(trip: Pick<TripDetail, 'pickups'>): PickupDetail | null {
  return trip.pickups.find((p) => p.direction === 'to_airport' && p.status !== 'cancelled') ?? null;
}
export function arrivalPickup(trip: Pick<TripDetail, 'pickups'>): PickupDetail | null {
  return trip.pickups.find((p) => p.direction === 'from_airport' && p.status !== 'cancelled') ?? null;
}
export const nightPrice = (st: Pick<StayDetail, 'price' | 'nights'>) => Math.round(st.price.amount / Math.max(1, st.nights));

/** The instant a flight leaves or lands, from its local wall-clock time and zone, with any delay. */
export function departInstant(s: Pick<SegmentDetail, 'departLocal' | 'departTz' | 'delayMin'>): Date {
  return new Date(zonedToInstant(s.departLocal, s.departTz).getTime() + (s.delayMin ?? 0) * 60_000);
}
export function arriveInstant(s: Pick<SegmentDetail, 'arriveLocal' | 'arriveTz' | 'delayMin'>): Date {
  return new Date(zonedToInstant(s.arriveLocal, s.arriveTz).getTime() + (s.delayMin ?? 0) * 60_000);
}
/** Both clocks agree all year (Riyadh and Istanbul are UTC+3). */
export function sameTimeAsHome(s: Pick<SegmentDetail, 'departTz' | 'arriveTz' | 'departLocal'>): boolean {
  const at = zonedToInstant(s.departLocal, s.departTz);
  const off = (tz: string) => { const p = new Intl.DateTimeFormat('en-US', { timeZone: tz, hour: 'numeric', hourCycle: 'h23' }).format(at); return Number(p); };
  try { return off(s.departTz) === off(s.arriveTz); } catch { return false; }
}

export function fareRulesFor(carrier: string | null | undefined): FareRules {
  const a = (carrier && AIRLINE_INFO[carrier]) || DEFAULT_AIRLINE;
  return { changeFee: a.change, refundable: a.refundable, refundFee: a.refundFee, bagFee: a.bagFee, bagKg: a.bagKg, bags: a.bags, taxPerPerson: TAX_PER_PERSON };
}

/* ═══════════ the trip clock ═══════════ */

/** The phase of a trip at an instant. Mid-trip days read as "landed"; a week after the flight home, the trip is past. */
export function derivePhase(trip: Pick<TripDetail, 'status' | 'segments' | 'stays' | 'startDate' | 'endDate'>, now: Date): TripPhase {
  if (trip.status === 'cancelled') return 'none';
  const out = outSegment(trip);
  const back = backSegment(trip);
  const ms = now.getTime();
  if (!out) {
    const st = liveStay(trip);
    const start = st?.checkIn ?? trip.startDate;
    const end = st ? stayEnd(st) : trip.endDate ?? start;
    const today = todayIn(TZ, now);
    if (today < addDays(start, -1)) return 'booked';
    if (today === addDays(start, -1)) return 'daybefore';
    if (today < end) return 'landed';
    return today <= addDays(end, 7) ? 'home' : 'none';
  }
  const dep = departInstant(out).getTime();
  const arr = arriveInstant(out).getTime();
  const outDay = dayPart(out.departLocal);
  const localToday = todayIn(out.departTz, now);
  if (ms < dep) {
    if (localToday < addDays(outDay, -1)) return 'booked';
    if (localToday === addDays(outDay, -1)) return 'daybefore';
    if (out.status === 'cancelled') return 'cancelled';
    if (out.status === 'delayed' || out.predictedDelay) return 'delayed';
    return 'travelday';
  }
  if (out.status === 'cancelled') return ms < dep + 12 * 3_600_000 ? 'cancelled' : 'none';
  if (ms < arr) return 'inair';
  if (back) {
    const bdep = departInstant(back).getTime();
    const barr = arriveInstant(back).getTime();
    if (ms < bdep) return 'landed';
    if (ms < barr) return 'inair';
    return ms < barr + 7 * 86_400_000 ? 'home' : 'none';
  }
  const st = liveStay(trip);
  const end = trip.endDate ?? (st ? stayEnd(st) : dayPart(out.arriveLocal));
  const today = todayIn(out.arriveTz, now);
  if (today <= end && ms < arr + 30 * 86_400_000) return 'landed';
  return today <= addDays(end, 7) ? 'home' : 'none';
}

/**
 * A demo moment (mock mode only): the instant the clock pretends it is, so every countdown and label lines up with the
 * prototype. Travel day starts 42 minutes before the driver comes; in the air, 2h 05m are left.
 */
export function demoNow(trip: Pick<TripDetail, 'segments' | 'stays' | 'pickups' | 'startDate' | 'endDate'>, phase: TripPhase, realNow: Date): Date {
  const out = outSegment(trip);
  const back = backSegment(trip);
  if (!out) {
    const st = liveStay(trip);
    const start = st?.checkIn ?? trip.startDate;
    const at = (day: string, hm: string) => zonedToInstant(`${day}T${hm}`, TZ);
    if (phase === 'daybefore') return at(addDays(start, -1), '20:10');
    if (phase === 'landed') return at(start, '15:00');
    if (phase === 'home') return at(st ? stayEnd(st) : start, '18:00');
    return realNow;
  }
  const dep = zonedToInstant(out.departLocal, out.departTz).getTime();
  const arr = zonedToInstant(out.arriveLocal, out.arriveTz).getTime();
  const pk = homePickup(trip);
  const min = 60_000;
  switch (phase) {
    case 'booked': return realNow.getTime() < dep - 2 * 86_400_000 ? realNow : new Date(dep - 21 * 86_400_000);
    case 'daybefore': return zonedToInstant(`${addDays(dayPart(out.departLocal), -1)}T20:10`, out.departTz);
    case 'travelday': return new Date(dep + (pk?.offsetMin ?? -155) * min - 42 * min);
    case 'delayed': return new Date(dep - 98 * min);
    case 'cancelled': return new Date(dep - 205 * min);
    case 'inair': return new Date(arr - 125 * min);
    case 'landed': return new Date(arr + 3 * min);
    case 'home': return back ? new Date(arriveInstant(back).getTime() + 2 * 3_600_000) : new Date(arr + 6 * 86_400_000);
    default: return realNow;
  }
}

/** Under a demo override, show what the airline would be saying at that moment (the stored trip is not changed). */
export function demoView<T extends Pick<TripDetail, 'segments'>>(trip: T, phase: TripPhase): T {
  const out = outSegment(trip);
  if (!out) return trip;
  const segs = trip.segments.map((s) => {
    if (s.id !== out.id) return s;
    if (phase === 'delayed' && s.status !== 'cancelled' && !s.delayMin) return { ...s, predictedDelay: true, delayMin: null };
    if (phase === 'cancelled' && s.status !== 'delayed') return { ...s, status: 'cancelled' as const, statusSource: s.statusSource ?? 'Live · airline' };
    if (phase === 'inair') return { ...s, status: 'in_air' as const };
    if (phase === 'landed' || phase === 'home') return { ...s, status: 'landed' as const };
    return s;
  });
  return { ...trip, segments: segs };
}

/* ═══════════ pickups and the day ═══════════ */

/** Minutes before take-off the driver can come. The second is what we suggest. */
export const PICKUP_OFFSETS = [-175, -155, -140, -125] as const;
export const SUGGESTED_OFFSET = -155;
/** Drive to King Khalid at that hour, and the margins the plan uses. */
export const DRIVE_MIN = 31;

export type PickupPlan = {
  pickupId: string; driver: string; car: string | null; room: string | null; phone: string | null; waits: string;
  offsetMin: number; time: string; day: string; wake: string; airportBy: string; bagDrop: string;
};

/** The home pickup for the flight out, as one object every screen reads. */
export function pickupPlan(trip: Pick<TripDetail, 'segments' | 'pickups'>): PickupPlan | null {
  const out = outSegment(trip);
  const pk = homePickup(trip);
  if (!out || !pk) return null;
  const dep = hhmm(out.departLocal);
  const offset = pk.offsetMin ?? SUGGESTED_OFFSET;
  const time = addMinutes(dep, offset);
  const day = pk.at ? new Date(pk.at).getTime() ? todayIn(out.departTz, new Date(pk.at)) : dayPart(out.departLocal) : dayPart(out.departLocal);
  return {
    pickupId: pk.id, driver: pk.driverName ?? tk('trip.yourDriver'), car: pk.car, room: pk.room, phone: pk.phone, waits: pk.waits ?? '10 min',
    offsetMin: offset, time, day, wake: addMinutes(time, -45), airportBy: addMinutes(time, 35), bagDrop: addMinutes(dep, -60),
  };
}
export const boardsAt = (s: Pick<SegmentDetail, 'departLocal' | 'delayMin'>) => addMinutes(hhmm(s.departLocal), -45 + (s.delayMin ?? 0));
export const signName = (trip: Pick<TripDetail, 'travellers'>) => (trip.travellers[0]?.fullName.split(' ').slice(-1)[0] ?? tk('trip.yourName')).toUpperCase();

/** After a date change: the hotel and the home pickup still on the old day until the traveller says. */
export function moveNeeded(trip: Pick<TripDetail, 'segments' | 'stays' | 'pickups' | 'clock'>): MoveNeeded | null {
  const out = outSegment(trip);
  if (!out) return null;
  const to = dayPart(out.departLocal);
  const back = backSegment(trip);
  const st = liveStay(trip);
  const pk = homePickup(trip);
  const plan = pickupPlan(trip);
  const hotel = st && st.checkIn !== to ? st : null;
  const pickupDay = pk ? todayIn(out.departTz, new Date(pk.at)) : null;
  const pickup = pk && pickupDay && pickupDay !== to ? pk : null;
  if (!hotel && !pickup) return null;
  let hotelOut: MoveNeeded['hotel'] = null;
  if (hotel) {
    const keepsCheckout = back && stayEnd(hotel) === dayPart(back.departLocal);
    const newNights = Math.max(1, keepsCheckout && back ? daysBetween(to, dayPart(back.departLocal)) : hotel.nights);
    const diffNights = newNights - hotel.nights;
    const night = nightPrice(hotel);
    const freeNow = trip.clock.phase === 'booked' || trip.clock.phase === 'none';
    const diff = diffNights * night;
    hotelOut = { stayId: hotel.id, name: hotel.name, fromDay: hotel.checkIn, newNights, diff, back: diff < 0 && freeNow ? -diff : 0 };
  }
  return {
    from: hotel?.checkIn ?? pickupDay ?? to, to, hotel: hotelOut,
    pickup: pickup && plan ? { pickupId: pickup.id, driver: plan.driver, fromDay: pickupDay!, time: plan.time } : null,
  };
}

/* ═══════════ timing and refunds ═══════════ */

export function timing(phase: TripPhase) {
  return {
    early: phase === 'booked' || phase === 'none',
    within24: phase === 'daybefore' || phase === 'travelday' || phase === 'delayed',
    airlineCancelled: phase === 'cancelled',
    outUsed: phase === 'inair' || phase === 'landed' || phase === 'home',
    allUsed: phase === 'home',
  };
}
export const freeUntil = (checkIn: string) => shortDay(addDays(checkIn, -7));

type QuoteCore = Pick<RefundQuoteItem, 'rule' | 'why' | 'askAnyway' | 'law'> & { back: Halalas };

/** What comes back if one payment is cancelled now, and why. */
export function refundRule(trip: TripDetail, p: Pick<TripPayment, 'item' | 'amount' | 'title'>): QuoteCore | null {
  const tm = timing(trip.clock.phase);
  const n = Math.max(1, trip.travellers.length);
  const paid = p.amount.amount;
  if (p.item === 'flight') {
    const out = outSegment(trip);
    if (!out) return null;
    const back = backSegment(trip);
    const R = trip.fare ?? fareRulesFor(out.carrier);
    const oneway = !back;
    const airline = out.carrierName;
    if (tm.allUsed || (oneway && tm.outUsed)) return { back: 0, rule: tk(oneway ? 'trip.rule.flight.flown' : 'trip.rule.flights.flown'), why: tk('trip.rule.flight.nothingLeft'), askAnyway: false, law: false };
    if (tm.airlineCancelled) return { back: paid, rule: tk('trip.rule.airlineCancelled', { airline }), why: tk('trip.rule.gaca'), askAnyway: false, law: true };
    const part = tm.outUsed ? 0.5 : 1;
    const legs = tk(oneway ? 'trip.legs.flight' : tm.outUsed ? 'trip.legs.back' : 'trip.legs.both');
    const taxPP = oneway ? R.taxPerPerson / 2 : R.taxPerPerson;
    if (R.refundable && R.refundFee !== null) {
      const fee = Math.round(R.refundFee * n * part);
      return {
        back: Math.max(0, Math.round(paid * part - fee)),
        rule: tk(tm.outUsed ? 'trip.rule.refundable.used' : 'trip.rule.refundable', { airline, fee: formatSar(R.refundFee, { bare: true }) }),
        why: tm.outUsed ? tk('trip.rule.refundable.usedWhy') : tk('trip.rule.refundable.why', { n, fee: sar(fee), legs }), askAnyway: false, law: false,
      };
    }
    return {
      back: Math.round(taxPP * n * part),
      rule: tk(tm.outUsed ? 'trip.rule.taxesOnly.used' : 'trip.rule.taxesOnly', { airline, tax: formatSar(taxPP, { bare: true }) }),
      why: tk('trip.rule.taxesOnly.why'), askAnyway: false, law: false,
    };
  }
  if (p.item === 'stay') {
    const st = trip.stays[0];
    if (!st) return null;
    const night = nightPrice(st);
    if (tm.allUsed) return { back: 0, rule: tk('trip.rule.stay.over'), why: tk('trip.rule.stay.overWhy'), askAnyway: false, law: false };
    if (tm.airlineCancelled) return { back: paid, rule: tk('trip.rule.freeCancelled'), why: tk('trip.rule.stay.waived'), askAnyway: false, law: false };
    if (tm.outUsed) return { back: Math.max(0, paid - night * 2), rule: tk('trip.rule.stay.used'), why: tk('trip.rule.stay.usedWhy', { nights: st.nights - 1, night: sar(night) }), askAnyway: false, law: false };
    if (tm.early) return { back: paid, rule: tk('trip.rule.stay.free', { day: freeUntil(st.checkIn) }), why: tk('trip.rule.stay.freeWhy'), askAnyway: false, law: false };
    return { back: paid - night, rule: tk('trip.rule.stay.late', { day: freeUntil(st.checkIn), night: sar(night) }), why: tk('trip.rule.stay.lateWhy'), askAnyway: false, law: false };
  }
  if (p.item === 'pickup') {
    const pk = trip.pickups[0];
    const oneway = trip.pickups.filter((x) => x.status !== 'cancelled').length < 2 || !backSegment(trip);
    if (tm.allUsed) return { back: 0, rule: tk(oneway ? 'trip.rule.pickup.bothDone' : 'trip.rule.pickup.allDone'), why: '', askAnyway: false, law: false };
    if (tm.airlineCancelled) return { back: paid, rule: tk('trip.rule.freeCancelled'), why: '', askAnyway: false, law: false };
    if (tm.outUsed && oneway) return { back: 0, rule: tk('trip.rule.pickup.bothDone'), why: '', askAnyway: false, law: false };
    if (tm.outUsed) return { back: Math.round(paid / 2), rule: tk('trip.rule.pickup.half'), why: tk('trip.rule.pickup.halfWhy'), askAnyway: false, law: false };
    if (tm.within24) return { back: 0, rule: tk('trip.rule.pickup.inside24'), why: tk('trip.rule.pickup.inside24Why', { driver: pk?.driverName ?? tk('trip.yourDriver') }), askAnyway: true, law: false };
    return { back: paid, rule: tk('trip.rule.pickup.free'), why: '', askAnyway: false, law: false };
  }
  if (p.item === 'extra') {
    if (tm.early) return { back: paid, rule: tk('trip.rule.extra.free'), why: '', askAnyway: false, law: false };
    return { back: 0, rule: tk('trip.rule.extra.inside48'), why: tk('trip.rule.extra.inside48Why'), askAnyway: true, law: false };
  }
  if (p.item === 'change') return { back: 0, rule: tk('trip.rule.change'), why: '', askAnyway: false, law: false };
  return null;
}

/** With instalments, what comes back is what was paid so far less what the rule keeps; the payments left are cancelled. */
export function refundMoney(p: Pick<TripPayment, 'amount' | 'method' | 'plan'>, back: Halalas) {
  if ((p.method === 'tabby' || p.method === 'tamara') && p.plan) {
    const paidSoFar = p.plan.filter((i) => i.paid).reduce((a, i) => a + i.amount.amount, 0);
    const keep = p.amount.amount - back;
    return { cash: Math.max(0, paidSoFar - keep), cancelled: p.amount.amount - paidSoFar, count: p.plan.filter((i) => !i.paid).length, owe: Math.max(0, keep - paidSoFar) };
  }
  return { cash: back, cancelled: 0, count: 0, owe: 0 };
}

export function refundQuoteItems(trip: TripDetail, payments: readonly TripPayment[]): RefundQuoteItem[] {
  const out: RefundQuoteItem[] = [];
  for (const p of payments) {
    const q = refundRule(trip, p);
    if (!q) continue;
    const m = refundMoney(p, q.back);
    out.push({
      paymentId: p.id, item: p.item, title: p.title, paid: p.amount, back: moneyOf(q.back), cash: moneyOf(m.cash),
      cancelled: m.count ? { count: m.count, amount: moneyOf(m.cancelled) } : null, owe: m.owe ? moneyOf(m.owe) : null,
      rule: q.rule, why: q.why, askAnyway: q.askAnyway, law: q.law, method: p.method, alreadyRefunded: !!p.refunded,
    });
  }
  return out;
}

/* ═══════════ changing a flight ═══════════ */

export const CHANGE_KINDS: { id: ChangeKind; side: 'out' | 'back' | 'any' }[] = [
  { id: 'date', side: 'out' }, { id: 'time', side: 'out' }, { id: 'return', side: 'back' }, { id: 'one', side: 'back' }, { id: 'airline', side: 'out' }, { id: 'name', side: 'any' },
];

/** Options around the booked dates, so a June trip gets June days. Differences per person, in halalas. */
export function changeOptions(kind: ChangeKind, trip: TripDetail, count: number): ChangeOption[] {
  const out = outSegment(trip);
  if (!out) return [];
  const back = backSegment(trip);
  const outDay = dayPart(out.departLocal);
  const dep = hhmm(out.departLocal);
  const num = Number(out.flightNumber.replace(/^\D+|^[A-Z0-9]{2}/, '')) || Number(out.flightNumber.slice(2));
  const iata = out.carrier;
  const dl = (d: string) => dayLabel(d, { today: d });
  const backSub = back ? tk('trip.change.backOn', { day: dl(dayPart(back.departLocal)) }) : tk('trip.change.oneWay');
  const opt = (o: Partial<ChangeOption> & Pick<ChangeOption, 'id' | 'title' | 'sub'>): ChangeOption => ({ diffPerPerson: 0, soldOut: false, say: '', movesOutDate: false, longer: false, ...o });
  if (kind === 'date') {
    return [
      opt({ id: 'dm1', title: `${dl(addDays(outDay, -1))} · ${dep}`, sub: `${tk('trip.change.dayEarlier')} ${backSub}`, diffPerPerson: 120 * SAR, say: tk('trip.change.flyOn', { day: dl(addDays(outDay, -1)) }), movesOutDate: true }),
      opt({ id: 'dp1', title: `${dl(addDays(outDay, 1))} · ${dep}`, sub: `${tk('trip.change.dayLater')} ${backSub}`, diffPerPerson: 0, say: tk('trip.change.flyOn', { day: dl(addDays(outDay, 1)) }), movesOutDate: true }),
      opt({ id: 'dp2', title: `${dl(addDays(outDay, 2))} · ${dep}`, sub: tk('trip.change.noSeats', { n: count }), soldOut: true }),
    ].filter((o) => !back || o.soldOut || addDays(outDay, o.id === 'dm1' ? -1 : 1) < dayPart(back.departLocal));
  }
  if (kind === 'time') {
    return [
      opt({ id: 't1', title: `${iata}${num - 2} · 06:30 → 10:45`, sub: tk('trip.change.early'), diffPerPerson: -380 * SAR, say: tk('trip.change.onFlight', { code: `${iata}${num - 2}`, time: '06:30' }) }),
      opt({ id: 't2', title: `${iata}${num + 4} · 18:20 → 22:35`, sub: tk('trip.change.evening'), diffPerPerson: 0, say: tk('trip.change.onFlight', { code: `${iata}${num + 4}`, time: '18:20' }) }),
    ];
  }
  if (kind === 'return' && back) {
    const bday = dayPart(back.departLocal);
    const bdep = hhmm(back.departLocal);
    const bnum = Number(back.flightNumber.slice(2));
    return [
      opt({ id: 'rm1', title: `${dl(addDays(bday, -1))} · ${bdep}`, sub: tk('trip.change.sooner'), diffPerPerson: -80 * SAR, say: tk('trip.change.homeOn', { day: dl(addDays(bday, -1)) }) }),
      opt({ id: 'rp1', title: `${dl(addDays(bday, 1))} · ${bdep}`, sub: tk('trip.change.longer'), diffPerPerson: 80 * SAR, say: tk('trip.change.homeOn', { day: dl(addDays(bday, 1)) }), longer: true }),
      opt({ id: 'rl', title: `${dl(bday)} · 21:40 · ${back.carrier}${bnum + 2}`, sub: tk('trip.change.later'), diffPerPerson: 0, say: tk('trip.change.homeAt', { time: '21:40' }) }),
    ].filter((o) => o.id !== 'rm1' || addDays(bday, -1) > outDay);
  }
  if (kind === 'one' && back) {
    const bday = dayPart(back.departLocal);
    const bdep = hhmm(back.departLocal);
    return [
      opt({ id: 'o1', title: `${dl(addDays(bday, -1))} · ${bdep}`, sub: tk('trip.change.oneSooner'), diffPerPerson: -80 * SAR, say: dl(addDays(bday, -1)) }),
      opt({ id: 'o2', title: `${dl(addDays(bday, -2))} · ${bdep}`, sub: tk('trip.change.twoSooner'), diffPerPerson: 0, say: dl(addDays(bday, -2)) }),
    ].filter((o) => (o.id === 'o1' ? addDays(bday, -1) : addDays(bday, -2)) > outDay);
  }
  return [];
}

/** Applies a chosen change to the segments: the new wall-clock times keep the same zones. */
export function applyChange(kind: ChangeKind, optionId: string, trip: TripDetail): { segmentId: string; patch: Partial<SegmentDetail> } | null {
  const out = outSegment(trip);
  const back = backSegment(trip);
  if (!out) return null;
  const shift = (local: string, days: number) => `${addDays(dayPart(local), days)}T${hhmm(local)}`;
  const at = (local: string, time: string) => `${dayPart(local)}T${time}`;
  if (kind === 'date' && (optionId === 'dm1' || optionId === 'dp1')) {
    const d = optionId === 'dm1' ? -1 : 1;
    return { segmentId: out.id, patch: { departLocal: shift(out.departLocal, d), arriveLocal: shift(out.arriveLocal, d) } };
  }
  if (kind === 'time' && (optionId === 't1' || optionId === 't2')) {
    const num = Number(out.flightNumber.slice(2));
    return optionId === 't1'
      ? { segmentId: out.id, patch: { flightNumber: `${out.carrier}${num - 2}`, departLocal: at(out.departLocal, '06:30'), arriveLocal: at(out.arriveLocal, '10:45') } }
      : { segmentId: out.id, patch: { flightNumber: `${out.carrier}${num + 4}`, departLocal: at(out.departLocal, '18:20'), arriveLocal: at(out.arriveLocal, '22:35') } };
  }
  if (kind === 'return' && back) {
    if (optionId === 'rm1' || optionId === 'rp1') {
      const d = optionId === 'rm1' ? -1 : 1;
      return { segmentId: back.id, patch: { departLocal: shift(back.departLocal, d), arriveLocal: shift(back.arriveLocal, d) } };
    }
    if (optionId === 'rl') {
      const num = Number(back.flightNumber.slice(2));
      return { segmentId: back.id, patch: { flightNumber: `${back.carrier}${num + 2}`, departLocal: at(back.departLocal, '21:40'), arriveLocal: `${addDays(dayPart(back.arriveLocal), 1)}T01:50` } };
    }
  }
  return null;
}

/** Spelling fixes only: up to 3 letters different (airlines allow small fixes, not a new name). */
export function nameDistance(a: string, b: string): number {
  const x = a.toUpperCase().replace(/[^A-Z]/g, '');
  const y = b.toUpperCase().replace(/[^A-Z]/g, '');
  const d: number[][] = Array.from({ length: x.length + 1 }, (_, i) => [i, ...Array<number>(y.length).fill(0)]);
  for (let j = 1; j <= y.length; j += 1) d[0]![j] = j;
  for (let i = 1; i <= x.length; i += 1) for (let j = 1; j <= y.length; j += 1) d[i]![j] = Math.min(d[i - 1]![j]! + 1, d[i]![j - 1]! + 1, d[i - 1]![j - 1]! + (x[i - 1] === y[j - 1] ? 0 : 1));
  return d[x.length]![y.length]!;
}

/** Other airlines Faisal can swap to: a new ticket, after a refund under the current fare's rules. */
export const SWITCH_OFFERS = [
  { key: 'sv263', carrier: 'SV', carrierName: 'Saudia', code: 'SV263', depart: '09:40', from: 'RUH', to: 'IST', perPerson: 2160 * SAR, bags: '2 × 23 kg', refund: 'Refund minus SAR 400 per person' },
  { key: 'xy125', carrier: 'XY', carrierName: 'flynas', code: 'XY125', depart: '06:15', from: 'RUH', to: 'SAW', perPerson: 1745 * SAR, bags: '1 × 20 kg', refund: 'Not refundable' },
  { key: 'tk141', carrier: 'TK', carrierName: 'Turkish Airlines', code: 'TK141', depart: '02:10', from: 'RUH', to: 'IST', perPerson: 2328 * SAR, bags: '2 × 23 kg', refund: 'Refund minus SAR 300 per person' },
] as const;

/** What the current tickets return if Faisal swaps airlines. */
export function switchCredit(trip: TripDetail): Halalas {
  const out = outSegment(trip);
  const n = Math.max(1, trip.travellers.length);
  const R = trip.fare ?? fareRulesFor(out?.carrier);
  return R.refundable && R.refundFee !== null ? Math.max(0, trip.prices.flights.amount - R.refundFee * n) : R.taxPerPerson * n;
}

/* ═══════════ disruption ═══════════ */

/** What the trip cost, for a full refund: what was charged, not a made-up figure. */
export const tripRefundAmount = (trip: TripDetail) => trip.prices.total.amount;

/** Seats Mada is holding on other flights, by kind of disruption. */
export function disruptionOptions(kind: DisruptionKind, trip: TripDetail): DisruptionOption[] {
  const out = outSegment(trip);
  if (!out) return [];
  const city = trip.city;
  const num = Number(out.flightNumber.slice(2));
  const alt = out.carrier === 'XY' ? { c: 'SV', n: 'Saudia', to: 'IST' } : { c: 'XY', n: 'flynas', to: 'SAW' };
  const altAirport = AIRPORT_NAME[alt.to] ?? alt.to;
  const refund = { id: 'refund', title: tk(kind === 'night' ? 'dz.opt.home' : kind === 'cancel' ? 'dz.opt.refund' : 'dz.opt.refund'), times: tk('dz.opt.refundTimes', { amount: sar(tripRefundAmount(trip)) }), note: tk(kind === 'night' ? 'dz.opt.homeNote' : 'dz.opt.refundNote'), carrier: null, carrierName: null, departs: null, kind: 'refund' as const };
  if (kind === 'night') {
    return [
      { id: 'morning', title: tk('dz.opt.tomorrow', { airline: out.carrierName, code: `${out.carrier}${num - 2}` }), times: tk('dz.opt.times', { dep: '07:15', arr: '11:30', airport: AIRPORT_NAME[out.to] ?? out.to }), note: tk('dz.opt.morningNote'), carrier: out.carrier, carrierName: out.carrierName, departs: '07:15', kind: 'rebook' },
      { id: 'xy', title: tk('dz.opt.tomorrow', { airline: alt.n, code: `${alt.c}127` }), times: tk('dz.opt.times', { dep: '09:50', arr: '14:30', airport: altAirport }), note: tk('dz.opt.xyNightNote'), carrier: alt.c, carrierName: alt.n, departs: '09:50', kind: 'rebook' },
      refund,
    ];
  }
  if (kind === 'cancel') {
    return [
      { id: 'next', title: tk('dz.opt.direct', { airline: out.carrierName, code: `${out.carrier}${num + 2}` }), times: tk('dz.opt.times', { dep: '13:30', arr: '17:45', airport: city }), note: tk('dz.opt.nextNote'), carrier: out.carrier, carrierName: out.carrierName, departs: '13:30', kind: 'rebook' },
      { id: 'xy', title: tk('dz.opt.direct', { airline: alt.n, code: `${alt.c}125` }), times: tk('dz.opt.times', { dep: '10:25', arr: '15:05', airport: altAirport }), note: tk('dz.opt.xyEarlierNote'), carrier: alt.c, carrierName: alt.n, departs: '10:25', kind: 'rebook' },
      refund,
    ];
  }
  return [
    { id: 'xy', title: tk('dz.opt.direct', { airline: alt.n, code: `${alt.c}125` }), times: tk('dz.opt.times', { dep: '10:25', arr: '15:05', airport: altAirport }), note: tk('dz.opt.xyNote'), carrier: alt.c, carrierName: alt.n, departs: '10:25', kind: 'rebook' },
    { id: 'stay', title: tk('dz.opt.stay', { code: out.flightNumber }), times: tk('dz.opt.stayTimes', { dep: addMinutes(hhmm(out.departLocal), 180), arr: addMinutes(hhmm(out.arriveLocal), 180) }), note: tk('dz.opt.stayNote'), carrier: out.carrier, carrierName: out.carrierName, departs: null, kind: 'stay' },
  ];
}

/** The new flight for a rebooking choice, as a patch to the outbound segment. */
export function rebookPatch(kind: DisruptionKind, optionId: string, trip: TripDetail): Partial<SegmentDetail> | null {
  const out = outSegment(trip);
  if (!out) return null;
  const num = Number(out.flightNumber.slice(2));
  const alt = out.carrier === 'XY' ? { c: 'SV', n: 'Saudia', to: 'IST' } : { c: 'XY', n: 'flynas', to: 'SAW' };
  const day = dayPart(out.departLocal);
  const next = kind === 'night' ? addDays(day, 1) : day;
  const p = (carrier: string, carrierName: string, code: string, dep: string, arr: string, to: string): Partial<SegmentDetail> => ({
    carrier, carrierName, flightNumber: code, departLocal: `${next}T${dep}`, arriveLocal: `${next}T${arr}`, to, status: 'scheduled', delayMin: null, predictedDelay: false,
    gate: null, bookedGate: null, terminal: AIRLINE_INFO[carrier]?.terminal ?? out.terminal, durationMin: Math.max(60, (Number(arr.slice(0, 2)) * 60 + Number(arr.slice(3))) - (Number(dep.slice(0, 2)) * 60 + Number(dep.slice(3)))),
  });
  if (kind === 'night' && optionId === 'morning') return p(out.carrier, out.carrierName, `${out.carrier}${num - 2}`, '07:15', '11:30', out.to);
  if (kind === 'night' && optionId === 'xy') return p(alt.c, alt.n, `${alt.c}127`, '09:50', '14:30', alt.to);
  if (kind === 'cancel' && optionId === 'next') return p(out.carrier, out.carrierName, `${out.carrier}${num + 2}`, '13:30', '17:45', out.to);
  if ((kind === 'cancel' || kind === 'delay') && optionId === 'xy') return p(alt.c, alt.n, `${alt.c}125`, '10:25', '15:05', alt.to);
  return null;
}

/* ═══════════ the itinerary ═══════════ */

export type ItineraryInput = {
  trip: TripDetail;
  /** Requests the hotel or airline confirmed, and priced extras. */
  requests: readonly TripRequestView[];
  /** First-evening picks chosen in the air. */
  picks: readonly string[];
};

const item = (o: Partial<ItineraryItem> & Pick<ItineraryItem, 'id' | 'icon' | 'kind' | 'title'>): ItineraryItem => ({
  time: null, sub: null, facts: [], tags: [], status: null, pendingText: null, warn: null, driver: null, phone: null, car: null, leg: null, ask: null, requestId: null, ...o,
});

/** The trip, day by day: every flight, pickup, night and booked extra, with gentle ideas for free days. */
export function buildItinerary({ trip, requests, picks }: ItineraryInput): ItineraryDay[] {
  const phase = trip.clock.phase;
  const tm = timing(phase);
  const dest = destinationOf(trip);
  const out = outSegment(trip);
  const back = backSegment(trip);
  const st = liveStay(trip);
  const n = Math.max(1, trip.travellers.length);
  const confirmed = requests.filter((r) => r.outcome === 'yes' || r.status === 'confirmed' || r.status === 'done');
  const tags = (...kinds: string[]) => confirmed.filter((r) => kinds.includes(r.kind)).map((r) => r.short ?? r.title);
  const R = trip.fare ?? fareRulesFor(out?.carrier);
  const outDay = out ? dayPart(out.departLocal) : st?.checkIn ?? trip.startDate;
  const backDay = back ? dayPart(back.departLocal) : null;
  const inDay = st ? st.checkIn : null;
  const stayOut = st ? stayEnd(st) : null;
  const firsts = [outDay, inDay].filter(Boolean).sort() as string[];
  const lasts = [backDay, stayOut, outDay, trip.endDate].filter(Boolean).sort() as string[];
  const first = firsts[0]!;
  const last = lasts[lasts.length - 1]!;
  const days = new Map<string, ItineraryDay>();
  for (let d = first, i = 0; d <= last && i < 40; d = addDays(d, 1), i += 1) days.set(d, { date: d, title: '', free: false, prayer: dest.prayer ? dest.prayer.split(' · ').slice(1, 4).join(' · ') : null, docs: [], items: [] });
  const add = (d: string | null, it: ItineraryItem) => { if (d && days.has(d)) days.get(d)!.items.push(it); };
  const plan = pickupPlan(trip);
  const arr = arrivalPickup(trip);
  const where = st ? st.name : trip.noStay?.address ?? null;
  const arrAirport = out ? AIRPORT_NAME[out.to] ?? out.to : '';
  const home = AIRPORT_CITY[out?.from ?? 'RUH'] ?? 'Riyadh';
  const landedOrHome = phase === 'landed' || phase === 'home';

  if (out) {
    if (plan) {
      add(plan.day, item({
        id: 'pk-home', time: plan.time, icon: 'car', kind: 'pickup', title: tk('itin.pickupHome', { driver: plan.driver }), sub: [plan.car, plan.room].filter(Boolean).join(' · '),
        driver: plan.driver, phone: plan.phone, car: plan.car, status: tm.outUsed ? 'done' : null,
        warn: plan.day !== outDay ? tk('itin.warn.pickupOld', { day: dayLabel(plan.day, { today: plan.day }), flight: dayLabel(outDay, { today: outDay }) }) : null,
      }));
    }
    add(outDay, item({
      id: 'fl-out', time: hhmm(out.departLocal), icon: 'flight', kind: 'flight', leg: 'out',
      title: tk('itin.flight', { from: AIRPORT_CITY[out.from] ?? out.from, to: AIRPORT_CITY[out.to] ?? out.to, code: out.flightNumber }),
      sub: tk('itin.flightSub', { airline: out.carrierName + (out.cabin !== 'economy' ? ` · ${cabinName(out.cabin)}` : ''), from: out.from, terminal: out.terminal ?? '', arr: hhmm(out.arriveLocal), to: out.to }),
      facts: [[tk('itin.fact.seats'), seatText(out.seats)], [tk('itin.fact.bags'), tk('itin.fact.bagsEach', { bags: R.bags })], [tk('itin.fact.boarding'), boardsAt(out)]],
      tags: tags('meal', 'wheelchair', 'seats', 'bags', 'sports'), status: tm.outUsed ? 'done' : out.status === 'cancelled' ? 'cancelled' : null,
    }));
    if (arr) {
      add(outDay, item({
        id: 'pk-arrive', time: addMinutes(hhmm(out.arriveLocal), 45), icon: 'car', kind: 'pickup', title: tk('itin.meets', { driver: arr.driverName ?? tk('trip.yourDriver'), door: arr.meetingPoint ?? '' }),
        sub: where ? tk('itin.meetsSub', { airport: arrAirport, drive: st?.fromAirport ?? durationLabel(45), place: tk(st ? 'itin.theHotel' : 'itin.yourPlace') }) : tk('itin.meetsSubNoStay', { airport: arrAirport }),
        driver: arr.driverName, phone: arr.phone, car: [arr.car, arr.plate].filter(Boolean).join(' · ') || null, status: landedOrHome ? 'done' : null,
        warn: where ? null : tk('itin.warn.noStay'),
      }));
    }
    if (!where && trip.stays.some((s) => s.status === 'cancelled')) add(outDay, item({ id: 'nostay', time: addMinutes(hhmm(out.arriveLocal), 90), icon: 'stay', kind: 'nostay', title: tk('itin.noStay'), sub: tk('itin.noStaySub') }));
    if (!st && trip.noStay) add(outDay, item({ id: 'stay-own', time: addMinutes(hhmm(out.arriveLocal), 105), icon: 'stay', kind: 'own', title: tk('itin.own', { label: trip.noStay.label }), sub: trip.noStay.address }));
  }
  if (st && inDay && stayOut) {
    const early = confirmed.find((r) => r.kind === 'times' && /early/i.test(r.short ?? ''));
    const late = confirmed.find((r) => r.kind === 'times' && /late/i.test(r.short ?? ''));
    const arriveAt = out && dayPart(out.departLocal) === inDay ? addMinutes(hhmm(out.arriveLocal), 105) : '14:00';
    const landsLater = out && dayPart(out.departLocal) > inDay;
    add(inDay, item({
      id: 'h-in', time: early ? '10:00' : arriveAt < '14:00' ? '14:00' : arriveAt, icon: 'stay', kind: 'hotel', title: tk('itin.checkIn', { name: st.name }),
      sub: tk('itin.checkInSub', { room: st.roomType ?? tk(n > 2 ? 'trip.connectingRooms' : 'trip.aRoom'), nights: st.nights }) + (early ? ` ${tk('itin.earlyCheckIn')}` : ''),
      tags: tags('celebration', 'prayer', 'room', 'bed', 'connecting'), warn: landsLater && out ? tk('itin.warn.emptyNight', { day: dayLabel(dayPart(out.departLocal), { today: dayPart(out.departLocal) }) }) : null,
    }));
    const lateUntil = late?.short?.match(/\d\d:\d\d/)?.[0];
    add(stayOut, item({
      id: 'h-out', time: lateUntil ?? '12:00', icon: 'stay', kind: 'hotel', title: tk('itin.checkOut'), sub: tk(late ? 'itin.lateCheckout' : 'itin.checkOutSub'),
      warn: backDay && stayOut < backDay ? tk(daysBetween(stayOut, backDay) === 1 ? 'itin.warn.noRoom.one' : 'itin.warn.noRoom.other', { day: dayLabel(backDay, { today: backDay }), count: daysBetween(stayOut, backDay) }) : null,
    }));
  }
  if (back && backDay) {
    const leave = addMinutes(hhmm(back.departLocal), -210);
    if (arr && trip.pickups.filter((p) => p.status !== 'cancelled').length > 1) {
      add(backDay, item({ id: 'pk-back', time: leave, icon: 'car', kind: 'pickup', title: tk('itin.toAirport', { driver: arr.driverName ?? tk('trip.yourDriver') }), sub: tk('itin.toAirportSub', { place: tk(st ? 'itin.theHotel' : 'itin.yourPlace'), drive: back.from === 'SAW' ? tk('itin.aboutHour') : durationLabel(45) }), driver: arr.driverName, phone: arr.phone }));
    }
    add(backDay, item({
      id: 'fl-back', time: hhmm(back.departLocal), icon: 'flight', kind: 'flight', leg: 'back',
      title: tk('itin.flight', { from: AIRPORT_CITY[back.from] ?? back.from, to: AIRPORT_CITY[back.to] ?? back.to, code: back.flightNumber }),
      sub: tk('itin.flightBackSub', { airline: back.carrierName, arr: hhmm(back.arriveLocal), to: back.to }),
      facts: [[tk('itin.fact.seats'), seatText(back.seats)], [tk('itin.fact.bags'), tk('itin.fact.bagsEach', { bags: R.bags })], [tk('itin.fact.boarding'), boardsAt(back)]],
      tags: tags('meal', 'wheelchair'), status: phase === 'home' ? 'done' : null,
    }));
    if (plan && homePickup(trip)) add(backDay, item({ id: 'pk-homeward', time: addMinutes(hhmm(back.arriveLocal), 30), icon: 'car', kind: 'pickup', title: tk('itin.drivesHome', { driver: plan.driver }), sub: tk('itin.drivesHomeSub'), driver: plan.driver, phone: plan.phone }));
  }
  // Booked extras: first-evening picks and priced asks.
  for (const id of picks) {
    const p = dest.picks.find((x) => x.id === id);
    if (p) add(outDay, item({ id: `pick-${id}`, time: p.time, icon: id === 'k4' ? 'stay' : 'food', kind: 'pick', title: p.title, sub: p.note, status: landedOrHome ? 'booked' : 'pending', pendingText: tk('itin.pickPending') }));
  }
  for (const r of requests.filter((x) => x.area === 'other' && ['food', 'todo', 'car'].includes(x.kind) && ['quoted', 'awaiting_payment', 'confirmed', 'done'].includes(x.status))) {
    add(outDay, item({ id: `rq-${r.id}`, time: '19:30', icon: r.kind === 'car' ? 'car' : r.kind === 'food' ? 'food' : 'star', kind: 'booked', title: r.title, sub: r.detail, status: r.status === 'quoted' || r.status === 'awaiting_payment' ? 'pending' : 'booked', pendingText: tk('itin.heldPay'), requestId: r.id }));
  }
  for (const r of confirmed.filter((x) => x.kind === 'celebration')) {
    const day = (r.detail ?? '').match(/\d{4}-\d{2}-\d{2}/)?.[0] ?? null;
    add(day ?? addDays(outDay, 2), item({ id: `cel-${r.id}`, time: '20:00', icon: 'star', kind: 'note', title: r.short ?? r.title, sub: tk('itin.celebrationSub') }));
  }
  // Free days get gentle ideas, never filler. Friday is Jumu'ah; on Sunday the Grand Bazaar is shut.
  const kids = trip.travellers.some((p) => p.birthYear !== null && p.birthYear >= new Date(trip.clock.now).getUTCFullYear() - 12);
  let k = 0;
  const lastFull = backDay ? addDays(backDay, -1) : stayOut ? addDays(stayOut, -1) : null;
  for (const day of days.values()) {
    const bookedCount = day.items.filter((i) => ['flight', 'booked', 'pick'].includes(i.kind)).length;
    if (!bookedCount && day.date !== outDay && day.date !== backDay) {
      const wd = weekdayOf(day.date);
      const ideas: { title: string; sub: string; ask: string | null }[] = wd === 'Fri' && dest.friday.length ? dest.friday.map((x) => ({ ...x, ask: null }))
        : wd === 'Sun' && dest.sunday.length ? dest.sunday.map((x) => ({ ...x, ask: null }))
          : dest.freeDays.length ? [dest.freeDays[k++ % dest.freeDays.length]!] : [];
      const label = dayLabel(day.date, { today: day.date });
      const list = ideas.map((x) => ({ title: x.title, sub: x.title === 'Basilica Cistern' && kids ? `${x.sub} ${tk('itin.kidsFish')}` : x.sub, ask: x.ask ? x.ask.replace('{day}', label) : null }));
      if (day.date === lastFull) list.push({ title: tk('itin.packTonight'), sub: back && arr ? tk('itin.packTonightPickup', { driver: arr.driverName ?? tk('trip.yourDriver'), time: addMinutes(hhmm(back.departLocal), -210) }) : tk('itin.packTonightCheckout'), ask: null });
      list.forEach((x, i) => day.items.push(item({ id: `idea-${day.date}-${i}`, icon: 'pin', kind: 'idea', title: x.title, sub: x.sub, ask: x.ask })));
    }
    day.items.sort((a, b) => ((a.time ?? '99') < (b.time ?? '99') ? -1 : (a.time ?? '99') > (b.time ?? '99') ? 1 : 0));
    const hasFlight = day.items.some((i) => i.kind === 'flight');
    day.free = !day.items.some((i) => i.kind !== 'idea' && i.kind !== 'note');
    day.title = day.date === outDay && out ? tk('itin.day.fly', { city: trip.city }) : day.date === backDay ? tk('itin.day.home') : day.free ? tk('itin.day.free') : tk('itin.day.in', { city: trip.city });
    day.docs = hasFlight
      ? [tk(n === 1 ? 'itin.docs.passport.one' : 'itin.docs.passport.other', { n }), tk('itin.docs.passes'), ...(day.date === outDay && st ? [tk('itin.docs.hotel')] : [])]
      : [tk('itin.docs.copies')];
  }
  void home;
  return [...days.values()];
}

export const cabinName = (c: string) => tk(`trip.cabin.${c}`);

/** Calendar entries for the moments that matter: flights, pickups and check-in. Free-day ideas stay out. */
export function calendarEvents(trip: TripDetail, days: readonly ItineraryDay[]): CalendarEvent[] {
  const out = outSegment(trip);
  const tz = out?.departTz ?? TZ;
  const st = liveStay(trip);
  const evs: CalendarEvent[] = [];
  for (const day of days) {
    for (const i of day.items) {
      if (!i.time || i.kind === 'idea') continue;
      const mins = i.kind === 'flight' ? (out?.durationMin ?? 240) : i.kind === 'pickup' ? 45 : 90;
      const itemTz = i.leg === 'back' || (i.kind !== 'flight' && day.date !== out?.departLocal.slice(0, 10) && day.date !== addDays(out?.departLocal.slice(0, 10) ?? day.date, -1)) ? (out?.arriveTz ?? tz) : tz;
      const start = zonedToInstant(`${day.date}T${i.time}`, i.id === 'pk-home' || i.id === 'fl-out' ? tz : itemTz);
      const end = new Date(start.getTime() + mins * 60_000);
      const key = i.kind === 'flight' || i.kind === 'pickup' || i.id === 'h-in';
      const location = i.kind === 'flight' ? (i.leg === 'back' ? `${AIRPORT_NAME[backSegment(trip)?.from ?? ''] ?? ''}` : `${AIRPORT_NAME[out?.from ?? ''] ?? ''} International Airport`) : i.kind === 'hotel' ? st?.address ?? '' : '';
      evs.push({ uid: `${i.id}-${day.date}@madatrips.sa`, title: i.title, description: i.sub ?? '', location, start: start.toISOString(), end: end.toISOString(), day: day.date, time: i.time, key });
    }
  }
  return evs;
}

/** A real calendar file (RFC 5545). */
export function buildIcs(events: readonly CalendarEvent[], name: string): string {
  const stamp = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const esc = (x: string) => x.replace(/[,;\\]/g, (c) => `\\${c}`).replace(/\n/g, '\\n');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Mada Trips//Itinerary//EN', 'CALSCALE:GREGORIAN', `X-WR-CALNAME:${esc(name)}`];
  for (const e of events) lines.push('BEGIN:VEVENT', `UID:${e.uid}`, `DTSTAMP:${stamp(e.start)}`, `DTSTART:${stamp(e.start)}`, `DTEND:${stamp(e.end)}`, `SUMMARY:${esc(e.title)}`, `DESCRIPTION:${esc(e.description)}`, ...(e.location ? [`LOCATION:${esc(e.location)}`] : []), 'END:VEVENT');
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

/** Google Calendar link for one event: works everywhere, no file needed. */
export function calendarLink(e: Pick<CalendarEvent, 'title' | 'start' | 'end' | 'description' | 'location'>): string {
  const s = (iso: string) => iso.replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodeURIComponent(e.title)}&dates=${s(e.start)}/${s(e.end)}&details=${encodeURIComponent(e.description)}&location=${encodeURIComponent(e.location)}`;
}

/** The plan as text for WhatsApp: times, flights, hotel and drivers. Never passport numbers, prices or the booking code. */
export function shareText(trip: TripDetail, days: readonly ItineraryDay[]): string {
  const lines = [tk('itin.share.head', { city: trip.city, dates: rangeLabel(trip.startDate, trip.endDate) })];
  for (const d of days) {
    const its = d.items.filter((i) => i.kind !== 'idea');
    if (!its.length) continue;
    lines.push('', `${dayLabel(d.date, { today: d.date })}`);
    for (const i of its) lines.push(`${i.time ? `${i.time}  ` : ''}${i.title}${i.sub ? ` (${i.sub})` : ''}`);
  }
  const st = liveStay(trip);
  if (st?.address) lines.push('', tk('itin.share.hotel', { name: st.name, address: st.address }));
  lines.push('', tk('itin.share.foot'));
  return lines.join('\n');
}

/** "Mon 9 – Mon 15 Mar" */
export function rangeLong(a: string, b: string | null): string {
  if (!b) return `${weekdayOf(a)} ${dayOfMonth(a)} ${monthOf(a)} · ${tk('trip.oneWay')}`;
  return monthOf(a) === monthOf(b) ? `${weekdayOf(a)} ${dayOfMonth(a)} – ${weekdayOf(b)} ${dayOfMonth(b)} ${monthOf(b)}` : `${weekdayOf(a)} ${dayOfMonth(a)} ${monthOf(a)} – ${weekdayOf(b)} ${dayOfMonth(b)} ${monthOf(b)}`;
}

/* ═══════════ invoices ═══════════ */

/** Split a VAT-inclusive line into net and VAT. Zero-rated lines carry no VAT. */
export function invoiceLine(text: string, gross: Halalas, vatRateBps: number, note: string | null = null): InvoiceLine {
  const vat = vatRateBps ? vatInside(gross, vatRateBps) : 0;
  return { text, note, gross, vatRateBps, net: gross - vat, vat };
}

/** The lines of a payment's invoice. Air fares are zero-rated (international transport); Mada's fee carries 15% VAT. */
export function invoiceLinesFor(item: TripPayment['item'], amount: Halalas, ctx: { trip: TripDetail; title: string; discount?: Halalas; label?: string; zeroRated?: boolean }): InvoiceLine[] {
  const { trip } = ctx;
  const n = Math.max(1, trip.travellers.length);
  if (item === 'flight') {
    const out = outSegment(trip);
    const back = backSegment(trip);
    const discount = ctx.discount ?? 0;
    const tickets = amount + discount - SERVICE_FEE;
    const cabin = out && out.cabin !== 'economy' ? `${cabinName(out.cabin)}, ` : '';
    const lines = [
      invoiceLine(tk('inv.line.tickets', { from: out?.from ?? '', to: out?.to ?? '', ways: tk(back ? 'inv.return' : 'inv.oneWay'), cabin, n, each: sar(Math.round(tickets / n)) }), tickets, 0, tk('inv.zeroRated')),
      invoiceLine(tk('inv.line.fee'), SERVICE_FEE, VAT_STANDARD_BPS),
    ];
    if (discount) lines.push(invoiceLine(tk('inv.line.discount'), -discount, 0, tk('inv.discountNote')));
    return lines;
  }
  if (item === 'stay') {
    const st = trip.stays[0];
    const nights = st?.nights ?? 1;
    return [invoiceLine(tk('inv.line.room', { room: tk(n > 2 ? 'trip.connectingRooms' : 'trip.aRoomCap'), nights, each: sar(Math.round(amount / nights)) }), amount, VAT_STANDARD_BPS)];
  }
  if (item === 'pickup') {
    const rides = Math.max(1, trip.pickups.length) * (backSegment(trip) && trip.pickups.length > 1 ? 2 : 1);
    return [invoiceLine(tk(rides === 1 ? 'inv.line.transfer.one' : 'inv.line.transfer.other', { count: rides }), amount, VAT_STANDARD_BPS)];
  }
  if (item === 'change') return [invoiceLine(ctx.label ?? ctx.title, amount, 0, tk('inv.changeNote'))];
  return [invoiceLine(ctx.label ?? ctx.title, amount, ctx.zeroRated ? 0 : VAT_STANDARD_BPS)];
}

/** Scale an invoice's lines for a credit note against part of it, keeping every line exact to the halala. */
export function creditLines(lines: readonly InvoiceLine[], credited: Halalas): InvoiceLine[] {
  const total = lines.reduce((a, l) => a + l.gross, 0);
  if (!total) return [];
  let left = credited;
  return lines.map((l, i) => {
    const g = i === lines.length - 1 ? left : Math.round((l.gross * credited) / total);
    left -= g;
    return invoiceLine(l.text, g, l.vatRateBps, l.note);
  });
}

/** Invoice numbers: MT (simplified), TI (tax invoice), CN (credit note), the year, a 6-digit sequence. */
export const invoiceNumber = (kind: 'simplified' | 'tax' | 'credit_note', year: number, seq: number) =>
  `${kind === 'tax' ? 'TI' : kind === 'credit_note' ? 'CN' : 'MT'}-${String(year).slice(2)}-${String(seq).padStart(6, '0')}`;

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { c -= 0; out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}
function base64(bytes: number[]): string {
  const A = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]];
    s += A[a >> 2]! + A[((a & 3) << 4) | ((b ?? 0) >> 4)]! + (b === undefined ? '=' : A[((b & 15) << 2) | ((c ?? 0) >> 6)]!) + (c === undefined ? '=' : A[c & 63]!);
  }
  return s;
}

/** The ZATCA (phase 1) QR payload: TLV of seller name, VAT number, time, total and VAT, base64-encoded. */
export function zatcaQr(o: { seller: string; vatNumber: string; issuedAt: string; total: Halalas; vat: Halalas }): string {
  const amt = (h: Halalas) => (h / 100).toFixed(2);
  const fields = [o.seller, o.vatNumber, o.issuedAt, amt(o.total), amt(o.vat)];
  const bytes: number[] = [];
  fields.forEach((f, i) => { const v = utf8(f); bytes.push(i + 1, v.length, ...v); });
  return base64(bytes);
}

const escHtml = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
const fmt2 = (h: Halalas) => (Math.abs(h) / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type InvoiceHtmlInput = {
  kind: 'simplified' | 'tax' | 'credit_note'; status: 'draft' | 'issued'; number: string; issuedAt: string; customer: string;
  company: { name: string; vat: string; cr: string; address: string } | null; lines: readonly InvoiceLine[]; againstNumber: string | null; paidWith: string | null; qr: string;
};

/** The invoice as a printable page. The app prints it to PDF; the API serves it as the document. */
export function invoiceHtml(doc: InvoiceHtmlInput): string {
  const sign = doc.kind === 'credit_note' ? '−' : '';
  const total = doc.lines.reduce((a, l) => a + l.gross, 0);
  const vat = doc.lines.reduce((a, l) => a + l.vat, 0);
  const kind = tk(`inv.kind.${doc.kind}`);
  const ar = tk(`inv.kindAr.${doc.kind}`);
  const date = `${doc.issuedAt.slice(0, 10)} ${doc.issuedAt.slice(11, 16)}`;
  const rows = doc.lines.map((l) => `<tr><td>${escHtml(l.text)}${l.note ? `<br><small>${escHtml(l.note)}</small>` : ''}</td><td>${l.vatRateBps / 100}%</td><td class="n">${l.gross < 0 ? '−' : sign}${fmt2(l.net)}</td><td class="n">${fmt2(l.vat)}</td><td class="n">${l.gross < 0 ? '−' : sign}${fmt2(l.gross)}</td></tr>`).join('');
  const buyer = doc.company
    ? `<b>${escHtml(tk('inv.buyer'))}</b> ${escHtml(doc.company.name)}<br>${escHtml(tk('inv.vatNo'))} ${escHtml(doc.company.vat)} · CR ${escHtml(doc.company.cr)}<br>${escHtml(doc.company.address)}<br>${escHtml(tk('inv.traveller'))} ${escHtml(doc.customer)}`
    : `<b>${escHtml(tk('inv.customer'))}</b> ${escHtml(doc.customer)}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escHtml(kind)} ${escHtml(doc.number)}</title>
<style>body{font:14px/1.45 -apple-system,system-ui,'Segoe UI',sans-serif;margin:36px;color:#1e352d}h1{font:400 30px Georgia,serif;margin:0}.ar{color:#4d5c55;margin:2px 0 18px}table{width:100%;border-collapse:collapse;margin:16px 0}td,th{padding:7px 6px;border-bottom:1px solid #e3dcd1;text-align:left;vertical-align:top}th{font-size:11px;letter-spacing:.06em;text-transform:uppercase;color:#5f6b65}.n{text-align:right;white-space:nowrap}small{color:#5f6b65}.tot{margin-left:auto;width:260px}.tot div{display:flex;justify-content:space-between;padding:3px 0}.draft{color:#7d5d27}.foot{color:#5f6b65;font-size:12px;margin-top:20px}</style></head><body>
<h1>${escHtml(kind)}${doc.status === 'draft' ? ` <span class="draft">· ${escHtml(tk('inv.draft'))}</span>` : ''}</h1><div class="ar" dir="rtl" lang="ar">${escHtml(ar)}</div>
<p><b>${escHtml(SELLER.legal)}</b> (${escHtml(SELLER.name)})<br>${escHtml(tk('inv.vatNo'))} ${SELLER.vat} · ${escHtml(SELLER.cr)}<br>${escHtml(SELLER.address)}</p>
<p>${escHtml(tk(doc.kind === 'credit_note' ? 'inv.cnNo' : 'inv.no'))} <b>${escHtml(doc.number)}</b> · ${escHtml(date)}${doc.againstNumber ? `<br>${escHtml(tk('inv.against'))} ${escHtml(doc.againstNumber)}` : ''}<br>${buyer}${doc.paidWith ? `<br>${escHtml(tk('inv.paidWith'))} ${escHtml(doc.paidWith)}` : ''}</p>
<table><tr><th>${escHtml(tk('inv.col.item'))}</th><th>${escHtml(tk('inv.col.rate'))}</th><th class="n">${escHtml(tk('inv.col.net'))}</th><th class="n">${escHtml(tk('inv.col.vat'))}</th><th class="n">${escHtml(tk('inv.col.total'))}</th></tr>${rows}</table>
<div class="tot"><div><span>${escHtml(tk('inv.beforeVat'))}</span><span>${sign}${fmt2(total - vat)}</span></div><div><span>${escHtml(tk('inv.vat15'))}</span><span>${sign}${fmt2(vat)}</span></div><div><b>${escHtml(tk('inv.total'))}</b><b>${sign}SAR ${fmt2(total)}</b></div></div>
<p class="foot">${escHtml(tk('inv.foot'))}<br>QR (ZATCA TLV): ${escHtml(doc.qr)}</p></body></html>`;
}

/* ═══════════ asks from the trip: special requests, hotel options and the rest ═══════════ */

export type AskSpec = {
  area: 'special' | 'hotel' | 'other';
  kind: string;
  title: string;
  short: string;
  detail: string | null;
  withWhom: 'airline' | 'hotel' | 'faisal';
  withName: string | null;
  /** A price Faisal confirms first (paid through Requests). */
  quote: Halalas | null;
  quoteText: string | null;
  vatRateBps: number;
  /** The scripted answer the mock desk gives (the real desk decides in Ops). */
  outcome: 'yes' | 'no';
  alt: string | null;
  yesText: string | null;
};

export type AskInput = { area: 'special' | 'hotel' | 'other'; kind: string; option?: string; travellerIds?: readonly string[]; count?: number; day?: string; note?: string };

export const ESIM_PRICE: Halalas = 39 * SAR;
/** A Mada pickup booked on landing: the airport ride only. */
export const ARRIVAL_PICKUP_PRICE: Halalas = 220 * SAR;
export const ROOM_OPTIONS = [
  { id: 'family', perNight: 220 * SAR }, { id: 'view', perNight: 380 * SAR }, { id: 'two', perNight: -120 * SAR },
] as const;

/** Works out the words, who Faisal asks and any price for an ask. Returns a reason when the ask doesn't apply. */
export function askSpec(trip: TripDetail, a: AskInput): AskSpec | { problem: string } {
  const out = outSegment(trip);
  const back = backSegment(trip);
  const st = liveStay(trip);
  const R = trip.fare ?? fareRulesFor(out?.carrier);
  const airline = out?.carrierName ?? tk('trip.theAirline');
  const who: TripTraveller[] = a.travellerIds?.length ? trip.travellers.filter((p) => a.travellerIds!.includes(p.id)) : trip.travellers;
  const all = !a.travellerIds?.length || who.length === trip.travellers.length;
  const whoTxt = all ? tk('sr.everyone') : joinPeople(who.map((p) => p.firstName));
  const legs = tk(back ? 'sr.bothFlights' : 'sr.theFlight');
  const base = { area: a.area, kind: a.kind, detail: null, withName: null, quote: null, quoteText: null, vatRateBps: VAT_STANDARD_BPS, outcome: 'yes' as const, alt: null, yesText: null };
  const needsFlight = ['wheelchair', 'meal', 'bassinet', 'seats', 'bags', 'sports'];
  if (a.area === 'special' && needsFlight.includes(a.kind) && !out) return { problem: tk('sr.noFlights', { airline }) };
  if (a.area === 'hotel' && !st) return { problem: tk('ho.none') };
  const nowYear = new Date(trip.clock.now).getUTCFullYear();
  switch (a.kind) {
    case 'wheelchair': {
      const opt = a.option === 'seat' ? 'seat' : a.option === 'own' ? 'own' : 'gate';
      return { ...base, title: tk(`sr.wheelchair.title.${opt}`) + (all ? '' : ` · ${whoTxt}`), short: tk('sr.wheelchair.short', { who: whoTxt }), detail: legs, withWhom: 'airline', withName: airline };
    }
    case 'meal': {
      const opt = ['child', 'veg', 'diabetic', 'gluten'].includes(a.option ?? '') ? a.option! : 'veg';
      const kids = who.filter((p) => p.birthYear !== null && p.birthYear > nowYear - 12);
      if (opt === 'child' && !kids.length) return { problem: tk('sr.meal.childOnly') };
      const label = tk(`sr.meal.${opt}`);
      return { ...base, title: `${label} · ${opt === 'child' ? joinPeople(kids.map((p) => p.firstName)) : whoTxt}`, short: label, detail: legs, withWhom: 'airline', withName: airline };
    }
    case 'bassinet': {
      const baby = trip.travellers.some((p) => p.birthYear !== null && p.birthYear >= nowYear - 2);
      if (!baby) return { problem: tk('sr.bassinet.none') };
      return { ...base, title: tk('sr.bassinet.title'), short: tk('sr.bassinet.short'), detail: legs, withWhom: 'airline', withName: airline, outcome: 'no', alt: tk('sr.bassinet.alt') };
    }
    case 'seats': {
      const keep = a.option !== 'kids';
      return { ...base, title: keep ? tk(back ? 'sr.seats.keepBoth' : 'sr.seats.keep') : tk('sr.seats.kids'), short: tk('sr.seats.short'), detail: legs, withWhom: 'airline', withName: airline, outcome: out?.carrier === 'XY' ? 'no' : 'yes', alt: tk('sr.seats.alt') };
    }
    case 'celebration': {
      const what = ['Birthday', 'Anniversary', 'Something else'].includes(a.option ?? '') ? a.option! : 'Birthday';
      const day = a.day ?? addDays(trip.startDate, 2);
      return { ...base, title: `${tk(`sr.celebration.${what === 'Something else' ? 'else' : what.toLowerCase()}`)} · ${dayLabel(day, { today: day })}`, short: tk(`sr.celebration.${what === 'Something else' ? 'else' : what.toLowerCase()}`) + (all ? '' : ` · ${whoTxt}`), detail: `${a.note || tk('sr.celebration.note')} · ${day}`, withWhom: 'hotel' };
    }
    case 'prayer':
      return { ...base, title: tk('sr.prayer.title'), short: tk('sr.prayer.short'), detail: st?.name ?? tk('sr.hotel'), withWhom: 'hotel' };
    case 'bags': {
      const count = Math.max(1, Math.min(a.count ?? 1, (all ? trip.travellers.length : who.length) * 2));
      const legsN = back ? 2 : 1;
      const price = R.bagFee * count * legsN;
      return { ...base, title: tk(count === 1 ? 'sr.bags.title.one' : 'sr.bags.title.other', { count }) + (legsN === 2 ? `, ${tk('sr.bags.bothWays')}` : ''), short: tk('sr.bags.short'), detail: `${airline} · ${R.bagKg} kg`, withWhom: 'airline', withName: airline, quote: price, vatRateBps: 0, quoteText: tk(count === 1 ? 'sr.bags.quote.one' : 'sr.bags.quote.other', { airline, count, kg: R.bagKg, both: legsN === 2 ? `, ${tk('sr.bags.bothWays')}` : '', price: sar(price) }) };
    }
    case 'sports': {
      const opt = a.option === 'bike' ? 'bike' : a.option === 'ski' ? 'ski' : 'golf';
      return { ...base, title: tk(`sr.sports.${opt}`) + (all ? '' : ` · ${whoTxt}`), short: tk(`sr.sports.short.${opt}`), detail: legs, withWhom: 'airline', withName: airline, outcome: opt === 'bike' ? 'no' : 'yes', alt: tk('sr.sports.alt', { airline }) };
    }
    case 'pet':
      return { problem: tk('sr.pet.no', { airline }) };
    case 'room': {
      const r = ROOM_OPTIONS.find((x) => x.id === a.option);
      if (!r || !st) return { problem: tk('ho.pickRoom') };
      const diff = r.perNight * st.nights;
      const title = tk(`ho.room.${r.id}`);
      return diff > 0
        ? { ...base, title: tk('ho.instead', { title }), short: tk('ho.short.room'), detail: tk('ho.nightsAt', { name: st.name, nights: st.nights }), withWhom: 'hotel', quote: diff, quoteText: tk('ho.room.quote', { room: title.toLowerCase(), nights: st.nights, price: sar(diff) }) }
        : { ...base, title: tk('ho.instead', { title }), short: title, detail: tk('ho.backOnce', { amount: sar(-diff) }), withWhom: 'hotel', yesText: tk('ho.refundOnWay', { amount: sar(-diff) }) };
    }
    case 'nights': {
      if (!st) return { problem: tk('ho.none') };
      const night = nightPrice(st);
      const last = stayEnd(st);
      if (a.option === 'add') return { ...base, title: tk('ho.nights.addTitle', { day: dayLabel(addDays(last, 1), { today: last }) }), short: tk('ho.short.night'), detail: st.name, withWhom: 'hotel', quote: night, quoteText: tk('ho.nights.quote', { day: dayLabel(addDays(last, 1), { today: last }), price: sar(night) }) };
      return { problem: tk('ho.nights.cutHere') };
    }
    case 'times': {
      const night = nightPrice(st!);
      const half = Math.round(night / 2);
      const o = a.option ?? 'late-free';
      if (o === 'early-free') return { ...base, title: tk('ho.times.earlyFree'), short: tk('ho.short.early'), detail: st!.name, withWhom: 'hotel', outcome: 'no', alt: tk('ho.times.earlyNo') };
      if (o === 'early-paid') return { ...base, title: tk('ho.times.earlyPaid'), short: tk('ho.short.early'), detail: st!.name, withWhom: 'hotel', quote: half, quoteText: tk('ho.times.quote', { what: tk('ho.times.earlyPaid').toLowerCase(), price: sar(half) }) };
      if (o === 'late-paid') return { ...base, title: tk('ho.times.latePaid'), short: tk('ho.short.late', { time: '18:00' }), detail: st!.name, withWhom: 'hotel', quote: half, quoteText: tk('ho.times.quote', { what: tk('ho.times.latePaid').toLowerCase(), price: sar(half) }) };
      return { ...base, title: tk('ho.times.lateFree'), short: tk('ho.short.late', { time: '14:00' }), detail: st!.name, withWhom: 'hotel' };
    }
    case 'bed': {
      if (a.option === 'cot') {
        const baby = trip.travellers.some((p) => p.birthYear !== null && p.birthYear >= nowYear - 2);
        if (!baby) return { problem: tk('ho.bed.noBaby') };
        return { ...base, title: tk('ho.bed.cot'), short: tk('ho.bed.cotShort'), detail: st!.name, withWhom: 'hotel' };
      }
      const price = 150 * SAR * st!.nights;
      return { ...base, title: tk('ho.bed.extra'), short: tk('ho.short.bed'), detail: tk('ho.nightsAt', { name: st!.name, nights: st!.nights }), withWhom: 'hotel', quote: price, quoteText: tk('ho.bed.quote', { price: sar(price), nights: st!.nights }) };
    }
    case 'connecting':
      return { ...base, title: tk('ho.connecting'), short: tk('ho.connecting'), detail: st!.name, withWhom: 'hotel' };
    case 'esim': {
      const count = Math.max(1, Math.min(a.count ?? trip.travellers.length, 12));
      const price = ESIM_PRICE * count;
      return { ...base, title: tk('td.esim.title', { country: destinationOf(trip).country }), short: tk('td.esim.short', { count }), detail: tk('td.esim.detail'), withWhom: 'faisal', quote: price, quoteText: tk('td.esim.quote', { count, price: sar(price) }) };
    }
    case 'pickup': {
      const price = ARRIVAL_PICKUP_PRICE;
      return { ...base, title: tk('as.pickupTitle'), short: tk('as.pickupShort'), detail: tk('as.pickupDetail', { airport: AIRPORT_NAME[out?.to ?? ''] ?? trip.city }), withWhom: 'faisal', quote: price, quoteText: tk('as.pickupQuote', { price: sar(price) }) };
    }
    case 'call':
      return { ...base, title: tk('cf.callTitle'), short: tk('cf.callShort'), detail: out ? tk('cf.callDetail', { code: out.flightNumber }) : null, withWhom: 'faisal', yesText: tk('cf.callYes') };
    case 'wider':
      return { ...base, title: tk('cf.widerTitle'), short: tk('cf.widerShort'), detail: out ? tk('cf.widerDetail', { code: out.flightNumber, day: dayLabel(dayPart(out.departLocal), { today: dayPart(out.departLocal) }) }) : null, withWhom: 'faisal', yesText: tk('cf.widerYes') };
    case 'reissue':
      return { ...base, title: tk('inv.reissueTitle'), short: tk('inv.reissueShort'), detail: trip.company?.name ?? null, withWhom: 'faisal', yesText: tk('inv.reissueYes') };
    default:
      return { problem: tk('error.validation') };
  }
}

/**
 * The mock desk: how a request moves when nobody in Ops is driving it (mock mode and the in-app demo).
 * Sent for 5 seconds, then Faisal asks, then the answer at 12 seconds.
 */
export function deskStatus(createdAtMs: number, nowMs: number, outcome: 'yes' | 'no', withWhom: 'airline' | 'hotel' | 'faisal'): 'sent' | 'reviewing' | 'confirmed' | 'done' | 'cancelled' {
  const age = nowMs - createdAtMs;
  if (age < 5000) return 'sent';
  if (age < 12000) return 'reviewing';
  if (outcome === 'no') return 'cancelled';
  return withWhom === 'faisal' ? 'done' : 'confirmed';
}

/** How the request reads on its pill. */
export function requestLabel(r: Pick<TripRequestView, 'status' | 'withWhom' | 'withName' | 'outcome'>, agent: string): string {
  const who = r.withName ?? tk(`trip.with.${r.withWhom}`);
  switch (r.status) {
    case 'queued': return tk('rq.queued');
    case 'sent': return tk('rq.sent');
    case 'reviewing': case 'with_agent': return r.withWhom === 'faisal' ? tk('rq.onIt', { agent }) : tk('rq.asking', { agent, who });
    case 'needs_answer': return tk('rq.needsAnswer');
    case 'quoted': case 'awaiting_payment': return tk('rq.priceReady');
    case 'confirmed': return r.withWhom === 'faisal' ? tk('rq.done') : tk('rq.confirmedBy', { who });
    case 'done': return tk('rq.done');
    case 'cancelled': return r.outcome === 'no' ? tk('rq.cant') : tk('rq.cancelled');
    default: return '';
  }
}

/* ═══════════ readiness, packing and arrival (the Today phases) ═══════════ */

/** Passport validity against the destination's rule. Worked out from the real dates. */
export function passportIssue(trip: TripDetail, p: TripTraveller): { blocking: boolean; text: string } | null {
  const dest = destinationOf(trip);
  const out = outSegment(trip);
  const land = out ? dayPart(out.arriveLocal) : liveStay(trip)?.checkIn ?? trip.startDate;
  if (!p.passportExpiry) return null;
  const need = addDays(land, dest.validityDays);
  const left = daysBetween(land, p.passportExpiry);
  if (left < dest.validityDays) return { blocking: true, text: tk('td.pp.blocking', { name: p.firstName, date: `${dayOfMonth(p.passportExpiry)} ${monthOf(p.passportExpiry)} ${p.passportExpiry.slice(0, 4)}`, country: dest.country, days: dest.validityDays, need: shortDay(need) }) };
  if (left < dest.validityDays + 30) return { blocking: false, text: tk('td.pp.fine', { city: dest.city, country: dest.country, days: dest.validityDays, name: p.firstName, left }) };
  return null;
}

/** Plain helpers the app's screens share with the server's words. */
export const tripWords = { tn, durationLabel, rangeLabel, bps };
