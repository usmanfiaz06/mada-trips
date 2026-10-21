import { requireEnv } from "../live/not-configured";
import { borderOf } from "./estimate";
import type { DriveLeg, DriveQuery, RoutesSupplier } from "./types";

/*
 * Google Routes API, computeRoutes (docs: developers.google.com/maps/documentation/routes/compute_route_directions).
 *   POST https://routes.googleapis.com/directions/v2:computeRoutes
 *   X-Goog-Api-Key: GOOGLE_ROUTES_API_KEY · X-Goog-FieldMask: the fields below (the mask decides the SKU)
 * TRAFFIC_UNAWARE and no toll info keep every call on the Essentials SKU (CONNECT.md §24 has the cost). Durations come
 * back as "12345s", distances in metres. No routes in the answer: there's no road (null).
 */

const URL = "https://routes.googleapis.com/directions/v2:computeRoutes";
export const ROUTES_FIELD_MASK = "routes.distanceMeters,routes.staticDuration,routes.duration,routes.warnings,routes.polyline.encodedPolyline";

type GRoute = { distanceMeters?: number; duration?: string; staticDuration?: string; warnings?: string[]; polyline?: { encodedPolyline?: string } };

export const routesBody = (q: DriveQuery) => ({
  origin: { location: { latLng: { latitude: q.from.lat, longitude: q.from.lng } } },
  destination: { location: { latLng: { latitude: q.to.lat, longitude: q.to.lng } } },
  travelMode: "DRIVE",
  routingPreference: "TRAFFIC_UNAWARE",
  computeAlternativeRoutes: false,
  routeModifiers: { avoidTolls: !!q.avoidTolls, avoidFerries: !!q.avoidFerries },
  languageCode: q.language === "ar" ? "ar" : "en",
  units: "METRIC",
});

const seconds = (s: string | undefined) => (s && /^\d+(\.\d+)?s$/.test(s) ? Number(s.slice(0, -1)) : null);

/** Google's answer as our leg, or null when it found no route. */
export function parseRoutes(data: unknown, q: DriveQuery): DriveLeg | null {
  const r = (data as { routes?: GRoute[] })?.routes?.[0];
  if (!r || typeof r.distanceMeters !== "number") return null;
  const sec = seconds(r.staticDuration) ?? seconds(r.duration);
  if (sec === null) return null;
  const warnings = (r.warnings ?? []).filter((w) => typeof w === "string").slice(0, 10);
  return {
    from: q.from, to: q.to, day: q.day, distanceKm: Math.round(r.distanceMeters / 100) / 10, durationMin: Math.max(1, Math.round(sec / 60)),
    ...borderOf(q, warnings), warnings, polyline: r.polyline?.encodedPolyline ?? null, source: "google",
  };
}

export const googleRoutes: RoutesSupplier = {
  name: "google",
  async drive(q) {
    const { GOOGLE_ROUTES_API_KEY: key } = requireEnv("routes (Google)", ["GOOGLE_ROUTES_API_KEY"]);
    const res = await fetch(URL, {
      method: "POST", signal: AbortSignal.timeout(7000),
      headers: { "Content-Type": "application/json", "X-Goog-Api-Key": key, "X-Goog-FieldMask": ROUTES_FIELD_MASK },
      body: JSON.stringify(routesBody(q)),
    });
    if (res.status >= 500) throw new Error(`routes.googleapis.com answered ${res.status}`);
    // 4xx is an answer (a bad point, a key without the API on): no route, never an outage.
    if (!res.ok) { console.warn("[routes] Google refused", res.status, (await res.text()).slice(0, 200)); return null; }
    return parseRoutes(await res.json(), q);
  },
};
