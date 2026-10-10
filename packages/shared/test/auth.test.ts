import { describe, expect, it } from 'vitest';
import { authCopy } from '../src/copy/auth';
import { authCopyAr } from '../src/copy/auth.ar';
import { lintCatalogue, t } from '../src/copy';
import { decodeMockSupabaseToken, encodeMockSupabaseToken } from '../src/schemas/auth';

describe('mock Supabase tokens', () => {
  it('round-trip claims, including Arabic names', () => {
    const claims = { sub: 'mock-1', phone: '+966500004127', email: null, providers: ['phone' as const], name: 'عمر', exp: 2_000_000_000 };
    const token = encodeMockSupabaseToken(claims);
    expect(token).toMatch(/^mocksb\.[\w-]+$/);
    expect(decodeMockSupabaseToken(token)).toEqual({ iss: 'mock-supabase', ...claims });
  });
  it('refuse anything else', () => {
    expect(decodeMockSupabaseToken('eyJhbGciOi.x.y')).toBeNull();
    expect(decodeMockSupabaseToken('mocksb.!!!')).toBeNull();
    expect(decodeMockSupabaseToken('mocksb.' + 'e30')).toBeNull(); // {} has no sub
  });
});

describe('sign-in copy', () => {
  it('has Arabic for every English key, and Arabic is served for ar', () => {
    expect(Object.keys(authCopyAr).sort()).toEqual(Object.keys(authCopy).sort());
    expect(t('auth.signin.email', undefined, 'ar')).toBe(authCopyAr['auth.signin.email']);
  });
  it('writes the brand as مادا in Arabic and passes the punctuation rules', () => {
    const all = Object.values(authCopyAr).join(' ');
    expect(all).not.toContain('مدى');
    expect(all).toContain('مادا');
    const problems = lintCatalogue(authCopyAr).filter((p) => !p.problem.startsWith('banned word'));
    expect(problems).toEqual([]);
  });
});
