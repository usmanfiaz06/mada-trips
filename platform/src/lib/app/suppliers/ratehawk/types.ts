import type { BookingHotelOffer, BookingHotelSupplier } from "../booking-types";

/*
 * RateHawk (Emerging Travel Group's B2B API, api.worldota.net) as a hotel source: search by city, price a room
 * (prebook), and the booking calls the desk will use (book, status, cancel). Offers are ours (BookingHotelOffer) with
 * ids "ratehawk.<…>.<party>".
 */

export type RateHawkGuest = { firstName: string; lastName: string };

export type RateHawkBooking = {
  /** Our order id (RateHawk's partner_order_id): every call after book() uses it. */
  reference: string;
  /** RateHawk's own order id, once known. */
  orderId: number | null;
  status: "confirmed" | "processing" | "failed" | "cancelled";
  offer: BookingHotelOffer | null;
};

export interface RateHawkHotels extends BookingHotelSupplier {
  /** Prebook and book with Mada's deposit. A second call with the same reference reads the first booking's status. */
  book(input: { offerId: string; reference: string; guests: RateHawkGuest[][]; email: string; phone: string; ip?: string | null }): Promise<RateHawkBooking>;
  status(reference: string): Promise<RateHawkBooking>;
  cancel(reference: string): Promise<{ cancelled: boolean }>;
}
