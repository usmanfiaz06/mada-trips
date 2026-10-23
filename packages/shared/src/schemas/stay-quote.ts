import { z } from 'zod';
import { IsoDay } from './common';

/*
 * A room the team at Mada priced by hand (docs/app/ASK-INTEGRATED.md, stays found by hand): until a supplier key is
 * live for a hotel, Ask sends a stay request, an agent finds the room on the supplier's own portal or with the hotel,
 * and sends up to three options. The traveller sees them as a card in the same Ask chat, books one and pays in the
 * app; the stay then lands on the trip. Only what the traveller reads is here: what Mada pays and who it books with
 * stay on the desk.
 */

/** Room only, breakfast, half board, full board, all inclusive (the app words them with stay.board.*). */
export const StayBoard = z.enum(['RO', 'BB', 'HB', 'FB', 'AI']);
export type StayBoard = z.infer<typeof StayBoard>;

/** "2026-11-20T18:00": a time at the hotel, in its own time zone. */
export const HotelLocalTime = z.string().regex(/^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/);

export const StayQuoteOption = z.object({
  id: z.string().min(1).max(8),
  hotel: z.string().min(1).max(120),
  city: z.string().min(1).max(80),
  room: z.string().min(1).max(120),
  board: StayBoard,
  checkIn: IsoDay,
  checkOut: IsoDay,
  nights: z.number().int().positive().max(60),
  guests: z.number().int().positive().max(20),
  /** The all-in price in halalas. */
  total: z.number().int().positive(),
  /** Free to cancel until this time at the hotel; null: non-refundable. */
  freeCancelUntil: HotelLocalTime.nullable(),
  /** The agent's line for the traveller, if any. */
  note: z.string().max(300).nullable(),
});
export type StayQuoteOption = z.infer<typeof StayQuoteOption>;

/** Hotel quotes go out with at most this many options. */
export const MAX_STAY_QUOTE_OPTIONS = 3;

/** The options of a desk quote that priced rooms by hand, or null for any other quote. */
export function stayQuoteOf(snapshot: unknown): StayQuoteOption[] | null {
  const s = (snapshot ?? {}) as { kind?: unknown; options?: unknown };
  if (s.kind !== 'stay' || !Array.isArray(s.options)) return null;
  const parsed = z.array(StayQuoteOption).min(1).max(MAX_STAY_QUOTE_OPTIONS).safeParse(s.options);
  return parsed.success ? parsed.data : null;
}

/** Whole nights between two calendar days (0 when they're the wrong way round or not days). */
export function nightsBetween(checkIn: string, checkOut: string): number {
  const a = Date.parse(`${checkIn}T00:00:00Z`), b = Date.parse(`${checkOut}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) return 0;
  return Math.round((b - a) / 86_400_000);
}
