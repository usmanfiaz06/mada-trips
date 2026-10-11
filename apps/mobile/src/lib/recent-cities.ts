import { create } from 'zustand';
import { kvReadJson, kvWriteJson } from './net/kv';

/* The cities this traveller searched last, first in the "Where?" step. Kept on the phone only; five at most. */

export type RecentCity = { key: string | null; name: string };
const KEY = 'mada.recentCities.v1';

type State = { list: RecentCity[]; loaded: boolean; load: () => Promise<void>; add: (c: RecentCity) => void };

export const useRecentCities = create<State>((set, get) => ({
  list: [],
  loaded: false,
  load: async () => {
    if (get().loaded) return;
    const saved = (await kvReadJson<RecentCity[]>(KEY)) ?? [];
    set((s) => ({ loaded: true, list: [...s.list, ...saved.filter((c) => c && c.name && !s.list.some((x) => x.name === c.name))].slice(0, 5) }));
  },
  add: (c) => {
    const list = [c, ...get().list.filter((x) => x.name.toLowerCase() !== c.name.toLowerCase())].slice(0, 5);
    set({ list });
    void kvWriteJson(KEY, list);
  },
}));
