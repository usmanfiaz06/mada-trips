import { SHOW_DEMO_HINTS } from './config';

/*
 * The prototype's demo switches for the Wallet's edge cases (FLOWS.md §7, §8c): Face ID fails, the scan fails,
 * offline. Only in builds that show demo hints; the web e2e sets them with `window.__MADA_DEMO__ = { faceIdFails: true }`.
 */
export type WalletDemoSwitch = 'faceIdFails' | 'scanFails' | 'offline';

export function demo(flag: WalletDemoSwitch): boolean {
  if (!SHOW_DEMO_HINTS) return false;
  const d = (globalThis as { __MADA_DEMO__?: Partial<Record<WalletDemoSwitch, boolean>> }).__MADA_DEMO__;
  return !!d?.[flag];
}
