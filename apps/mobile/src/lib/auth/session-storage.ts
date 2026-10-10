import { deleteSecret, getSecret, setSecret } from '../storage';

/*
 * Where supabase-js keeps its session: the Keychain / Keystore through expo-secure-store (localStorage on the web).
 * SecureStore values should stay under 2 KB and a Supabase session can be larger, so values are split into chunks.
 */
const CHUNK = 1800;
const countKey = (key: string) => `${key}.n`;
const safe = (key: string) => key.replace(/[^\w.-]/g, '_');

export const secureSessionStorage = {
  async getItem(key: string): Promise<string | null> {
    const k = safe(key);
    const n = Number(await getSecret(countKey(k)));
    if (!n) return null;
    const parts: string[] = [];
    for (let i = 0; i < n; i += 1) {
      const p = await getSecret(`${k}.${i}`);
      if (p == null) return null;
      parts.push(p);
    }
    return parts.join('');
  },
  async setItem(key: string, value: string): Promise<void> {
    const k = safe(key);
    const old = Number(await getSecret(countKey(k))) || 0;
    const n = Math.max(1, Math.ceil(value.length / CHUNK));
    for (let i = 0; i < n; i += 1) await setSecret(`${k}.${i}`, value.slice(i * CHUNK, (i + 1) * CHUNK));
    for (let i = n; i < old; i += 1) await deleteSecret(`${k}.${i}`);
    await setSecret(countKey(k), String(n));
  },
  async removeItem(key: string): Promise<void> {
    const k = safe(key);
    const n = Number(await getSecret(countKey(k))) || 0;
    for (let i = 0; i < n; i += 1) await deleteSecret(`${k}.${i}`);
    await deleteSecret(countKey(k));
  },
};
