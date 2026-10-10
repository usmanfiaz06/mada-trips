import type { FlightOffer, HotelOffer, Person } from "@mada/shared";
import type { FlightSupplier, HotelSupplier, PaymentResult, PaymentSupplier } from "./types";

/*
 * Supplier interfaces booking (M2) adds on top of types.ts. The catalogue mocks and the live adapters implement them;
 * src/lib/app/booking/suppliers.ts picks one per call from SUPPLIER_MODE (same switches as the M0 suppliers).
 */

/** What the card shows beyond the GDS offer: the label we chose, a stop, the airline colour. */
export type OfferMeta = { label: "best" | "lowest" | "earliest" | "fastest" | "bags"; stop: string | null; refundable: boolean };
export type BookingFlightOffer = FlightOffer & { meta?: OfferMeta };

export interface BookingFlightSupplier extends FlightSupplier {
  search(q: Parameters<FlightSupplier["search"]>[0]): Promise<BookingFlightOffer[]>;
  price(offerId: string, travellers: number): Promise<BookingFlightOffer>;
}

export type BookingHotelOffer = HotelOffer & { meta?: { photo: string; focal: string; noteOne: string; noteTwo: string; label: "best" | "quiet" | "water" | "lowest" } };
export interface BookingHotelSupplier extends HotelSupplier {
  search(q: Parameters<HotelSupplier["search"]>[0]): Promise<BookingHotelOffer[]>;
  price(offerId: string): Promise<BookingHotelOffer>;
}

/** MyFatoorah-shaped: authorise (maybe 3-D Secure first), capture on issue, void on failure, refund. */
export interface BookingPaymentSupplier extends PaymentSupplier {
  /** The bank's one-time code for 3-D Secure. On the real gateway this happens in the bank's page; the mock takes the code. */
  completeAction(providerRef: string, code: string): Promise<PaymentResult & { triesLeft?: number }>;
}

export type AskParserContext = { today: string; people: Person[]; destinations: string[] };
/** What the model returns through the strict tool. Validated and cleaned by the booking service. */
export type ModelIntent = {
  kind: string; destination: string | null; destinationName: string | null; from: string | null; depart: string | null; return: string | null;
  tripType: string | null; monthOnly: { month: number; year: number; label: string | null } | null; cabin: string | null;
  travellerIds: string[] | null; travellerCount: number | null; infants: number; ask: string | null;
};
export interface AskParser {
  readonly name: string;
  /** null when the model declined or didn't call the tool: the rules take over. */
  parse(text: string, ctx: AskParserContext): Promise<ModelIntent | null>;
}
