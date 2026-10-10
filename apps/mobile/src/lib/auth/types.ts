import { t } from '../i18n';

export type SocialProvider = 'apple' | 'google';

/** A Supabase access token, plus the name Apple shares only on the very first sign-in. */
export type Identity = { accessToken: string; givenName?: string };

export type AuthErrorCode = 'wrong' | 'expired' | 'wait' | 'tooMany' | 'cancelled' | 'unavailable' | 'offline' | 'taken' | 'noSession' | 'other';

/** Supabase's failures, in our words (COPY.md). `seconds` for 'wait'. */
export class AuthError extends Error {
  constructor(readonly code: AuthErrorCode, message?: string, readonly seconds?: number) {
    super(message ?? AuthError.say(code, seconds));
  }
  static say(code: AuthErrorCode, seconds?: number): string {
    switch (code) {
      case 'wrong': return t('auth.code.wrong');
      case 'expired': return t('auth.code.expired');
      case 'wait': return t('auth.code.wait', { seconds: seconds ?? 60 });
      case 'tooMany': return t('auth.code.tooMany');
      case 'cancelled': return t('auth.signin.cancelled');
      case 'unavailable': return t('auth.signin.unavailable');
      case 'offline': return t('error.offline');
      case 'taken': return t('auth.error.identityTaken');
      case 'noSession': return t('auth.methods.confirmFirst');
      default: return t('error.internal');
    }
  }
}

/**
 * What the screens need from Supabase Auth. Two implementations: supabase.ts (the real project) and mock.ts.
 * Every method that signs in or changes the identity returns a fresh Supabase access token for the Core API.
 */
export interface AuthBackend {
  readonly kind: 'supabase' | 'mock';
  /** Sign in (or up) with a code by SMS. */
  sendPhoneCode(phone: string): Promise<void>;
  verifyPhoneCode(phone: string, code: string): Promise<Identity>;
  /** Sign in (or up) with a 6-digit code by email (not a magic link, so it works in the app). */
  sendEmailCode(email: string): Promise<void>;
  verifyEmailCode(email: string, code: string): Promise<Identity>;
  /** Apple or Google: the native sheet on a phone, a redirect on the web (then null; /auth-callback finishes it). */
  signInWith(provider: SocialProvider, opts?: { hideEmail?: boolean }): Promise<Identity | null>;
  /** After a redirect back from Apple or Google on the web. */
  sessionFromRedirect(): Promise<Identity | null>;

  /** Signed in already: is there a Supabase session to add ways in to? */
  hasSession(): Promise<boolean>;
  /** Add (or change) the phone: a code goes to the new number. */
  addPhone(phone: string): Promise<void>;
  verifyAddedPhone(phone: string, code: string): Promise<string>;
  addEmail(email: string): Promise<void>;
  verifyAddedEmail(email: string, code: string): Promise<string>;
  link(provider: SocialProvider): Promise<string | null>;
  unlink(provider: SocialProvider): Promise<string>;
  signOut(): Promise<void>;
}

/** Supabase's error codes and messages → ours. */
export function fromSupabase(e: unknown): AuthError {
  if (e instanceof AuthError) return e;
  const err = (e ?? {}) as { code?: string; status?: number; message?: string; name?: string };
  const code = err.code ?? '';
  const msg = err.message ?? '';
  // Supabase answers a wrong code and an old one the same way ("Token has expired or is invalid").
  if (code === 'otp_expired' || (/expired|invalid/i.test(msg) && /token|otp|code/i.test(msg))) return new AuthError('wrong');
  if (code === 'over_sms_send_rate_limit' || code === 'over_email_send_rate_limit' || err.status === 429) {
    const s = /after (\d+) seconds?/i.exec(msg);
    return s ? new AuthError('wait', undefined, Number(s[1])) : new AuthError('tooMany');
  }
  if (code === 'identity_already_exists' || code === 'phone_exists' || code === 'email_exists') return new AuthError('taken');
  if (code === 'session_not_found' || code === 'no_authorization') return new AuthError('noSession');
  if (/network|fetch/i.test(msg) || err.name === 'AuthRetryableFetchError') return new AuthError('offline');
  return new AuthError('other');
}
