import { sarToHalalas, type Halalas } from '../money';
import type { EsimPackage } from './esim-data';
import { GB_A_DAY, esimCoverageFor, recommendEsimPlan, totalGb, withSizes, type EsimPlan, type EsimSize } from './esim';

/*
 * Server-side eSIM plan building and pricing (net price → the traveller's price): what Mada pays and adds never ships in
 * the app, so this lives outside the shared index (import from '@mada/shared/internal'). The app's mock API reads it
 * only in a mock build.
 */

/** What the traveller pays for an eSIM, in halalas: net USD at the peg, plus the markup, rounded up to a whole riyal. */
export const USD_SAR = 3.75;
export const ESIM_MARKUP_BPS = 3000;
export function esimPrice(netUsd: number, markupBps = ESIM_MARKUP_BPS): Halalas {
  const sar = netUsd * USD_SAR * (1 + markupBps / 10_000);
  return sarToHalalas(Math.ceil(sar - 1e-9));
}


/**
 * Plans worth offering as a choice: a plan goes when another of the same coverage gives at least as much data for at
 * least as many days at the same price or less (5 GB · 30 days at SAR 29 next to 10 GB · 30 days at SAR 29). Of plans
 * that are the same to the traveller, the one that costs Mada least stays. `price` is what the traveller pays.
 */
export function undominatedPlans<T extends Pick<EsimPackage, 'coverage' | 'gb' | 'days' | 'daily' | 'netUsd' | 'id'>>(list: readonly T[], price: (p: T) => number): T[] {
  const priced = list.map((p) => ({ p, price: price(p), gb: totalGb(p) }))
    .sort((a, b) => a.price - b.price || b.gb - a.gb || b.p.days - a.p.days || a.p.netUsd - b.p.netUsd || a.p.id.localeCompare(b.p.id));
  const kept: typeof priced = [];
  for (const x of priced) {
    const beaten = kept.some((k) => k.p.coverage.code === x.p.coverage.code && k.p.coverage.kind === x.p.coverage.kind && k.gb >= x.gb && k.p.days >= x.p.days && k.price <= x.price);
    if (!beaten) kept.push(x);
  }
  return list.filter((p) => kept.some((k) => k.p === p));
}


/**
 * Two or three sizes for the trip: each the shortest plan that lasts the trip at that size; light below what a day
 * usually takes, regular at it, heavy above. When nothing lasts the trip, the longest there is. A plan another one
 * beats on data, days and price is never one of them (undominatedPlans), and the one recommended is the cheapest that
 * covers the trip (recommendEsimPlan).
 */
export function suggestEsimPlans(
  packages: readonly EsimPackage[],
  q: { countries: readonly string[]; days: number; markupBps?: number; price?: Pricer; picks?: readonly string[] },
): { coverage: EsimPackage['coverage'] | null; plans: EsimPlan[]; recommended: string | null; more: EsimPlan[] } {
  const coverage = esimCoverageFor(packages, q.countries);
  if (!coverage) return { coverage: null, plans: [], recommended: null, more: [] };
  const here = packages.filter((p) => p.coverage.code === coverage.code && p.coverage.kind === coverage.kind);
  // A daily plan becomes one plan for the trip's days: the day's price times the days.
  const daily = here.filter((p) => p.daily).map((p) => ({ ...p, days: q.days, netUsd: p.netUsd * q.days, retailUsd: p.retailUsd ? p.retailUsd * q.days : p.retailUsd }));
  const mine = here.filter((p) => !p.daily);
  const priceOf = (p: EsimPackage) => (q.price ? q.price(p) : esimPrice(p.netUsd, q.markupBps));
  const value = (p: EsimPlan) => (p.gb === null ? 0 : p.price.amount / (p.daily ? p.gb * p.days : p.gb));
  const moreOf = (shown: readonly EsimPlan[]) => [...mine.filter((p) => p.days >= q.days), ...daily]
    .filter((p) => !shown.some((s) => s.id === p.id))
    .map((p) => planOf(p, 'regular', true, q.markupBps, q.price))
    .sort((a, b) => value(a) - value(b) || a.price.amount - b.price.amount)
    .slice(0, 40);
  // The owner's picks for this place, when there are any: sizes by data, without a pick another pick beats.
  const picked = undominatedPlans((q.picks ?? []).map((id) => [...mine, ...daily].find((p) => p.id === id)).filter((p): p is EsimPackage => !!p).slice(0, 3), priceOf);
  if (picked.length) {
    const sorted = [...picked].sort((a, b) => totalGb(a) - totalGb(b));
    const plans = withSizes(sorted.map((p) => planOf(p, 'regular', p.days >= q.days, q.markupBps, q.price)), q.days);
    return { coverage, plans, recommended: recommendEsimPlan(plans, q.days)?.id ?? null, more: moreOf(plans) };
  }
  if (!mine.length) {
    const plans = daily.slice(0, 1).map((p) => planOf(p, 'regular', true, q.markupBps, q.price));
    return { coverage, plans, recommended: plans[0]?.id ?? null, more: moreOf(plans) };
  }
  const longEnough = mine.filter((p) => p.days >= q.days);
  const longest = Math.max(...mine.map((p) => p.days));
  const pool = undominatedPlans(longEnough.length ? longEnough : mine.filter((p) => p.days === longest), priceOf);
  // One package per size: the shortest that lasts.
  const bySize = new Map<string, EsimPackage>();
  for (const p of [...pool].sort((a, b) => a.days - b.days || a.netUsd - b.netUsd)) {
    const k = p.gb === null ? 'u' : String(p.gb);
    if (!bySize.has(k)) bySize.set(k, p);
  }
  const sized = [...bySize.values()].sort((a, b) => (a.gb ?? 1e6) - (b.gb ?? 1e6));
  const need = q.days * GB_A_DAY;
  let mid = sized.findIndex((p) => p.gb === null || p.gb >= need);
  if (mid < 0) mid = sized.length - 1;
  const picks: [EsimPackage, EsimSize][] = [];
  if (sized[mid - 1]) picks.push([sized[mid - 1]!, 'light']);
  picks.push([sized[mid]!, 'regular']);
  if (sized[mid + 1]) picks.push([sized[mid + 1]!, 'heavy']);
  if (picks.length < 3 && !sized[mid - 1] && sized[mid + 2]) picks.push([sized[mid + 2]!, 'heavy']);
  // Sized next to each other, so no two share a word (10 GB and 20 GB were both "Heavy" when nothing was lighter).
  const plans = withSizes(picks.map(([p, size]) => planOf(p, size, p.days >= q.days, q.markupBps, q.price)), q.days);
  return { coverage, plans, recommended: recommendEsimPlan(plans, q.days)?.id ?? null, more: moreOf(plans) };
}


/** A package's price in halalas (the owner's rules, schemas/esim-pricing.ts); the plain markup when none is given. */
export type Pricer = (p: EsimPackage) => Halalas;

export const planOf = (p: EsimPackage, size: EsimSize, fits: boolean, markupBps?: number, price?: Pricer): EsimPlan => ({
  id: p.id, coverage: p.coverage, gb: p.gb, days: p.days, price: { amount: price ? price(p) : esimPrice(p.netUsd, markupBps), currency: 'SAR' }, size, fits, operator: p.operator, topup: p.topup,
  ...(p.daily ? { daily: true } : {}),
});

/** Top-up sizes for an eSIM: up to three, smallest first. */
export function topupPlans(packages: readonly EsimPackage[], markupBps?: number, price?: Pricer): EsimPlan[] {
  const sorted = [...packages].sort((a, b) => (a.gb ?? 1e6) - (b.gb ?? 1e6) || a.days - b.days);
  const seen = new Set<string>();
  const out: EsimPackage[] = [];
  for (const p of sorted) { const k = `${p.gb}`; if (!seen.has(k)) { seen.add(k); out.push(p); } }
  const three = out.length > 3 ? [out[0]!, out[Math.floor(out.length / 2)]!, out[out.length - 1]!] : out;
  const sizes: EsimSize[] = three.length === 3 ? ['light', 'regular', 'heavy'] : three.length === 2 ? ['light', 'regular'] : ['regular'];
  return three.map((p, i) => planOf(p, sizes[i]!, true, markupBps, price));
}

