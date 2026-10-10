/**
 * Money. Every amount is an integer number of halalas (1 SAR = 100 halalas), on the server, on the wire and in the app.
 * These helpers are the only place that converts to and from riyals, so totals and splits are always exact.
 *
 * Display follows COPY.md §4: "SAR 8,640" in English (no ".00"), the riyal sign or "ر.س" in Arabic.
 */

export type Halalas = number;
export const CURRENCY = 'SAR' as const;

/** Largest amount any single value may carry: SAR 100 million. Keeps every sum far inside exact integer range. */
export const MAX_HALALAS = 100_000_000_00;

/** Saudi VAT, in basis points (15%). */
export const VAT_BPS = 1500;

export function isHalalas(n: unknown): n is Halalas {
  return typeof n === 'number' && Number.isSafeInteger(n) && Math.abs(n) <= MAX_HALALAS;
}

export function assertHalalas(n: number, what = 'amount'): Halalas {
  if (!isHalalas(n)) throw new RangeError(`${what} must be a whole number of halalas within range, got ${n}`);
  return n;
}

const ARABIC_INDIC = '٠١٢٣٤٥٦٧٨٩';
const PERSIAN = '۰۱۲۳۴۵۶۷۸۹';

/** Western digits for Arabic-Indic and Persian digits, and Arabic decimal/thousands marks. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[٠-٩]/g, (d) => String(ARABIC_INDIC.indexOf(d)))
    .replace(/[۰-۹]/g, (d) => String(PERSIAN.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

/**
 * Parse a typed riyal amount ("8,640", "8640.5", "٨٦٤٠") into halalas.
 * Commas are accepted only as thousands separators: "12,5" is ambiguous and is refused rather than guessed.
 */
export function parseSar(input: string | number | null | undefined): Halalas {
  if (input === null || input === undefined || input === '') return 0;
  if (typeof input === 'number') return sarToHalalas(input);
  const s = normalizeDigits(String(input).trim().slice(0, 40)).replace(/^SAR\s*/i, '').replace(/\s/g, '');
  if (!/^-?(\d{1,3}(,\d{3})+|\d+)(\.\d{0,2})?$/.test(s)) throw new RangeError(`Not an amount: ${String(input).slice(0, 40)}`);
  const neg = s.startsWith('-');
  const [whole = '0', frac = ''] = s.replace('-', '').replace(/,/g, '').split('.');
  if (whole.length > 12) throw new RangeError('Amount is too large');
  const v = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  if (v > MAX_HALALAS) throw new RangeError('Amount is too large');
  return neg ? -v : v;
}

/** Riyals (a JS number, e.g. from a supplier) to halalas, rounding half away from zero at the halala. */
export function sarToHalalas(sar: number): Halalas {
  if (!Number.isFinite(sar)) throw new RangeError('Amount must be finite');
  // Go through a fixed 3-decimal string so 1.005 * 100 doesn't become 100.49999.
  const sign = sar < 0 ? -1 : 1;
  const [w = '0', f = ''] = Math.abs(sar).toFixed(3).split('.');
  const thousandths = Number(w) * 1000 + Number(f);
  const v = sign * Math.floor((thousandths + 5) / 10);
  return assertHalalas(v === 0 ? 0 : v);
}

export const halalasToSar = (h: Halalas): number => h / 100;

function group(digits: string): string {
  return digits.replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export type FormatSarOptions = {
  /** 'auto' (default) shows halalas only when there are some: "SAR 8,640" / "SAR 8,640.50". */
  decimals?: 'auto' | 'always' | 'never';
  /** Show "+" for positive amounts (credits, refunds). */
  sign?: boolean;
  /** 'en' (default): "SAR 8,640". 'ar': "8,640 ر.س" (Western digits, as Saudi banks and airlines show). */
  locale?: 'en' | 'ar';
  /** Leave the currency off: "8,640". */
  bare?: boolean;
};

/** "SAR 8,640" — COPY.md §4: SAR before the amount, thousands separator, no ".00". */
export function formatSar(h: Halalas, opts: FormatSarOptions = {}): string {
  assertHalalas(h);
  const { decimals = 'auto', sign = false, locale = 'en', bare = false } = opts;
  const neg = h < 0;
  const abs = Math.abs(h);
  let whole = Math.floor(abs / 100);
  let frac = abs % 100;
  if (decimals === 'never' && frac) {
    // Round half up to the riyal.
    if (frac >= 50) whole += 1;
    frac = 0;
  }
  const showFrac = decimals === 'always' || (decimals === 'auto' && frac !== 0);
  const body = group(String(whole)) + (showFrac ? '.' + String(frac).padStart(2, '0') : '');
  const s = neg ? '−' : sign && h > 0 ? '+' : '';
  if (bare) return `${s}${body}`;
  return locale === 'ar' ? `${s}${body} ر.س` : `${s}SAR ${body}`;
}

export function sum(values: readonly Halalas[]): Halalas {
  let t = 0;
  for (const v of values) t += assertHalalas(v);
  return assertHalalas(t);
}

/** Price per person times travellers. */
export function times(unit: Halalas, n: number): Halalas {
  if (!Number.isInteger(n) || n < 0) throw new RangeError('Count must be a whole number');
  return assertHalalas(assertHalalas(unit) * n);
}

/**
 * Split by integer weights so the parts always add up exactly (largest remainder; ties go to the earlier part).
 * splitByWeights(1000, [1, 1, 1]) → [334, 333, 333].
 */
export function splitByWeights(total: Halalas, weights: readonly number[]): Halalas[] {
  assertHalalas(total);
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) throw new RangeError('Weights must be non-negative');
  const wsum = weights.reduce((a, b) => a + b, 0);
  if (wsum === 0) return weights.map(() => 0);
  const neg = total < 0;
  const abs = Math.abs(total);
  const raw = weights.map((w) => (abs * w) / wsum);
  const parts = raw.map(Math.floor);
  let rest = abs - parts.reduce((a, b) => a + b, 0);
  const order = raw
    .map((r, i) => [r - Math.floor(r), i] as const)
    .sort((a, b) => b[0] - a[0] || a[1] - b[1]);
  for (const [, i] of order) {
    if (rest <= 0) break;
    parts[i] = (parts[i] ?? 0) + 1;
    rest -= 1;
  }
  return neg ? parts.map((p) => (p === 0 ? 0 : -p)) : parts;
}

/** Split evenly into n parts that sum exactly: a group's shares, instalments. */
export function splitEven(total: Halalas, n: number): Halalas[] {
  if (!Number.isInteger(n) || n < 1) throw new RangeError('Need at least one part');
  return splitByWeights(total, Array.from({ length: n }, () => 1));
}

/** Instalment plan (Tabby: 4, Tamara: 3). The first payment carries any leftover halalas. */
export function instalments(total: Halalas, n: 3 | 4 | number): Halalas[] {
  return splitEven(total, n);
}

/** A share in basis points, rounded half up: bps(8640_00, 1500) is 15% of SAR 8,640. */
export function bps(amount: Halalas, basisPoints: number): Halalas {
  assertHalalas(amount);
  if (!Number.isInteger(basisPoints)) throw new RangeError('Basis points must be whole');
  const neg = amount < 0;
  const v = Math.floor((Math.abs(amount) * basisPoints + 5000) / 10000);
  return neg ? -v : v;
}

/** The VAT inside a VAT-inclusive price (Saudi simplified invoices show prices with VAT included). */
export function vatInside(gross: Halalas, rateBps = VAT_BPS): Halalas {
  assertHalalas(gross);
  const neg = gross < 0;
  const v = Math.floor((Math.abs(gross) * rateBps * 2 + (10000 + rateBps)) / (2 * (10000 + rateBps)));
  return neg ? -v : v;
}

/** Money as it travels in API payloads (see the Money schema). */
export const money = (amount: Halalas): { amount: Halalas; currency: typeof CURRENCY } => ({ amount: assertHalalas(amount), currency: CURRENCY });
