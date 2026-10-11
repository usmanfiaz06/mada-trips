import './polyfill';
import { Platform } from 'react-native';
import * as Crypto from 'expo-crypto';
import { createClient, type Session, type SupabaseClient, type UserIdentity } from '@supabase/supabase-js';
import { SUPABASE_ANON_KEY, SUPABASE_URL } from './config';
import { secureSessionStorage } from './session-storage';
import { nativeCredential, nativeSocial, redirectUrl } from './social';
import { AuthError, fromSupabase, type AuthBackend, type Identity, type SocialProvider } from './types';

/*
 * The real Supabase Auth (docs/app/AUTH.md). Only identity lives there: phone, email, Apple, Google. Right after
 * every sign-in the app swaps the Supabase access token for a Core API session (flows.ts); passports, bookings and
 * everything else stay in our database. The Supabase session is kept (in the Keychain) only so a signed-in traveller
 * can add or change a way in later from Profile.
 */
let client: SupabaseClient | null = null;
export function supabase(): SupabaseClient {
  client ??= createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: secureSessionStorage,
      storageKey: 'mada.sb',
      autoRefreshToken: true,
      persistSession: true,
      // The web build comes back from Apple/Google with ?code=…; the native build never uses a URL.
      detectSessionInUrl: Platform.OS === 'web',
      flowType: 'pkce',
    },
  });
  return client;
}

async function run<R extends { data: unknown; error: unknown }>(p: Promise<R>): Promise<NonNullable<R['data']>> {
  let r: R;
  try { r = await p; } catch (e) { throw fromSupabase(e); }
  if (r.error) throw fromSupabase(r.error);
  if (r.data == null) throw new AuthError('other');
  return r.data as NonNullable<R['data']>;
}

const tokenOf = (s: Session | null | undefined): string => {
  if (!s?.access_token) throw new AuthError('other');
  return s.access_token;
};

/** Supabase stores phones without the plus. */
const bare = (phone: string) => phone.replace(/^\+/, '');

async function freshToken(): Promise<string> {
  const { session } = await run(supabase().auth.refreshSession());
  return tokenOf(session);
}

async function identityFor(provider: SocialProvider): Promise<UserIdentity> {
  const { identities } = await run(supabase().auth.getUserIdentities());
  const id = identities.find((i: UserIdentity) => i.provider === provider);
  if (!id) throw new AuthError('other');
  return id;
}

export const supabaseAuth: AuthBackend = {
  kind: 'supabase',

  async sendPhoneCode(phone) {
    await run(supabase().auth.signInWithOtp({ phone: bare(phone), options: { channel: 'sms', shouldCreateUser: true } }));
  },
  async verifyPhoneCode(phone, code) {
    const { session } = await run(supabase().auth.verifyOtp({ phone: bare(phone), token: code, type: 'sms' }));
    return { accessToken: tokenOf(session) };
  },

  async sendEmailCode(email) {
    // The project's email template carries {{ .Token }} (a 6-digit code), not a link: AUTH.md step 3.
    await run(supabase().auth.signInWithOtp({ email: email.trim().toLowerCase(), options: { shouldCreateUser: true } }));
  },
  async verifyEmailCode(email, code) {
    const { session } = await run(supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email' }));
    return { accessToken: tokenOf(session) };
  },

  async signInWith(provider): Promise<Identity | null> {
    if (!nativeSocial) {
      await run(supabase().auth.signInWithOAuth({ provider, options: { redirectTo: `${redirectUrl()}?via=${provider}` } }));
      return null; // the browser leaves for Apple or Google; /auth-callback picks it up
    }
    const c = await nativeCredential(provider);
    const { session } = await run(supabase().auth.signInWithIdToken({ provider, token: c.idToken, nonce: c.nonce }));
    return { accessToken: tokenOf(session), givenName: c.givenName };
  },
  async sessionFromRedirect() {
    const { session } = await run(supabase().auth.getSession());
    return session ? { accessToken: session.access_token } : null;
  },

  async hasSession() {
    try {
      const { session } = await run(supabase().auth.getSession());
      return !!session;
    } catch { return false; }
  },

  async addPhone(phone) {
    await run(supabase().auth.updateUser({ phone: bare(phone) }));
  },
  async verifyAddedPhone(phone, code) {
    await run(supabase().auth.verifyOtp({ phone: bare(phone), token: code, type: 'phone_change' }));
    return freshToken();
  },

  async addEmail(email) {
    await run(supabase().auth.updateUser({ email: email.trim().toLowerCase() }));
  },
  async verifyAddedEmail(email, code) {
    await run(supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'email_change' }));
    return freshToken();
  },

  async link(provider) {
    if (!nativeSocial) {
      await run(supabase().auth.linkIdentity({ provider, options: { redirectTo: `${redirectUrl()}?link=1` } }));
      return null;
    }
    const c = await nativeCredential(provider);
    await run(supabase().auth.linkIdentity({ provider, token: c.idToken, nonce: c.nonce }));
    return freshToken();
  },
  async unlink(provider) {
    await run(supabase().auth.unlinkIdentity(await identityFor(provider)));
    return freshToken();
  },

  async signInWithPassword(email, password) {
    const { session } = await run(supabase().auth.signInWithPassword({ email: email.trim().toLowerCase(), password }));
    return { accessToken: tokenOf(session) };
  },
  async sendPasswordReset(email) {
    // OTP flow: the Reset password template carries {{ .Token }}; no redirect, no link.
    const { error } = await supabase().auth.resetPasswordForEmail(email.trim().toLowerCase());
    if (error) throw fromSupabase(error);
  },
  async verifyPasswordReset(email, code) {
    const { session } = await run(supabase().auth.verifyOtp({ email: email.trim().toLowerCase(), token: code, type: 'recovery' }));
    return { accessToken: tokenOf(session) };
  },
  async reauthenticate() {
    const { error } = await supabase().auth.reauthenticate();
    if (error) throw fromSupabase(error);
  },
  async setPassword(password, code) {
    await run(supabase().auth.updateUser({ password, nonce: code, data: { has_password: true } }));
    return freshToken();
  },
  async removePassword(code) {
    const random = Array.from(Crypto.getRandomBytes(32), (b) => b.toString(16).padStart(2, '0')).join('');
    await run(supabase().auth.updateUser({ password: random, nonce: code, data: { has_password: false } }));
    return freshToken();
  },

  async signOut() {
    try { await supabase().auth.signOut({ scope: 'local' }); } catch { /* offline: the local session is gone anyway */ }
  },
};
