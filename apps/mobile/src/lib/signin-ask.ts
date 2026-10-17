import { Platform } from 'react-native';
import { create } from 'zustand';
import { useSession } from './session';

/*
 * Sign-in is asked only at an account action (Apple 5.1.1(v)): booking, saving, talking to Mada, Circles, the Wallet.
 * requireAccount() answers true when signed in; otherwise it opens "Sign in to book this" over the screen and keeps
 * where to come back to (lib/resume.ts), so the traveller lands on the same search, hotel or plan afterwards.
 */

export type AccountReason = 'book' | 'save' | 'chat' | 'circles' | 'wallet' | 'trips';
type State = { reason: AccountReason | null; returnTo: string | null; open: (reason: AccountReason, returnTo: string | null) => void; close: () => void };

export const useSignInAsk = create<State>((set) => ({
  reason: null,
  returnTo: null,
  open: (reason, returnTo) => set({ reason, returnTo }),
  close: () => set({ reason: null, returnTo: null }),
}));

/** The page as it is now (path and query), to come back to. Web knows it exactly; native passes its own. */
export function herePath(): string | null {
  if (Platform.OS !== 'web') return null;
  try { return `${globalThis.location.pathname}${globalThis.location.search}`; } catch { return null; }
}

/** True when signed in. Otherwise asks to sign in for `reason` and returns false. */
export function requireAccount(reason: AccountReason, returnTo?: string | null): boolean {
  if (useSession.getState().status === 'signedIn') return true;
  useSignInAsk.getState().open(reason, returnTo ?? herePath());
  return false;
}

/** Ask comes back as it was (lib/resume.ts): the saved search, not the words in the address. */
export const ASK_RESUME = '/ask?resume=1';
