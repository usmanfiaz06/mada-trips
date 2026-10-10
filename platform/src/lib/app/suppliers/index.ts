import "server-only";
import { supplierMode, type SupplierName } from "../config";
import type {
  AiSupplier, EmailSupplier, FlightPositionsSupplier, FlightStatusSupplier, FlightSupplier, HotelSupplier, IdentitySupplier, PaymentSupplier, SmsSupplier, WhatsAppSupplier,
} from "./types";
import { mockEmail, mockSms, mockWhatsApp } from "./mock/messaging";
import { mockFlights } from "./mock/flights";
import { mockHotels } from "./mock/hotels";
import { mockPayments } from "./mock/payments";
import { mockFlightStatus } from "./mock/flight-status";
import { mockFlightPositions } from "./mock/flight-positions";
import { mockAi } from "./mock/ai";
import { mockIdentity } from "./mock/identity";
import { metaWhatsApp, sesEmail, unifonicSms } from "./live/messaging";
import { gdsFlights, myFatoorah, rateHawkHotels } from "./live/commerce";
import { flightAware } from "./live/flight-status";
import { openAdsbPositions } from "./live/flight-positions";
import { claudeAi } from "./live/ai";
import { providerIdentity } from "./live/identity";

export type * from "./types";
export { outbox } from "./mock/outbox";

/* One place decides mock or live, per supplier, on every call (so a test or an env change takes effect at once). */
const pick = <T>(name: SupplierName, mock: T, live: T): T => (supplierMode(name) === "live" ? live : mock);

export const suppliers = {
  flights: (): FlightSupplier => pick("flights", mockFlights, gdsFlights),
  hotels: (): HotelSupplier => pick("hotels", mockHotels, rateHawkHotels),
  payments: (): PaymentSupplier => pick("payments", mockPayments, myFatoorah),
  sms: (): SmsSupplier => pick("sms", mockSms, unifonicSms),
  whatsapp: (): WhatsAppSupplier => pick("whatsapp", mockWhatsApp, metaWhatsApp),
  flightStatus: (): FlightStatusSupplier => pick("flightStatus", mockFlightStatus, flightAware),
  /** Live by default (free, keyless open ADS-B). */
  flightPositions: (): FlightPositionsSupplier => pick("flightPositions", mockFlightPositions, openAdsbPositions),
  ai: (): AiSupplier => pick("ai", mockAi, claudeAi),
  email: (): EmailSupplier => pick("email", mockEmail, sesEmail),
  identity: (): IdentitySupplier => pick("identity", mockIdentity, providerIdentity),
};

/** In mock SMS mode every sign-in code is this, so development and app review never need a real phone. */
export const MOCK_OTP_CODE = "123456";
