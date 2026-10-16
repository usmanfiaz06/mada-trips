import { z } from 'zod';
import { t, type CopyKey, type CopyLocale } from '../copy';

/*
 * Requests for the hotel, asked on the order sheet before paying (owner audit, item 3): a few chips and a line in the
 * traveller's own words. They ride on the order's draft, the desk sees them, the trip's stay repeats them, and a
 * Hotelbeds booking carries them as its remark. Hotels do their best; none of it is a promise.
 */
export const HOTEL_REQUEST_KINDS = ['lateCheckIn', 'earlyCheckIn', 'highFloor', 'quiet', 'connecting', 'cot', 'dietary', 'celebration'] as const;
export type HotelRequestKind = (typeof HOTEL_REQUEST_KINDS)[number];

export const HotelRequests = z.object({
  chips: z.array(z.enum(HOTEL_REQUEST_KINDS)).max(HOTEL_REQUEST_KINDS.length).default([]),
  note: z.string().trim().max(300).default(''),
});
export type HotelRequests = z.infer<typeof HotelRequests>;

export const hasHotelRequests = (r: HotelRequests | null | undefined): r is HotelRequests => !!r && (r.chips.length > 0 || r.note.length > 0);

/** The requests as lines in a language ("Late check-in, after 22:00", then the note). */
export function hotelRequestLines(r: HotelRequests | null | undefined, locale?: CopyLocale): string[] {
  if (!hasHotelRequests(r)) return [];
  return [...r.chips.map((k) => t(`hr.chip.${k}` as CopyKey, undefined, locale)), ...(r.note ? [r.note] : [])];
}

/** For the hotel itself (the supplier's remark is read by the property, in English). */
const REMARK_EN: Record<HotelRequestKind, string> = {
  lateCheckIn: 'Late check-in, after 22:00', earlyCheckIn: 'Early check-in if possible', highFloor: 'High floor', quiet: 'Quiet room', connecting: 'Connecting rooms',
  cot: 'Baby cot', dietary: 'Dietary needs, see note', celebration: 'A celebration, see note',
};
export function hotelRequestRemark(r: HotelRequests | null | undefined): string | null {
  if (!hasHotelRequests(r)) return null;
  return [...r.chips.map((k) => REMARK_EN[k]), ...(r.note ? [r.note.replace(/\s+/g, ' ')] : [])].join('. ');
}
