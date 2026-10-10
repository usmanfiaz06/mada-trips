import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/*
 * Secrets (the refresh token) live in the iOS Keychain / Android Keystore via expo-secure-store.
 * The web build has no keychain: it falls back to localStorage, which is fine for screenshots and review builds only.
 */
const web = Platform.OS === 'web';

export async function getSecret(key: string): Promise<string | null> {
  if (web) { try { return globalThis.localStorage?.getItem(key) ?? null; } catch { return null; } }
  return SecureStore.getItemAsync(key);
}

export async function setSecret(key: string, value: string): Promise<void> {
  if (web) { try { globalThis.localStorage?.setItem(key, value); } catch { /* private mode */ } return; }
  await SecureStore.setItemAsync(key, value, { keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY });
}

export async function deleteSecret(key: string): Promise<void> {
  if (web) { try { globalThis.localStorage?.removeItem(key); } catch { /* */ } return; }
  await SecureStore.deleteItemAsync(key);
}
