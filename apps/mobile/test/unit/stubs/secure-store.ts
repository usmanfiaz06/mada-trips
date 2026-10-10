const m = new Map<string, string>();
export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 0;
export async function getItemAsync(k: string) { return m.get(k) ?? null; }
export async function setItemAsync(k: string, v: string) { m.set(k, v); }
export async function deleteItemAsync(k: string) { m.delete(k); }
