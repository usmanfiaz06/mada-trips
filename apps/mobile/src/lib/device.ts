import { Platform } from 'react-native';
import { en, type CopyKey } from '@mada/shared';
import { API_MODE } from './config';
import { t } from './i18n';

/*
 * What this device is, for the words and choices that depend on it: Apple Pay and Face ID only on an iPhone, a
 * fingerprint or screen lock on Android, neither on the web.
 *
 * The mock web export is the iPhone prototype (design reviews, screenshots and the e2e suites), so it stays an iPhone
 * unless EXPO_PUBLIC_DEVICE says otherwise; a live web build is the web.
 */
type Device = 'ios' | 'android' | 'web';
const forced = process.env.EXPO_PUBLIC_DEVICE;
export const DEVICE: Device = forced === 'ios' || forced === 'android' || forced === 'web' ? forced
  : Platform.OS === 'ios' ? 'ios' : Platform.OS === 'android' ? 'android' : API_MODE === 'mock' ? 'ios' : 'web';

/** Apple Pay is offered (and can be the default) only on an iPhone. */
export const HAS_APPLE_PAY = DEVICE === 'ios';
/** A biometric check to talk about: Face ID on an iPhone, a fingerprint on Android, none on the web. */
export const HAS_BIOMETRICS = DEVICE !== 'web';

/**
 * `t()` with the device's own words: "Face ID" keys have a `.android` twin (fingerprint or screen lock), and the
 * Apple Pay ones an `.other` twin for anything that isn't an iPhone.
 */
export function dt(key: CopyKey, vars?: Parameters<typeof t>[1]): string {
  if (DEVICE !== 'ios') {
    for (const alt of [DEVICE === 'android' ? `${key}.android` : null, `${key}.other`]) {
      if (alt && alt in en) return t(alt as CopyKey, vars);
    }
  }
  return t(key, vars);
}
