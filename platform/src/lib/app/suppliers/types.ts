import type { FlightOffer, FlightSearch, HotelOffer, HotelSearch, PaymentMethod, PaymentStatus, FlightStatus } from "@mada/shared";

/*
 * Every outside system sits behind one of these interfaces. Each has a mock (realistic data from the prototype:
 * Saudia SV263 RUH→IST, rooms near Galata Tower) and a live adapter, chosen per supplier by SUPPLIER_MODE.
 * Route handlers and services only ever see the interface.
 */

export type Sent = { id: string };

export interface SmsSupplier {
  readonly name: string;
  send(to: string, text: string): Promise<Sent>;
}

export interface WhatsAppSupplier {
  readonly name: string;
  /** Approved template messages only (Meta requires templates outside a 24-hour customer window). */
  sendTemplate(to: string, template: string, params: string[], locale?: "en" | "ar"): Promise<Sent>;
}

export interface EmailSupplier {
  readonly name: string;
  send(msg: { to: string; subject: string; text: string; html?: string }): Promise<Sent>;
}

export type FlightHold = { pnr: string; expiresAt: string; offer: FlightOffer };

export interface FlightSupplier {
  readonly name: string;
  search(q: FlightSearch): Promise<FlightOffer[]>;
  /** Re-price one offer just before payment. Returns the offer at today's price (it may have moved). */
  price(offerId: string, travellers: number): Promise<FlightOffer>;
  /** Hold seats without ticketing; an agent issues in Ops. */
  hold(offerId: string, travellers: { givenNames: string; surname: string; dateOfBirth?: string | null }[]): Promise<FlightHold>;
}

export interface HotelSupplier {
  readonly name: string;
  search(q: HotelSearch): Promise<HotelOffer[]>;
  price(offerId: string): Promise<HotelOffer>;
}

export type AuthorizeInput = {
  amount: number; // halalas
  method: PaymentMethod;
  /** A tokenised card or wallet token from the provider's SDK. Card numbers never reach our servers. */
  token: string;
  idempotencyKey: string;
  description: string;
  instalments?: number;
};
export type PaymentResult = { status: PaymentStatus; providerRef: string; redirectUrl?: string; declineReason?: string };

export interface PaymentSupplier {
  readonly name: string;
  authorize(input: AuthorizeInput): Promise<PaymentResult>;
  capture(providerRef: string, amount?: number): Promise<PaymentResult>;
  void(providerRef: string): Promise<PaymentResult>;
  refund(providerRef: string, amount: number, idempotencyKey: string): Promise<PaymentResult>;
}

export type FlightStatusInfo = {
  flightNumber: string;
  carrierName: string | null;
  date: string;
  from: string | null;
  to: string | null;
  departLocal: string | null;
  arriveLocal: string | null;
  status: FlightStatus;
  gate: string | null;
  terminal: string | null;
  source: string;
};

export interface FlightStatusSupplier {
  readonly name: string;
  lookup(flightNumber: string, date: string): Promise<FlightStatusInfo | null>;
  /** Push alerts for one flight to our webhook (FlightAware alerts; never polling). */
  watch(flightNumber: string, date: string): Promise<{ alertId: string }>;
}

/** What the concierge understood. Prices never come from here (SCOPE.md §6). */
export type Intent = {
  kind: "flight" | "stay" | "visa" | "umrah" | "car" | "restaurant" | "activity" | "general";
  to: string | null;
  from: string | null;
  depart: string | null;
  return: string | null;
  travellers: number | null;
  /** The one question that changes the outcome, if any. */
  ask: "where" | "when" | "who" | null;
};

export interface AiSupplier {
  readonly name: string;
  parseIntent(text: string, context: { today: string; home: string }): Promise<Intent>;
  /** A short open answer under COPY.md rules ("we", answer first, no banned words). */
  answer(question: string, context: { today: string; city?: string | null }): Promise<string>;
}

export type VerifiedIdentity = { provider: "apple" | "google"; sub: string; email: string | null; emailVerified: boolean; isPrivateEmail: boolean };

export interface IdentitySupplier {
  readonly name: string;
  verify(provider: "apple" | "google", idToken: string, nonce?: string): Promise<VerifiedIdentity>;
}

/**
 * Live aircraft positions from open ADS-B data (adsb.lol, OpenSky as fallback). Position and altitude only.
 * Never throws: null when the aircraft isn't airborne, isn't seen, or the feed is down.
 */
export interface FlightPositionsSupplier {
  readonly name: string;
  byCallsign(callsign: string): Promise<import("@mada/shared").FlightPosition | null>;
  byHex(hex: string): Promise<import("@mada/shared").FlightPosition | null>;
}

/** What Supabase Auth has proven about the person behind an access token (docs/app/AUTH.md). */
export type SupabaseIdentity = {
  /** The Supabase user id (auth.users.id). */
  sub: string;
  /** E.164 with the plus, only when Supabase confirmed it with a code. */
  phone: string | null;
  phoneVerified: boolean;
  email: string | null;
  emailVerified: boolean;
  /** Apple's private relay address. */
  isPrivateEmail: boolean;
  /** Ways in Supabase knows: phone | email | apple | google. */
  providers: ("phone" | "email" | "apple" | "google")[];
  /** A name the provider shared, if any. */
  name: string | null;
};

/**
 * Verifies a Supabase Auth access token. Live: the project's JWKS (jose). Mock: the app's unsigned `mocksb.` tokens.
 * Throws AppError TOKEN_EXPIRED for an expired token and UNAUTHORIZED for anything else it can't trust.
 */
export interface SupabaseAuthSupplier {
  readonly name: string;
  verify(accessToken: string): Promise<SupabaseIdentity>;
}

/** A phone (E.164) or an email address, as Supabase Auth holds it. */
export type SupabaseContact = { kind: "phone" | "email"; value: string };

/**
 * Supabase Auth's admin API (service-role key), for the desk moving an account to a new number or email after a
 * recovery request. Live: <SUPABASE_URL>/auth/v1/admin/users. Mock: in memory, recorded in mockSupabaseAdminLog.
 */
export interface SupabaseAdminSupplier {
  readonly name: string;
  /** Replace the user's phone or email, marked confirmed (a person on the desk has checked it's them). */
  setContact(userId: string, contact: SupabaseContact): Promise<void>;
  /** A new user with only this contact, confirmed. Returns its id. */
  createUser(contact: SupabaseContact): Promise<string>;
  deleteUser(userId: string): Promise<void>;
}
