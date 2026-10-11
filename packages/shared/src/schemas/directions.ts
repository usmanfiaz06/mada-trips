import { kmBetween } from './activities-logic';

/*
 * Getting to a place from Things to do: the deep links each maps and ride app understands, and a straight-line guess
 * at the time from the hotel (always shown as "about"; the app the traveller picks has the real route).
 *
 * Links, per platform:
 *  - iOS: Apple Maps (maps://, always there), Google Maps (comgooglemaps://), Waze (waze://), Uber (uber://),
 *    Careem (careem://). Each scheme is probed with Linking.canOpenURL (listed in LSApplicationQueriesSchemes).
 *  - Android: Google Maps through its universal https link (opens the app when installed), Waze, Uber, Careem by
 *    scheme (declared as <queries> so canOpenURL can see them).
 *  - Web (and the prototype): Google Maps on the web.
 * Maps apps fall back to their web pages when not installed; ride apps are only offered when installed.
 */

export type GoApp = 'apple' | 'google' | 'waze' | 'uber' | 'careem';
export type GoPlatform = 'ios' | 'android' | 'web';
export type GoMode = 'walk' | 'drive';

/** Where to: a point when we have one, else the address or name as a search. */
export type GoTarget = { name: string; lat: number | null; lon: number | null; address?: string | null };

export type GoLink = {
  app: GoApp;
  /** What to open first. */
  url: string;
  /** canOpenURL this before offering `url`; null when it always opens (a web link, Apple Maps on iOS). */
  probe: string | null;
  /** Where to go when the app isn't installed; null for ride apps (offered only when installed). */
  web: string | null;
};

const enc = encodeURIComponent;
const hasPoint = (t: GoTarget): t is GoTarget & { lat: number; lon: number } => typeof t.lat === 'number' && typeof t.lon === 'number' && Number.isFinite(t.lat) && Number.isFinite(t.lon);
const fix = (n: number) => String(Math.round(n * 1e6) / 1e6);
const query = (t: GoTarget) => [t.address, t.name].filter(Boolean).join(', ') || t.name;

/** Google Maps directions on the web (also what Android hands to the Google Maps app). */
export function googleMapsUrl(t: GoTarget, mode: GoMode = 'drive'): string {
  const dest = hasPoint(t) ? `${fix(t.lat)},${fix(t.lon)}` : enc(query(t));
  return `https://www.google.com/maps/dir/?api=1&destination=${dest}&travelmode=${mode === 'walk' ? 'walking' : 'driving'}`;
}

export function directionsLinks(t: GoTarget, platform: GoPlatform, mode: GoMode = 'drive'): GoLink[] {
  const google: GoLink = { app: 'google', url: googleMapsUrl(t, mode), probe: null, web: null };
  if (platform === 'web') return [google];
  const pt = hasPoint(t) ? `${fix(t.lat)},${fix(t.lon)}` : null;
  const q = enc(query(t));
  const wazeQ = pt ? `ll=${pt}&navigate=yes` : `q=${q}&navigate=yes`;
  const waze: GoLink = { app: 'waze', url: `waze://?${wazeQ}`, probe: 'waze://', web: `https://waze.com/ul?${wazeQ}` };
  const drop = pt
    ? `dropoff[latitude]=${fix(t.lat!)}&dropoff[longitude]=${fix(t.lon!)}&dropoff[nickname]=${enc(t.name)}`
    : `dropoff[formatted_address]=${q}&dropoff[nickname]=${enc(t.name)}`;
  const uber: GoLink = { app: 'uber', url: `uber://?action=setPickup&pickup=my_location&${drop}`, probe: 'uber://', web: null };
  const careemDrop = pt ? `dropoff_latitude=${fix(t.lat!)}&dropoff_longitude=${fix(t.lon!)}&dropoff_name=${enc(t.name)}` : `dropoff_name=${q}`;
  const careem: GoLink = { app: 'careem', url: `careem://ride?${careemDrop}`, probe: 'careem://', web: null };
  if (platform === 'ios') {
    const dir = mode === 'walk' ? 'w' : 'd';
    const daddr = pt ?? q;
    const apple: GoLink = { app: 'apple', url: `maps://?daddr=${daddr}&q=${enc(t.name)}&dirflg=${dir}`, probe: null, web: `https://maps.apple.com/?daddr=${daddr}&q=${enc(t.name)}&dirflg=${dir}` };
    const gTravel = mode === 'walk' ? 'walking' : 'driving';
    const gApp: GoLink = { app: 'google', url: `comgooglemaps://?daddr=${daddr}&directionsmode=${gTravel}`, probe: 'comgooglemaps://', web: google.url };
    return [apple, gApp, waze, uber, careem];
  }
  return [google, waze, uber, careem];
}

/** Which links to offer: always-open ones, installed apps, and maps apps that have a web page to fall back on. */
export function offeredLinks(links: GoLink[], installed: (probe: string) => boolean): (GoLink & { installed: boolean })[] {
  return links
    .map((l) => ({ ...l, installed: l.probe === null || installed(l.probe) }))
    .filter((l) => l.installed || l.web !== null);
}

/** What to open for a link: the app when it's there, else its web page. */
export const openUrlOf = (l: GoLink & { installed: boolean }) => (l.installed ? l.url : (l.web ?? l.url));

export type TravelEstimate = { km: number; walkMin: number; driveMin: number; mode: GoMode; min: number };

/**
 * A straight-line guess from A to B: streets wind (walking ×1.25, driving ×1.35), people walk 4.8 km/h, and city
 * traffic runs 18 km/h for short hops, 28 across town, 45 out of town, plus a few minutes to get going.
 * Walking wins up to 15 minutes.
 */
export function travelEstimate(from: { lat: number; lon: number }, to: { lat: number; lon: number }): TravelEstimate {
  const km = kmBetween(from.lat, from.lon, to.lat, to.lon);
  const walkMin = Math.max(1, Math.round(((km * 1.25) / 4.8) * 60));
  const road = km * 1.35;
  const speed = road < 4 ? 18 : road < 20 ? 28 : 45;
  const driveMin = Math.max(3, Math.round((road / speed) * 60 + 3));
  const mode: GoMode = walkMin <= 15 ? 'walk' : 'drive';
  return { km: Math.round(km * 10) / 10, walkMin, driveMin, mode, min: mode === 'walk' ? walkMin : driveMin };
}
