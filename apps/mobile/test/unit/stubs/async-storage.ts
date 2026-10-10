const m = new Map<string, string>();
export default {
  async getItem(k: string) { return m.get(k) ?? null; },
  async setItem(k: string, v: string) { m.set(k, v); },
  async removeItem(k: string) { m.delete(k); },
};
