import { AppState, Platform } from 'react-native';
import * as LocalAuthentication from 'expo-local-authentication';
import { create } from 'zustand';
import { getSecret, setSecret } from './storage';
import { demo } from './wallet-demo';
import { t } from './i18n';

/*
 * Open Mada with Face ID (or fingerprint): opt-in, offered once after sign-in on a phone that has it, and switched in
 * Profile › Security. Same check as the Wallet lock (wallet-lock.ts): the phone's biometrics, with its passcode as the
 * fallback. Mada asks again when it comes back after 5 minutes away. Stored on this phone only.
 * The web preview has no Face ID: the check is simulated there, failing only on the demo switch.
 */
const KEY = 'mada.applock.v1';
const AWAY_MS = 5 * 60_000;
const native = Platform.OS !== 'web';

type Saved = { on: boolean; asked: boolean };
type AppLock = Saved & {
  loaded: boolean;
  locked: boolean;
  /** The one-time "Open Mada with Face ID?" sheet. */
  offer: boolean;
  hydrate: () => Promise<void>;
  setOn: (on: boolean) => Promise<boolean>;
  maybeOffer: () => Promise<void>;
  answerOffer: (yes: boolean) => Promise<void>;
  unlock: () => Promise<boolean>;
};

export async function biometricsAvailable(): Promise<boolean> {
  if (!native) return true;
  try { return (await LocalAuthentication.hasHardwareAsync()) && (await LocalAuthentication.isEnrolledAsync()); } catch { return false; }
}

async function check(): Promise<boolean> {
  if (native) {
    const r = await LocalAuthentication.authenticateAsync({ promptMessage: t('auth.bio.prompt'), cancelLabel: t('common.cancel') }).catch(() => ({ success: false }));
    return r.success;
  }
  await new Promise((res) => setTimeout(res, 700));
  return !demo('faceIdFails');
}

async function save(v: Saved) { try { await setSecret(KEY, JSON.stringify(v)); } catch { /* private mode */ } }

export const useAppLock = create<AppLock>((set, get) => ({
  on: false, asked: false, loaded: false, locked: false, offer: false,
  async hydrate() {
    if (get().loaded) return;
    let v: Saved = { on: false, asked: false };
    try { const raw = await getSecret(KEY); if (raw) v = { ...v, ...(JSON.parse(raw) as Partial<Saved>) }; } catch { /* */ }
    // A cold start with the lock on opens locked.
    set({ ...v, loaded: true, locked: v.on });
  },
  async setOn(on) {
    if (on && !(await check())) return false;
    const v = { on, asked: true };
    set({ ...v, locked: false });
    await save(v);
    return true;
  },
  async maybeOffer() {
    await get().hydrate();
    // Only on a phone that has Face ID or a fingerprint set up, and only once.
    if (!native || get().asked || get().on || !(await biometricsAvailable())) return;
    set({ offer: true });
  },
  async answerOffer(yes) {
    set({ offer: false });
    if (yes) { await get().setOn(true); return; }
    const v = { on: get().on, asked: true };
    set(v);
    await save(v);
  },
  async unlock() {
    const ok = await check();
    if (ok) set({ locked: false });
    return ok;
  },
}));

let awaySince = 0;
AppState.addEventListener('change', (s) => {
  if (s === 'background') awaySince = Date.now();
  else if (s === 'active' && awaySince && Date.now() - awaySince > AWAY_MS && useAppLock.getState().on) useAppLock.setState({ locked: true });
});
