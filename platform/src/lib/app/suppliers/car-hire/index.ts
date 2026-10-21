import "server-only";
import { keyedMode } from "../../config";
import { AppError } from "../../http";
import { guarded } from "../../resilience/breaker";
import { carTrawler } from "./cartrawler";
import { mockCarHire } from "./mock";
import type { CarHireSupplier } from "./types";

export type * from "./types";

/*
 * Self-drive car hire (CONNECT.md §25): SUPPLIER_MODE_CAR_HIRE / CARTRAWLER_CLIENT_ID. Live: CarTrawler behind the
 * "carHire" breaker; mock: the fixtures; off: NOT_CONFIGURED, and the app offers "Ask Mada for a car" instead.
 */
export function carHire(): CarHireSupplier {
  const m = keyedMode("carHire");
  if (m === "live") return guarded("carHire", carTrawler);
  if (m === "mock") return mockCarHire;
  throw new AppError("NOT_CONFIGURED");
}

export const carHireAvailable = () => keyedMode("carHire") !== "off";
