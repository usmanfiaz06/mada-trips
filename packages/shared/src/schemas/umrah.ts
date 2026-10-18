/*
 * Umrah, planned around the permit (the Nusuk day and time slot): where to stay in Makkah by how far it is from the
 * Haram, Madinah before or after, the Haramain train between them, the flights, and the last ten nights of Ramadan
 * said plainly. The app shows these prices as it plans; the desk quotes from the same table. Pure functions, no I/O.
 */
import { t, tn } from '../copy';
import { addDays, dayLabel } from '../dates';
import { formatSar, sarToHalalas } from '../money';
import type { Lang } from '../locale';
import { CATALOGUE_HOTELS, SMALL_ROOM_FACTOR } from './booking-data';
import { commaList } from './booking-words';

/** How far from the Haram (or the Prophet's Mosque): steps away, a 5–10 minute walk, or the hotel's shuttle. */
export type UmrahBand = 'steps' | 'walk' | 'shuttle';
export type UmrahCity = 'makkah' | 'madinah';
export type UmrahHotel = {
  key: string; city: UmrahCity; band: UmrahBand; name: string; area: string;
  /** Minutes on foot (steps, walk) or by the shuttle. */
  minutes: number;
  /** A family room (connecting rooms for more than two), per night, riyals; two or fewer pay SMALL_ROOM_FACTOR of it. */
  nightSar: number; rating: number; address: string; note: string; lat: number; lng: number;
};

export const UMRAH_BANDS: UmrahBand[] = ['steps', 'walk', 'shuttle'];

/** The hotels Mada books for Umrah (mock catalogue; the desk confirms the live price). */
export const UMRAH_HOTELS: UmrahHotel[] = [
  { key: 'raffles-makkah', city: 'makkah', band: 'steps', name: 'Raffles Makkah Palace', area: 'Abraj Al Bait', minutes: 1, nightSar: 2400, rating: 9.3, address: 'Abraj Al Bait, King Abdul Aziz Endowment, Makkah', note: 'Butler on every floor. Haram view rooms.', lat: 21.4191, lng: 39.8259 },
  { key: 'swissotel-makkah', city: 'makkah', band: 'steps', name: 'Swissôtel Makkah', area: 'Abraj Al Bait', minutes: 2, nightSar: 1650, rating: 8.9, address: 'Abraj Al Bait, Ajyad Street, Makkah', note: 'Straight into the courtyard from the lobby.', lat: 21.4187, lng: 39.8262 },
  { key: 'hilton-suites-makkah', city: 'makkah', band: 'walk', name: 'Hilton Suites Makkah', area: 'Jabal Omar', minutes: 6, nightSar: 980, rating: 8.7, address: 'Jabal Omar, Ibrahim Al Khalil Road, Makkah', note: 'Suites with a kitchenette. Flat walk to the Haram.', lat: 21.4197, lng: 39.8222 },
  { key: 'conrad-makkah', city: 'makkah', band: 'walk', name: 'Conrad Makkah', area: 'Jabal Omar', minutes: 8, nightSar: 1100, rating: 8.8, address: 'Jabal Omar, Makkah', note: 'Quiet floors, family rooms.', lat: 21.4203, lng: 39.8210 },
  { key: 'kiswa-towers', city: 'makkah', band: 'shuttle', name: 'Kiswa Towers Hotel', area: 'Ibrahim Al Khalil Road', minutes: 12, nightSar: 520, rating: 8.1, address: 'Ibrahim Al Khalil Road, Misfalah, Makkah', note: 'Shuttle to the Haram round the clock.', lat: 21.4021, lng: 39.8189 },
  { key: 'le-meridien-makkah', city: 'makkah', band: 'shuttle', name: 'Le Méridien Makkah', area: 'Ibrahim Al Khalil Road', minutes: 10, nightSar: 640, rating: 8.3, address: 'Ibrahim Al Khalil Road, Makkah', note: 'Shuttle every 15 minutes. Larger rooms.', lat: 21.4078, lng: 39.8204 },
  { key: 'oberoi-madinah', city: 'madinah', band: 'steps', name: 'The Oberoi Madinah', area: 'Central area, north', minutes: 1, nightSar: 1500, rating: 9.2, address: 'Abdul Aziz Al Awwal Road, Central Area, Madinah', note: 'Facing the north gates of the mosque.', lat: 24.4691, lng: 39.6109 },
  { key: 'anwar-movenpick', city: 'madinah', band: 'steps', name: 'Anwar Al Madinah Mövenpick', area: 'Central area, west', minutes: 2, nightSar: 1150, rating: 8.8, address: 'Central Area, Madinah', note: 'Family rooms, a short walk to the women’s gates.', lat: 24.4698, lng: 39.6101 },
  { key: 'pullman-zamzam-madinah', city: 'madinah', band: 'walk', name: 'Pullman Zamzam Madinah', area: 'Central area, south', minutes: 6, nightSar: 720, rating: 8.5, address: 'Amr Bin Al Gamouh Street, Madinah', note: 'Breakfast included.', lat: 24.4652, lng: 39.6140 },
  { key: 'dar-al-hijra', city: 'madinah', band: 'walk', name: 'Dar Al Hijra InterContinental', area: 'Central area, east', minutes: 9, nightSar: 610, rating: 8.4, address: 'King Faisal Road, Madinah', note: 'Quiet rooms, good value.', lat: 24.4712, lng: 39.6172 },
];

export const umrahHotel = (key: string | null | undefined) => UMRAH_HOTELS.find((h) => h.key === key) ?? null;
export const umrahHotelsIn = (city: UmrahCity, band: UmrahBand) => UMRAH_HOTELS.filter((h) => h.city === city && h.band === band);

/** The rest of the plan, per person (riyals): the Haramain train one way, flights there and back; children under 12 at 75%, babies at 10%. */
/**
 * Where a pilgrim can fly from: every Saudi airport with flights to Jeddah (or Madinah), with the return fare per person
 * and the morning flight Mada books first (mock schedule; the desk confirms). From Jeddah, Makkah or Taif it's a drive.
 */
export const UMRAH_FROM: readonly { code: string; city: string; sar: number; airline: string; flight: string; dep: string }[] = [
  { code: 'RUH', city: 'Riyadh', sar: 1100, airline: 'Saudia', flight: 'SV 1022', dep: '08:15' },
  { code: 'DMM', city: 'Dammam', sar: 1250, airline: 'Saudia', flight: 'SV 1112', dep: '07:30' },
  { code: 'AHB', city: 'Abha', sar: 690, airline: 'Saudia', flight: 'SV 1806', dep: '10:20' },
  { code: 'TUU', city: 'Tabuk', sar: 780, airline: 'flynas', flight: 'XY 133', dep: '09:05' },
  { code: 'ELQ', city: 'Qassim', sar: 820, airline: 'Saudia', flight: 'SV 1342', dep: '06:50' },
  { code: 'GIZ', city: 'Jazan', sar: 650, airline: 'Saudia', flight: 'SV 1716', dep: '13:10' },
  { code: 'HAS', city: 'Hail', sar: 760, airline: 'flynas', flight: 'XY 381', dep: '11:15' },
];
export const umrahFrom = (code: string | null | undefined) => UMRAH_FROM.find((f) => f.code === code) ?? null;
/** A car between Jeddah airport and a Makkah hotel, one way (riyals), for the whole party. */
export const UMRAH_TRANSFER_SAR = 280;
export const UMRAH_PRICES = { train: 250, flight: Object.fromEntries(UMRAH_FROM.map((f) => [f.code, f.sar])) as Record<string, number> };
export const UMRAH_TRAIN_MIN = 140;

/** Ramadan by the Umm al-Qura calendar: the first day and the day of Eid al-Fitr. */
export const RAMADAN: { start: string; eid: string }[] = [
  { start: '2026-02-18', eid: '2026-03-20' }, { start: '2027-02-08', eid: '2027-03-09' },
  { start: '2028-01-28', eid: '2028-02-26' }, { start: '2029-01-16', eid: '2029-02-14' },
];
/** The next Ramadan that hasn't ended. */
export const nextRamadan = (today: string) => RAMADAN.find((r) => r.eid > today) ?? RAMADAN[RAMADAN.length - 1]!;
/** The nights of the last ten: the 21st night (the evening of the 20th) to the night before Eid. */
export const lastTenOf = (r: { start: string; eid: string }) => ({ from: addDays(r.start, 19), to: addDays(r.eid, -1) });

/** Any night between check-in and check-out (or the one day) falls in the last ten nights of a Ramadan. */
export function inLastTen(from: string | null | undefined, to?: string | null): boolean {
  if (!from) return false;
  const end = to && to > from ? addDays(to, -1) : from;
  return RAMADAN.some((r) => { const w = lastTenOf(r); return from <= w.to && end >= w.from; });
}

/** "Before Fajr" and "Morning" slots check in the day before; afternoon and evening the same day. */
export const UMRAH_SLOTS = ['Before Fajr', 'Morning', 'Afternoon', 'Evening'] as const;
export const checkInFor = (permitDay: string, slot: string | null | undefined) => (slot === 'Before Fajr' || slot === 'Morning' ? addDays(permitDay, -1) : permitDay);

/** When, without a permit: the first days of Ramadan, the last ten nights, after Eid. */
export const UMRAH_WHEN = ['Early Ramadan', 'The last ten nights', 'After Eid'] as const;
export function checkInForWhen(when: string, today: string): string | null {
  const r = nextRamadan(today);
  const day = when === 'Early Ramadan' ? addDays(r.start, 1) : when === 'The last ten nights' ? lastTenOf(r).from : when === 'After Eid' ? addDays(r.eid, 4) : null;
  return day && day > today ? day : day ? addDays(today, 14) : null;
}

/** Fly into Madinah when Madinah comes first, else Jeddah; home from wherever the trip ends. */
export function umrahAirports(madinah: 'before' | 'after' | null) {
  return { into: madinah === 'before' ? 'MED' : 'JED', home: madinah === 'after' ? 'MED' : 'JED' };
}

export type UmrahPlanInput = {
  /** The Makkah check-in (the permit decides it). */
  checkIn: string; makkah: { key: string; nights: number }; madinah: { key: string; nights: number; order: 'before' | 'after' } | null;
  flyFrom: string | null; ages: number[];
};
export type UmrahPlanLine = { k: 'makkah' | 'madinah' | 'train' | 'flights' | 'transfer'; sar: number };
export type UmrahPlan = {
  lines: UmrahPlanLine[]; totalSar: number; perPerson: { train: number; flights: number }[];
  dates: { makkahIn: string; makkahOut: string; madinahIn: string | null; madinahOut: string | null; leave: string; home: string };
};

const share = (age: number) => (age < 2 ? 0.1 : age < 12 ? 0.75 : 1);

/** One hotel's price for the nights and the party: a family room for more than two, a smaller share for two or one. */
export const umrahStaySar = (h: UmrahHotel, nights: number, guests: number) => Math.round(h.nightSar * nights * (guests > 2 ? 1 : SMALL_ROOM_FACTOR));

/** The whole plan priced: rooms per hotel, the train and the flights per person, and each day of it. */
export function umrahPlan(p: UmrahPlanInput): UmrahPlan | null {
  const mk = umrahHotel(p.makkah.key);
  if (!mk) return null;
  const md = p.madinah ? umrahHotel(p.madinah.key) : null;
  const guests = Math.max(1, p.ages.filter((a) => a >= 2).length);
  const ages = p.ages.length ? p.ages : [30];
  // The Makkah check-in is fixed by the permit: Madinah before it ends that day, Madinah after it starts when Makkah ends.
  const makkahIn = p.checkIn;
  const makkahOut = addDays(makkahIn, p.makkah.nights);
  const madinahIn = md ? (p.madinah!.order === 'before' ? addDays(makkahIn, -p.madinah!.nights) : makkahOut) : null;
  const madinahOut = md && madinahIn ? addDays(madinahIn, p.madinah!.nights) : null;
  const home = [makkahOut, madinahOut].filter((x): x is string => !!x).sort().at(-1)!;
  const leave = [makkahIn, madinahIn].filter((x): x is string => !!x).sort()[0]!;
  const fare = p.flyFrom ? UMRAH_PRICES.flight[p.flyFrom] ?? 0 : 0;
  const perPerson = ages.map((a) => ({ train: md ? Math.round(UMRAH_PRICES.train * (a < 2 ? 0 : share(a))) : 0, flights: Math.round(fare * share(a)) }));
  const lines: UmrahPlanLine[] = [{ k: 'makkah', sar: umrahStaySar(mk, p.makkah.nights, guests) }];
  if (md) lines.push({ k: 'madinah', sar: umrahStaySar(md, p.madinah!.nights, guests) });
  if (md) lines.push({ k: 'train', sar: perPerson.reduce((a, b) => a + b.train, 0) });
  if (fare) lines.push({ k: 'flights', sar: perPerson.reduce((a, b) => a + b.flights, 0) });
  // Flying in or out of Jeddah means a car between the airport and Makkah: in, unless Madinah comes first; out, unless it ends in Madinah.
  const legs = fare ? (p.madinah?.order === 'before' && md ? 0 : 1) + (p.madinah?.order === 'after' && md ? 0 : 1) : 0;
  if (legs) lines.push({ k: 'transfer', sar: UMRAH_TRANSFER_SAR * legs });
  return { lines, totalSar: lines.reduce((a, b) => a + b.sar, 0), perPerson, dates: { makkahIn, makkahOut, madinahIn, madinahOut, leave, home } };
}

/** The plan as stored on the request (the desk reads these English answers). */
export function umrahPlanOfAnswers(a: Record<string, string[]>, ages: number[]): UmrahPlan | null {
  const checkIn = a.checkIn?.[0];
  const mk = a.makkahHotel?.[0];
  if (!checkIn || !mk) return null;
  const mdKey = a.madinahHotel?.[0];
  const order = a.madinah?.[0] === 'after' ? 'after' : 'before';
  return umrahPlan({
    checkIn, makkah: { key: mk, nights: Number(a.makkahNights?.[0]) || 3 },
    madinah: mdKey ? { key: mdKey, nights: Number(a.madinahNights?.[0]) || 2, order } : null,
    flyFrom: a.flyFrom?.[0] && a.flyFrom[0] !== 'none' ? a.flyFrom[0] : null, ages,
  });
}

const sar = (n: number, l?: Lang) => formatSar(sarToHalalas(Math.round(n)), { locale: l });

/** The permit as said back: "Permit Mon 1 Mar, Morning", or that Mada is helping get one. */
export function umrahPermitLine(a: Record<string, string[]>, l?: Lang): string | null {
  const p = a.permit?.[0];
  const day = a.permitDay?.[0];
  if (p === 'has' && day) return t('umrah.sum.permit', { day: dayLabel(day, { locale: l, hijri: false }), slot: slotLabel(a.permitSlot?.[0], l) }, l);
  if (p === 'has') return t('umrah.sum.permitHas', undefined, l);
  if (p === 'help') return t('umrah.sum.permitHelp', undefined, l);
  if (p === 'self') return t('umrah.sum.permitSelf', undefined, l);
  return null;
}

const SLOT_KEYS = { 'Before Fajr': 'umrah.slot.night', Morning: 'umrah.slot.morning', Afternoon: 'umrah.slot.afternoon', Evening: 'umrah.slot.evening' } as const;
export const slotLabel = (slot: string | null | undefined, l?: Lang) => (slot && slot in SLOT_KEYS ? t(SLOT_KEYS[slot as keyof typeof SLOT_KEYS], undefined, l) : slot ?? '');

/** "Swissôtel Makkah, 3 nights" */
export const umrahStayLine = (key: string | null | undefined, nights: number, l?: Lang) => {
  const h = umrahHotel(key);
  return h ? t('umrah.sum.stay', { hotel: h.name, nights: tn('umrah.nights', nights, undefined, l) }, l) : '';
};

/** The request's summary for the desk, Trips and the thread: permit, Makkah, Madinah, the train, flights, who. */
export function umrahSummary(a: Record<string, string[]>, names: string, needSummary: string, l?: Lang): string {
  const mk = umrahStayLine(a.makkahHotel?.[0], Number(a.makkahNights?.[0]) || 3, l);
  const md = a.madinahHotel?.[0] ? umrahStayLine(a.madinahHotel[0], Number(a.madinahNights?.[0]) || 2, l) : '';
  const stays = a.madinah?.[0] === 'before' ? [md, mk] : [mk, md];
  const from = a.flyFrom?.[0];
  return [umrahPermitLine(a, l) ?? '', a.checkIn?.[0] ? t('umrah.sum.from', { day: dayLabel(a.checkIn[0], { locale: l, hijri: false }) }, l) : '',
    ...stays, md ? t('umrah.sum.train', undefined, l) : '',
    from ? (from === 'none' ? t('umrah.sum.drive', undefined, l) : t('umrah.sum.fly', { city: umrahFrom(from)?.city ?? from }, l)) : '',
    names, needSummary].filter(Boolean).join(' · ');
}

/** The desk's quote for a planned Umrah: rooms per hotel, the train and flights per person, the permit said back. */
export function umrahDeskQuote(a: Record<string, string[]>, who: { id: string; name: string; age: number }[], l?: Lang) {
  const plan = umrahPlanOfAnswers(a, who.map((p) => p.age));
  if (!plan) return null;
  const mkNights = Number(a.makkahNights?.[0]) || 3;
  const mdNights = Number(a.madinahNights?.[0]) || 2;
  const rooms = { personId: null, name: t('dq.umrah.rooms', undefined, l), lines: plan.lines.filter((x) => x.k === 'makkah' || x.k === 'madinah').map((x) => ({
    label: umrahStayLine(x.k === 'makkah' ? a.makkahHotel?.[0] : a.madinahHotel?.[0], x.k === 'makkah' ? mkNights : mdNights, l), sar: x.sar,
  })) };
  const people = who.map((p, i) => ({ personId: p.id, name: p.name, lines: [
    ...(plan.perPerson[i]?.flights ? [{ label: t('dq.umrah.flights', undefined, l), sar: plan.perPerson[i]!.flights }] : []),
    ...(plan.perPerson[i]?.train ? [{ label: t('dq.umrah.train', undefined, l), sar: plan.perPerson[i]!.train }] : []),
  ] })).filter((p) => p.lines.length);
  const transfer = plan.lines.find((x) => x.k === 'transfer');
  const car = transfer ? [{ personId: null, name: t('dq.umrah.transfer', undefined, l), lines: [{ label: t('umrah.transfer', undefined, l), sar: transfer.sar }] }] : [];
  const hotels = commaList([umrahHotel(a.makkahHotel?.[0])?.name, umrahHotel(a.madinahHotel?.[0])?.name].filter((x): x is string => !!x), l);
  const permit = a.permit?.[0] === 'has' && a.permitDay?.[0]
    ? t('dq.umrah.permitHeld', { day: dayLabel(a.permitDay[0], { locale: l, hijri: false }), slot: slotLabel(a.permitSlot?.[0], l) }, l)
    : t('dq.umrah.permitHelp', undefined, l);
  const n = Math.max(1, who.length);
  return {
    totalSar: plan.totalSar, breakdown: [rooms, ...car, ...people],
    lead: `${t('dq.umrah.planLead', { hotels }, l)} ${permit}`, text: [tn('dq.umrah.planText', n, { price: sar(plan.totalSar, l) }, l), permit].join(' '),
  };
}

/** A hotel Mada sells from its own catalogue (the Istanbul bundle's, the Umrah ones), by key, for its page. */
export function catalogueHotelByKey(key: string | null | undefined): { key: string; city: string; name: string; area: string; address: string; note: string; rating: number; lat: number | null; lng: number | null; band: UmrahBand | null; minutes: number | null } | null {
  const u = umrahHotel(key);
  if (u) return { key: u.key, city: u.city, name: u.name, area: u.area, address: u.address, note: u.note, rating: u.rating, lat: u.lat, lng: u.lng, band: u.band, minutes: u.minutes };
  for (const [city, list] of Object.entries(CATALOGUE_HOTELS)) {
    const h = list.find((x) => x.key === key);
    if (h) return { key: h.key, city, name: h.name, area: h.area, address: h.address, note: h.note, rating: h.rating, lat: null, lng: null, band: null, minutes: null };
  }
  return null;
}
