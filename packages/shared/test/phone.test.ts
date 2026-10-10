import { describe, expect, it } from 'vitest';
import { checkSaudiMobile, maskPhone, prettyPhone } from '../src/phone';

describe('Saudi mobile numbers', () => {
  it('accepts the ways people type them', () => {
    for (const s of ['500004127', '0500004127', '+966500004127', '00966 50 000 4127', '966-50-000-4127', '٥٠٠٠٠٤١٢٧']) {
      const r = checkSaudiMobile(s);
      expect(r.ok, s).toBe(true);
      if (r.ok) expect(r.e164).toBe('+966500004127');
    }
  });
  it('explains what is wrong', () => {
    expect(checkSaudiMobile('')).toMatchObject({ ok: false, problem: 'empty' });
    expect(checkSaudiMobile('400004127')).toMatchObject({ ok: false, problem: 'prefix' });
    expect(checkSaudiMobile('5000041')).toMatchObject({ ok: false, problem: 'short', digits: '5000041' });
    expect(checkSaudiMobile('5000041270')).toMatchObject({ ok: false, problem: 'long' });
  });
  it('formats and masks', () => {
    expect(prettyPhone('+966500004127')).toBe('+966 50 000 4127');
    expect(maskPhone('+966500004127')).toBe('+966 •• ••• 4127');
  });
});
