import type { BookingFlightSupplier } from "../booking-types";
import type { FlightPassenger } from "../flight-ticketing";

/*
 * Duffel orders on top of the shared flight interface: the desk (or later the app) creates an order from a Duffel
 * offer with every passenger's details, reads it back and cancels it. `instant` tickets at once against Mada's Duffel
 * balance; `hold` keeps the seats until `paymentRequiredBy` where the airline allows it.
 */

export type DuffelOrder = {
  id: string;
  /** The airline PNR. */
  bookingReference: string | null;
  status: "held" | "ticketed" | "cancelled";
  tickets: string[];
  total: { amount: number; currency: string };
  paymentRequiredBy: string | null;
  /** Our order id, from the order's metadata. */
  reference: string | null;
};

export interface DuffelFlights extends BookingFlightSupplier {
  createOrder(input: { offerId: string; passengers: FlightPassenger[]; type: "instant" | "hold"; reference: string; known?: string | null }): Promise<DuffelOrder>;
  getOrder(orderId: string): Promise<DuffelOrder>;
  /** Asks Duffel what cancelling returns, then confirms. `refund` in the order's currency. */
  cancelOrder(orderId: string): Promise<{ cancelled: boolean; refund: { amount: number; currency: string } | null }>;
}
