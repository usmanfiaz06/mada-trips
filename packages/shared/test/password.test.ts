import { describe, expect, it } from 'vitest';
import { PASSWORD_RULES, passwordChecks, passwordMeetsRules } from '../src/schemas/auth';
import { en } from '../src/copy';

describe('password rules (Supabase: 8+, lower, upper, digit, symbol)', () => {
  it('ticks each rule as it is met', () => {
    const ok = (p: string) => passwordChecks(p).filter((c) => c.ok).map((c) => c.id);
    expect(ok('')).toEqual([]);
    expect(ok('abc')).toEqual(['lower']);
    expect(ok('abcDEF12')).toEqual(['length', 'lower', 'upper', 'digit']);
    expect(ok('abcDEF1!')).toEqual(['length', 'lower', 'upper', 'digit', 'symbol']);
  });
  it('passes only when every rule does', () => {
    expect(passwordMeetsRules('Istanbul 2027!')).toBe(true);
    expect(passwordMeetsRules('istanbul 2027!')).toBe(false);
    expect(passwordMeetsRules('Ist4nb!')).toBe(false);
    expect(passwordMeetsRules('ISTANBUL2027!')).toBe(false);
  });
  it('has words for every rule', () => {
    for (const r of PASSWORD_RULES) expect(en[r.copy as keyof typeof en], r.id).toBeTruthy();
  });
});
