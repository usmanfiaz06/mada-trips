import { z } from 'zod';
import { AirportCode, Id, IsoDateTime, IsoDay, LocalDateTime, Money } from './common';
import { BookingRequestView } from './booking';

/*
 * Airport pickups on a trip (Hotelbeds Transfers). GET /trips/{id}/transfers lists what can meet the trip's arrival
 * flight and take everyone to the hotel; POST picks one. In the beta a pick is a request to the desk carrying the
 * supplier's rate: the desk books it on Hotelbeds in one click, then quotes, and the traveller pays in the app.
 */

export const TransferOption = z.object({
  /** Our id for this option (an offer held 20 minutes). */
  id: Id,
  kind: z.enum(['private', 'shared']),
  /** As the supplier names it: "Minivan", "Car", "Shuttle". */
  vehicle: z.string(),
  category: z.string(),
  maxPax: z.number().int().positive(),
  /** Door to door, when the supplier says. */
  minutes: z.number().int().positive().nullable(),
  total: Money,
  freeCancelUntil: IsoDay.nullable(),
  refundable: z.boolean(),
  /** The supplier's own words on where to meet (English). */
  pickupNote: z.string().nullable(),
  imageUrl: z.string().nullable(),
  expiresAt: IsoDateTime,
});
export type TransferOption = z.infer<typeof TransferOption>;

export const TransferOptionsResponse = z.object({
  outcome: z.enum(['ok', 'none', 'no_flight', 'no_hotel', 'requested']),
  airport: AirportCode.nullable(),
  airportName: z.string().nullable(),
  hotel: z.string().nullable(),
  /** Landing, local time at the airport. */
  arrival: LocalDateTime.nullable(),
  people: z.number().int().nonnegative(),
  options: z.array(TransferOption),
  /** An open pickup request on this trip, if one was already sent. */
  request: z.object({ id: Id, status: z.string(), vehicle: z.string() }).nullable(),
});
export type TransferOptionsResponse = z.infer<typeof TransferOptionsResponse>;

export const ChooseTransferBody = z.object({ optionId: Id, clientKey: z.string().min(8).max(64) });
export type ChooseTransferBody = z.infer<typeof ChooseTransferBody>;

export const ChooseTransferResponse = z.object({ request: BookingRequestView });
export type ChooseTransferResponse = z.infer<typeof ChooseTransferResponse>;

export const TRANSFER_ROUTES = {
  transfers: (tripId: string) => `/trips/${tripId}/transfers`,
} as const;

/* ───────────── vouchers (Hotelbeds certification §4) ───────────── */

export const SupplierVoucherPax = z.object({ room: z.number().int(), name: z.string(), child: z.boolean(), age: z.number().int().nullable() });
export const SupplierVoucher = z.object({
  id: Id,
  kind: z.enum(['stay', 'transfer']),
  status: z.enum(['confirmed', 'cancelled', 'pending']),
  /** The hotel's booking reference with the partner (the voucher needs it at check-in). */
  reference: z.string(),
  /** Ours, for the traveller and the desk. */
  agencyReference: z.string().nullable(),
  bookedOn: IsoDay.nullable(),
  holder: z.string(),
  paxes: z.array(SupplierVoucherPax),
  hotel: z.object({ name: z.string(), address: z.string().nullable(), category: z.string().nullable(), destination: z.string().nullable(), phone: z.string().nullable() }).nullable(),
  checkIn: IsoDay.nullable(),
  checkOut: IsoDay.nullable(),
  room: z.string().nullable(),
  board: z.string().nullable(),
  transfer: z.object({ vehicle: z.string(), kind: z.enum(['private', 'shared']), from: z.string(), to: z.string(), date: z.string(), time: z.string(), flight: z.string().nullable(), pickup: z.string().nullable() }).nullable(),
  /** Rate comments / essential information, in full. */
  remarks: z.string().nullable(),
  cancellation: z.string().nullable(),
  /** "Payable through …, acting as agent for the service operating company …" (no price on a voucher). */
  payableThrough: z.string(),
  canCancel: z.boolean(),
});
export type SupplierVoucher = z.infer<typeof SupplierVoucher>;
export const SupplierVoucherResponse = z.object({ voucher: SupplierVoucher });
export const SupplierVouchersResponse = z.object({ vouchers: z.array(SupplierVoucher) });
export const CancelSupplierVoucherBody = z.object({ confirm: z.boolean() });
export const CancelSupplierVoucherResponse = z.object({
  simulated: z.boolean(),
  /** What cancelling costs (or cost), in riyals. */
  fee: Money,
  voucher: SupplierVoucher,
});
export type CancelSupplierVoucherResponse = z.infer<typeof CancelSupplierVoucherResponse>;

export const SUPPLIER_VOUCHER_ROUTES = {
  tripVouchers: (tripId: string) => `/trips/${tripId}/vouchers`,
  voucher: (id: string) => `/vouchers/${id}`,
  voucherHtml: (id: string, lang: 'en' | 'ar') => `/vouchers/${id}?format=html&lang=${lang}`,
  cancel: (id: string) => `/vouchers/${id}/cancel`,
} as const;

/* ───────────── hotel details (Content API, from our store) ───────────── */

export const HotelDetails = z.object({
  /** Mada's opaque id for the hotel. */
  code: z.string(),
  name: z.string(),
  /** "4 stars", "3 keys", as the category says. */
  category: z.string().nullable(),
  address: z.string().nullable(),
  phone: z.string().nullable(),
  description: z.string().nullable(),
  /** Every photo, in order, through Mada's image links. */
  images: z.array(z.string()),
  facilities: z.array(z.object({ name: z.string(), paid: z.boolean() })),
  latitude: z.number().nullable(),
  longitude: z.number().nullable(),
});
export type HotelDetails = z.infer<typeof HotelDetails>;
export const HotelDetailsResponse = z.object({ hotel: HotelDetails });
/**
 * The hotel's own words (written in English by the hotel or the desk) in the reader's language, on request: the
 * page shows the original with a "Translate" toggle. `machine` says it was translated for them, not written so.
 */
export const HotelTranslationResponse = z.object({
  lang: z.enum(['en', 'ar']),
  description: z.string().nullable(),
  facilities: z.array(z.string()),
  machine: z.boolean(),
});
export type HotelTranslationResponse = z.infer<typeof HotelTranslationResponse>;

/**
 * What guests say about a hotel on Google Maps: the rating, how many reviews, a few of them in the reader's language
 * when Google has it, and the link to all of them. Shown with Google's name and each author, as Google asks; never
 * stored. `place` is null when Google has no hotel at that spot (the page then shows nothing rather than a guess).
 */
export const HotelReview = z.object({
  author: z.string(),
  authorUrl: z.string().nullable(),
  authorPhoto: z.string().nullable(),
  rating: z.number().min(1).max(5),
  text: z.string(),
  /** "2 weeks ago", as Google words it in the reader's language. */
  when: z.string(),
  /** The language the text is in. */
  lang: z.string().nullable(),
  translated: z.boolean(),
});
export type HotelReview = z.infer<typeof HotelReview>;
export const HotelReviewsResponse = z.object({
  place: z.object({
    rating: z.number().min(1).max(5).nullable(),
    count: z.number().int().min(0),
    mapsUrl: z.string(),
    reviews: z.array(HotelReview),
  }).nullable(),
  source: z.literal('google'),
});
export type HotelReviewsResponse = z.infer<typeof HotelReviewsResponse>;
/** A message the desk or Mada wrote, in the reader's language (GET /messages/{id}/translation?to=). */
export const MessageTranslationResponse = z.object({ lang: z.enum(['en', 'ar']), text: z.string(), machine: z.boolean() });
export type MessageTranslationResponse = z.infer<typeof MessageTranslationResponse>;
export const messageTranslationPath = (id: string, to: 'en' | 'ar') => `/messages/${id}/translation?to=${to}`;

export const HOTEL_ROUTES = { hotel: (code: string) => `/hotels/${encodeURIComponent(code)}`, translation: (code: string, to: 'en' | 'ar') => `/hotels/${encodeURIComponent(code)}/translation?to=${to}` } as const;

export { voucherHtml } from './voucher-html';
