import "server-only";
import { keyedExplicit, keyedMode } from "../../config";
import { guarded } from "../../resilience/breaker";
import { duffel } from "./duffel";
import { mockDuffel } from "./mock";
import type { DuffelFlights } from "./types";

export type * from "./types";
export { mergeFlightOffers, withSecondSource, flightsKey } from "./merge";

/*
 * Duffel as the second flight source (CONNECT.md §30): SUPPLIER_MODE_DUFFEL / DUFFEL_ACCESS_TOKEN. Live: Duffel behind
 * the "duffel" breaker; SUPPLIER_MODE_DUFFEL=mock joins the fixtures (staging demos); otherwise none, and flights are
 * exactly as before.
 */
export function duffelSource(): DuffelFlights | null {
  const m = keyedMode("duffel");
  if (m === "live") return guarded("duffel", duffel);
  if (m === "mock" && keyedExplicit("duffel")) return mockDuffel;
  return null;
}
