import { costHalalas, pricingRules, type PricingRules } from "./hotelbeds/money";

/**
 * What the traveller pays for a supplier's net amount in the keyed suppliers (car hire, Klook, Duffel, RateHawk): cost
 * at our rate plus the FX buffer (hotelbeds/money.ts), × (1 + the markup in `env` basis points), rounded up to a riyal.
 */
export function markedUp(net: number, currency: string, env: string, defaultBps: number, rules: PricingRules = pricingRules()): number {
  const raw = Number(process.env[env] ?? defaultBps);
  const bps = Number.isFinite(raw) && raw >= 0 && raw <= 10_000 ? raw : defaultBps;
  return Math.ceil(Math.round(costHalalas(net, currency, rules) * (1 + bps / 10_000)) / 100) * 100;
}

/** A supplier amount in halalas with no markup (deposits, excess, cover sold at the insurer's price). */
export const plainHalalas = (amount: number, currency: string) => costHalalas(amount, currency);
