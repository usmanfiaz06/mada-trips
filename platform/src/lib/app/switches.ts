import "server-only";
import type { FlightsMode } from "@mada/shared";
import { isProductionDeploy, supplierMode } from "./config";

/*
 * The beta's switches, read from the environment on every call (tests and serverless both set env before use).
 *
 *   APP_FLIGHTS_MODE            request | live. "request": Ask turns a flight search into a request to the desk
 *                               ("Tell us where and when"), the desk quotes fares it booked in Mada's own system,
 *                               the traveller pays in the app. "live": search the flights supplier (TBO Air with
 *                               SUPPLIER_MODE_FLIGHTS=tbo; the desk holds and tickets from the order page, and any
 *                               route TBO can't answer goes to the desk as a request). Default: live when a GDS
 *                               adapter is configured (GDS_API_URL), or outside production on the mock catalogue;
 *                               request everywhere else. TBO keys alone never switch it: set "live" once TBO has
 *                               certified us (docs/app/TBO.md).
 *   APP_BOOKING_REQUIRES_PHONE  yes | no (default yes). "no" lets accounts without a verified phone book (email only,
 *                               until WhatsApp codes are live); they type a contact number at payment, stored on the
 *                               order as not verified, and the desk calls to confirm.
 *   APP_DESK_AUTOPILOT          on | off. The mock desk that moves orders and requests on by itself. Never on a
 *                               production deployment unless set to "on" (booking/common.ts).
 */

export const gdsConfigured = () => !!process.env.GDS_API_URL;

export function flightsMode(): FlightsMode {
  const v = process.env.APP_FLIGHTS_MODE?.trim().toLowerCase();
  if (v === "request" || v === "live") return v;
  if (gdsConfigured()) return "live";
  if (isProductionDeploy()) return "request";
  // Local, tests and demos: the mock catalogue answers searches.
  try { return supplierMode("flights") === "mock" ? "live" : "request"; } catch { return "request"; }
}

/** Booking needs a verified phone (AUTH.md). "no" for the beta while phone codes aren't live. */
export function bookingRequiresPhone(): boolean {
  return process.env.APP_BOOKING_REQUIRES_PHONE?.trim().toLowerCase() !== "no";
}
