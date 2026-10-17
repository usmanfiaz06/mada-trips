import type { EsimInstall, EsimPackage, EsimUsage } from "@mada/shared";
import { AppError } from "../http";

/*
 * The eSIM supplier (eSIM Access or Airalo live, fixtures in mock). Everything in our words: packages as EsimPackage,
 * an eSIM's install codes as EsimInstall plus its ICCID, usage as EsimUsage. Every order and top-up carries our own
 * reference as its description (Airalo's description, eSIM Access's transactionId), and findOrder looks it up, so a
 * retry never buys twice.
 *
 * `ref` is the supplier's own id for one eSIM when it has one (eSIM Access's esimTranNo: ICCIDs get reused there); the
 * calls that take an ICCID take it too, and Airalo ignores it.
 */

export type EsimSim = { iccid: string; ref?: string | null } & EsimInstall;

export type EsimSupplierOrder = {
  id: string;
  code: string | null;
  packageId: string;
  quantity: number;
  description: string;
  netUsd: number | null;
  sims: EsimSim[];
  /** Ordered, and the supplier is still making the eSIMs (eSIM Access): sims come with the webhook or a later look. */
  pending?: boolean;
};

export type EsimRefundReason = "INSTALLATION_FAILURE" | "NO_COVERAGE" | "TRIP_CANCELLATION" | "WRONG_PURCHASE" | "INCOMPATIBLE_DEVICE" | "OTHERS";

export type EsimVendor = "esimaccess" | "airalo" | "mock";

export interface EsimSupplier {
  readonly name: EsimVendor;
  /** Local packages for one country, or the regional and global ones (`global`). */
  packages(q: { country: string } | { global: true }): Promise<EsimPackage[]>;
  /** Every package there is, for the daily catalogue sync. Absent: the sync asks per country. */
  catalogue?(): Promise<EsimPackage[]>;
  /** Top-ups that fit an eSIM already sold. Coverage is the eSIM's own (the caller fills it in). */
  topupPackages(iccid: string, ref?: string | null): Promise<EsimPackage[]>;
  /** `days`: how many days of a daily plan. */
  order(input: { packageId: string; quantity: number; description: string; days?: number; demoFail?: boolean }): Promise<EsimSupplierOrder>;
  /** An order or top-up placed with this description, or null: the check before any retry. `orderId`: the supplier's id, when we kept it. */
  findOrder(description: string, orderId?: string | null): Promise<EsimSupplierOrder | null>;
  sim(iccid: string, ref?: string | null): Promise<EsimSim>;
  usage(iccid: string, ref?: string | null): Promise<EsimUsage>;
  topup(input: { iccid: string; ref?: string | null; packageId: string; description: string; days?: number }): Promise<{ id: string }>;
  /** Money back on eSIMs nobody used: Airalo reviews a request; eSIM Access cancels an uninstalled one at once. */
  refund(input: { iccids: string[]; refs?: (string | null)[]; reason: EsimRefundReason; notes?: string }): Promise<{ id: string }>;
  /** The prepaid balance left at the supplier, in USD. Absent: the supplier bills otherwise. */
  balance?(): Promise<{ usd: number }>;
}

/**
 * The supplier said no for a business reason (out of stock, a package gone, a top-up not allowed). Not an outage, so
 * it doesn't open the circuit breaker. `retryable`: the same call may work later (maintenance, stock).
 */
export class EsimRefused extends AppError {
  /** `lowBalance`: our prepaid balance at the supplier ran out (money is ours to add, not the traveller's problem). */
  constructor(readonly supplierCode: number | string, readonly reason: string, readonly retryable = false, readonly duplicate = false, readonly lowBalance = false) {
    super("VALIDATION", { message: reason, details: { supplierCode, retryable } });
  }
}
