import { MeResponse, ROUTES, SignInResponse, type User } from '@mada/shared';
import { deviceInfo, request } from '../api';
import { useOnboarding } from '../onboarding';
import { useSession } from '../session';
import { AUTH_MODE } from './config';
import { mockAuth } from './mock';
import { supabaseAuth } from './supabase';
import type { AuthBackend, Identity } from './types';
import { saveLastSignIn } from './last';

/*
 * Sign-in, in two halves (docs/app/AUTH.md):
 *   1. Supabase Auth proves who you are: a phone code, an email code, Apple or Google  → a Supabase access token;
 *   2. the Core API swaps that token for its own session (POST /auth/session), the same access + refresh tokens
 *      every other call already uses.
 * Accounts that began with Apple, Google or email verify a phone before their first booking (verify-phone screen).
 */
export * from './types';
export { AUTH_MODE, CODE_RESEND_SECONDS } from './config';
export { getLastSignIn, forgetLastSignIn, type LastSignIn } from './last';

export const auth = (): AuthBackend => (AUTH_MODE === 'supabase' ? supabaseAuth : mockAuth);

export const authApi = {
  session: (accessToken: string, givenName?: string) =>
    request({ method: 'POST', path: ROUTES.session, body: { accessToken, givenName, device: deviceInfo() }, auth: false }, SignInResponse),
  sync: (accessToken: string) => request({ method: 'POST', path: ROUTES.sessionSync, body: { accessToken } }, MeResponse),
};

/** The profile everywhere: the session, and React Query's /me (loaded lazily: queries.ts pulls in the screens' world). */
function keepUser(user: User) {
  useSession.getState().setUser(user);
  void import('../queries').then((q) => q.queryClient.setQueryData(q.keys.me, user)).catch(() => {});
}

export type Via = 'apple' | 'google' | 'email' | 'phone';

/**
 * Step 2, then where to go: no verified phone yet → Verify your phone; a new account → name; otherwise Welcome back.
 * The onboarding store remembers what comes after the phone step.
 */
export async function finishSignIn(id: Identity, via: Via): Promise<'/verify-phone?then=onboarding' | '/name' | '/welcome-back'> {
  const r = await authApi.session(id.accessToken, id.givenName);
  await useSession.getState().signIn(r.tokens, r.user);
  keepUser(r.user);
  const after = r.isNew ? '/name' : '/welcome-back';
  const ob = useOnboarding.getState();
  const contact = via === 'phone' ? r.user.phone ?? ob.phone : via === 'email' ? ob.email || r.user.email : r.user.emailRelay ? null : r.user.email;
  void saveLastSignIn({ via, contact: contact || null });
  // Face ID to reopen the app: offered once, on a phone that has it (app-lock.ts).
  void import('../app-lock').then((m) => m.useAppLock.getState().maybeOffer()).catch(() => {});
  useOnboarding.getState().set({
    social: via === 'apple' || via === 'google' ? via : null,
    via,
    suggestedName: r.user.name || id.givenName || '',
    returning: r.isNew ? null : { name: r.user.name },
    afterPhone: after,
  });
  return r.user.phone ? after : '/verify-phone?then=onboarding';
}

/** Signed in already: copy what Supabase now knows (a phone, an email, a provider) onto the account. */
export async function syncIdentity(accessToken: string): Promise<User> {
  const { user } = await authApi.sync(accessToken);
  keepUser(user);
  return user;
}

/** Forget the Supabase session on this phone too (the Core API session is ended by api.logout). */
export async function signOutIdentity() {
  await auth().signOut();
}
