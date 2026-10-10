import { create } from 'zustand';
import type { AuthTokens, User } from '@mada/shared';
import { deleteSecret, getSecret, setSecret } from './storage';

/*
 * Who is using the app. Tokens are kept in secure storage and mirrored here; the user profile comes from /me.
 *   loading   reading secure storage at launch
 *   signedOut nobody: onboarding
 *   guest     "Just track a flight": the app without an account (FLOWS.md §1)
 *   signedIn  tokens present (the profile may still be loading)
 */
export type SessionStatus = 'loading' | 'signedOut' | 'guest' | 'signedIn';

const KEY = 'mada.session.v1';

type State = {
  status: SessionStatus;
  tokens: AuthTokens | null;
  user: User | null;
  boot: () => Promise<void>;
  signIn: (tokens: AuthTokens, user: User) => Promise<void>;
  setTokens: (tokens: AuthTokens) => Promise<void>;
  setUser: (user: User) => void;
  becomeGuest: () => void;
  clear: () => Promise<void>;
};

export const useSession = create<State>((set, get) => ({
  status: 'loading',
  tokens: null,
  user: null,
  async boot() {
    if (get().status !== 'loading') return;
    try {
      const raw = await getSecret(KEY);
      const tokens = raw ? (JSON.parse(raw) as AuthTokens) : null;
      const usable = tokens && Date.parse(tokens.refreshExpiresAt) > Date.now();
      set({ status: usable ? 'signedIn' : 'signedOut', tokens: usable ? tokens : null });
    } catch {
      set({ status: 'signedOut', tokens: null });
    }
  },
  async signIn(tokens, user) {
    await setSecret(KEY, JSON.stringify(tokens));
    set({ status: 'signedIn', tokens, user });
  },
  async setTokens(tokens) {
    await setSecret(KEY, JSON.stringify(tokens));
    set({ tokens });
  },
  setUser(user) { set({ user }); },
  becomeGuest() { set({ status: 'guest', tokens: null, user: null }); },
  async clear() {
    await deleteSecret(KEY);
    set({ status: 'signedOut', tokens: null, user: null });
  },
}));
