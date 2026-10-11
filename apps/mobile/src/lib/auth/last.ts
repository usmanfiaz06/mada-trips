import { deleteSecret, getSecret, setSecret } from '../storage';

/*
 * The way in this phone used last time, kept in the Keychain / Keystore (web preview: localStorage), so the sign-in
 * screen can put it first: "Continue as o•••@gmail.com". Only the method and the number or address; never a code,
 * a token or a password.
 */
export type LastVia = 'apple' | 'google' | 'email' | 'phone';
export type LastSignIn = { via: LastVia; contact: string | null };
const KEY = 'mada.lastSignIn.v1';

export async function getLastSignIn(): Promise<LastSignIn | null> {
  try {
    const raw = await getSecret(KEY);
    if (!raw) return null;
    const v = JSON.parse(raw) as LastSignIn;
    return ['apple', 'google', 'email', 'phone'].includes(v.via) ? v : null;
  } catch { return null; }
}

export async function saveLastSignIn(v: LastSignIn): Promise<void> {
  try { await setSecret(KEY, JSON.stringify(v)); } catch { /* private mode: nothing to remember */ }
}

export async function forgetLastSignIn(): Promise<void> {
  try { await deleteSecret(KEY); } catch { /* */ }
}
