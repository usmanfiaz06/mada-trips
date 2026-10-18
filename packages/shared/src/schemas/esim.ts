import { z } from 'zod';
import { Id, IsoDateTime, IsoDay, Money } from './common';
import { RequestResult } from './outcomes';
import { COUNTRY_CODES, ESIM_NAMED, ESIM_PHONES, NO_ESIM_PHONES, type EsimPackage } from './esim-data';
import { DESTINATIONS } from './booking-data';
import { ESIM_REGION_WORDS, esimCountry, esimFlag, findEsimPlace } from './esim-places';
import { sarToHalalas, type Halalas } from '../money';

/*
 * eSIMs (Airalo): a plan for the trip's country and days, one per traveller who wants it, paid on the order sheet
 * (order kind 'esim'), ordered from the supplier once the payment is captured, then installed from the phone: a one-tap
 * link on iPhone, a QR code and the codes on Android. On the trip: what's left, when it ends, top up.
 *
 * The rules here run on the server and in the app's mock API alike: which coverage fits the trip, which 2–3 sizes to
 * show, the price from the supplier's net price, whether a phone takes an eSIM, and the iPhone install link.
 */

export * from './esim-data';
export * from './esim-places';

export const ESIM_ROUTES = {
  plans: '/esim/plans',
  /** Every country and region the supplier sells, named in English and Arabic, for the planner's search. */
  places: '/esim/places',
  esims: '/esims',
  esim: (id: string) => `/esims/${id}`,
  topups: (id: string) => `/esims/${id}/topups`,
  installed: (id: string) => `/esims/${id}/installed`,
  /** Airalo's webhook (low data, async orders). */
  webhook: '/esim/airalo/webhook',
  /** eSIM Access's webhook (order, eSIM, data and validity notices). */
  esimAccessWebhook: '/esim/esimaccess/webhook',
} as const;

export const EsimCoverageKind = z.enum(['local', 'regional', 'global']);
export type EsimCoverageKind = z.infer<typeof EsimCoverageKind>;
export const EsimSize = z.enum(['light', 'regular', 'heavy']);
export type EsimSize = z.infer<typeof EsimSize>;

export const EsimPlan = z.object({
  /** The supplier's package id (Airalo: "merhaba-7days-1gb"). */
  id: z.string().min(1).max(80),
  coverage: z.object({ kind: EsimCoverageKind, code: z.string(), name: z.string(), countries: z.array(z.string()) }),
  /** Gigabytes; null when unlimited. */
  gb: z.number().nullable(),
  days: z.number().int().positive(),
  /** Per eSIM, all in, in SAR. */
  price: Money,
  size: EsimSize,
  /** Lasts the whole trip. False: the longest there is, and a top-up covers the rest. */
  fits: z.boolean(),
  operator: z.string(),
  topup: z.boolean(),
  /** A daily plan: `gb` is each day's allowance, `days` the trip's. */
  daily: z.boolean().optional(),
});
export type EsimPlan = z.infer<typeof EsimPlan>;

export const EsimPlansQuery = z.object({
  tripId: Id.optional(),
  /** A DESTINATIONS key ("istanbul") or ISO country codes ("TR,GR"). */
  destination: z.string().max(40).optional(),
  countries: z.string().regex(/^[A-Z]{2}(,[A-Z]{2}){0,9}$/).optional(),
  /** A region the supplier sells, by its coverage code ("europe", "EU-42") or Mada's word for it ("europe", "world"). */
  region: z.string().max(40).optional(),
  days: z.coerce.number().int().min(1).max(90).optional(),
});

export const EsimPlansResponse = z.object({
  outcome: z.enum(['ok', 'none']),
  where: z.object({ countries: z.array(z.string()), code: z.string(), kind: EsimCoverageKind }).nullable(),
  days: z.number().int(),
  start: IsoDay.nullable(),
  tripId: Id.nullable(),
  plans: z.array(EsimPlan).max(3),
  recommended: z.string().nullable(),
  /** Every other plan for the same place, best value first ("See all plans"). */
  more: z.array(EsimPlan).max(40).default([]),
  /** The trip's travellers (or the household), and whether each already has an eSIM for this trip. */
  people: z.array(z.object({ id: Id, name: z.string(), has: z.boolean() })),
  supplier: z.enum(['esimaccess', 'airalo', 'mock']),
  /**
   * No plan for the place asked: what's closest instead, a region sold for the countries around it (or the global
   * plan), offered as its own choice; null when there is nothing near. `name` is the supplier's title.
   */
  alt: z.object({ code: z.string(), kind: EsimCoverageKind, name: z.string() }).nullable().optional(),
});
export type EsimPlansResponse = z.infer<typeof EsimPlansResponse>;

/** A country or region the supplier sells: `code` is the ISO code, or the region's coverage code for `region=`. */
export const EsimPlace = z.object({
  code: z.string().min(2).max(40),
  kind: z.enum(['country', 'region']),
  en: z.string(),
  ar: z.string(),
  /** The flag emoji (countries); null for a region. */
  flag: z.string().nullable(),
  /** A region's countries. */
  countries: z.array(z.string()).optional(),
});
export type EsimPlace = z.infer<typeof EsimPlace>;
export const EsimPlacesResponse = z.object({ places: z.array(EsimPlace).max(600) });
export type EsimPlacesResponse = z.infer<typeof EsimPlacesResponse>;

export const EsimStatus = z.enum(['ordering', 'ready', 'installed', 'active', 'used_up', 'expired', 'refunded', 'stuck']);
export type EsimStatus = z.infer<typeof EsimStatus>;

export const EsimInstall = z.object({
  /** The whole activation code, "LPA:1$<SM-DP+>$<matching id>": what the QR code holds. */
  lpa: z.string(),
  smdp: z.string(),
  matchingId: z.string(),
  /** iOS 17.4 and later: opens Settings with the eSIM ready to add. */
  iosLink: z.string(),
  apn: z.object({ type: z.enum(['automatic', 'manual']), value: z.string().nullable() }),
  roaming: z.boolean(),
});
export type EsimInstall = z.infer<typeof EsimInstall>;

export const EsimUsage = z.object({
  totalMb: z.number().nullable(),
  leftMb: z.number().nullable(),
  unlimited: z.boolean(),
  expiresAt: IsoDateTime.nullable(),
  /** The supplier's word: NOT_ACTIVE, ACTIVE, FINISHED, EXPIRED. */
  state: z.enum(['not_active', 'active', 'finished', 'expired', 'unknown']),
  checkedAt: IsoDateTime,
});
export type EsimUsage = z.infer<typeof EsimUsage>;

export const EsimView = z.object({
  id: Id,
  orderId: Id,
  tripId: Id.nullable(),
  travellerId: Id.nullable(),
  travellerName: z.string().nullable(),
  status: EsimStatus,
  plan: EsimPlan.omit({ price: true, size: true, fits: true }),
  /** The country or region in the reader's words. */
  where: z.string(),
  iccid: z.string().nullable(),
  install: EsimInstall.nullable(),
  usage: EsimUsage.nullable(),
  topups: z.array(z.object({ gb: z.number().nullable(), days: z.number().int(), at: IsoDateTime })),
  /** Bought, and the supplier couldn't give it: the refund, as an outcome. */
  result: RequestResult.nullable(),
  installedAt: IsoDateTime.nullable(),
  createdAt: IsoDateTime,
  /** Paid, and Mada is sorting it with the network: the time it's promised by. */
  readyBy: IsoDateTime.nullable().optional(),
});
export type EsimView = z.infer<typeof EsimView>;

export const EsimsResponse = z.object({ esims: z.array(EsimView) });
export const EsimResponse = z.object({ esim: EsimView });
export const EsimTopupsResponse = z.object({ esim: EsimView, plans: z.array(EsimPlan).max(3) });

/** Airalo's low-data webhook. */
export const AiraloLowData = z.object({ level: z.string(), package_name: z.string().optional(), remaining_percentage: z.number().optional(), iccid: z.string() });

/* ───────────── the rules ───────────── */

/** What the traveller pays for an eSIM, in halalas: net USD at the peg, plus the markup, rounded up to a whole riyal. */
export const USD_SAR = 3.75;
export const ESIM_MARKUP_BPS = 3000;
export function esimPrice(netUsd: number, markupBps = ESIM_MARKUP_BPS): Halalas {
  const sar = netUsd * USD_SAR * (1 + markupBps / 10_000);
  return sarToHalalas(Math.ceil(sar - 1e-9));
}

/** The iPhone link that adds the eSIM in one tap (iOS 17.4+). */
export const iosInstallLink = (lpa: string) => `https://esimsetup.apple.com/esim_qrcode_provisioning?carddata=${lpa}`;

/** "LPA:1$smdp$matching" from its parts, and back. */
export const lpaOf = (smdp: string, matchingId: string) => `LPA:1$${smdp}$${matchingId}`;
export function lpaParts(code: string): { smdp: string; matchingId: string } | null {
  const m = /^LPA:1\$([^$]+)\$([^$]*)/.exec(code.trim());
  return m ? { smdp: m[1]!, matchingId: m[2]! } : null;
}

/** The ISO codes of a trip's countries: its city if Mada knows it, else its country's name. */
export function esimCountriesOf(trip: { city: string; country: string | null }): string[] {
  const byCity = Object.values(DESTINATIONS).find((d) => d.name.toLowerCase() === trip.city.toLowerCase());
  if (byCity) return [byCity.country];
  const c = trip.country ? COUNTRY_CODES[trip.country.toLowerCase()] ?? (/^[A-Z]{2}$/.test(trip.country) ? trip.country : null) : null;
  if (c) return [c];
  // Any other country or city Mada can name ("Pakistan", "Lahore").
  const hit = findEsimPlace(trip.country ?? '') ?? findEsimPlace(trip.city);
  return hit?.kind === 'country' ? [hit.code] : [];
}

/** Days on the ground, counting the day you land and the day you leave. At least 1. */
export function esimDays(start: string | null, end: string | null): number {
  if (!start || !end) return 7;
  const d = Math.round((Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86_400_000) + 1;
  return Math.max(1, Math.min(90, d));
}

/** The coverage that fits the countries: the country's own, else the smallest region with all of them, else global. */
export function esimCoverageFor(packages: readonly EsimPackage[], countries: readonly string[]): EsimPackage['coverage'] | null {
  if (!countries.length) return null;
  if (countries.length === 1) {
    const own = packages.find((p) => p.coverage.kind === 'local' && p.coverage.countries[0] === countries[0]);
    if (own) return own.coverage;
  }
  const covers = (p: EsimPackage) => countries.every((c) => p.coverage.countries.includes(c));
  const regional = packages.filter((p) => p.coverage.kind === 'regional' && covers(p)).sort((a, b) => a.coverage.countries.length - b.coverage.countries.length)[0];
  if (regional) return regional.coverage;
  return packages.find((p) => p.coverage.kind === 'global' && covers(p))?.coverage ?? null;
}

/**
 * Every place the supplier sells, from its packages: each country any plan covers (named in English and Arabic, with its
 * flag) and each region as its own choice. Countries A–Z, then regions, then the global plan.
 */
export function esimPlacesOf(packages: readonly EsimPackage[]): EsimPlace[] {
  const countries = new Set<string>();
  const regions = new Map<string, EsimPackage['coverage']>();
  for (const p of packages) {
    for (const c of p.coverage.countries) countries.add(c);
    if (p.coverage.kind !== 'local' && !regions.has(p.coverage.code)) regions.set(p.coverage.code, p.coverage);
  }
  const out: EsimPlace[] = [];
  for (const code of countries) {
    const c = esimCountry(code);
    if (c) out.push({ code, kind: 'country', en: c.en, ar: c.ar, flag: esimFlag(code) });
    else {
      const local = packages.find((p) => p.coverage.kind === 'local' && p.coverage.code === code);
      if (local) out.push({ code, kind: 'country', en: local.coverage.name, ar: local.coverage.name, flag: esimFlag(code) });
    }
  }
  out.sort((a, b) => a.en.localeCompare(b.en));
  const regionOut = [...regions.values()].map((r): EsimPlace => {
    const w = r.kind === 'global' ? ESIM_REGION_WORDS.find((x) => x.key === 'world') : ESIM_REGION_WORDS.find((x) => x.key !== 'world' && (x.match.test(r.code) || x.match.test(r.name)));
    return { code: r.code, kind: 'region', en: r.kind === 'global' ? w!.en : r.name, ar: w?.ar ?? r.name, flag: null, countries: [...r.countries] };
  }).sort((a, b) => (a.code === 'world' || /^gl/i.test(a.code) ? 1 : 0) - (b.code === 'world' || /^gl/i.test(b.code) ? 1 : 0) || (a.countries?.length ?? 0) - (b.countries?.length ?? 0));
  return [...out, ...regionOut].slice(0, 600);
}

/** A region asked for (`region=`): the supplier's coverage with that code, else the one Mada's word names (the largest). */
export function esimRegionCoverage(packages: readonly EsimPackage[], region: string): EsimPackage['coverage'] | null {
  const own = packages.find((p) => p.coverage.kind !== 'local' && p.coverage.code.toLowerCase() === region.toLowerCase());
  if (own) return own.coverage;
  const w = ESIM_REGION_WORDS.find((x) => x.key === region.toLowerCase());
  if (!w) return null;
  const fits = packages.filter((p) => (w.key === 'world' ? p.coverage.kind === 'global' : p.coverage.kind === 'regional' && (w.match.test(p.coverage.code) || w.match.test(p.coverage.name))));
  return fits.sort((a, b) => b.coverage.countries.length - a.coverage.countries.length)[0]?.coverage ?? null;
}

/**
 * Nothing sold for this country: the closest thing that is, a region covering the most countries on the same continent
 * (honestly not this one), else the global plan; null when there's none.
 */
export function esimNearest(packages: readonly EsimPackage[], code: string): EsimPackage['coverage'] | null {
  const c = esimCountry(code);
  if (!c) return null;
  const regional = new Map<string, { cov: EsimPackage['coverage']; near: number }>();
  for (const p of packages) {
    if (p.coverage.kind !== 'regional' || regional.has(p.coverage.code)) continue;
    const near = p.coverage.countries.filter((x) => esimCountry(x)?.cont === c.cont).length;
    if (near > 0) regional.set(p.coverage.code, { cov: p.coverage, near });
  }
  const best = [...regional.values()].sort((a, b) => b.near - a.near)[0];
  return best?.cov ?? packages.find((p) => p.coverage.kind === 'global')?.coverage ?? null;
}

/** What a place asked for (`destination=`) is: a DESTINATIONS key, an ISO code, a region word, or a country or city by name. */
export function esimDestinationOf(destination: string): { countries: string[]; region: string | null } {
  const d = DESTINATIONS[destination.toLowerCase()];
  if (d) return { countries: [d.country], region: null };
  if (/^[A-Z]{2}$/.test(destination)) return { countries: [destination], region: null };
  const hit = findEsimPlace(destination);
  if (!hit) return { countries: [], region: null };
  return hit.kind === 'country' ? { countries: [hit.code], region: null } : { countries: [], region: hit.code };
}

/** About what a traveller uses a day: maps, messages, some photos and video. */
const GB_A_DAY = 0.7;

/** All the data a plan gives: a daily plan's GB times its days; unlimited is endless. */
const totalGb = (p: { gb: number | null; days: number; daily?: boolean }) => (p.gb === null ? Infinity : p.daily ? p.gb * p.days : p.gb);

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
 * The plan to recommend among those shown: the cheapest that covers the trip (lasts its days and has about a day's
 * data for each of them), more data and more days breaking a tie. When none has the data, the biggest that lasts; when
 * none lasts, the longest.
 */
export function recommendEsimPlan(plans: readonly EsimPlan[], days: number): EsimPlan | null {
  const need = days * GB_A_DAY;
  const covering = plans.filter((p) => p.fits && totalGb(p) >= need);
  if (covering.length) return [...covering].sort((a, b) => a.price.amount - b.price.amount || totalGb(b) - totalGb(a) || b.days - a.days)[0]!;
  const fitting = plans.filter((p) => p.fits);
  if (fitting.length) return [...fitting].sort((a, b) => totalGb(b) - totalGb(a) || a.price.amount - b.price.amount)[0]!;
  return [...plans].sort((a, b) => b.days - a.days || totalGb(b) - totalGb(a) || a.price.amount - b.price.amount)[0] ?? null;
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

/**
 * The size words on the cards (Light · Most people · Heavy), by how big each plan is next to the others shown, so no
 * two cards ever share one. Three plans: smallest Light, middle Most people, biggest Heavy. Two: Most people and Heavy
 * when the smaller already covers the trip (about a day's data a day), else Light and Most people. One: Most people.
 * Unlimited counts as the biggest. Keeps the plans' order.
 */
export function esimSizes(plans: readonly Pick<EsimPlan, 'gb' | 'days' | 'daily'>[], days?: number): EsimSize[] {
  const n = plans.length;
  if (!n) return [];
  const order = plans.map((p, i) => ({ i, gb: totalGb(p) })).sort((a, b) => a.gb - b.gb || a.i - b.i);
  let words: EsimSize[];
  if (n === 1) words = ['regular'];
  else if (n === 2) words = days !== undefined && order[0]!.gb >= days * GB_A_DAY ? ['regular', 'heavy'] : ['light', 'regular'];
  else words = ['light', ...Array.from({ length: n - 2 }, () => 'regular' as const), 'heavy'];
  const out: EsimSize[] = new Array(n);
  order.forEach((x, rank) => { out[x.i] = words[rank]!; });
  return out;
}

/** The plans with their sizes set by esimSizes. */
export function withSizes<P extends Pick<EsimPlan, 'gb' | 'days' | 'daily' | 'size'>>(plans: readonly P[], days?: number): P[] {
  const sizes = esimSizes(plans, days);
  return plans.map((p, i) => (p.size === sizes[i] ? p : { ...p, size: sizes[i]! }));
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

/** Whether a phone takes an eSIM, from its model name: yes, no, or not sure (then the steps to check). */
export function esimPhoneFit(model: string | null | undefined): 'yes' | 'no' | 'unsure' {
  const m = (model ?? '').trim();
  if (!m) return 'unsure';
  if (ESIM_PHONES.some((p) => p.match.test(m))) return 'yes';
  if (NO_ESIM_PHONES.test(m)) return 'no';
  return 'unsure';
}

/** The copy key for a coverage's name, when Mada writes it; null keeps the supplier's title. */
export const esimWhereKey = (code: string) => ((ESIM_NAMED as readonly string[]).includes(code) ? (`esim.where.${code}` as const) : null);

/** Status from the supplier's usage answer, for an eSIM that was delivered. */
export function esimStatusOf(cur: EsimStatus, u: EsimUsage | null, installed: boolean): EsimStatus {
  if (['ordering', 'refunded', 'stuck'].includes(cur)) return cur;
  if (!u) return installed ? 'installed' : cur;
  if (u.state === 'active') return u.unlimited || (u.leftMb ?? 1) > 0 ? 'active' : 'used_up';
  if (u.state === 'finished') return 'used_up';
  if (u.state === 'expired') return 'expired';
  return installed ? 'installed' : 'ready';
}

/** "3.4 GB" / "620 MB". */
export function gbText(mb: number): string {
  if (mb >= 1000) return `${(Math.round((mb / 1024) * 10) / 10).toString()} GB`;
  return `${Math.max(0, Math.round(mb))} MB`;
}

/* ───────────── the mock supplier's eSIMs (server mock and app mock alike) ───────────── */

/** A deterministic eSIM for a mock order: ICCID, SM-DP+ and matching id from the order's key. */
export function mockEsimSim(key: string, i: number): { iccid: string; smdp: string; matchingId: string; lpa: string } {
  let h = 2166136261;
  for (const ch of `${key}:${i}`) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619) >>> 0; }
  const digits = String(h).padStart(10, '0').slice(0, 10);
  const iccid = `8944465400${digits}`;
  const A = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let x = h || 1;
  const block = () => Array.from({ length: 5 }, () => { x = Math.imul(x ^ (x >>> 13), 1274126177) >>> 0; return A[x % A.length]; }).join('');
  const matchingId = `${block()}-${block()}-${block()}-${block()}`;
  const smdp = 'rsp.mock.mada.example';
  return { iccid, smdp, matchingId, lpa: lpaOf(smdp, matchingId) };
}

/**
 * The mock supplier's usage: not switched on until installed; then a third used each day of the plan's first days,
 * never below a fifth left, so "what's left" reads like a real trip.
 */
export function mockEsimUsage(p: { gb: number | null; days: number }, installedAt: string | null, now = Date.now()): EsimUsage {
  const checkedAt = new Date(now).toISOString();
  if (!installedAt) return { totalMb: p.gb === null ? null : p.gb * 1024, leftMb: p.gb === null ? null : p.gb * 1024, unlimited: p.gb === null, expiresAt: null, state: 'not_active', checkedAt };
  const start = Date.parse(installedAt);
  const total = p.gb === null ? null : p.gb * 1024;
  const left = total === null ? null : Math.round(total * 0.62);
  return { totalMb: total, leftMb: left, unlimited: p.gb === null, expiresAt: new Date(start + p.days * 86_400_000).toISOString(), state: 'active', checkedAt };
}
