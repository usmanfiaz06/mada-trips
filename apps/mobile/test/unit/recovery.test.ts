import { beforeEach, describe, expect, it } from 'vitest';
import { decodeMockSupabaseToken } from '@mada/shared';
import { ApiError, setTransport } from '@/lib/api';
import { AuthError } from '@/lib/auth';
import { codeFrom } from '@/lib/auth/code';
import { getLastSignIn, saveLastSignIn } from '@/lib/auth/last';
import { MOCK_CODE, mockAuth, resetMockAuth } from '@/lib/auth/mock';
import { maskContact, sendRecovery } from '@/lib/auth/recovery';
import { resetAuthMock } from '@/lib/mock/auth';
import { mockTransport } from '../../src/lib/mock-api';

/*
 * Didn't get the code?: codes from whatever was pasted, the masked contact on the sign-in screen, the remembered way
 * in, the signed-out recovery request (mock Core API), and optional passwords through Supabase's stand-in.
 */

const rnd = () => `+9665${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const fails = async (p: Promise<unknown>) => p.then(() => null, (e: unknown) => e);

beforeEach(() => {
  resetMockAuth();
  resetAuthMock();
  (globalThis as { __madaDeviceId?: string }).__madaDeviceId = Math.random().toString(36).slice(2, 10);
  setTransport((w) => mockTransport(w));
});

describe('codes from what was typed or pasted', () => {
  it('keeps typing, takes a pasted code over a half-typed one, and finds the code in a pasted message', () => {
    expect(codeFrom('12')).toBe('12');
    expect(codeFrom('12 34 56')).toBe('123456');
    expect(codeFrom('12123456', '12')).toBe('123456');
    expect(codeFrom('123456 is your Mada Trips code. It expires in 10 minutes. Never share it.')).toBe('123456');
    expect(codeFrom('1234567', '123456')).toBe('123456');
  });
});

describe('the way in used last time', () => {
  it('is masked for the sign-in screen and remembered on this phone', async () => {
    expect(maskContact('email', 'omar.h@gmail.com')).toBe('o•••@gmail.com');
    expect(maskContact('phone', '+966501234567')).toBe('+966 5• ••• 4567');
    // The web build keeps it in localStorage (the Keychain on a phone).
    const store = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => store.get(k) ?? null, setItem: (k: string, v: string) => { store.set(k, v); }, removeItem: (k: string) => { store.delete(k); } };
    await saveLastSignIn({ via: 'email', contact: 'omar.h@gmail.com' });
    expect([...store.values()].join()).not.toMatch(/token|password/);
    expect(await getLastSignIn()).toEqual({ via: 'email', contact: 'omar.h@gmail.com' });
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});

describe('the recovery request (mock Core API)', () => {
  const body = (old: string, next: string) => ({ name: 'Omar Alharbi', oldContact: { kind: 'phone' as const, value: old }, newContact: { kind: 'email' as const, value: next } });

  it('answers the same for the demo account and for a number nobody has', async () => {
    const known = await sendRecovery(body('+966500004127', 'omar.new@example.com'), 'k1-abcdefgh');
    const unknown = await sendRecovery(body(rnd(), 'someone@example.com'), 'k2-abcdefgh');
    expect(known).toEqual({ received: true });
    expect(unknown).toEqual(known);
  });

  it('refuses the same contact twice, and a fourth request for one number in a day', async () => {
    const same = await fails(sendRecovery({ name: 'Omar', oldContact: { kind: 'email', value: 'a@example.com' }, newContact: { kind: 'email', value: 'a@example.com' } }, 'k3-abcdefgh'));
    expect(same).toBeInstanceOf(ApiError);
    expect((same as ApiError).code).toBe('VALIDATION');
    const old = rnd();
    for (let i = 0; i < 3; i++) await sendRecovery(body(old, `n${i}@example.com`), `k4-${i}-abcdefgh`);
    const fourth = await fails(sendRecovery(body(old, 'n4@example.com'), 'k5-abcdefgh'));
    expect((fourth as ApiError).code).toBe('RATE_LIMITED');
  });
});

describe('optional passwords (Supabase stand-in)', () => {
  async function emailUser(email: string) {
    await mockAuth.sendEmailCode(email);
    return mockAuth.verifyEmailCode(email, MOCK_CODE);
  }

  it('sets one only after a fresh code and only when it meets the rules; then signs in with it', async () => {
    const email = `sara.${Date.now()}@example.com`;
    await emailUser(email);
    await mockAuth.reauthenticate();
    expect(((await fails(mockAuth.setPassword('Istanbul 2027!', '000000'))) as AuthError).code).toBe('wrong');
    await mockAuth.reauthenticate().catch(() => {});
    expect(((await fails(mockAuth.setPassword('istanbul2027', MOCK_CODE))) as AuthError).code).toBe('weakPassword');
    const token = await mockAuth.setPassword('Istanbul 2027!', MOCK_CODE);
    expect(decodeMockSupabaseToken(token)!.providers).toContain('password');
    await mockAuth.signOut();

    const wrong = (await fails(mockAuth.signInWithPassword(email, 'Istanbul 2026!'))) as AuthError;
    const nobody = (await fails(mockAuth.signInWithPassword('nobody@example.com', 'Istanbul 2027!'))) as AuthError;
    // The same words whether or not the email has an account.
    expect(wrong.code).toBe('wrongPassword');
    expect(nobody.message).toBe(wrong.message);
    expect((await mockAuth.signInWithPassword(email, 'Istanbul 2027!')).accessToken).toMatch(/^mocksb\./);
  });

  it('refuses a leaked password kindly, resets a forgotten one by email code, and removes it', async () => {
    const email = `noura.${Date.now()}@example.com`;
    await emailUser(email);
    await mockAuth.reauthenticate();
    const leaked = (await fails(mockAuth.setPassword('Password123!', MOCK_CODE))) as AuthError;
    expect(leaked.code).toBe('leakedPassword');
    expect(leaked.message).toContain('leak');
    await mockAuth.signOut();

    await mockAuth.sendPasswordReset(email);
    await mockAuth.verifyPasswordReset(email, MOCK_CODE);
    await mockAuth.setPassword('Riyadh Season 9#');
    await mockAuth.signOut();
    await mockAuth.signInWithPassword(email, 'Riyadh Season 9#');

    await mockAuth.reauthenticate().catch(() => {});
    const token = await mockAuth.removePassword(MOCK_CODE);
    expect(decodeMockSupabaseToken(token)!.providers).not.toContain('password');
    await mockAuth.signOut();
    expect(((await fails(mockAuth.signInWithPassword(email, 'Riyadh Season 9#'))) as AuthError).code).toBe('wrongPassword');
  });
});
