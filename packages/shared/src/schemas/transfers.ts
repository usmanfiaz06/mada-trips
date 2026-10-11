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

export const VoucherPax = z.object({ room: z.number().int(), name: z.string(), child: z.boolean(), age: z.number().int().nullable() });
export const Voucher = z.object({
  id: Id,
  kind: z.enum(['stay', 'transfer']),
  status: z.enum(['confirmed', 'cancelled', 'pending']),
  /** HBX Group's booking reference (mandatory on the voucher). */
  reference: z.string(),
  /** Ours, for the traveller and the desk. */
  agencyReference: z.string().nullable(),
  bookedOn: IsoDay.nullable(),
  holder: z.string(),
  paxes: z.array(VoucherPax),
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
export type Voucher = z.infer<typeof Voucher>;
export const VoucherResponse = z.object({ voucher: Voucher });
export const VouchersResponse = z.object({ vouchers: z.array(Voucher) });
export const CancelVoucherBody = z.object({ confirm: z.boolean() });
export const CancelVoucherResponse = z.object({
  simulated: z.boolean(),
  /** What cancelling costs (or cost), in riyals at our rate, and as Hotelbeds states it. */
  fee: Money,
  supplierFee: z.object({ amount: z.number(), currency: z.string().nullable() }),
  voucher: Voucher,
});
export type CancelVoucherResponse = z.infer<typeof CancelVoucherResponse>;

export const VOUCHER_ROUTES = {
  tripVouchers: (tripId: string) => `/trips/${tripId}/vouchers`,
  voucher: (id: string) => `/vouchers/${id}`,
  voucherHtml: (id: string, lang: 'en' | 'ar') => `/vouchers/${id}?format=html&lang=${lang}`,
  cancel: (id: string) => `/vouchers/${id}/cancel`,
} as const;
