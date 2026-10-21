import "server-only";
import { keyedMode } from "../../config";
import { AppError } from "../../http";
import { guarded } from "../../resilience/breaker";
import { mockInsurance } from "./mock";
import { xCover } from "./xcover";
import type { InsuranceSupplier } from "./types";

export type * from "./types";

/*
 * Travel insurance (CONNECT.md §28): SUPPLIER_MODE_INSURANCE / XCOVER_API_KEY + XCOVER_API_SECRET + XCOVER_PARTNER_CODE.
 * Live: XCover behind the "insurance" breaker; mock: the priced table; off: NOT_CONFIGURED (the app doesn't offer it).
 * Before live in Saudi Arabia, the licensing in CONNECT.md §28 must be in place: the keys alone aren't enough.
 */
export function insurance(): InsuranceSupplier {
  const m = keyedMode("insurance");
  if (m === "live") return guarded("insurance", xCover);
  if (m === "mock") return mockInsurance;
  throw new AppError("NOT_CONFIGURED");
}

export const insuranceAvailable = () => keyedMode("insurance") !== "off";
