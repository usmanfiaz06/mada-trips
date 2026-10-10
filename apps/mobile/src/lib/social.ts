import { API_MODE } from './config';

/*
 * Sign in with Apple / Google. M0 stubs the native step: in development and mock builds it returns a mock identity
 * token the Core API's mock identity supplier accepts ("mock:<id>[:<email>]"). The native sheets
 * (expo-apple-authentication, Google Sign-In) replace this in M1 without touching the screens or the API.
 */
export type SocialResult = { idToken: string; givenName?: string };

const deviceId = () => {
  const g = globalThis as { __madaDeviceId?: string };
  return (g.__madaDeviceId ??= Math.random().toString(36).slice(2, 12));
};

export async function socialIdentity(provider: 'apple' | 'google', opts: { hideEmail: boolean }): Promise<SocialResult> {
  if (!(__DEV__ || API_MODE === 'mock' || process.env.EXPO_PUBLIC_SOCIAL_MODE === 'mock')) {
    throw new Error(`${provider} sign-in isn't wired to the native sheet yet`);
  }
  const email = provider === 'apple' && opts.hideEmail ? `${deviceId()}@privaterelay.appleid.com` : `${provider}.${deviceId()}@example.com`;
  return { idToken: `mock:${provider}-${deviceId()}:${email}`, givenName: 'Omar' };
}
