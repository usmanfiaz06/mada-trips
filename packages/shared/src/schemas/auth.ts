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
