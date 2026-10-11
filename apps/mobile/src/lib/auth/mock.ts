import { PASSWORD_MIN_LENGTH, encodeMockSupabaseToken, type AuthProvider } from '@mada/shared';
import { deleteSecret, getSecret, setSecret } from '../storage';
import { CODE_RESEND_SECONDS } from './config';
import { AuthError, type AuthBackend, type Identity, type SocialProvider } from './types';

/*
 * Supabase Auth's stand-in, for mock-API mode, design work and tests (no Supabase project). Same shape as the real
 * thing: codes by SMS and email (always 123456, logged instead of sent), one code per minute per address, Apple and
 * Google answer at once, identities with the same email join one user (Supabase's automatic linking), a phone or an
 * identity already on another user is refused. Tokens are unsigned `mocksb.` tokens the Core API reads in mock mode only.
 */

export const MOCK_CODE = '123456';
/** Stands in for Supabase's leaked-password check (Have I Been Pwned). */
const LEAKED = new Set(['password123', 'password', '12345678', '123456789', 'qwerty123', 'iloveyou1']);

type MockUser = { sub: string; phone: string | null; email: string | null; providers: AuthProvider[]; name: string | null; identities: string[]; password?: string | null };

const users = new Map<string, MockUser>();
const sentAt = new Map<string, number>();
let current: MockUser | null = null;
let pending: { phone?: string; email?: string } = {};
let loaded: Promise<void> | null = null;

const KEY = 'mada.mockauth.v1';
const delay = () => new Promise((r) => setTimeout(r, 120 + Math.random() * 180));
const rid = () => Math.random().toString(36).slice(2, 10);
const deviceId = () => {
  const g = globalThis as { __madaDeviceId?: string };
  return (g.__madaDeviceId ??= rid());
};

async function ready() {
  loaded ??= (async () => {
    try {
      const raw = await getSecret(KEY);
      if (raw) { current = JSON.parse(raw) as MockUser; users.set(current.sub, current); }
    } catch { current = null; }
  })();
  await loaded;
}

async function save() {
  try { if (current) await setSecret(KEY, JSON.stringify(current)); else await deleteSecret(KEY); } catch { /* private mode */ }
}

function token(u: MockUser): string {
  return encodeMockSupabaseToken({ sub: u.sub, phone: u.phone, email: u.email, providers: [...u.providers], name: u.name, exp: Math.floor(Date.now() / 1000) + 3600 });
}

function throttle(target: string) {
  const last = sentAt.get(target);
  const wait = last ? CODE_RESEND_SECONDS - Math.floor((Date.now() - last) / 1000) : 0;
  if (wait > 0) throw new AuthError('wait', undefined, wait);
  sentAt.set(target, Date.now());
}

function checkCode(target: string, code: string) {
  if (!sentAt.has(target) || code !== MOCK_CODE) throw new AuthError('wrong');
  sentAt.delete(target);
}

const find = (pred: (u: MockUser) => boolean) => [...users.values()].find(pred) ?? null;
const addProvider = (u: MockUser, p: AuthProvider) => { if (!u.providers.includes(p)) u.providers.push(p); };

function newUser(fields: Partial<MockUser>): MockUser {
  const u: MockUser = { sub: `mock-${rid()}${rid()}`, phone: null, email: null, providers: [], name: null, identities: [], ...fields };
  users.set(u.sub, u);
  return u;
}

async function become(u: MockUser, givenName?: string): Promise<Identity> {
  current = u;
  pending = {};
  await save();
  return { accessToken: token(u), givenName };
}

function me(): MockUser {
  if (!current) throw new AuthError('noSession');
  return current;
}

export const mockAuth: AuthBackend = {
  kind: 'mock',

  async sendPhoneCode(phone) {
    await ready(); await delay();
    throttle(`sms:${phone}`);
    console.info(`[mock supabase] SMS to ${phone}: ${MOCK_CODE}`);
  },
  async verifyPhoneCode(phone, code) {
    await ready(); await delay();
    checkCode(`sms:${phone}`, code);
    const u = find((x) => x.phone === phone) ?? newUser({ phone });
    addProvider(u, 'phone');
    return become(u);
  },

  async sendEmailCode(raw) {
    await ready(); await delay();
    const email = raw.trim().toLowerCase();
    throttle(`email:${email}`);
    console.info(`[mock supabase] email to ${email}: ${MOCK_CODE}`);
  },
  async verifyEmailCode(raw, code) {
    await ready(); await delay();
    const email = raw.trim().toLowerCase();
    checkCode(`email:${email}`, code);
    const u = find((x) => x.email === email) ?? newUser({ email });
    addProvider(u, 'email');
    return become(u);
  },

  async signInWith(provider, opts = {}) {
    await ready(); await delay();
    const identity = `${provider}:${deviceId()}`;
    const email = provider === 'apple' && opts.hideEmail ? `${deviceId()}@privaterelay.appleid.com` : `${provider}.${deviceId()}@example.com`;
    let u = find((x) => x.identities.includes(identity)) ?? find((x) => x.email === email);
    const first = !u;
    u ??= newUser({ email, name: provider === 'google' ? 'Omar Al-Harbi' : null });
    if (!u.identities.includes(identity)) u.identities.push(identity);
    addProvider(u, provider);
    // Apple shares the name once, on the very first sign-in.
    return become(u, provider === 'apple' && first ? 'Omar' : undefined);
  },
  async sessionFromRedirect() { return null; },

  async hasSession() { await ready(); return !!current; },

  async addPhone(phone) {
    await ready(); await delay();
    const u = me();
    if (find((x) => x.phone === phone && x.sub !== u.sub)) throw new AuthError('taken');
    throttle(`sms:${phone}`);
    pending.phone = phone;
    console.info(`[mock supabase] SMS to ${phone}: ${MOCK_CODE}`);
  },
  async verifyAddedPhone(phone, code) {
    await ready(); await delay();
    const u = me();
    if (pending.phone !== phone) throw new AuthError('wrong');
    checkCode(`sms:${phone}`, code);
    u.phone = phone;
    addProvider(u, 'phone');
    return (await become(u)).accessToken;
  },

  async addEmail(raw) {
    await ready(); await delay();
    const u = me();
    const email = raw.trim().toLowerCase();
    if (find((x) => x.email === email && x.sub !== u.sub)) throw new AuthError('taken');
    throttle(`email:${email}`);
    pending.email = email;
    console.info(`[mock supabase] email to ${email}: ${MOCK_CODE}`);
  },
  async verifyAddedEmail(raw, code) {
    await ready(); await delay();
    const u = me();
    const email = raw.trim().toLowerCase();
    if (pending.email !== email) throw new AuthError('wrong');
    checkCode(`email:${email}`, code);
    u.email = email;
    addProvider(u, 'email');
    return (await become(u)).accessToken;
  },

  async link(provider: SocialProvider) {
    await ready(); await delay();
    const u = me();
    const identity = `${provider}:${deviceId()}`;
    if (find((x) => x.identities.includes(identity) && x.sub !== u.sub)) throw new AuthError('taken');
    if (!u.identities.includes(identity)) u.identities.push(identity);
    addProvider(u, provider);
    if (!u.email) u.email = `${provider}.${deviceId()}@example.com`;
    return (await become(u)).accessToken;
  },
  async unlink(provider: SocialProvider) {
    await ready(); await delay();
    const u = me();
    if (u.providers.length <= 1) throw new AuthError('other');
    u.providers = u.providers.filter((p) => p !== provider);
    u.identities = u.identities.filter((i) => !i.startsWith(`${provider}:`));
    return (await become(u)).accessToken;
  },

  async signInWithPassword(raw, password) {
    await ready(); await delay();
    const email = raw.trim().toLowerCase();
    const u = find((x) => x.email === email);
    // The same answer whether or not the email has an account.
    if (!u || !u.password || u.password !== password) throw new AuthError('wrongPassword');
    return become(u);
  },
  async sendPasswordReset(raw) {
    await ready(); await delay();
    const email = raw.trim().toLowerCase();
    throttle(`reset:${email}`);
    console.info(`[mock supabase] reset code to ${email}: ${MOCK_CODE}`);
  },
  async verifyPasswordReset(raw, code) {
    await ready(); await delay();
    const email = raw.trim().toLowerCase();
    checkCode(`reset:${email}`, code);
    // Supabase signs in with a recovery code only for an existing user; the mock makes one, like the email code.
    const u = find((x) => x.email === email) ?? newUser({ email });
    addProvider(u, 'email');
    return become(u);
  },
  async reauthenticate() {
    await ready(); await delay();
    const u = me();
    throttle(`reauth:${u.sub}`);
    console.info(`[mock supabase] reauthentication code to ${u.email ?? u.phone}: ${MOCK_CODE}`);
  },
  async setPassword(password, code) {
    await ready(); await delay();
    const u = me();
    if (code !== undefined) checkCode(`reauth:${u.sub}`, code);
    if (password.length < PASSWORD_MIN_LENGTH) throw new AuthError('weakPassword');
    if (LEAKED.has(password.toLowerCase())) throw new AuthError('leakedPassword');
    u.password = password;
    addProvider(u, 'password');
    return (await become(u)).accessToken;
  },
  async removePassword(code) {
    await ready(); await delay();
    const u = me();
    if (code !== undefined) checkCode(`reauth:${u.sub}`, code);
    u.password = null;
    u.providers = u.providers.filter((p) => p !== 'password');
    return (await become(u)).accessToken;
  },

  async signOut() {
    await ready();
    current = null;
    pending = {};
    await save();
  },
};

/** Tests: forget every mock user and code. */
export function resetMockAuth() {
  users.clear(); sentAt.clear(); current = null; pending = {}; loaded = null;
}
