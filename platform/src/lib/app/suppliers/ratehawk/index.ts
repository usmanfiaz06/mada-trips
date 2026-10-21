import "server-only";
import { keyedExplicit, keyedMode } from "../../config";
import { guarded } from "../../resilience/breaker";
import { mockRateHawk } from "./mock";
import { rateHawk } from "./ratehawk";
import type { RateHawkHotels } from "./types";

export type * from "./types";
export { mergeHotelOffers, sameHotel, withSecondHotelSource } from "./merge";

/*
 * RateHawk as the second hotel source (CONNECT.md §31): SUPPLIER_MODE_RATEHAWK / RATEHAWK_KEY_ID + RATEHAWK_API_KEY.
 * Live: RateHawk behind the "ratehawk" breaker; SUPPLIER_MODE_RATEHAWK=mock merges the fixtures (staging demos);
 * otherwise none, and stays are exactly as before.
 */
export function rateHawkSource(): RateHawkHotels | null {
  const m = keyedMode("ratehawk");
  if (m === "live") return guarded("ratehawk", rateHawk);
  if (m === "mock" && keyedExplicit("ratehawk")) return mockRateHawk;
  return null;
}
