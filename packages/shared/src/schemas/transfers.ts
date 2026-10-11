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
