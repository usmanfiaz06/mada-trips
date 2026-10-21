import type { DriveCrossing, DrivePoint } from "./drive";

/*
 * Border crossings on a drive (ASK-INTEGRATED §4.4). Routers don't say where a road leaves a country, so we read it
 * from the line: the known road crossings the route passes (within a few km), in order. Without a line, the countries
 * at both ends: different → one crossing, named only when that pair has a single road crossing (Saudi ↔ Bahrain is
 * always King Fahd Causeway; Singapore ↔ Malaysia has two, so it stays "Crosses into Malaysia").
 */

type Crossing = { a: string; b: string; name: string; lat: number; lng: number };

export const CROSSINGS: Crossing[] = [
  { a: "SG", b: "MY", name: "Woodlands Causeway", lat: 1.4517, lng: 103.7686 },
  { a: "SG", b: "MY", name: "Tuas Second Link", lat: 1.3489, lng: 103.6366 },
  { a: "SA", b: "BH", name: "King Fahd Causeway", lat: 26.1856, lng: 50.3358 },
  { a: "SA", b: "QA", name: "Salwa – Abu Samra", lat: 24.7428, lng: 50.8125 },
  { a: "SA", b: "AE", name: "Al Batha – Ghuwaifat", lat: 24.1003, lng: 51.6011 },
  { a: "SA", b: "KW", name: "Al Khafji – Nuwaiseeb", lat: 28.5394, lng: 48.4319 },
  { a: "SA", b: "KW", name: "Al Raqai – Salmi", lat: 29.0533, lng: 46.5511 },
  { a: "SA", b: "JO", name: "Al Haditha – Al Omari", lat: 31.4667, lng: 37.1394 },
  { a: "SA", b: "JO", name: "Durra", lat: 29.3653, lng: 34.9622 },
  { a: "SA", b: "OM", name: "Rub' al Khali crossing", lat: 22.0606, lng: 55.1617 },
  { a: "AE", b: "OM", name: "Hatta – Al Wajajah", lat: 24.7681, lng: 56.1608 },
  { a: "AE", b: "OM", name: "Khatmat Malaha", lat: 24.9878, lng: 56.3592 },
  { a: "AE", b: "OM", name: "Hili – Buraimi", lat: 24.2633, lng: 55.7756 },
  { a: "MY", b: "TH", name: "Bukit Kayu Hitam – Sadao", lat: 6.5122, lng: 100.4192 },
];

/** Rough country boxes for ends whose country we weren't told, smallest first (the first box that holds the point). */
const BOXES: [string, number, number, number, number][] = [
  // country, south, north, west, east
  ["SG", 1.15, 1.47, 103.6, 104.1],
  ["BH", 25.78, 26.35, 50.37, 50.85],
  ["QA", 24.45, 26.2, 50.73, 51.7],
  ["KW", 28.52, 30.1, 46.55, 48.45],
  ["AE", 22.6, 26.1, 51.5, 56.38],
  ["OM", 16.6, 26.4, 52.0, 59.9],
  ["JO", 29.18, 33.38, 34.95, 39.3],
  ["TH", 6.6, 20.5, 97.3, 105.7],
  ["MY", 1.25, 6.75, 99.6, 104.5],
  ["SA", 16.0, 32.2, 34.5, 55.7],
  ["TR", 35.8, 42.2, 25.6, 44.9],
];

export function countryAt(p: { lat: number; lng: number }): string | null {
  return BOXES.find(([, s, n, w, e]) => p.lat >= s && p.lat <= n && p.lng >= w && p.lng <= e)?.[0] ?? null;
}

export const countryOf = (p: DrivePoint) => p.country?.toUpperCase() ?? countryAt(p);

/** Google's and OSRM's encoded polyline (precision 5) as [lat, lng] pairs. */
export function decodePolyline(s: string, precision = 5): [number, number][] {
  const out: [number, number][] = [];
  const f = 10 ** precision;
  let i = 0, lat = 0, lng = 0;
  const next = () => {
    let shift = 0, result = 0, b: number;
    do {
      if (i >= s.length) throw new Error("bad polyline");
      b = s.charCodeAt(i++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    return result & 1 ? ~(result >> 1) : result >> 1;
  };
  while (i < s.length) {
    lat += next();
    lng += next();
    out.push([lat / f, lng / f]);
  }
  return out;
}

/** Km from a point to a segment, flat-earth (fine at a few km). */
function kmToSegment(p: { lat: number; lng: number }, a: [number, number], b: [number, number]): number {
  const kx = 111.32 * Math.cos((p.lat * Math.PI) / 180), ky = 110.57;
  const ax = (a[1] - p.lng) * kx, ay = (a[0] - p.lat) * ky, bx = (b[1] - p.lng) * kx, by = (b[0] - p.lat) * ky;
  const dx = bx - ax, dy = by - ay;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / len)) : 0;
  return Math.hypot(ax + t * dx, ay + t * dy);
}

const NEAR_KM = 4;

/** Crossings along a line, in the order the route reaches them; from/to oriented by where the route is coming from. */
export function crossingsOnLine(line: [number, number][], start: string | null): DriveCrossing[] {
  if (line.length < 2) return [];
  const hits: { at: number; c: Crossing }[] = [];
  for (const c of CROSSINGS) {
    for (let k = 1; k < line.length; k++) {
      if (kmToSegment(c, line[k - 1]!, line[k]!) <= NEAR_KM) { hits.push({ at: k, c }); break; }
    }
  }
  hits.sort((x, y) => x.at - y.at);
  let here = start;
  return hits.map(({ c }) => {
    const from = here === c.b ? c.b : c.a;
    const to = from === c.a ? c.b : c.a;
    here = to;
    return { from, to, name: c.name };
  });
}

/**
 * The crossings of a drive: from the line when we have one and it shows any, else from the countries at the ends.
 * `routerSaysBorder` (Google's "crosses country borders" warning) adds an unnamed crossing when the ends look the same.
 */
export function bordersOf(from: DrivePoint, to: DrivePoint, line: [number, number][] | null, routerSaysBorder = false): DriveCrossing[] {
  const a = countryOf(from), b = countryOf(to);
  const onLine = line ? crossingsOnLine(line, a) : [];
  if (onLine.length) return onLine;
  if (a && b && a !== b) {
    const pair = CROSSINGS.filter((c) => (c.a === a && c.b === b) || (c.a === b && c.b === a));
    return [{ from: a, to: b, name: pair.length === 1 ? pair[0]!.name : null }];
  }
  return routerSaysBorder ? [{ from: a, to: null, name: null }] : [];
}
