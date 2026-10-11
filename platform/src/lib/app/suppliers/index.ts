import "server-only";
import { isProductionDeploy, supplierMode, type SupplierName } from "../config";
import type {
  AiSupplier, EmailSupplier, FlightPositionsSupplier, FlightStatusSupplier, FlightSupplier, HotelSupplier, IdentitySupplier, PaymentSupplier, SmsSupplier, SupabaseAdminSupplier, SupabaseAuthSupplier, WhatsAppSupplier,
} from "./types";
import { mockEmail, mockSms, mockWhatsApp } from "./mock/messaging";
import { mockFlights } from "./mock/flights";
import { mockHotels } from "./mock/hotels";
import { mockPayments } from "./mock/payments";
import { mockFlightStatus } from "./mock/flight-status";
import { mockFlightPositions } from "./mock/flight-positions";
import { mockAi } from "./mock/ai";
import { mockIdentity } from "./mock/identity";
import { mockSupabase } from "./mock/supabase";
import { mockSupabaseAdmin } from "./mock/supabase-admin";
import { metaWhatsApp, sesEmail, unifonicSms } from "./live/messaging";
import { gdsFlights, myFatoorah, rateHawkHotels } from "./live/commerce";
import { flightAware } from "./live/flight-status";
import { openAdsbPositions } from "./live/flight-positions";
import { claudeAi } from "./live/ai";
import { providerIdentity } from "./live/identity";
import { liveSupabase } from "./live/supabase";
import { liveSupabaseAdmin } from "./live/supabase-admin";
import { taqnyatSms } from "./live/taqnyat";
import { guarded } from "../resilience/breaker";

export type * from "./types";
export { outbox } from "./mock/outbox";
export { mockSupabaseAdminLog } from "./mock/supabase-admin";

/* One place decides mock or live, per supplier, on every call (so a test or an env change takes effect at once). */
// Live adapters go through a timeout and a circuit breaker (resilience/breaker.ts); mocks stay deterministic.
const pick = <T extends object>(name: SupplierName, mock: T, live: T): T => (supplierMode(name) === "live" ? guarded(name, live) : mock);

export const suppliers = {
  flights: (): FlightSupplier => pick("flights", mockFlights, gdsFlights),
  hotels: (): HotelSupplier => pick("hotels", mockHotels, rateHawkHotels),
  payments: (): PaymentSupplier => pick("payments", mockPayments, myFatoorah),
  /** Live: Unifonic, or Taqnyat with SMS_PROVIDER=taqnyat. Also sends Supabase Auth's codes (auth/sms-hook). */
  sms: (): SmsSupplier => pick("sms", mockSms, process.env.SMS_PROVIDER === "taqnyat" ? taqnyatSms : unifonicSms),
  whatsapp: (): WhatsAppSupplier => pick("whatsapp", mockWhatsApp, metaWhatsApp),
  flightStatus: (): FlightStatusSupplier => pick("flightStatus", mockFlightStatus, flightAware),
  /** Live by default (free, keyless open ADS-B). */
  flightPositions: (): FlightPositionsSupplier => pick("flightPositions", mockFlightPositions, openAdsbPositions),
  ai: (): AiSupplier => pick("ai", mockAi, claudeAi),
  email: (): EmailSupplier => pick("email", mockEmail, sesEmail),
  identity: (): IdentitySupplier => pick("identity", mockIdentity, providerIdentity),
  /** Supabase Auth access tokens. Not behind a breaker: a bad token is the caller's problem, not an outage. */
  supabase: (): SupabaseAuthSupplier => (supplierMode("supabase") === "live" ? liveSupabase : mockSupabase),
  /**
   * Supabase's admin API, for the desk moving an account (recovery). Live needs SUPABASE_SERVICE_ROLE_KEY; without it
   * the mock records the change, except on a production deployment, where a missing key refuses (NOT_CONFIGURED).
   */
  supabaseAdmin: (): SupabaseAdminSupplier => {
    if (supplierMode("supabase") === "live" && (process.env.SUPABASE_SERVICE_ROLE_KEY || isProductionDeploy())) return liveSupabaseAdmin;
    return mockSupabaseAdmin;
  },
};

/** In mock SMS mode every sign-in code is this, so development and app review never need a real phone. */
export const MOCK_OTP_CODE = "123456";
