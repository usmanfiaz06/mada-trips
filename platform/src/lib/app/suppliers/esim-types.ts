import type { EsimInstall, EsimPackage, EsimUsage } from "@mada/shared";
import { AppError } from "../http";

/*
 * The eSIM supplier (Airalo live, fixtures in mock). Everything in our words: packages as EsimPackage, an eSIM's
 * install codes as EsimInstall plus its ICCID, usage as EsimUsage. Airalo has no idempotency key: every order and top-up
 * carries our own reference as its description, and findOrder looks it up, so a retry never buys twice.
 */

export type EsimSim = { iccid: string } & EsimInstall;

export type EsimSupplierOrder = {
  id: string;
  code: string | null;
  packageId: string;
  quantity: number;
  description: string;
  netUsd: number | null;
  sims: EsimSim[];
};

export type EsimRefundReason = "INSTALLATION_FAILURE" | "NO_COVERAGE" | "TRIP_CANCELLATION" | "WRONG_PURCHASE" | "INCOMPATIBLE_DEVICE" | "OTHERS";

export interface EsimSupplier {
  readonly name: "airalo" | "mock";
  /** Local packages for one country, or the regional and global ones (`global`). */
  packages(q: { country: string } | { global: true }): Promise<EsimPackage[]>;
  /** Top-ups that fit an eSIM already sold. Coverage is the eSIM's own (the caller fills it in). */
  topupPackages(iccid: string): Promise<EsimPackage[]>;
  order(input: { packageId: string; quantity: number; description: string; demoFail?: boolean }): Promise<EsimSupplierOrder>;
  /** An order or top-up placed with this description, or null: the check before any retry. */
  findOrder(description: string): Promise<EsimSupplierOrder | null>;
  sim(iccid: string): Promise<EsimSim>;
  usage(iccid: string): Promise<EsimUsage>;
  topup(input: { iccid: string; packageId: string; description: string }): Promise<{ id: string }>;
  /** Ask the supplier for its money back on eSIMs nobody used (reviewed by them; credited as supplier credit). */
  refund(input: { iccids: string[]; reason: EsimRefundReason; notes?: string }): Promise<{ id: string }>;
}

/**
 * The supplier said no for a business reason (out of stock, a package gone, a top-up not allowed). Not an outage, so
 * it doesn't open the circuit breaker. `retryable`: the same call may work later (maintenance, stock).
 */
export class EsimRefused extends AppError {
  constructor(readonly supplierCode: number | string, readonly reason: string, readonly retryable = false, readonly duplicate = false) {
    super("VALIDATION", { message: reason, details: { supplierCode, retryable } });
  }
}
