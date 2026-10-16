import { describe, expect, it } from 'vitest';
import { FX_FALLBACK, FxRates, approxIn, convertSar, formatDisplay, fxDateLabel, fxIsFresh, parseErApi } from '../src/fx';
import { setDisplayPrefs } from '../src/locale';

describe('display currency beside SAR', () => {
  it('converts halalas to whole units of the display currency', () => {
    expect(convertSar(864000, 'AED', FX_FALLBACK)).toBe(8461); // 8,640 × 0.97933
    expect(convertSar(864000, 'USD', FX_FALLBACK)).toBe(2304);
    expect(convertSar(-14000, 'USD', FX_FALLBACK)).toBe(-37);
    expect(convertSar(0, 'EUR', FX_FALLBACK)).toBe(0);
  });
  it('formats as "AED 2,304" in English and amount-then-sign in Arabic', () => {
    expect(formatDisplay(2304, 'USD', 'en')).toBe('USD 2,304');
    expect(formatDisplay(-37, 'GBP', 'en')).toBe('−GBP 37');
    expect(formatDisplay(2304, 'AED', 'ar')).toBe('2,304 د.إ');
  });
  it('is an approximation, never for SAR itself or an unknown code', () => {
    expect(approxIn(864000, 'AED', FX_FALLBACK, 'en')).toBe('≈ AED 8,461');
    expect(approxIn(864000, 'SAR', FX_FALLBACK)).toBeNull();
    expect(approxIn(864000, 'XXX', FX_FALLBACK)).toBeNull();
    expect(approxIn(864000, 'AED', null)).toBeNull();
    setDisplayPrefs({ locale: 'en' });
  });
  it('labels the rate day', () => {
    expect(fxDateLabel({ ...FX_FALLBACK, date: '2026-10-16' }, 'en')).toBe('16 Oct');
    expect(fxDateLabel({ ...FX_FALLBACK, date: '2026-10-16' }, 'ar')).toMatch(/16|١٦/);
  });
});

describe('the live source', () => {
  const sample = { result: 'success', base_code: 'SAR', time_last_update_unix: 1792627201, rates: { AED: 0.9793, USD: 0.2667, EUR: 0.2301, GBP: 0.1994, JPY: 40.1 } };
  it('reads open.er-api.com and keeps only the display currencies', () => {
    const at = new Date('2026-10-16T08:00:00Z');
    const fx = parseErApi(sample, at);
    expect(fx).toEqual({ base: 'SAR', date: new Date(sample.time_last_update_unix * 1000).toISOString().slice(0, 10), rates: { AED: 0.9793, USD: 0.2667, EUR: 0.2301, GBP: 0.1994 }, source: 'open.er-api.com', fetchedAt: at.toISOString(), stale: false });
    expect(FxRates.safeParse(fx).success).toBe(true);
  });
  it('refuses a wrong base, a missing currency or a bad number', () => {
    const at = new Date();
    expect(parseErApi({ ...sample, base_code: 'USD' }, at)).toBeNull();
    expect(parseErApi({ ...sample, rates: { AED: 0.97, USD: 0.26, EUR: 0.23 } }, at)).toBeNull();
    expect(parseErApi({ ...sample, rates: { ...sample.rates, GBP: 'x' } }, at)).toBeNull();
    expect(parseErApi({ result: 'error' }, at)).toBeNull();
    expect(parseErApi(null, at)).toBeNull();
  });
  it('is fresh for a day', () => {
    const now = Date.parse('2026-10-16T12:00:00Z');
    expect(fxIsFresh({ ...FX_FALLBACK, fetchedAt: '2026-10-16T00:00:00Z' }, now)).toBe(true);
    expect(fxIsFresh({ ...FX_FALLBACK, fetchedAt: '2026-10-15T11:00:00Z' }, now)).toBe(false);
    expect(fxIsFresh(FX_FALLBACK, now)).toBe(false);
  });
});
