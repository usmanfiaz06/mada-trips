import { afterEach, describe, expect, it } from 'vitest';
import { ar, en, lintArabic, missingArabic, t, tn } from '../src/copy';
import { resetDisplayPrefs, setDisplayPrefs, stripIsolates } from '../src/locale';

const EN = en as unknown as Record<string, string>;
const AR = ar as Record<string, string>;

describe('the Arabic catalogue', () => {
  it('has every English key', () => {
    expect(missingArabic(AR, EN)).toEqual([]);
  });
  it('passes the Arabic lint (placeholders match English, no "!", Arabic punctuation, not Latin-only, no banned words)', () => {
    const problems = lintArabic(AR, EN);
    expect(problems, JSON.stringify(problems, null, 2)).toEqual([]);
  });
  it('gives every counted English string its Arabic dual and plural forms', () => {
    const bases = Object.keys(EN).filter((k) => k.endsWith('.one') && /\{(count|n)\}/.test(EN[`${k.slice(0, -4)}.other`] ?? '')).map((k) => k.slice(0, -4));
    const thin = bases.filter((b) => !(`${b}.two` in AR) && !/\{(count|n)\}/.test(AR[`${b}.other`] ?? ''));
    expect(thin).toEqual([]);
  });
  it('writes the brand as مادا', () => {
    const wrong = Object.entries(AR).filter(([k, v]) => /مدى/.test(v) && !/Visa|Mastercard/.test(v)).map(([k]) => k);
    expect(wrong).toEqual([]);
    expect(t('action.talk', undefined, 'ar')).toBe('تحدّث مع مادا');
  });
  it('catches what it should', () => {
    const fake = { 'x.a': 'تم!', 'x.b': 'Done', 'x.c': 'مرحبًا {name}', 'x.d': 'هل أنت متأكد?', 'x.e': 'حدث خطأ ما' };
    const english = { 'x.a': 'Done', 'x.b': 'Done', 'x.c': 'Hi {first}', 'x.d': 'Sure?', 'x.e': 'Oops' };
    const problems = lintArabic(fake, english).map((p) => `${p.key}: ${p.problem}`);
    expect(problems).toEqual(expect.arrayContaining([
      'x.a: exclamation mark', 'x.b: still English', 'x.c: missing placeholder {first}', 'x.c: unknown placeholder {name}',
      'x.d: Latin question mark in Arabic text (use ؟)', 'x.e: banned word "خطأ"',
    ]));
    expect(lintArabic({ 'x.y': 'رحلة' }, {})).toHaveLength(1);
  });
});

describe('t() and tn() in Arabic', () => {
  afterEach(() => resetDisplayPrefs());
  it('uses all six plural forms', () => {
    const forms = [0, 1, 2, 3, 10, 11, 99, 100, 101, 102, 103].map((n) => tn('otp.wrong', n, {}, 'ar'));
    expect(forms[1]).toBe('الرمز غير مطابق. بقيت محاولة واحدة.');
    expect(forms[2]).toBe('الرمز غير مطابق. بقيت محاولتان.');
    expect(forms[3]).toBe('الرمز غير مطابق. بقيت 3 محاولات.');
    expect(forms[5]).toBe('الرمز غير مطابق. بقيت 11 محاولة.');
    expect(forms[7]).toBe('الرمز غير مطابق. بقيت 100 محاولة.');
    expect(forms[9]).toBe('الرمز غير مطابق. بقيت محاولتان.'.replace('محاولتان', '102 محاولة'));
    expect(forms[10]).toBe('الرمز غير مطابق. بقيت 103 محاولات.');
  });
  it('keeps codes left-to-right inside Arabic sentences', () => {
    const s = t('notify.confirmed.body', { agent: 'فيصل', ref: 'X7K2QD' }, 'ar');
    expect(s).toContain('⁦X7K2QD⁩');
    expect(stripIsolates(s)).toBe('أكّدها فيصل. رمز الحجز X7K2QD.');
    // English is untouched.
    expect(t('notify.confirmed.body', { agent: 'Faisal', ref: 'X7K2QD' }, 'en')).toBe('Confirmed by Faisal. Booking X7K2QD.');
  });
  it('switches digits to Arabic-Indic when asked, except inside codes', () => {
    setDisplayPrefs({ locale: 'ar', digits: 'arab' });
    expect(stripIsolates(t('notify.gateChange.body', { flight: 'SV263', gate: 'C4', minutes: 6 }))).toBe('الصعود إلى SV263 الآن من C4. المشي إليها ٦ دقائق.');
    expect(t('otp.label')).toBe('رمز من ٦ أرقام');
  });
  it('follows the display locale by default and falls back to English', () => {
    setDisplayPrefs({ locale: 'ar' });
    expect(t('tabs.wallet')).toBe('المحفظة');
    expect(t('nope.key' as never)).toBe('⟦nope.key⟧');
  });
});
