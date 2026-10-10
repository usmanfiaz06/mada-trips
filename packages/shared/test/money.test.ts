import { describe, expect, it } from 'vitest';
import {
  MAX_HALALAS, bps, formatSar, instalments, isHalalas, parseSar, sarToHalalas, splitByWeights, splitEven, sum, times, vatInside,
} from '../src/money';

describe('parseSar', () => {
  it('reads plain, grouped and decimal amounts', () => {
    expect(parseSar('8640')).toBe(864000);
    expect(parseSar('8,640')).toBe(864000);
    expect(parseSar('8,640.5')).toBe(864050);
    expect(parseSar('SAR 1,120.25')).toBe(112025);
    expect(parseSar('0.01')).toBe(1);
    expect(parseSar('-140')).toBe(-14000);
    expect(parseSar('')).toBe(0);
    expect(parseSar(null)).toBe(0);
  });
  it('reads Arabic-Indic and Persian digits', () => {
    expect(parseSar('٨٦٤٠')).toBe(864000);
    expect(parseSar('٨٬٦٤٠٫٥٠')).toBe(864050);
    expect(parseSar('۱۲۰')).toBe(12000);
  });
  it('refuses ambiguous or malformed input', () => {
    expect(() => parseSar('12,5')).toThrow();
    expect(() => parseSar('1.234')).toThrow();
    expect(() => parseSar('abc')).toThrow();
    expect(() => parseSar('1,00,000')).toThrow();
    expect(() => parseSar('9999999999999')).toThrow();
  });
});

describe('sarToHalalas', () => {
  it('rounds at the halala without float drift', () => {
    expect(sarToHalalas(1.005)).toBe(101);
    expect(sarToHalalas(2160)).toBe(216000);
    expect(sarToHalalas(0.1 + 0.2)).toBe(30);
    expect(sarToHalalas(-1.005)).toBe(-101);
    expect(sarToHalalas(-0.001)).toBe(0);
  });
  it('rejects non-finite values', () => {
    expect(() => sarToHalalas(Number.NaN)).toThrow();
    expect(() => sarToHalalas(Infinity)).toThrow();
  });
});

describe('formatSar', () => {
  it('follows COPY.md: SAR first, separators, no .00', () => {
    expect(formatSar(864000)).toBe('SAR 8,640');
    expect(formatSar(878000)).toBe('SAR 8,780');
    expect(formatSar(864050)).toBe('SAR 8,640.50');
    expect(formatSar(5)).toBe('SAR 0.05');
    expect(formatSar(0)).toBe('SAR 0');
    expect(formatSar(99_456_789_00)).toBe('SAR 99,456,789');
  });
  it('handles signs, decimals and Arabic', () => {
    expect(formatSar(-14000)).toBe('−SAR 140');
    expect(formatSar(64000, { sign: true })).toBe('+SAR 640');
    expect(formatSar(864000, { decimals: 'always' })).toBe('SAR 8,640.00');
    expect(formatSar(864050, { decimals: 'never' })).toBe('SAR 8,641');
    expect(formatSar(864049, { decimals: 'never' })).toBe('SAR 8,640');
    expect(formatSar(864000, { locale: 'ar' })).toBe('8,640 ر.س');
    expect(formatSar(216000, { bare: true })).toBe('2,160');
  });
  it('refuses fractional halalas', () => {
    expect(() => formatSar(1.5)).toThrow();
  });
});

describe('arithmetic', () => {
  it('sums and multiplies exactly', () => {
    expect(sum([216000, 588000, 44000])).toBe(848000);
    expect(times(216000, 4)).toBe(864000);
    expect(() => times(100, 1.5)).toThrow();
    expect(() => sum([MAX_HALALAS, 1])).toThrow();
  });
  it('splits so the parts always add up', () => {
    expect(splitEven(1000, 3)).toEqual([334, 333, 333]);
    expect(splitEven(864000, 4)).toEqual([216000, 216000, 216000, 216000]);
    expect(instalments(100001, 4)).toEqual([25001, 25000, 25000, 25000]);
    expect(splitByWeights(1000, [1, 2, 1])).toEqual([250, 500, 250]);
    expect(splitByWeights(100, [0, 0])).toEqual([0, 0]);
    expect(splitByWeights(-1000, [1, 1, 1])).toEqual([-334, -333, -333]);
    for (const total of [1, 7, 99, 864001, 12345678]) {
      for (const n of [1, 2, 3, 4, 6, 7]) expect(sum(splitEven(total, n))).toBe(total);
    }
    expect(() => splitEven(100, 0)).toThrow();
  });
  it('takes shares in basis points and VAT inside a price', () => {
    expect(bps(864000, 1500)).toBe(129600);
    expect(bps(333, 5000)).toBe(167);
    expect(bps(-333, 5000)).toBe(-167);
    // SAR 115 including 15% VAT holds SAR 15 of VAT.
    expect(vatInside(11500)).toBe(1500);
    expect(vatInside(864000)).toBe(112696);
    expect(vatInside(1)).toBe(0);
  });
  it('knows what a halala amount is', () => {
    expect(isHalalas(10)).toBe(true);
    expect(isHalalas(1.5)).toBe(false);
    expect(isHalalas(MAX_HALALAS + 1)).toBe(false);
    expect(isHalalas('10')).toBe(false);
  });
});
