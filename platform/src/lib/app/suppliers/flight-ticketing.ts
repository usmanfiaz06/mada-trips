import type { FareRules } from "@mada/shared";
import type { BookingFlightOffer, BookingFlightSupplier } from "./booking-types";

/*
 * What a flights supplier that books and tickets by itself adds on top of BookingFlightSupplier (live: TBO Air,
 * suppliers/live/tbo-air.ts). The catalogue mock and the GDS stub don't have these: their bookings are held and
 * ticketed by hand on the desk. booking/supplier-flights.ts drives them from the desk's order page.
 *
 * Every write takes the order's own reference as its idempotency key, and the order keeps a FlightBookingRef between
 * calls (app_orders.snapshot.flightBooking), so a retry, a second server or a second click never books or tickets twice.
 */

/** One traveller as the airline needs them: names exactly as on the passport. */
export type FlightPassenger = {
  personId: string;
  givenNames: string;
  surname: string;
  type: "adult" | "child" | "infant";
  dateOfBirth: string | null;
  sex: "M" | "F" | null;
  /** ISO 3166 alpha-2. */
  nationality: string | null;
  passportNumber: string | null;
  passportExpiry: string | null;
  passportCountry: string | null;
  lead: boolean;
  phone: string | null;
  email: string | null;
  /** Meal SSR (CHML, VGML…), asked of the airline with the booking. */
  meal?: string | null;
  /** Seat preference for full-service airlines (window or aisle); chosen seats on low-cost airlines are paid and stay with the desk. */
  seat?: "window" | "aisle" | null;
};

/** One booking at the supplier. A domestic return on TBO is two (one per direction). */
export type FlightBookingPart = {
  resultIndex: string;
  lcc: boolean;
  /** The supplier's content source (TBO `Source`), needed to release a hold. */
  source: number | null;
  /** A hold request has been sent: on a retry, look the booking up instead of booking again. */
  bookSent: boolean;
  /** The supplier's booking id and the airline PNR, once held or ticketed. */
  bookingId: number | null;
  pnr: string | null;
  /** The airline's last day to ticket a held booking (ISO), when it says. */
  lastTicketDate: string | null;
  /** A ticket request has been sent: never send another; ask for the booking's details instead. */
  ticketSent: boolean;
  /** Ticket numbers in passenger order, once issued. */
  tickets: string[];
  /** The supplier's ticket ids (for a refund request), in passenger order. */
  ticketIds: number[];
  /** The fare rose at ticketing; the traveller accepted it, so the next request accepts the change. */
  priceChangeAccepted?: boolean;
};

export type FlightBookingRef = {
  supplier: string;
  offerId: string;
  /** The supplier's session for this booking (TBO TraceId), valid about 15 minutes after a search. */
  traceId: string;
  parts: FlightBookingPart[];
  /** Asked for but not passed to the airline (paid seats on a low-cost airline, a bassinet): the desk adds them. */
  ssrForDesk: string[];
};

export type FlightOutcome =
  | { outcome: "held"; ref: FlightBookingRef }
  /** A low-cost airline: nothing to hold, the fare is confirmed and tickets are issued straight away. */
  | { outcome: "ticket_now"; ref: FlightBookingRef }
  | { outcome: "ticketed"; ref: FlightBookingRef; tickets: string[] }
  /** Sent, and the supplier is still working (or the answer was lost): ask for the booking's details later. */
  | { outcome: "pending"; ref: FlightBookingRef; why: string }
  /** The fare moved: `total` is the new all-in total in halalas, `offer` the re-priced offer. */
  | { outcome: "price_changed"; ref: FlightBookingRef | null; total: number; offer: BookingFlightOffer | null }
  | { outcome: "schedule_changed"; ref: FlightBookingRef | null; offer: BookingFlightOffer | null }
  | { outcome: "sold_out"; ref: FlightBookingRef | null }
  /** A definite no from the supplier (nothing held or charged there). `reason` is for the team, not the traveller. */
  | { outcome: "failed"; ref: FlightBookingRef | null; reason: string };

export type FlightBookingDetails = { ref: FlightBookingRef; status: "held" | "ticketed" | "pending" | "cancelled" | "failed" | "unknown"; tickets: string[] };

export type FlightCancelResult = { released: boolean; changeRequestIds: number[]; note: string };

/** The fare-rules sheet (shared FareRules) plus the words the cards show and the airline's own text. */
export type FlightFareRules = FareRules & { changeAllowed: boolean; changeRule: string; refundRule: string; text: string | null };

/**
 * `key`: the order's id (joins a concurrent call on the same server). `paidTotal`: what the traveller's card holds, in
 * halalas: a fare above it is a price change, never charged. `persist`: writes the ref to the order before each
 * request that books or tickets; if it throws, nothing is sent.
 */
export type WriteOpts = { key: string; paidTotal: number; persist?: (ref: FlightBookingRef) => Promise<void> };

export interface TicketingFlightSupplier extends BookingFlightSupplier {
  fareRules(offerId: string): Promise<FlightFareRules>;
  /** Confirm the fare and hold the seats (full-service airlines) or confirm the fare (low-cost airlines). */
  book(offerId: string, passengers: FlightPassenger[], opts: WriteOpts & { known?: FlightBookingRef | null; ssr?: string[] }): Promise<FlightOutcome>;
  /** Issue the tickets. Never sends a second ticket request for a part that already had one (it looks it up). */
  ticket(ref: FlightBookingRef, passengers: FlightPassenger[], opts: WriteOpts): Promise<FlightOutcome>;
  bookingDetails(ref: FlightBookingRef, lead?: { givenNames: string; surname: string }): Promise<FlightBookingDetails>;
  /** Before ticketing: release the hold. After: ask for a refund (the airline's rules decide how much). */
  cancel(ref: FlightBookingRef, remarks: string): Promise<FlightCancelResult>;
}

export const canTicket = (s: BookingFlightSupplier): s is TicketingFlightSupplier =>
  typeof (s as Partial<TicketingFlightSupplier>).book === "function" && typeof (s as Partial<TicketingFlightSupplier>).ticket === "function";
