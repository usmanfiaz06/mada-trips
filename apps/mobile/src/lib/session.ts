import { create } from 'zustand';
import type { AuthTokens, User } from '@mada/shared';
import { deleteSecret, getSecret, setSecret } from './storage';

/*
 * Who is using the app. Tokens are kept in secure storage and mirrored here; the user profile comes from /me.
 *   loading   reading secure storage at launch
 *   signedOut nobody: onboarding
 *   guest     looking around without an account: search, prices, hotels, Discover, tracking a flight. Sign-in is
 *             asked only at an account action (components/auth/SignInSheet). Kept across launches.
 *   signedIn  tokens present (the profile may still be loading)
 */
export type SessionStatus = 'loading' | 'signedOut' | 'guest' | 'signedIn';

const KEY = 'mada.session.v1';
/** Chose to look around without an account: the next launch opens the app, not the welcome. */
const GUEST_KEY = 'mada.guest.v1';

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
      const guest = !usable && (await getSecret(GUEST_KEY).catch(() => null)) === '1';
      set({ status: usable ? 'signedIn' : guest ? 'guest' : 'signedOut', tokens: usable ? tokens : null });
    } catch {
      set({ status: 'signedOut', tokens: null });
    }
  },
  async signIn(tokens, user) {
    await setSecret(KEY, JSON.stringify(tokens));
    void deleteSecret(GUEST_KEY).catch(() => {});
    set({ status: 'signedIn', tokens, user });
  },
  async setTokens(tokens) {
    await setSecret(KEY, JSON.stringify(tokens));
    set({ tokens });
  },
  setUser(user) { set({ user }); },
  becomeGuest() { set({ status: 'guest', tokens: null, user: null }); void setSecret(GUEST_KEY, '1').catch(() => {}); },
  async clear() {
    await deleteSecret(KEY);
    await deleteSecret(GUEST_KEY).catch(() => {});
    set({ status: 'signedOut', tokens: null, user: null });
  },
}));
