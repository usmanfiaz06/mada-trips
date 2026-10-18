/*
 * A hotel from Mada's own catalogue (the Istanbul bundle's), said in full before anyone adds it (CRITIQUE-2 #9): the
 * photo, the room and how many, the price a night and in all, the board, the rating, the last day to cancel free and
 * what's included. The hotel page and the bundle card read the same lines, so they never disagree.
 */
import { addDays, daysBetween } from '../dates';
import { sarToHalalas } from '../money';
import { CATALOGUE_HOTELS } from './booking-data';
import { roomsFor, staySar } from './booking-logic';
import { CATALOGUE_STAY_FACTS } from './stay-wishes';
import type { StayAmenity, StayFacts } from './booking';

export type CatalogueStay = {
  key: string; name: string; photo: string; focal: string; rating: string; area: string;
  /** "Deluxe double", as the hotel names it. */
  room: string | null; rooms: number; connecting: boolean;
  board: StayFacts['board'];
  /** Halalas, for the whole party. */
  perNight: number; total: number; nights: number;
  checkIn: string | null; checkOut: string | null;
  /** The last day it's free to cancel: a week before the first night. */
  freeUntil: string | null;
  amenities: StayAmenity[];
};

/** The catalogue hotel `key` for `guests` people, from `checkIn` for `nights` (or the dates of the flights, when known). */
export function catalogueStay(key: string, guests: number, checkIn?: string | null, checkOut?: string | null): CatalogueStay | null {
  const h = Object.values(CATALOGUE_HOTELS).flat().find((x) => x.key === key);
  if (!h) return null;
  const f = CATALOGUE_STAY_FACTS[key];
  const n = Math.max(1, guests);
  const nights = checkIn && checkOut ? Math.max(1, daysBetween(checkIn, checkOut)) : 1;
  const total = sarToHalalas(staySar(h.nightSar, nights, n));
  const rooms = roomsFor(n);
  return {
    key, name: h.name, photo: h.photo, focal: h.focal, rating: h.rating.toFixed(1), area: h.area,
    room: f?.room ?? null, rooms, connecting: rooms > 1 && !!f?.amenities.includes('connecting'), board: f?.board ?? null,
    perNight: Math.round(total / nights), total, nights,
    checkIn: checkIn ?? null, checkOut: checkOut ?? null, freeUntil: checkIn ? addDays(checkIn, -7) : null,
    amenities: f?.amenities ?? [],
  };
}
