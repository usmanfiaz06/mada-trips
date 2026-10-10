import { Platform } from 'react-native';
import * as AppleAuthentication from 'expo-apple-authentication';
import * as Crypto from 'expo-crypto';
import { GoogleSignin, isErrorWithCode, statusCodes } from '@react-native-google-signin/google-signin';
import { GOOGLE_IOS_CLIENT_ID, GOOGLE_WEB_CLIENT_ID } from './config';
import { AuthError, type SocialProvider } from './types';

/*
 * The system sheets. Apple (iOS only): expo-apple-authentication with a SHA-256 nonce; Supabase gets the raw nonce
 * and checks it against the token. Google: the native Google Sign-In SDK; its ID token is issued for the web client
 * id, which is what Supabase's Google provider lists (docs/app/AUTH.md).
 */
export type NativeCredential = { idToken: string; nonce?: string; givenName?: string };

export const nativeSocial = true;

let googleReady = false;
function configureGoogle() {
  if (googleReady) return;
  if (!GOOGLE_WEB_CLIENT_ID) throw new AuthError('unavailable');
  GoogleSignin.configure({ webClientId: GOOGLE_WEB_CLIENT_ID, iosClientId: GOOGLE_IOS_CLIENT_ID || undefined, scopes: ['email', 'profile'] });
  googleReady = true;
}

export const appleAvailable = async () => Platform.OS === 'ios' && (await AppleAuthentication.isAvailableAsync().catch(() => false));

export async function nativeCredential(provider: SocialProvider): Promise<NativeCredential> {
  if (provider === 'apple') {
    if (!(await appleAvailable())) throw new AuthError('unavailable');
    const nonce = Crypto.randomUUID();
    const hashed = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, nonce);
    try {
      const c = await AppleAuthentication.signInAsync({
        requestedScopes: [AppleAuthentication.AppleAuthenticationScope.FULL_NAME, AppleAuthentication.AppleAuthenticationScope.EMAIL],
        nonce: hashed,
      });
      if (!c.identityToken) throw new AuthError('other');
      return { idToken: c.identityToken, nonce, givenName: c.fullName?.givenName ?? undefined };
    } catch (e) {
      if ((e as { code?: string }).code === 'ERR_REQUEST_CANCELED') throw new AuthError('cancelled');
      throw e instanceof AuthError ? e : new AuthError('other');
    }
  }
  configureGoogle();
  try {
    if (Platform.OS === 'android') await GoogleSignin.hasPlayServices({ showPlayServicesUpdateDialog: true });
    const r = await GoogleSignin.signIn();
    if (r.type !== 'success') throw new AuthError('cancelled');
    if (!r.data.idToken) throw new AuthError('other');
    return { idToken: r.data.idToken, givenName: r.data.user.givenName ?? undefined };
  } catch (e) {
    if (e instanceof AuthError) throw e;
    if (isErrorWithCode(e) && (e.code === statusCodes.SIGN_IN_CANCELLED || e.code === statusCodes.IN_PROGRESS)) throw new AuthError('cancelled');
    if (isErrorWithCode(e) && e.code === statusCodes.PLAY_SERVICES_NOT_AVAILABLE) throw new AuthError('unavailable');
    throw new AuthError('other');
  }
}

export const redirectUrl = () => 'madatrips://auth-callback';
