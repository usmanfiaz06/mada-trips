import type { DriveLeg, DriveQuery } from "./types";

/** Great-circle distance in km. */
export function crowKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = (d: number) => (d * Math.PI) / 180;
  const h = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return 2 * 6371 * Math.asin(Math.sqrt(h));
}

/** Countries differ (both known), or Google said the route crosses a border. */
export function borderOf(q: Pick<DriveQuery, "from" | "to">, warnings: string[]): { crossesBorder: boolean; border: string | null } {
  const a = q.from.countryCode?.toUpperCase() ?? null;
  const b = q.to.countryCode?.toUpperCase() ?? null;
  const byCountry = !!a && !!b && a !== b;
  const byWarning = warnings.some((w) => /border/i.test(w));
  return { crossesBorder: byCountry || byWarning, border: byCountry ? `${a}→${b}` : null };
}

/**
 * Road distance from the straight line: ×1.3 on Gulf highways, 85 km/h on average with a stop, plus 45 minutes at a
 * border post. Honest about being an estimate (source "estimate").
 */
export function estimateDrive(q: DriveQuery): DriveLeg {
  const km = Math.round(crowKm(q.from, q.to) * 1.3);
  const b = borderOf(q, []);
  const min = Math.round((km / 85) * 60) + (km > 300 ? 20 : 0) + (b.crossesBorder ? 45 : 0);
  return { from: q.from, to: q.to, day: q.day, distanceKm: km, durationMin: Math.max(min, 1), ...b, warnings: [], polyline: null, source: "estimate" };
}
