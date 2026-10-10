import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { create } from 'zustand';
import { getSecret, setSecret } from './storage';
import { demo } from './wallet-demo';
import { SHOW_DEMO_HINTS } from './config';
import { t } from './i18n';

/*
 * The Wallet lock (FLOWS.md §7): Face ID (or Touch ID / fingerprint) when the Wallet opens, the passcode when it
 * doesn't match, and a lockout after too many wrong passcodes. On a phone the passcode is the phone's own, checked
 * by the OS (which has its own lockout). Where there's no biometric hardware (the web preview, review builds),
 * Mada's passcode screen stands in: the demo passcode is 123456, five wrong tries lock it for 5 minutes.
 * The Wallet locks again 60 seconds after the app goes to the background. Turned off in Security: no lock at all.
 */

export const MAX_PASSCODE_TRIES = 5;
export const LOCKOUT_MS = 5 * 60_000;
const RELOCK_MS = 60_000;
const KEY = 'mada.wallet.lockout.v1';
const DEMO_PASSCODE = '123456';

type LockState = {
  unlocked: boolean;
  /** idle → checking → failed (Face ID didn't match) */
  phase: 'idle' | 'checking' | 'failed';
  wrong: number;
  lockedUntil: number;
  hydrate: () => Promise<void>;
  tryBiometric: () => Promise<boolean>;
  /** On a phone: the OS passcode sheet. Elsewhere: the 6 digits typed on Mada's screen. */
  tryPasscode: (code?: string) => Promise<'ok' | 'wrong' | 'locked' | 'cancelled'>;
  lock: () => void;
  unlock: () => void;
};

const native = Platform.OS !== 'web';

async function biometricsReady() {
  if (!native) return false;
  try { return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()); } catch { return false; }
}

export const useWalletLock = create<LockState>((set, get) => ({
  unlocked: false,
  phase: 'idle',
  wrong: 0,
  lockedUntil: 0,
  async hydrate() {
    const raw = await getSecret(KEY);
    if (!raw) return;
    try { const v = JSON.parse(raw) as { wrong: number; lockedUntil: number }; set({ wrong: v.wrong, lockedUntil: v.lockedUntil }); } catch { /* ignore */ }
  },
  async tryBiometric() {
    set({ phase: 'checking' });
    if (native) {
      if (await biometricsReady()) {
        const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('wallet.lock.prompt'), disableDeviceFallback: true, cancelLabel: t('common.cancel') });
        if (r.success) { get().unlock(); return true; }
      }
      // No Face ID enrolled, or it didn't match: the phone's passcode is next.
      set({ phase: 'failed' });
      return false;
    }
    // The web preview has no Face ID: the prototype's simulated check, failing only on the demo switch.
    await new Promise((res) => setTimeout(res, 900));
    if (demo('faceIdFails')) { set({ phase: 'failed' }); return false; }
    get().unlock();
    return true;
  },
  async tryPasscode(code) {
    if (get().lockedUntil > Date.now()) return 'locked';
    if (native) {
      const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('wallet.lock.prompt'), disableDeviceFallback: false, fallbackLabel: t('wallet.lock.usePasscode') });
      // A phone with no passcode at all has nothing to check against.
      if (r.success || r.error === 'passcode_not_set') { get().unlock(); return 'ok'; }
      return r.error === 'lockout' ? 'locked' : 'cancelled';
    }
    if (code === DEMO_PASSCODE && SHOW_DEMO_HINTS) { get().unlock(); return 'ok'; }
    const wrong = get().wrong + 1;
    const lockedUntil = wrong >= MAX_PASSCODE_TRIES ? Date.now() + LOCKOUT_MS : 0;
    set({ wrong: lockedUntil ? 0 : wrong, lockedUntil });
    await setSecret(KEY, JSON.stringify({ wrong: lockedUntil ? 0 : wrong, lockedUntil }));
    return lockedUntil ? 'locked' : 'wrong';
  },
  lock() { set({ unlocked: false, phase: 'idle' }); },
  unlock() { set({ unlocked: true, phase: 'idle', wrong: 0, lockedUntil: 0 }); setSecret(KEY, JSON.stringify({ wrong: 0, lockedUntil: 0 })).catch(() => {}); },
}));

let backgroundAt = 0;
AppState.addEventListener('change', (s) => {
  if (s === 'background') backgroundAt = Date.now();
  else if (s === 'active' && backgroundAt && Date.now() - backgroundAt > RELOCK_MS) { backgroundAt = 0; useWalletLock.getState().lock(); }
});
