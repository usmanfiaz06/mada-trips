/**
 * Exchange rates for the display currency (owner audit item 4).
 *
 * SAR is the only charging currency: every amount on the wire and in the app is halalas (money.ts). Account ›
 * "Prices shown in" picks a second currency that is only ever shown beside the SAR amount, as "≈ AED 2,304
 * (rate of 16 Oct)", never as what is charged. The platform fetches rates once a day (platform/src/lib/app/fx.ts)
 * and the app reads them from GET /fx; when nothing fresh is to be had, the last known table or this file's
 * fallback is shown with its own date, so the line always says which day's rate it is.
 */

import { z } from 'zod';
import { localeOr, localizeDigits, type Lang } from './locale';
import { assertHalalas, type Halalas } from './money';

export const DISPLAY_CURRENCIES = ['AED', 'USD', 'EUR', 'GBP'] as const;
export type DisplayCurrency = (typeof DISPLAY_CURRENCIES)[number];

export const FxRates = z.object({
  base: z.literal('SAR'),
  /** The day the rates are for (ISO day, UTC). */
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  /** One SAR in each currency. */
  rates: z.object({ AED: z.number().positive(), USD: z.number().positive(), EUR: z.number().positive(), GBP: z.number().positive() }),
  /** Where the table came from: the live source, or the built-in fallback. */
  source: z.enum(['open.er-api.com', 'fallback']),
  fetchedAt: z.string().nullable(),
  /** True when the live source could not be reached today and an older table is shown. */
  stale: z.boolean().default(false),
});
export type FxRates = z.infer<typeof FxRates>;
export const FxResponse = z.object({ fx: FxRates });

/**
 * The built-in table. SAR is pegged to the US dollar (3.75) and the dirham to the dollar (3.6725), so AED and USD
 * hold; EUR and GBP move, hence the date on the line and the daily fetch.
 */
export const FX_FALLBACK: FxRates = {
  base: 'SAR', date: '2026-10-01', rates: { AED: 0.97933, USD: 0.26667, EUR: 0.2288, GBP: 0.1985 }, source: 'fallback', fetchedAt: null, stale: false,
};

/** Halalas to the display currency's whole units, rounded half up. Approximations are shown without decimals. */
export function convertSar(h: Halalas, currency: DisplayCurrency, fx: FxRates): number {
  assertHalalas(h);
  const rate = fx.rates[currency];
  const neg = h < 0;
  const v = Math.floor((Math.abs(h) * rate) / 100 + 0.5);
  return neg ? -v : v;
}

const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');

/** "AED 2,304" / "٢٬٣٠٤ د.إ" in Arabic: the code before the amount in English, the Arabic abbreviation after it. */
export function formatDisplay(units: number, currency: DisplayCurrency, locale?: Lang): string {
  const l = localeOr(locale);
  const neg = units < 0;
  const body = group(String(Math.abs(Math.round(units))));
  const s = neg ? '−' : '';
  if (l !== 'ar') return `${s}${currency} ${body}`;
  const AR: Record<DisplayCurrency, string> = { AED: 'د.إ', USD: '$', EUR: '€', GBP: '£' };
  return `${s}${localizeDigits(body, 'ar')} ${AR[currency]}`;
}

/** "≈ AED 2,304": the SAR amount in the display currency, or null when the display currency is SAR itself. */
export function approxIn(h: Halalas, currency: string | null | undefined, fx: FxRates | null | undefined, locale?: Lang): string | null {
  if (!fx || !currency || currency === 'SAR' || !(DISPLAY_CURRENCIES as readonly string[]).includes(currency)) return null;
  return `≈ ${formatDisplay(convertSar(h, currency as DisplayCurrency, fx), currency as DisplayCurrency, locale)}`;
}

/** "16 Oct" for the "(rate of 16 Oct)" line, in the display locale. */
export function fxDateLabel(fx: FxRates, locale?: Lang): string {
  const l = localeOr(locale);
  const d = new Date(`${fx.date}T12:00:00Z`);
  const s = new Intl.DateTimeFormat(l === 'ar' ? 'ar-SA-u-nu-latn' : 'en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' }).format(d);
  return l === 'ar' ? localizeDigits(s, 'ar') : s;
}

/** Older than a day, in the fetching sense: time to ask the source again. */
export const FX_MAX_AGE_MS = 24 * 3600_000;
export function fxIsFresh(fx: FxRates | null | undefined, now = Date.now()): boolean {
  if (!fx?.fetchedAt) return false;
  return now - Date.parse(fx.fetchedAt) < FX_MAX_AGE_MS;
}

/**
 * Read the live source's answer (open.er-api.com/v6/latest/SAR: free, no key, daily rates, attribution asked for:
 * "Rates By Exchange Rate API"). Anything missing or malformed is refused rather than guessed.
 */
export function parseErApi(json: unknown, fetchedAt: Date): FxRates | null {
  const r = json as { result?: string; base_code?: string; time_last_update_unix?: number; rates?: Record<string, unknown> } | null;
  if (!r || r.result !== 'success' || r.base_code !== 'SAR' || !r.rates) return null;
  const pick = (c: DisplayCurrency) => { const v = r.rates![c]; return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null; };
  const rates = { AED: pick('AED'), USD: pick('USD'), EUR: pick('EUR'), GBP: pick('GBP') };
  if (Object.values(rates).some((v) => v === null)) return null;
  const date = new Date(typeof r.time_last_update_unix === 'number' ? r.time_last_update_unix * 1000 : fetchedAt.getTime()).toISOString().slice(0, 10);
  return { base: 'SAR', date, rates: rates as FxRates['rates'], source: 'open.er-api.com', fetchedAt: fetchedAt.toISOString(), stale: false };
}
