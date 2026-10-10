import type { FlightPosition } from "@mada/shared";
import type { FlightPositionsSupplier } from "../types";

/*
 * Live aircraft positions from open ADS-B feeds. Free and keyless, so live by default.
 *   Primary:  adsb.lol  (https://api.adsb.lol/v2/callsign/{callsign}, /v2/hex/{hex}). Data under ODbL 1.0: commercial use
 *             is fine with attribution (FLIGHT_POSITION_ATTRIBUTION goes out with every response).
 *   Fallback: OpenSky Network (https://opensky-network.org/api/states/all). Free for non-commercial use only; commercial
 *             use needs an OpenSky agreement before launch. Anonymous calls are rate-limited.
 * Every call times out after 4 s; results (including "not seen") are cached for 45 s. Errors become null, never throws.
 */

const TIMEOUT_MS = 4_000;
const TTL_MS = 45_000;
/** OpenSky has no callsign filter: search this box (the Middle East, Türkiye, Egypt) for callsign lookups. */
const OPENSKY_BOX = { lamin: 10, lomin: 25, lamax: 45, lomax: 65 };

type Cached = { at: number; value: FlightPosition | null };
const g = globalThis as unknown as { __madaPositions?: Map<string, Cached> };
const cache = (g.__madaPositions ??= new Map());

/** adsb.lol refuses generic user agents: it wants contact details. Set ADSB_CONTACT to a monitored address. */
const userAgent = () => `MadaTrips/0.1 (+https://madatrips.sa; ${process.env.ADSB_CONTACT ?? "contact via https://madatrips.sa/contact"})`;

async function getJson(url: string): Promise<unknown> {
  const res = await fetch(url, { headers: { Accept: "application/json", "User-Agent": userAgent() }, signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status}`);
  return res.json();
}

type AdsbAc = { hex?: string; flight?: string; lat?: number; lon?: number; alt_baro?: number | "ground"; alt_geom?: number; gs?: number; track?: number; seen_pos?: number; seen?: number };

function fromAdsb(data: unknown, now: number): FlightPosition | null {
  const list = (data as { ac?: AdsbAc[] } | null)?.ac ?? [];
  const ac = list.filter((a) => typeof a.lat === "number" && typeof a.lon === "number").sort((a, b) => (a.seen_pos ?? 99) - (b.seen_pos ?? 99))[0];
  if (!ac) return null;
  const onGround = ac.alt_baro === "ground";
  return {
    lat: ac.lat!, lon: ac.lon!,
    altitudeFt: onGround ? 0 : typeof ac.alt_baro === "number" ? ac.alt_baro : ac.alt_geom ?? null,
    groundSpeedKt: ac.gs ?? null, track: ac.track ?? null, onGround,
    seenAt: new Date(now - (ac.seen_pos ?? ac.seen ?? 0) * 1000).toISOString(), source: "adsb.lol",
  };
}

/* OpenSky state vector: [icao24, callsign, country, time_position, last_contact, lon, lat, baro_alt_m, on_ground, velocity_ms, true_track, …, geo_alt_m (13)] */
type State = [string, string | null, string, number | null, number, number | null, number | null, number | null, boolean, number | null, number | null, ...unknown[]];

function fromOpenSky(data: unknown, match: (s: State) => boolean): FlightPosition | null {
  const s = ((data as { states?: State[] | null } | null)?.states ?? []).find((x) => match(x) && x[5] !== null && x[6] !== null);
  if (!s) return null;
  const alt = s[7] ?? (s[13] as number | null) ?? null;
  return {
    lat: s[6]!, lon: s[5]!, altitudeFt: alt === null ? null : Math.round(alt * 3.28084), groundSpeedKt: s[9] === null ? null : Math.round(s[9] * 1.943844 * 10) / 10,
    track: s[10], onGround: s[8], seenAt: new Date((s[3] ?? s[4]) * 1000).toISOString(), source: "opensky",
  };
}

async function lookup(key: string, primary: () => Promise<FlightPosition | null>, fallback: () => Promise<FlightPosition | null>) {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;
  let value: FlightPosition | null = null;
  try {
    value = await primary();
  } catch (e) {
    console.warn(`[positions] adsb.lol failed for ${key}: ${(e as Error).message}`);
    try { value = await fallback(); } catch (e2) { console.warn(`[positions] OpenSky failed for ${key}: ${(e2 as Error).message}`); value = null; }
  }
  // Only airborne aircraft count: an aircraft on the ground reads as "not in the air yet".
  if (value?.onGround) value = null;
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 2000) cache.delete(cache.keys().next().value as string);
  return value;
}

export const openAdsbPositions: FlightPositionsSupplier = {
  name: "adsb.lol+opensky",
  byCallsign(callsign) {
    const cs = callsign.trim().toUpperCase();
    if (!/^[A-Z0-9]{3,8}$/.test(cs)) return Promise.resolve(null);
    return lookup(`cs:${cs}`,
      async () => fromAdsb(await getJson(`https://api.adsb.lol/v2/callsign/${cs}`), Date.now()),
      async () => fromOpenSky(await getJson(`https://opensky-network.org/api/states/all?${new URLSearchParams(Object.entries(OPENSKY_BOX).map(([k, v]) => [k, String(v)]))}`), (s) => (s[1] ?? "").trim() === cs));
  },
  byHex(hex) {
    const h = hex.trim().toLowerCase();
    if (!/^[0-9a-f]{6}$/.test(h)) return Promise.resolve(null);
    return lookup(`hex:${h}`,
      async () => fromAdsb(await getJson(`https://api.adsb.lol/v2/hex/${h}`), Date.now()),
      async () => fromOpenSky(await getJson(`https://opensky-network.org/api/states/all?icao24=${h}`), (s) => s[0] === h));
  },
};

/** Test hooks. */
export const __positionsCache = cache;
export const __parse = { fromAdsb, fromOpenSky };
