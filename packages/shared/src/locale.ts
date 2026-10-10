/**
 * Locale, digits and calendar for display (COPY.md §4, §7.4).
 *
 *  - Two languages: English and Arabic. Arabic is right-to-left; codes, flight numbers, PNRs, passport fields and
 *    times stay left-to-right inside it, wrapped in Unicode direction isolates so a sentence never scrambles.
 *  - Western digits by default (as Saudi airlines and banks show them); Arabic-Indic digits are a setting.
 *  - Gregorian dates by default; the Hijri (Umm al-Qura) date can be shown alongside.
 *  - Arabic has six plural forms; Intl.PluralRules picks the form, with a built-in fallback for runtimes without it.
 *
 * The app sets the display preferences once at start (setDisplayPrefs). The server never does: it passes `locale`
 * explicitly per user, so a request for one traveller can never leak another's language.
 */

export type Lang = 'en' | 'ar';
export type Digits = 'latn' | 'arab';
export type PluralCategory = 'zero' | 'one' | 'two' | 'few' | 'many' | 'other';

export type DisplayPrefs = {
  locale: Lang;
  /** Western (latn, default) or Arabic-Indic (arab) digits. Only applies when the locale is Arabic. */
  digits: Digits;
  /** Show the Hijri date alongside the Gregorian one on day labels. */
  hijri: boolean;
  /** 12-hour clock ("6:30 pm" / "6:30 م"). The phone's setting; 24-hour by default. */
  hour12: boolean;
};

const DEFAULTS: DisplayPrefs = { locale: 'en', digits: 'latn', hijri: false, hour12: false };
let prefs: DisplayPrefs = { ...DEFAULTS };

/** Set the display preferences for this process (the app does this at start and when a setting changes). */
export function setDisplayPrefs(p: Partial<DisplayPrefs>): DisplayPrefs {
  prefs = { ...prefs, ...p };
  return prefs;
}
export const getDisplayPrefs = (): Readonly<DisplayPrefs> => prefs;
export const resetDisplayPrefs = () => { prefs = { ...DEFAULTS }; };

export const isLocale = (s: unknown): s is Lang => s === 'en' || s === 'ar';
export const isRtlLocale = (l: Lang) => l === 'ar';

/** Resolve the locale to use: an explicit one, else the process preference. */
export const localeOr = (l?: Lang | null): Lang => (l && isLocale(l) ? l : prefs.locale);

/**
 * The best supported locale for a list of language tags, an Accept-Language header or a single tag.
 * "ar-SA,ar;q=0.9,en;q=0.8" → 'ar'. Anything unknown → the fallback (English).
 */
export function pickLocale(input: string | readonly string[] | null | undefined, fallback: Lang = 'en'): Lang {
  if (!input) return fallback;
  const tags = typeof input === 'string'
    ? input.split(',').map((part) => {
      const [tag = '', ...params] = part.trim().split(';');
      const q = params.map((p) => p.trim()).find((p) => p.startsWith('q='));
      return { tag: tag.trim().toLowerCase(), q: q ? Number(q.slice(2)) || 0 : 1 };
    }).filter((x) => x.tag && x.q > 0).sort((a, b) => b.q - a.q).map((x) => x.tag)
    : input.map((x) => String(x).toLowerCase());
  for (const tag of tags) {
    const base = tag.split(/[-_]/)[0];
    if (base === 'ar') return 'ar';
    if (base === 'en') return 'en';
  }
  return fallback;
}

/* ───────────── digits ───────────── */

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';

/** Western digits to Arabic-Indic when asked for (and only in Arabic). Decimal and group marks follow. */
export function localizeDigits(s: string, locale?: Lang, digits?: Digits): string {
  const l = localeOr(locale);
  const d = digits ?? prefs.digits;
  if (l !== 'ar' || d !== 'arab') return s;
  return s
    .replace(/(\d),(?=\d{3})/g, '$1٬')
    .replace(/(\d)\.(?=\d)/g, '$1٫')
    .replace(/[0-9]/g, (x) => ARABIC_INDIC[Number(x)]!);
}

/** "8,640", "1,250.5": thousands separator, Western digits unless Arabic-Indic is chosen. */
export function formatNumber(n: number, opts: { locale?: Lang; digits?: Digits; maxFraction?: number } = {}): string {
  if (!Number.isFinite(n)) return String(n);
  const max = opts.maxFraction ?? 2;
  const neg = n < 0;
  const [w = '0', f = ''] = Math.abs(n).toFixed(max).split('.');
  const frac = f.replace(/0+$/, '');
  const body = w.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (frac ? `.${frac}` : '');
  return localizeDigits(`${neg ? '−' : ''}${body}`, opts.locale, opts.digits);
}

/* ───────────── direction ───────────── */

/** Unicode isolates: LRI … PDI keeps a left-to-right run whole inside right-to-left text, and vice versa. */
export const LRI = '⁦';
export const RLI = '⁧';
export const FSI = '⁨';
export const PDI = '⁩';

/**
 * Keep a code left-to-right: flight numbers, PNRs, IATA codes, passport numbers, card endings, phone numbers.
 * A no-op in English, so callers can use it everywhere.
 */
export function ltr(s: string | number, locale?: Lang): string {
  const v = String(s);
  if (localeOr(locale) !== 'ar' || !v) return v;
  return `${LRI}${v}${PDI}`;
}

/** Remove isolates (for tests, logs, copy-to-clipboard). */
export const stripIsolates = (s: string) => s.replace(/[⁦-⁩]/g, '');

const ARABIC_LETTER = /[؀-ۿݐ-ݿࢠ-ࣿﭐ-﷿ﹰ-﻿]/;
const LATIN_OR_DIGIT = /[A-Za-z0-9]/;

/** Text with Latin letters or digits and no Arabic: the kind of value that scrambles inside an Arabic sentence. */
export const isLatinRun = (s: string) => LATIN_OR_DIGIT.test(s) && !ARABIC_LETTER.test(s);

/** Whether a string has any Arabic letters. */
export const hasArabic = (s: string) => ARABIC_LETTER.test(s);

/* ───────────── plurals ───────────── */

/** CLDR's Arabic rule, for runtimes without Intl.PluralRules (older Hermes). */
function arabicCategory(n: number): PluralCategory {
  if (!Number.isInteger(n)) return 'other';
  const m = Math.abs(n) % 100;
  if (n === 0) return 'zero';
  if (n === 1) return 'one';
  if (n === 2) return 'two';
  if (m >= 3 && m <= 10) return 'few';
  if (m >= 11 && m <= 99) return 'many';
  return 'other';
}

const pluralCache = new Map<Lang, Intl.PluralRules | null>();

/** The plural form for a count: English has one/other, Arabic zero/one/two/few/many/other. */
export function pluralCategory(n: number, locale?: Lang): PluralCategory {
  const l = localeOr(locale);
  if (!pluralCache.has(l)) {
    try {
      pluralCache.set(l, typeof Intl !== 'undefined' && 'PluralRules' in Intl ? new Intl.PluralRules(l) : null);
    } catch {
      pluralCache.set(l, null);
    }
  }
  const rules = pluralCache.get(l);
  if (rules) return rules.select(n) as PluralCategory;
  if (l === 'ar') return arabicCategory(n);
  return n === 1 ? 'one' : 'other';
}

/**
 * The keys to try for a plural, most specific first. Arabic: an exact form ("two"), then the nearest written
 * one. Writers give .one, .two, .few and .other; "many" (11–99) takes the singular noun like "other" (100+),
 * so it falls back to .other; "zero" falls back to .other as well.
 */
export function pluralKeys(base: string, n: number, locale?: Lang): string[] {
  const c = pluralCategory(n, locale);
  return c === 'other' ? [`${base}.other`] : [`${base}.${c}`, `${base}.other`];
}
