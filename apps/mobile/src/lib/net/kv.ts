import AsyncStorage from '@react-native-async-storage/async-storage';
import { create } from 'zustand';

/*
 * Device storage for things that must survive a restart but aren't secrets: the offline copy of server state, the
 * outbox, the last /config. AsyncStorage on phones; localStorage on the web build. Secrets stay in lib/storage.ts.
 *
 * A full phone is the one write failure worth telling the traveller about ("Your phone is almost full."): it means
 * their trips won't be there offline. Every other storage problem is swallowed: the app still works online.
 */

type StorageHealth = { full: boolean; at: number | null; setFull: (full: boolean) => void };
export const useStorageHealth = create<StorageHealth>((set) => ({
  full: false,
  at: null,
  setFull: (full) => set({ full, at: full ? Date.now() : null }),
}));

const FULL = /quota|full|ENOSPC|SQLITE_FULL|no space|disk/i;
export const isStorageFull = (e: unknown) => {
  const x = e as { name?: string; message?: string; code?: string | number } | null;
  return !!x && (x.name === 'QuotaExceededError' || x.code === 22 || FULL.test(`${x.name ?? ''} ${x.message ?? ''} ${x.code ?? ''}`));
};

/** Tests swap the backend. */
export type KvBackend = { getItem(k: string): Promise<string | null>; setItem(k: string, v: string): Promise<void>; removeItem(k: string): Promise<void> };
let backend: KvBackend = AsyncStorage as unknown as KvBackend;
export const setKvBackend = (b: KvBackend) => { backend = b; };

export async function kvRead(key: string): Promise<string | null> {
  try { return await backend.getItem(key); } catch { return null; }
}

/** Write; false when it didn't stick. A full phone is reported once through useStorageHealth. */
export async function kvWrite(key: string, value: string | null): Promise<boolean> {
  try {
    if (value === null) await backend.removeItem(key);
    else await backend.setItem(key, value);
    if (useStorageHealth.getState().full) useStorageHealth.getState().setFull(false);
    return true;
  } catch (e) {
    if (isStorageFull(e)) useStorageHealth.getState().setFull(true);
    return false;
  }
}

export async function kvReadJson<T>(key: string): Promise<T | null> {
  const raw = await kvRead(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export const kvWriteJson = (key: string, value: unknown) => kvWrite(key, value === null ? null : JSON.stringify(value));
