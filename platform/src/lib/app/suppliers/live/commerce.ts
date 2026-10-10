import type { FlightSupplier, HotelSupplier, PaymentSupplier } from "../types";
import { notConfigured } from "./not-configured";

/*
 * Live supply and payments wait on accounts only Mada can open (INTEGRATIONS.md §1):
 *   flights  → Mada's GDS Enterprise API (decision D15: which GDS) + Travelfusion for flynas/flyadeal
 *   hotels   → RateHawk + WebBeds
 *   payments → MyFatoorah merchant account (authorise on request, capture on issue, void on failure)
 * Until then these answer NOT_CONFIGURED, and the app runs on the mocks.
 */

export const gdsFlights: FlightSupplier = {
  name: "gds",
  async search() { return notConfigured("flights (GDS)", ["GDS_API_URL", "GDS_CLIENT_ID", "GDS_CLIENT_SECRET"]); },
  async price() { return notConfigured("flights (GDS)", ["GDS_API_URL"]); },
  async hold() { return notConfigured("flights (GDS)", ["GDS_API_URL"]); },
};

export const rateHawkHotels: HotelSupplier = {
  name: "ratehawk",
  async search() { return notConfigured("hotels (RateHawk)", ["RATEHAWK_KEY_ID", "RATEHAWK_API_KEY"]); },
  async price() { return notConfigured("hotels (RateHawk)", ["RATEHAWK_KEY_ID"]); },
};

export const myFatoorah: PaymentSupplier = {
  name: "myfatoorah",
  async authorize() { return notConfigured("payments (MyFatoorah)", ["MYFATOORAH_API_KEY", "MYFATOORAH_BASE_URL"]); },
  async capture() { return notConfigured("payments (MyFatoorah)", ["MYFATOORAH_API_KEY"]); },
  async void() { return notConfigured("payments (MyFatoorah)", ["MYFATOORAH_API_KEY"]); },
  async refund() { return notConfigured("payments (MyFatoorah)", ["MYFATOORAH_API_KEY"]); },
};
