import { useEffect, useState } from 'react';
import type { ImageSourcePropType } from 'react-native';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { create } from 'zustand';
import { localizeDigits, PlaceResponse, PlaceSearchResponse, PlanPlaceResponse, PopularPlacesResponse, type PlaceHit, type PlanPlaceRequest } from '@mada/shared';
import { request } from './api';
import { kvGet, kvSet } from './trips';

/*
 * Places' client: worldwide city search (typeahead), the city guide, "Plan it with Mada" and Popular, plus the few
 * things the screens need on the phone: recent searches (kept on the device), our own photos, and local time.
 */

export const placesApi = {
  search: (q: string) => request({ method: 'GET', path: `/places/search?q=${encodeURIComponent(q)}` }, PlaceSearchResponse),
  place: (id: string) => request({ method: 'GET', path: `/places/${encodeURIComponent(id)}` }, PlaceResponse),
  plan: (id: string, b: PlanPlaceRequest) => request({ method: 'POST', path: `/places/${encodeURIComponent(id)}/plan`, body: b }, PlanPlaceResponse),
  popular: (from = 'RUH') => request({ method: 'GET', path: `/places/popular?from=${from}` }, PopularPlacesResponse),
};

export const placesKeys = {
  search: (q: string) => ['places', 'search', q] as const,
  place: (id: string) => ['places', 'place', id] as const,
  popular: (from: string) => ['places', 'popular', from] as const,
};

/** The typed text, settled for a moment, so each keystroke doesn't go to the server. */
export function useDebounced<T>(value: T, ms = 180): T {
  const [v, setV] = useState(value);
  useEffect(() => { const h = setTimeout(() => setV(value), ms); return () => clearTimeout(h); }, [value, ms]);
  return v;
}

export function usePlaceSearch(text: string) {
  const q = useDebounced(text.trim(), 160);
  return useQuery({
    queryKey: placesKeys.search(q), enabled: q.length > 0, queryFn: () => placesApi.search(q), placeholderData: keepPreviousData, staleTime: 5 * 60_000, retry: 1,
  });
}

export function usePlace(id: string | null) {
  return useQuery({ queryKey: placesKeys.place(id ?? ''), enabled: !!id, queryFn: async () => (await placesApi.place(id!)).place, staleTime: 30 * 60_000, retry: 1 });
}

export function usePopular(from = 'RUH') {
  return useQuery({ queryKey: placesKeys.popular(from), queryFn: async () => (await placesApi.popular(from)).places, staleTime: 60 * 60_000 });
}

/* ───────── recent searches, on this phone only ───────── */

const RECENT_KEY = 'mada.places.recent';
type RecentState = { items: PlaceHit[]; loaded: boolean; load: () => Promise<void>; add: (p: PlaceHit) => void; clear: () => void };
export const useRecentPlaces = create<RecentState>((set, get) => ({
  items: [], loaded: false,
  load: async () => {
    if (get().loaded) return;
    try { const raw = await kvGet(RECENT_KEY); set({ items: raw ? (JSON.parse(raw) as PlaceHit[]).slice(0, 6) : [], loaded: true }); } catch { set({ loaded: true }); }
  },
  add: (p) => {
    const items = [{ ...p, matched: null }, ...get().items.filter((x) => x.id !== p.id)].slice(0, 6);
    set({ items });
    void kvSet(RECENT_KEY, JSON.stringify(items));
  },
  clear: () => { set({ items: [] }); void kvSet(RECENT_KEY, null); },
}));

/* ───────── our photos (curated cities) ───────── */

export const PLACE_PHOTOS: Record<string, ImageSourcePropType> = {
  'istanbul-galata': require('../../assets/photos/istanbul-galata.jpg'),
  'dubai-skyline': require('../../assets/photos/dubai-skyline.jpg'),
  'alula-elephant-rock': require('../../assets/photos/alula-elephant-rock.jpg'),
  'london-kensington': require('../../assets/photos/london-kensington.jpg'),
  'tbilisi-old-town': require('../../assets/photos/tbilisi-old-town.jpg'),
  'baku-old-city': require('../../assets/photos/baku-old-city.jpg'),
  'cairo-pyramids': require('../../assets/photos/cairo-pyramids.jpg'),
  'abha-mountains': require('../../assets/photos/abha-mountains.jpg'),
  'jeddah-al-balad': require('../../assets/photos/jeddah-al-balad.jpg'),
  'makkah-clock-tower': require('../../assets/photos/makkah-clock-tower.jpg'),
  'madinah-green-dome': require('../../assets/photos/madinah-green-dome.jpg'),
  'maldives-overwater': require('../../assets/photos/maldives-overwater.jpg'),
  'riyadh-kingdom-centre': require('../../assets/photos/riyadh-kingdom-centre.jpg'),
};
export const placePhoto = (key: string | null | undefined) => (key ? PLACE_PHOTOS[key] ?? null : null);

/* ───────── time there ───────── */

export function localTime(tz: string, at = new Date()): string | null {
  try { return localizeDigits(new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit' }).format(at)); } catch { return null; }
}

function offsetMinutes(tz: string | undefined, at: Date): number {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric' }).formatToParts(at).map((x) => [x.type, x.value]));
    return Math.round((Date.UTC(+p.year!, +p.month! - 1, +p.day!, +p.hour!, +p.minute!) - at.getTime()) / 60_000);
  } catch { return 0; }
}

/** Minutes the city is ahead of this phone (negative: behind). */
export function minutesAhead(tz: string, at = new Date()): number {
  return offsetMinutes(tz, at) - offsetMinutes(undefined, at);
}

/** The local-time ticker for a city page: once a minute is plenty. */
export function useNow(ms = 30_000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const h = setInterval(() => setNow(new Date()), ms); return () => clearInterval(h); }, [ms]);
  return now;
}
