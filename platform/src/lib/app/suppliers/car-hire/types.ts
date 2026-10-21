/*
 * Self-drive car hire: one interface, `carHire`, with CarTrawler as the first implementation (fixtures in mock).
 * Everything in our words: SAR halalas for what the traveller pays, the supplier's own currency kept as `net`, the
 * deposit held on the driver's card at the desk, what the insurance covers and the excess left to pay.
 */

/** ACRISS first letter, in words. */
export type CarClass = "mini" | "economy" | "compact" | "intermediate" | "standard" | "fullsize" | "premium" | "luxury" | "suv" | "van" | "special";

export type CarPlace = {
  /** An airport (IATA), which is where most desks are. */
  iata?: string | null;
  lat?: number | null;
  lng?: number | null;
  label: string;
  countryCode: string;
};

export type CarHireSearch = {
  pickup: { place: CarPlace; at: string };
  dropoff: { place: CarPlace; at: string };
  /** The main driver's age on the pickup day: under 21 most desks won't rent, 21–24 pay a young-driver fee. */
  driverAge: number;
  /** ISO alpha-2 of the driver's licence / residence (prices and rules differ). */
  residence: string;
  language?: "en" | "ar";
};

export type CarMoney = { amount: number; currency: "SAR" };

export type CarOffer = {
  /** Opaque, prefixed with the supplier ("cartrawler." / "mock."). */
  id: string;
  supplier: "cartrawler" | "mock";
  vendor: { name: string; logo: string | null };
  vehicle: {
    class: CarClass; acriss: string | null; name: string; seats: number | null; bags: number | null; doors: number | null;
    transmission: "automatic" | "manual"; aircon: boolean; image: string | null;
  };
  /** What the traveller pays for the whole hire (incl. one-way and young-driver fees), with Mada's margin. */
  total: CarMoney;
  perDay: CarMoney;
  days: number;
  net: { amount: number; currency: string };
  /** Held on the driver's credit card at the desk, released on return. Null when the supplier doesn't say. */
  deposit: CarMoney | null;
  insurance: {
    /** CDW, theft protection, third-party liability… as the supplier lists them. */
    included: string[];
    /** What the driver still pays after damage, before extra cover. */
    excess: CarMoney | null;
    /** Extra cover to bring the excess to zero, when sold with the hire. */
    extra: { code: string; name: string; total: CarMoney } | null;
  };
  mileage: "unlimited" | { kmPerDay: number };
  fuelPolicy: "full_to_full" | "same_to_same" | "prepaid" | "other";
  pickupDesk: { name: string; inTerminal: boolean };
  /** Driving into another country (Bahrain, the UAE…): allowed with the desk's permit, not allowed, or unknown. */
  crossBorder: "allowed" | "not_allowed" | "unknown";
  freeCancelUntil: string | null;
  expiresAt: string;
};

export type CarDriver = {
  givenNames: string; surname: string; email: string; phone: string; age: number;
  /** Where the licence was issued (ISO alpha-2). An international permit is the driver's own business; we say so. */
  licenceCountry: string;
};

export type CarBooking = {
  /** The supplier's confirmation number. */
  id: string;
  /** Ours (the order id): the idempotency key for book. */
  reference: string;
  status: "confirmed" | "pending" | "cancelled";
  /** Null when the booking was only looked up by its number (status), not made here. */
  offer: CarOffer | null;
  driver: Pick<CarDriver, "givenNames" | "surname">;
  voucherUrl: string | null;
};

export interface CarHireSupplier {
  readonly name: "cartrawler" | "mock";
  search(q: CarHireSearch): Promise<CarOffer[]>;
  /** The same car priced again just before payment. */
  quote(offerId: string): Promise<CarOffer>;
  /** Never retried blindly: a second call with the same reference returns the first booking. */
  book(input: { offerId: string; driver: CarDriver; reference: string; extraCover?: boolean; flightNumber?: string | null }): Promise<CarBooking>;
  cancel(bookingId: string, reference: string): Promise<{ cancelled: boolean; fee: CarMoney | null }>;
  status(bookingId: string, reference: string): Promise<CarBooking>;
}
