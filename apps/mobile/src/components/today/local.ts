import { useEffect } from 'react';
import { create } from 'zustand';
import { kvGet, kvSet } from '@/lib/trips';

/*
 * What stays on this phone only (the prototype says so on screen): the packing ticks, things added to the list, the
 * arrival checklist, the three favourite photos. Keyed by trip.
 */

export type TripLocal = { packed: string[]; extra: { id: string; t: string }[]; arrival: string[]; photos: string[]; seenGate: string | null };
const EMPTY: TripLocal = { packed: [], extra: [], arrival: [], photos: [], seenGate: null };
const KEY = 'mada.trips.local.v1';

type Store = { byTrip: Record<string, TripLocal>; loaded: boolean; load: () => Promise<void>; update: (tripId: string, fn: (l: TripLocal) => Partial<TripLocal>) => void };

export const useLocalStore = create<Store>((set, get) => ({
  byTrip: {}, loaded: false,
  async load() {
    if (get().loaded) return;
    const raw = await kvGet(KEY);
    try { set({ byTrip: raw ? JSON.parse(raw) : {}, loaded: true }); } catch { set({ loaded: true }); }
  },
  update(tripId, fn) {
    const cur = get().byTrip[tripId] ?? EMPTY;
    const byTrip = { ...get().byTrip, [tripId]: { ...cur, ...fn(cur) } };
    set({ byTrip });
    void kvSet(KEY, JSON.stringify(byTrip));
  },
}));

export function useTripLocal(tripId: string): [TripLocal, (fn: (l: TripLocal) => Partial<TripLocal>) => void] {
  const load = useLocalStore((s) => s.load);
  useEffect(() => { void load(); }, [load]);
  const local = useLocalStore((s) => s.byTrip[tripId]) ?? EMPTY;
  const update = useLocalStore((s) => s.update);
  return [local, (fn) => update(tripId, fn)];
}
