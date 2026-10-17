import { z } from 'zod';
import type { Halalas } from '../money';
import type { FxRates } from '../fx';

/*
 * What Mada sells an eSIM for, by the owner's rules (desk › eSIMs › Pricing). The supplier's wholesale price is in USD;
 * it becomes SAR at the FX table's dollar rate (fx.ts, SAR is pegged at 3.75), then:
 *
 *   1. the plan's own fixed price, if the owner set one; else
 *   2. the supplier's suggested retail, when "match suggested retail" is on; else
 *   3. the higher of cost + margin % and cost + the minimum profit (profit after the payment fee);
 *   4. friendly rounding up (whole riyal, or the next riyal ending in 9);
 *   5. never below the guard: cost plus the payment fee (MyFatoorah's % and fixed part), rounded up.
 *
 * Margin and minimum profit can be set per country or region (`where`, by coverage code) and per plan; the plan's
 * own beats the place's, which beats the global one. Everything is integer halalas once the cost is known.
 */

export const EsimRounding = z.enum(['none', 'whole', 'x9']);
export type EsimRounding = z.infer<typeof EsimRounding>;

export const EsimPriceOverride = z.object({
  marginPct: z.number().min(0).max(300).nullable().default(null),
  minProfitSar: z.number().min(0).max(1000).nullable().default(null),
  /** A plan's exact price in SAR (plans only). The guard still holds. */
  fixedSar: z.number().positive().max(10_000).nullable().default(null),
});
export type EsimPriceOverride = z.infer<typeof EsimPriceOverride>;

export const EsimPricingRules = z.object({
  marginPct: z.number().min(0).max(300).default(30),
  minProfitSar: z.number().min(0).max(1000).default(10),
  /** MyFatoorah's cut of a card payment: a percentage and a fixed part per payment. */
  paymentFeePct: z.number().min(0).max(20).default(2.5),
  paymentFeeFixedSar: z.number().min(0).max(50).default(0),
  rounding: EsimRounding.default('x9'),
  matchRetail: z.boolean().default(false),
  /** How long a price the traveller saw is kept for them, whatever the supplier does meanwhile. */
  holdMinutes: z.number().int().min(5).max(24 * 60).default(30),
  where: z.record(z.string(), EsimPriceOverride).default({}),
  plans: z.record(z.string(), EsimPriceOverride).default({}),
  /** Package ids never shown to travellers. */
  hidden: z.array(z.string()).default([]),
  /** Per coverage code (TR, europe…): the owner's picks, shown first (2–3, best value first). */
  recommended: z.record(z.string(), z.array(z.string()).max(3)).default({}),
  /** Alert below this supplier balance (USD). */
  lowBalanceUsd: z.number().min(0).max(100_000).default(50),
  /** When the supplier refuses for low balance after payment: the time Mada promises the eSIM by. */
  sortingMinutes: z.number().int().min(15).max(24 * 60).default(120),
  updatedAt: z.string().nullable().default(null),
  updatedBy: z.string().nullable().default(null),
});
export type EsimPricingRules = z.infer<typeof EsimPricingRules>;

export const ESIM_PRICING_DEFAULTS: EsimPricingRules = EsimPricingRules.parse({});

/** SAR per US dollar from the FX table (which holds one SAR in USD). */
export const usdSarOf = (fx: Pick<FxRates, 'rates'> | null | undefined): number => {
  const r = fx?.rates.USD;
  return r && r > 0 ? Math.round((1 / r) * 10_000) / 10_000 : 3.75;
};

export type EsimPriceRule = 'margin' | 'min_profit' | 'retail' | 'fixed' | 'floor';
export type EsimPriceBreakdown = {
  costUsd: number;
  cost: Halalas;
  sell: Halalas;
  fee: Halalas;
  /** What Mada keeps after the cost and the payment fee. */
  margin: Halalas;
  marginPct: number;
  /** The guard: the lowest price that still covers cost and fee. */
  floor: Halalas;
  retail: Halalas | null;
  rule: EsimPriceRule;
};

type Priced = { id: string; netUsd: number; retailUsd?: number | null; coverage: { code: string } };

/** Round halalas up to the rule: a whole riyal, or the next riyal ending in 9 (19, 29, 109). */
export function roundFriendly(h: Halalas, rounding: EsimRounding): Halalas {
  if (rounding === 'none') return Math.ceil(h);
  const sar = Math.ceil(h / 100 - 1e-9);
  if (rounding === 'whole') return sar * 100;
  return (sar % 10 === 9 ? sar : sar + ((9 - (sar % 10) + 10) % 10)) * 100;
}

const feeOf = (sell: Halalas, r: Pick<EsimPricingRules, 'paymentFeePct' | 'paymentFeeFixedSar'>) => Math.round((sell * r.paymentFeePct) / 100) + Math.round(r.paymentFeeFixedSar * 100);
/** The lowest sell price that leaves `keep` after the payment fee. */
const grossFor = (keep: Halalas, r: Pick<EsimPricingRules, 'paymentFeePct' | 'paymentFeeFixedSar'>) => Math.ceil((keep + r.paymentFeeFixedSar * 100) / (1 - r.paymentFeePct / 100) - 1e-9);

/** The price of one package by the rules, with how it was reached. */
export function esimSellPrice(p: Priced, rules: EsimPricingRules = ESIM_PRICING_DEFAULTS, usdSar = 3.75): EsimPriceBreakdown {
  const cost = Math.ceil(p.netUsd * usdSar * 100 - 1e-9);
  const own = rules.plans[p.id];
  const place = rules.where[p.coverage.code];
  const marginPct = own?.marginPct ?? place?.marginPct ?? rules.marginPct;
  const minProfit = Math.round((own?.minProfitSar ?? place?.minProfitSar ?? rules.minProfitSar) * 100);
  const retail = p.retailUsd && p.retailUsd > 0 ? Math.round(p.retailUsd * usdSar * 100) : null;
  let floor = grossFor(cost, rules);
  // The guard's own rounding check: the fee is rounded to the halala, so step up until it really covers.
  while (floor - feeOf(floor, rules) < cost) floor += 1;
  let rule: EsimPriceRule;
  let sell: Halalas;
  if (own?.fixedSar) { sell = Math.round(own.fixedSar * 100); rule = 'fixed'; }
  else if (rules.matchRetail && retail) { sell = roundFriendly(retail, rules.rounding === 'x9' ? 'whole' : rules.rounding); rule = 'retail'; }
  else {
    const byMargin = Math.ceil(cost * (1 + marginPct / 100) - 1e-9);
    const byProfit = grossFor(cost + minProfit, rules);
    rule = byProfit > byMargin ? 'min_profit' : 'margin';
    sell = roundFriendly(Math.max(byMargin, byProfit), rules.rounding);
  }
  if (sell < floor) { sell = roundFriendly(floor, rules.rounding); rule = 'floor'; }
  const fee = feeOf(sell, rules);
  const margin = sell - cost - fee;
  return { costUsd: p.netUsd, cost, sell, fee, margin, marginPct: sell ? Math.round((margin / sell) * 1000) / 10 : 0, floor, retail, rule };
}

/** A pricing function for the plan rules (schemas/esim.ts suggestEsimPlans). */
export const esimPricer = (rules: EsimPricingRules, usdSar: number) => (p: Priced): Halalas => esimSellPrice(p, rules, usdSar).sell;

/** Cost changes from one catalogue sync to the next, for the desk's "cost went up on 12 plans". */
export function esimCostChanges(before: ReadonlyMap<string, number>, after: readonly { id: string; netUsd: number }[]): { up: string[]; down: string[]; added: string[]; gone: string[] } {
  const up: string[] = [];
  const down: string[] = [];
  const added: string[] = [];
  const seen = new Set<string>();
  for (const p of after) {
    seen.add(p.id);
    const was = before.get(p.id);
    if (was === undefined) added.push(p.id);
    else if (p.netUsd > was + 1e-9) up.push(p.id);
    else if (p.netUsd < was - 1e-9) down.push(p.id);
  }
  return { up, down, added, gone: [...before.keys()].filter((k) => !seen.has(k)) };
}
