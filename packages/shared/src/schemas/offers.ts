import { z } from 'zod';
import { AirportCode, CarrierCode, FlightNumber, HalalasAmount, IsoDay, IsoDateTime, LocalDateTime, Money, TimeZone } from './common';
import { Cabin } from './trips';

/** What Ask shows: three options, each with its reason and all-in price (EXPERIENCE.md §5). */
export const OfferLabel = z.enum(['best', 'lowest', 'fastest', 'earliest', 'quiet', 'water', 'other']);

export const FlightLeg = z.object({
  carrier: CarrierCode,
  carrierName: z.string(),
  flightNumber: FlightNumber,
  from: AirportCode,
  to: AirportCode,
  departLocal: LocalDateTime,
  departTz: TimeZone,
  arriveLocal: LocalDateTime,
  arriveTz: TimeZone,
  durationMin: z.number().int().positive(),
});
export type FlightLeg = z.infer<typeof FlightLeg>;

export const FlightOffer = z.object({
  /** The supplier's offer id, opaque to the app. */
  id: z.string(),
  supplier: z.string(),
  label: OfferLabel,
  /** One-line reason: "Direct. Lands before check-in." */
  reason: z.string(),
  out: z.array(FlightLeg).min(1),
  back: z.array(FlightLeg),
  cabin: Cabin,
  /** Per traveller, all-in. */
  pricePerPerson: Money,
  total: Money,
  baggage: z.string(),
  changeRule: z.string(),
  refundRule: z.string(),
  /** Only when the supplier actually returned it (EXPERIENCE.md §7: no fake scarcity). */
  seatsLeft: z.number().int().nullable(),
  expiresAt: IsoDateTime,
});
export type FlightOffer = z.infer<typeof FlightOffer>;

export const FlightSearch = z.object({
  from: AirportCode,
  to: AirportCode,
  depart: IsoDay,
  return: IsoDay.nullable(),
  adults: z.number().int().min(1).max(9),
  children: z.number().int().min(0).max(8).default(0),
  infants: z.number().int().min(0).max(4).default(0),
  cabin: Cabin.default('economy'),
  flexibleDays: z.number().int().min(0).max(3).default(0),
});
export type FlightSearch = z.input<typeof FlightSearch>;

export const HotelOffer = z.object({
  id: z.string(),
  supplier: z.string(),
  label: OfferLabel,
  name: z.string(),
  area: z.string(),
  address: z.string(),
  note: z.string(),
  rating: z.number().nullable(),
  nightly: Money,
  total: Money,
  nights: z.number().int().positive(),
  rooms: z.number().int().positive(),
  cancellation: z.string(),
  freeCancelUntil: IsoDay.nullable(),
  cancelFee: HalalasAmount.nullable(),
  imageUrl: z.string().nullable(),
  expiresAt: IsoDateTime,
});
export type HotelOffer = z.infer<typeof HotelOffer>;

export const HotelSearch = z.object({
  city: z.string().min(2).max(80),
  checkIn: IsoDay,
  nights: z.number().int().min(1).max(60),
  adults: z.number().int().min(1).max(12),
  children: z.number().int().min(0).max(8).default(0),
  rooms: z.number().int().min(1).max(6).default(1),
});
export type HotelSearch = z.input<typeof HotelSearch>;
