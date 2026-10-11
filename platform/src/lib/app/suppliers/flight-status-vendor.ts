import { isProductionDeploy, supplierEnvName } from "../config";
import { guarded } from "../resilience/breaker";
import type { FlightStatusInfo, FlightStatusSupplier } from "./types";
import { mockFlightStatus } from "./mock/flight-status";
import { flightAware } from "./live/flight-status";
import { aeroDataBox } from "./live/aerodatabox";
import { aviationstack } from "./live/aviationstack";

/*
 * Which flight-status vendor answers. SUPPLIER_MODE_FLIGHT_STATUS may name one (aerodatabox | aviationstack |
 * flightaware | mock; "live" means the first vendor with a key). Unset, the first key present wins:
 *   AERODATABOX_API_KEY → aerodatabox, else AVIATIONSTACK_API_KEY → aviationstack, else FLIGHTAWARE_API_KEY → flightaware,
 *   else mock (or, on a production deployment without APP_ALLOW_MOCKS=yes, "none": status reads as not available).
 * So the owner only ever adds a key. The choice is logged once per change and shown in GET /status.
 */

export type FlightStatusVendor = "aerodatabox" | "aviationstack" | "flightaware" | "mock" | "none";

const BY_KEY: [string, FlightStatusVendor][] = [["AERODATABOX_API_KEY", "aerodatabox"], ["AVIATIONSTACK_API_KEY", "aviationstack"], ["FLIGHTAWARE_API_KEY", "flightaware"]];

let logged: string | null = null;

export function flightStatusVendor(): FlightStatusVendor {
  const raw = (process.env[supplierEnvName("flightStatus")] ?? "").trim().toLowerCase();
  const byKey = BY_KEY.find(([k]) => process.env[k])?.[1] ?? null;
  let v: FlightStatusVendor;
  if (raw === "aerodatabox" || raw === "aviationstack" || raw === "flightaware" || raw === "mock") v = raw;
  else if (raw === "live") v = byKey ?? "flightaware";
  else if (byKey) v = byKey;
  else if (raw) v = "mock";
  else {
    // Nothing set: mock in development; on production the global SUPPLIER_MODE decides, never a silent mock.
    const global = (process.env.SUPPLIER_MODE ?? (isProductionDeploy() ? "live" : "mock")).toLowerCase();
    v = global === "live" ? (isProductionDeploy() && process.env.APP_ALLOW_MOCKS === "yes" ? "mock" : "none") : "mock";
  }
  const why = raw ? `SUPPLIER_MODE_FLIGHT_STATUS=${raw}` : byKey ? "its key is set" : "no flight-status key is set";
  if (logged !== `${v}|${why}`) {
    logged = `${v}|${why}`;
    console.info(`[flight-status] using ${v} (${why})`);
  }
  return v;
}

/** No vendor and no mock: every lookup is "not available", honestly. */
const unavailable: FlightStatusSupplier = {
  name: "none",
  async lookup(): Promise<FlightStatusInfo | null> { return null; },
  async watch(flightNumber, date) { return { alertId: `none:${flightNumber}:${date}` }; },
};

const LIVE: Record<"aerodatabox" | "aviationstack" | "flightaware", FlightStatusSupplier> = { aerodatabox: aeroDataBox, aviationstack, flightaware: flightAware };

/** The supplier for a vendor. Live vendors go through the flightStatus circuit breaker; mock and none don't. */
export function flightStatusFor(v: FlightStatusVendor): FlightStatusSupplier {
  if (v === "mock") return mockFlightStatus;
  if (v === "none") return unavailable;
  return guarded("flightStatus", LIVE[v]);
}
