import { z } from 'zod';
import { Id, Money } from './common';
import { ASSISTANCE, BED_TYPES, FLOOR_PREFS, LOYALTY_PROGRAMS, LoyaltyProgram, Meal, ROOM_TYPES, normLoyalty, type LoyaltyProgramId, type TravelPrefs } from './wallet';
import { t } from '../copy';
import type { CopyKey } from '../copy/en';

/*
 * Preferences and loyalty numbers applied at booking (owner audit items 5 and 6).
 *
 * The saved travel preferences (Account › Travel preferences) are copied onto each booking as BookingPrefs: the
 * traveller can change them for this booking only on the order sheet, and what goes out is what the sheet shows.
 * This file is the one mapping both sides share: which preferences matter for a flight or a stay, the words for
 * them, the airline SSR codes and hotel remarks they become, the paid extras an airline prices (seat selection
 * on flynas and flyadeal), and which loyalty programme a carrier or hotel earns on.
 */

/** The preferences a booking carries: the saved ones minus loyalty (loyalty is attached per traveller). */
export const BookingPrefs = z.object({
  seat: z.enum(['window', 'aisle', 'any']).default('any'),
  together: z.boolean().default(true),
  meal: Meal.default('halal'),
  assist: z.array(z.enum(ASSISTANCE)).max(4).default([]),
  room: z.enum(ROOM_TYPES).default('any'),
  bed: z.enum(BED_TYPES).default('any'),
  floor: z.enum(FLOOR_PREFS).default('any'),
  quiet: z.boolean().default(false),
  notes: z.string().max(280).default(''),
});
export type BookingPrefs = z.infer<typeof BookingPrefs>;

/** A loyalty number attached to one traveller on one booking. */
export const BookingLoyaltyBase = z.object({ personId: Id, program: LoyaltyProgram, number: z.string().min(1).max(24) });
export const BookingLoyalty = BookingLoyaltyBase.refine((l) => LOYALTY_PROGRAMS.find((p) => p.id === l.program)!.re.test(normLoyalty(l.number)), { message: 'That number doesn’t match the programme', path: ['number'] });
export type BookingLoyalty = z.infer<typeof BookingLoyalty>;

/** Paid extras: each is off until the traveller adds it on the sheet, every time. Never remembered, never silent. */
export const BookingExtras = z.object({ seatsTogether: z.boolean().default(false) });
export type BookingExtras = z.infer<typeof BookingExtras>;

export type PrefScope = 'flight' | 'stay' | 'both';

export const DEFAULT_BOOKING_PREFS: BookingPrefs = { seat: 'any', together: true, meal: 'halal', assist: [], room: 'any', bed: 'any', floor: 'any', quiet: false, notes: '' };

/** The saved preferences as a booking starts with them. */
export function bookingPrefsOf(p: Partial<TravelPrefs> | null | undefined): BookingPrefs {
  return BookingPrefs.parse({ ...DEFAULT_BOOKING_PREFS, ...(p ? { seat: p.seat, together: p.together, meal: p.meal, assist: p.assist, room: p.room, bed: p.bed, floor: p.floor, quiet: p.quiet, notes: p.notes } : {}) });
}

/** What a booking of this kind can use: flights take seats, meals and help; stays take rooms. */
export function prefScope(kind: string | null | undefined): PrefScope {
  if (kind === 'stay') return 'stay';
  if (kind === 'package' || kind === 'bundle') return 'both';
  return 'flight';
}

/** Short labels for the row on the order sheet ("Window · Seats together · Halal"). Empty when nothing is set. */
export function prefsSummary(p: BookingPrefs, scope: PrefScope, travellers = 1, locale?: 'en' | 'ar'): string[] {
  const out: string[] = [];
  const T = (k: string) => t(k as CopyKey, undefined, locale);
  if (scope !== 'stay') {
    if (p.seat !== 'any') out.push(T(`prefs.seat.${p.seat}`));
    if (p.together && travellers > 1) out.push(T('bp.together'));
    out.push(T(`prefs.meal.${p.meal}`));
    for (const a of p.assist) out.push(T(`bp.assist.${a}`));
  }
  if (scope !== 'flight') {
    if (p.room !== 'any') out.push(T(`bp.room.${p.room}`));
    if (p.bed !== 'any') out.push(T(`bp.bed.${p.bed}`));
    if (p.floor !== 'any') out.push(T(`bp.floor.${p.floor}`));
    if (p.quiet) out.push(T('bp.quiet'));
    if (p.assist.includes('wchr') || p.assist.includes('wchc')) out.push(T('bp.accessible'));
  }
  return out;
}

/* ───────────── what the supplier gets ───────────── */

const MEAL_SSR: Record<BookingPrefs['meal'], string> = { halal: 'MOML', veg: 'VGML', vegan: 'VLML', child: 'CHML', diabetic: 'DBML', gluten: 'GFML', lowsalt: 'LSML' };
const ASSIST_SSR: Record<(typeof ASSISTANCE)[number], string> = { wchr: 'WCHR', wchc: 'WCHC', infant: 'INFT', bassinet: 'BSCT' };
/** Saudi carriers serve only halal: no meal code needed (the desk's note says so too). */
const HALAL_BY_DEFAULT = new Set(['SV', 'XY', 'F3']);

/**
 * Airline special service requests and the seat note for the PNR. Codes are the IATA SSRs an agent types
 * (MOML halal meal, VGML vegetarian, WCHR wheelchair to the gate, BSCT bassinet…); the seat wish and "seats together"
 * are OSI remarks in words, because every GDS words them its own way.
 */
export function airlineRequests(p: BookingPrefs, opts: { carrier?: string | null; travellers: number }): { ssr: string[]; remarks: string[] } {
  const ssr: string[] = [];
  const remarks: string[] = [];
  const carrier = (opts.carrier ?? '').toUpperCase();
  if (!(p.meal === 'halal' && HALAL_BY_DEFAULT.has(carrier))) ssr.push(MEAL_SSR[p.meal]);
  for (const a of p.assist) ssr.push(ASSIST_SSR[a]);
  if (p.seat === 'window') remarks.push('SEAT WINDOW');
  if (p.seat === 'aisle') remarks.push('SEAT AISLE');
  if (p.together && opts.travellers > 1) remarks.push('SEAT TOGETHER');
  if (p.notes.trim()) remarks.push(p.notes.trim().slice(0, 120).toUpperCase());
  return { ssr: [...new Set(ssr)], remarks };
}

/** Remarks for the hotel (Hotelbeds `remark`, the desk's booking note): plain English, short, the way hotels read them. */
export function hotelRemarks(p: BookingPrefs): string[] {
  const out: string[] = [];
  if (p.room === 'connecting') out.push('Connecting rooms');
  if (p.room === 'double') out.push('Double room');
  if (p.room === 'twin') out.push('Twin room');
  if (p.bed === 'king') out.push('King bed');
  if (p.bed === 'twin') out.push('Twin beds');
  if (p.floor === 'high') out.push('High floor');
  if (p.floor === 'low') out.push('Low floor');
  if (p.quiet) out.push('Quiet room, away from the lift');
  if (p.assist.includes('wchr') || p.assist.includes('wchc')) out.push('Wheelchair-accessible room');
  if (p.assist.includes('infant')) out.push('Baby cot');
  if (p.notes.trim()) out.push(p.notes.trim().slice(0, 160));
  return out;
}

/* ───────────── paid extras ───────────── */

/** Seat selection per person per direction, where an airline charges for it (sr.seats.alt: flynas SAR 35 each). */
export const SEAT_FEE_HALALAS: Readonly<Record<string, number>> = { XY: 3500, F3: 3500 };

export type ExtrasOffer = { key: 'seatsTogether'; perPerson: Money; count: number; legs: number; total: Money; added: boolean };

/**
 * The seats-together extra, priced, when the fare prices it and the preference asks for it: more than one traveller,
 * a carrier that charges, the saved "seat us together". It is only a line on the order when `added` (BookingExtras).
 */
export function seatsTogetherOffer(p: BookingPrefs, extras: Partial<BookingExtras> | null | undefined, opts: { carrier?: string | null; travellers: number; legs: number }): ExtrasOffer | null {
  const fee = SEAT_FEE_HALALAS[(opts.carrier ?? '').toUpperCase()];
  if (!fee || !p.together || opts.travellers < 2) return null;
  const legs = Math.max(1, opts.legs);
  const total = fee * opts.travellers * legs;
  return { key: 'seatsTogether', perPerson: { amount: fee, currency: 'SAR' }, count: opts.travellers, legs, total: { amount: total, currency: 'SAR' }, added: !!extras?.seatsTogether };
}

/* ───────────── loyalty ───────────── */

export const LOYALTY_FOR_CARRIER: Readonly<Record<string, LoyaltyProgramId>> = { SV: 'alfursan', XY: 'nasmiles', TK: 'mands', EK: 'skywards' };

const HOTEL_PROGRAMMES: readonly { id: LoyaltyProgramId; re: RegExp }[] = [
  { id: 'bonvoy', re: /\b(marriott|sheraton|westin|ritz[- ]carlton|st\.? regis|le m[eé]ridien|courtyard|jw marriott|w hotel|aloft|renaissance|autograph)\b/i },
  { id: 'hilton', re: /\b(hilton|conrad|waldorf|doubletree|hampton|curio|canopy)\b/i },
  { id: 'ihg', re: /\b(intercontinental|holiday inn|crowne plaza|kimpton|voco|hotel indigo|staybridge)\b/i },
  { id: 'accor', re: /\b(accor|sofitel|novotel|ibis|pullman|m[öo]venpick|fairmont|raffles|swiss[ôo]tel|mercure|mgallery|rixos)\b/i },
];

/** The programme this booking earns on: by carrier for a flight, by the hotel's name for a stay. */
export function programmeFor(opts: { carrier?: string | null; hotelName?: string | null }): LoyaltyProgramId[] {
  const out: LoyaltyProgramId[] = [];
  const air = opts.carrier ? LOYALTY_FOR_CARRIER[opts.carrier.toUpperCase()] : undefined;
  if (air) out.push(air);
  if (opts.hotelName) { const h = HOTEL_PROGRAMMES.find((x) => x.re.test(opts.hotelName!)); if (h) out.push(h.id); }
  return out;
}

export const programmeName = (id: LoyaltyProgramId) => LOYALTY_PROGRAMS.find((p) => p.id === id)?.name ?? id;
export const programmeHint = (id: LoyaltyProgramId) => LOYALTY_PROGRAMS.find((p) => p.id === id)?.hint ?? '';
export const loyaltyValid = (program: LoyaltyProgramId, number: string) => !!number && LOYALTY_PROGRAMS.find((p) => p.id === program)!.re.test(normLoyalty(number));
/** "••••1234": the last four, never the whole number on a screen or a share. */
export const maskLoyalty = (number: string) => `••••${normLoyalty(number).slice(-4)}`;

/**
 * The numbers to attach when a booking starts: the account holder's saved numbers for the programmes this booking
 * earns on, on the account holder's own traveller row. Other travellers add theirs on the sheet.
 */
export function loyaltyToAttach(saved: TravelPrefs['loyalty'] | null | undefined, programmes: LoyaltyProgramId[], selfId: string | null, travellerIds: string[]): BookingLoyalty[] {
  if (!saved?.length || !selfId || !travellerIds.includes(selfId)) return [];
  return programmes.flatMap((prog) => {
    const l = saved.find((x) => x.program === prog);
    return l && loyaltyValid(prog, l.number) ? [{ personId: selfId, program: prog, number: normLoyalty(l.number) }] : [];
  });
}
