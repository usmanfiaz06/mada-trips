/*
 * Hotelbeds prices in the account's contract currency (EUR on most accounts; the test account answers EUR). The app
 * shows and charges riyals, so every supplier amount goes through here: convert at our rate, add the FX buffer and
 * Mada's markup, round up to a whole riyal, and never sell below the hotel's own public price (hotelMandatory).
 *
 *   APP_FX_RATES          SAR per unit, e.g. "EUR=4.12,USD=3.75,GBP=4.80,TRY=0.11". Missing currencies fall back to
 *                         DEFAULT_FX below (USD is the official peg; the others are conservative placeholders the
 *                         owner must keep current). An unknown currency refuses to price (never guess).
 *   APP_FX_BUFFER_BPS     added on top of the rate for card FX and drift between booking and paying (default 150 = 1.5%).
 *   APP_STAY_MARKUP_BPS   Mada's margin on a room (default 1000 = 10%).
 *   APP_TRANSFER_MARKUP_BPS  on a transfer (default 1500 = 15%).
 *
 * Amounts out are halalas (integers), like everything else that leaves the server.
 */

export const DEFAULT_FX: Readonly<Record<string, number>> = {
  SAR: 1,
  USD: 3.75, // the riyal's peg
  EUR: 4.15,
  GBP: 4.9,
  AED: 1.0215,
  TRY: 0.115,
  EGP: 0.078,
  AZN: 2.21,
  GEL: 1.39,
};

export class UnknownCurrency extends Error {
  constructor(readonly currency: string) { super(`No FX rate for ${currency}: set APP_FX_RATES`); }
}

const bps = (raw: string | undefined, fallback: number) => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 10_000 ? n : fallback;
};

export function fxRates(env: NodeJS.ProcessEnv = process.env): Record<string, number> {
  const out: Record<string, number> = { ...DEFAULT_FX };
  for (const part of (env.APP_FX_RATES ?? "").split(",")) {
    const m = /^\s*([A-Z]{3})\s*[=:]\s*([0-9]*\.?[0-9]+)\s*$/.exec(part);
    if (m && Number(m[2]) > 0) out[m[1]!] = Number(m[2]);
  }
  out.SAR = 1;
  return out;
}

export type PricingRules = { fxBufferBps: number; stayMarkupBps: number; transferMarkupBps: number; rates: Record<string, number> };

export function pricingRules(env: NodeJS.ProcessEnv = process.env): PricingRules {
  return {
    fxBufferBps: bps(env.APP_FX_BUFFER_BPS, 150),
    stayMarkupBps: bps(env.APP_STAY_MARKUP_BPS, 1000),
    transferMarkupBps: bps(env.APP_TRANSFER_MARKUP_BPS, 1500),
    rates: fxRates(env),
  };
}

/** A supplier amount in halalas at our rate plus the buffer (cost to Mada, no markup). */
export function costHalalas(amount: number, currency: string, rules: PricingRules = pricingRules()): number {
  const cur = currency.toUpperCase();
  const rate = rules.rates[cur];
  if (!rate) throw new UnknownCurrency(cur);
  const buffer = cur === "SAR" ? 0 : rules.fxBufferBps;
  return Math.round(amount * rate * 100 * (1 + buffer / 10_000));
}

const upToRiyal = (h: number) => Math.ceil(h / 100) * 100;

/**
 * What the traveller pays for a supplier net amount: cost × (1 + markup), rounded up to a whole riyal. When the hotel
 * has a mandatory selling price (Hotelbeds `sellingRate` with `hotelMandatory: true`) we never go below it.
 */
export function sellHalalas(net: number, currency: string, kind: "stay" | "transfer", opts: { floor?: number | null; rules?: PricingRules } = {}): number {
  const rules = opts.rules ?? pricingRules();
  const markup = kind === "stay" ? rules.stayMarkupBps : rules.transferMarkupBps;
  const withMarkup = Math.round(costHalalas(net, currency, rules) * (1 + markup / 10_000));
  const floor = opts.floor ? costHalalas(opts.floor, currency, rules) : 0;
  return upToRiyal(Math.max(withMarkup, floor));
}

/** A cancellation fee as the traveller sees it: the supplier's fee in proportion to what they paid us, never more. */
export function feeHalalas(fee: number, net: number, total: number): number {
  if (fee <= 0 || net <= 0) return 0;
  return Math.min(total, upToRiyal(Math.round((fee / net) * total)));
}
