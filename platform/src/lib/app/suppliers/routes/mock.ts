import fixtures from "./fixtures.json";
import { borderOf, crowKm, estimateDrive } from "./estimate";
import type { DriveLeg, RoutesSupplier } from "./types";

/*
 * Mock routes: the fixture legs (either direction) when both ends are within 15 km of a fixture place, else the road
 * estimate. A point at 0,0 has no road (null), for the "no drive" path.
 */

type Place = { lat: number; lng: number; countryCode: string };
const PLACES = fixtures.places as Record<string, Place>;
const near = (p: { lat: number; lng: number }) => Object.entries(PLACES).find(([, v]) => crowKm(p, v) < 15)?.[0] ?? null;

export const mockRoutes: RoutesSupplier = {
  name: "mock",
  async drive(q) {
    if ((q.from.lat === 0 && q.from.lng === 0) || (q.to.lat === 0 && q.to.lng === 0)) return null;
    const a = near(q.from);
    const b = near(q.to);
    const leg = a && b ? fixtures.legs.find((l) => (l.from === a && l.to === b) || (l.from === b && l.to === a)) : undefined;
    if (!leg) return estimateDrive(q);
    const from = { ...q.from, countryCode: q.from.countryCode ?? PLACES[a!]!.countryCode };
    const to = { ...q.to, countryCode: q.to.countryCode ?? PLACES[b!]!.countryCode };
    const out: DriveLeg = {
      from, to, day: q.day, distanceKm: leg.distanceKm, durationMin: leg.durationMin, ...borderOf({ from, to }, leg.warnings),
      warnings: leg.warnings, polyline: null, source: "mock",
    };
    return out;
  },
};
