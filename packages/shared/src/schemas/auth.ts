import { z } from 'zod';
import { IsoDateTime, Locale, PhoneE164 } from './common';

/** Codes are 6 digits, 3 tries per code, a new code after 30 seconds (FLOWS.md §1). */
export const OTP_LENGTH = 6;
export const OTP_MAX_TRIES = 3;
export const OTP_RESEND_SECONDS = 30;
export const OTP_TTL_SECONDS = 600;

export const DeviceInfo = z.object({
  platform: z.enum(['ios', 'android', 'web']),
  name: z.string().max(80).optional(),
  appVersion: z.string().max(32).optional(),
});
export type DeviceInfo = z.infer<typeof DeviceInfo>;

/** Phone may be typed loosely ("050 000 4127"); the server normalises and checks it. */
export const OtpStartRequest = z.object({
  phone: z.string().min(1).max(32),
  locale: Locale.optional(),
});
export type OtpStartRequest = z.infer<typeof OtpStartRequest>;

export const OtpStartResponse = z.object({
  phone: PhoneE164,
  /** Seconds before another code can be sent. */
  resendAfter: z.number().int(),
  /** Seconds this code stays valid. */
  expiresIn: z.number().int(),
  length: z.literal(OTP_LENGTH),
});
export type OtpStartResponse = z.infer<typeof OtpStartResponse>;

export const OtpVerifyRequest = z.object({
  phone: z.string().min(1).max(32),
  code: z.string().regex(/^\d{6}$/, 'Expected 6 digits'),
  device: DeviceInfo.optional(),
});
export type OtpVerifyRequest = z.infer<typeof OtpVerifyRequest>;

export const AuthTokens = z.object({
  accessToken: z.string(),
  accessExpiresAt: IsoDateTime,
  refreshToken: z.string(),
  refreshExpiresAt: IsoDateTime,
});
export type AuthTokens = z.infer<typeof AuthTokens>;

export const RefreshRequest = z.object({ refreshToken: z.string().min(20).max(200) });
export type RefreshRequest = z.infer<typeof RefreshRequest>;
export const RefreshResponse = z.object({ tokens: AuthTokens });
export type RefreshResponse = z.infer<typeof RefreshResponse>;

export const LogoutRequest = z.object({ refreshToken: z.string().min(20).max(200).optional() });
export type LogoutRequest = z.infer<typeof LogoutRequest>;

/**
 * Sign in with Apple / Google. The app sends the provider's identity token; the server verifies it.
 * Apple shares the name only on the very first sign-in, so the app passes it along.
 */
export const SocialSignInRequest = z.object({
  idToken: z.string().min(10).max(8000),
  nonce: z.string().max(200).optional(),
  givenName: z.string().max(60).optional(),
  familyName: z.string().max(60).optional(),
  device: DeviceInfo.optional(),
});
export type SocialSignInRequest = z.infer<typeof SocialSignInRequest>;

/* ───────────── Supabase Auth (docs/app/AUTH.md) ───────────── */

/**
 * The app signs in with Supabase Auth (phone code, email code, Apple, Google), then swaps the Supabase access token for
 * a Core API session. Apple shares the name only on the very first sign-in, so the app passes it along.
 */
export const SupabaseSessionRequest = z.object({
  accessToken: z.string().min(10).max(16_000),
  givenName: z.string().max(60).optional(),
  familyName: z.string().max(60).optional(),
  device: DeviceInfo.optional(),
});
export type SupabaseSessionRequest = z.infer<typeof SupabaseSessionRequest>;

/** Signed in already: the Supabase identity gained a phone, an email or a provider. Answers MeResponse. */
export const SupabaseSyncRequest = z.object({ accessToken: z.string().min(10).max(16_000) });
export type SupabaseSyncRequest = z.infer<typeof SupabaseSyncRequest>;

export const AUTH_PROVIDERS = ['phone', 'email', 'apple', 'google'] as const;
export type AuthProvider = (typeof AUTH_PROVIDERS)[number];

/**
 * Mock mode (no Supabase project): the app's stand-in for Supabase Auth issues unsigned tokens of the form
 * `mocksb.<base64url JSON>`, and the platform's mock adapter reads them. Never accepted on a production deployment.
 */
export type MockSupabaseClaims = {
  sub: string;
  email?: string | null;
  phone?: string | null;
  providers: AuthProvider[];
  name?: string | null;
  /** Seconds since the epoch. */
  exp: number;
  iss?: string;
};
export const MOCK_SUPABASE_PREFIX = 'mocksb.';
export const MOCK_SUPABASE_ISSUER = 'mock-supabase';

const B64 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

function utf8(s: string): number[] {
  const out: number[] = [];
  for (const ch of s) {
    let c = ch.codePointAt(0)!;
    if (c < 0x80) out.push(c);
    else if (c < 0x800) out.push(0xc0 | (c >> 6), 0x80 | (c & 63));
    else if (c < 0x10000) out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63));
    else { out.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 63), 0x80 | ((c >> 6) & 63), 0x80 | (c & 63)); }
  }
  return out;
}

function fromUtf8(b: number[]): string {
  let s = '';
  for (let i = 0; i < b.length;) {
    const x = b[i]!;
    let c: number;
    if (x < 0x80) { c = x; i += 1; } else if (x < 0xe0) { c = ((x & 31) << 6) | (b[i + 1]! & 63); i += 2; } else if (x < 0xf0) { c = ((x & 15) << 12) | ((b[i + 1]! & 63) << 6) | (b[i + 2]! & 63); i += 3; } else { c = ((x & 7) << 18) | ((b[i + 1]! & 63) << 12) | ((b[i + 2]! & 63) << 6) | (b[i + 3]! & 63); i += 4; }
    s += String.fromCodePoint(c);
  }
  return s;
}

function b64url(bytes: number[]): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 3) {
    const n = (bytes[i]! << 16) | ((bytes[i + 1] ?? 0) << 8) | (bytes[i + 2] ?? 0);
    s += B64[(n >> 18) & 63]! + B64[(n >> 12) & 63]! + (i + 1 < bytes.length ? B64[(n >> 6) & 63]! : '') + (i + 2 < bytes.length ? B64[n & 63]! : '');
  }
  return s;
}

function unb64url(s: string): number[] | null {
  const out: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) return null;
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; out.push((buf >> bits) & 255); }
  }
  return out;
}

export function encodeMockSupabaseToken(claims: MockSupabaseClaims): string {
  return MOCK_SUPABASE_PREFIX + b64url(utf8(JSON.stringify({ iss: MOCK_SUPABASE_ISSUER, ...claims })));
}

/** The claims of a mock token, or null if it isn't one. Expiry is the caller's to check. */
export function decodeMockSupabaseToken(token: string): MockSupabaseClaims | null {
  if (!token.startsWith(MOCK_SUPABASE_PREFIX)) return null;
  const bytes = unb64url(token.slice(MOCK_SUPABASE_PREFIX.length));
  if (!bytes) return null;
  try {
    const c = JSON.parse(fromUtf8(bytes)) as MockSupabaseClaims;
    if (typeof c.sub !== 'string' || !c.sub || typeof c.exp !== 'number' || !Array.isArray(c.providers)) return null;
    return c;
  } catch {
    return null;
  }
}

/* ───────────── account recovery (signed out) ───────────── */

/** A way to reach someone: a phone number (typed loosely, the server checks it) or an email address. */
export const RecoveryContact = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('phone'), value: z.string().trim().min(6).max(32) }),
  z.object({ kind: z.literal('email'), value: z.string().trim().toLowerCase().pipe(z.email()).pipe(z.string().max(254)) }),
]);
export type RecoveryContact = z.infer<typeof RecoveryContact>;

/**
 * "I can't use this number or email any more": a person on the desk checks it's them (passport details on file,
 * their last booking) and moves the account to the new contact. Works signed out. The answer never says whether an
 * account exists for the old contact.
 */
export const RecoveryRequest = z.object({
  name: z.string().trim().min(1).max(80),
  oldContact: RecoveryContact,
  newContact: RecoveryContact,
  note: z.string().trim().max(500).optional(),
  locale: Locale.optional(),
});
export type RecoveryRequest = z.infer<typeof RecoveryRequest>;

/** Always the same answer, whether or not an account matched. */
export const RecoveryResponse = z.object({ received: z.literal(true) });
export type RecoveryResponse = z.infer<typeof RecoveryResponse>;

/** How many recovery requests one network or one old contact can send. */
export const RECOVERY_LIMITS = { perIpPerHour: 5, perContactPerDay: 3 } as const;
