import type { SocialProvider } from './types';

/*
 * Web: Apple and Google sign in by redirect (Supabase OAuth). The native build (social.native.ts) uses the system
 * sheets and hands Supabase an ID token instead.
 */
export type NativeCredential = { idToken: string; nonce?: string; givenName?: string };

export const nativeSocial = false;

export async function nativeCredential(_provider: SocialProvider): Promise<NativeCredential> {
  throw new Error('No native sign-in on the web');
}

export const appleAvailable = async () => false;

/** Where Apple and Google send the browser back to. */
export const redirectUrl = () => `${globalThis.location?.origin ?? ''}/auth-callback`;
