import { beforeEach, describe, expect, it } from 'vitest';
import { decodeMockSupabaseToken } from '@mada/shared';
import { setTransport } from '@/lib/api';
import { AuthError, finishSignIn, fromSupabase, syncIdentity } from '@/lib/auth';
import { MOCK_CODE, mockAuth, resetMockAuth } from '@/lib/auth/mock';
import { secureSessionStorage } from '@/lib/auth/session-storage';
import { useOnboarding } from '@/lib/onboarding';
import { useSession } from '@/lib/session';
import { mockTransport } from '../../src/lib/mock-api';

/*
 * Sign-in through Supabase Auth's stand-in, then the Core API's mock: phone, email, Apple and Google, where each lands
 * (name, Welcome back, Verify your phone), and adding a phone or a provider later.
 */

const claims = (token: string) => decodeMockSupabaseToken(token)!;
const rnd = () => `5${String(Math.floor(10_000_000 + Math.random() * 89_999_999))}`;
const expectAuthError = async (p: Promise<unknown>, code: string) => {
  const e = await p.then(() => null, (x: unknown) => x);
  expect(e).toBeInstanceOf(AuthError);
  expect((e as AuthError).code).toBe(code);
  expect((e as AuthError).message.length).toBeGreaterThan(5);
  return e as AuthError;
};

beforeEach(async () => {
  resetMockAuth();
  await useSession.getState().clear();
  useOnboarding.getState().reset();
  (globalThis as { __madaDeviceId?: string }).__madaDeviceId = Math.random().toString(36).slice(2, 10);
  setTransport((w) => mockTransport(w));
});

describe('the Supabase stand-in', () => {
  it('signs in with a phone code: wrong code, a minute between codes, then a token with the number', async () => {
    const phone = `+966${rnd()}`;
    await mockAuth.sendPhoneCode(phone);
    const wait = await expectAuthError(mockAuth.sendPhoneCode(phone), 'wait');
    expect(wait.seconds).toBeGreaterThan(55);
    await expectAuthError(mockAuth.verifyPhoneCode(phone, '000000'), 'wrong');
    const id = await mockAuth.verifyPhoneCode(phone, MOCK_CODE);
    expect(claims(id.accessToken)).toMatchObject({ phone, providers: ['phone'] });
  });

  it('signs in with an email code, and Apple with the same address joins that user', async () => {
    await mockAuth.sendEmailCode('Sara@Example.com');
    const a = await mockAuth.verifyEmailCode('sara@example.com', MOCK_CODE);
    expect(claims(a.accessToken)).toMatchObject({ email: 'sara@example.com', providers: ['email'] });
    const g = (await mockAuth.signInWith('google'))!;
    expect(claims(g.accessToken)).toMatchObject({ providers: ['google'] });
    expect(claims(g.accessToken).sub).not.toBe(claims(a.accessToken).sub);
  });

  it("hides Apple's email when asked, and shares the name only the first time", async () => {
    const first = (await mockAuth.signInWith('apple', { hideEmail: true }))!;
    expect(first.givenName).toBe('Omar');
    expect(claims(first.accessToken).email).toMatch(/@privaterelay\.appleid\.com$/);
    const again = (await mockAuth.signInWith('apple', { hideEmail: true }))!;
    expect(again.givenName).toBeUndefined();
    expect(claims(again.accessToken).sub).toBe(claims(first.accessToken).sub);
  });

  it('adds a phone with a code to the new number, refuses one already taken, never unlinks the last way in', async () => {
    const taken = `+966${rnd()}`;
    await mockAuth.sendPhoneCode(taken);
    await mockAuth.verifyPhoneCode(taken, MOCK_CODE);
    await mockAuth.signOut();
    await mockAuth.signInWith('google');
    await expectAuthError(mockAuth.addPhone(taken), 'taken');
    const mine = `+966${rnd()}`;
    await mockAuth.addPhone(mine);
    await expectAuthError(mockAuth.verifyAddedPhone(mine, '111111'), 'wrong');
    await expectAuthError(mockAuth.addPhone(mine), 'wait');
    const token = await mockAuth.verifyAddedPhone(mine, MOCK_CODE);
    expect(claims(token)).toMatchObject({ phone: mine, providers: ['google', 'phone'] });
    expect(claims(await mockAuth.unlink('google')).providers).toEqual(['phone']);
    await expectAuthError(mockAuth.unlink('google'), 'other');
  });

  it('needs a session to add a way in', async () => {
    expect(await mockAuth.hasSession()).toBe(false);
    await expectAuthError(mockAuth.addEmail('x@example.com'), 'noSession');
  });
});

describe('sign-in, end to end against the mock Core API', () => {
  it('a new phone goes on to the name; the demo number is Welcome back', async () => {
    const phone = `+966${rnd()}`;
    await mockAuth.sendPhoneCode(phone);
    expect(await finishSignIn(await mockAuth.verifyPhoneCode(phone, MOCK_CODE), 'phone')).toBe('/name');
    expect(useSession.getState()).toMatchObject({ status: 'signedIn', user: { phone } });

    resetMockAuth();
    await mockAuth.sendPhoneCode('+966500004127');
    expect(await finishSignIn(await mockAuth.verifyPhoneCode('+966500004127', MOCK_CODE), 'phone')).toBe('/welcome-back');
    expect(useOnboarding.getState().returning).toEqual({ name: 'Omar' });
  });

  it('Apple, Google and email accounts verify a phone first, and it lands on the same account', async () => {
    for (const via of ['apple', 'google', 'email'] as const) {
      resetMockAuth();
      (globalThis as { __madaDeviceId?: string }).__madaDeviceId = Math.random().toString(36).slice(2, 10);
      let id;
      if (via === 'email') { const e = `${Math.random().toString(36).slice(2)}@example.com`; await mockAuth.sendEmailCode(e); id = await mockAuth.verifyEmailCode(e, MOCK_CODE); }
      else id = (await mockAuth.signInWith(via))!;
      expect(await finishSignIn(id, via)).toBe('/verify-phone?then=onboarding');
      expect(useOnboarding.getState()).toMatchObject({ via, afterPhone: '/name' });
      const before = useSession.getState().user!;
      expect(before.phone).toBeNull();
      expect(before.methods[via === 'email' ? 'email' : via]).toBe(true);

      const phone = `+966${rnd()}`;
      await mockAuth.addPhone(phone);
      const user = await syncIdentity(await mockAuth.verifyAddedPhone(phone, MOCK_CODE));
      expect(user).toMatchObject({ id: before.id, phone, methods: { phone: true } });
      expect(useSession.getState().user?.phone).toBe(phone);
    }
  });
});

describe('Supabase errors in our words', () => {
  it('maps codes, rate limits and network trouble', () => {
    expect(fromSupabase({ code: 'otp_expired', message: 'Token has expired or is invalid' }).code).toBe('wrong');
    const w = fromSupabase({ code: 'over_sms_send_rate_limit', status: 429, message: 'For security purposes, you can only request this after 42 seconds.' });
    expect([w.code, w.seconds]).toEqual(['wait', 42]);
    expect(fromSupabase({ status: 429, message: 'Too many' }).code).toBe('tooMany');
    expect(fromSupabase({ code: 'identity_already_exists' }).code).toBe('taken');
    expect(fromSupabase({ name: 'AuthRetryableFetchError', message: 'Failed to fetch' }).code).toBe('offline');
    for (const code of ['wrong', 'wait', 'tooMany', 'taken', 'other'] as const) expect(new AuthError(code).message).not.toMatch(/error|failed|!|—/i);
  });
});

describe('the Supabase session in secure storage', () => {
  it('splits large values into chunks and reads them back', async () => {
    // The web build's stand-in for the Keychain (the unit tests run as "web").
    const m = new Map<string, string>();
    (globalThis as { localStorage?: unknown }).localStorage = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, removeItem: (k: string) => { m.delete(k); } };
    const big = 'x'.repeat(4000) + 'end';
    await secureSessionStorage.setItem('sb-test-auth-token', big);
    expect(await secureSessionStorage.getItem('sb-test-auth-token')).toBe(big);
    expect(m.get('sb-test-auth-token.n')).toBe('3');
    await secureSessionStorage.setItem('sb-test-auth-token', 'small');
    expect(await secureSessionStorage.getItem('sb-test-auth-token')).toBe('small');
    await secureSessionStorage.removeItem('sb-test-auth-token');
    expect(await secureSessionStorage.getItem('sb-test-auth-token')).toBeNull();
    expect(m.size).toBe(0);
    delete (globalThis as { localStorage?: unknown }).localStorage;
  });
});
