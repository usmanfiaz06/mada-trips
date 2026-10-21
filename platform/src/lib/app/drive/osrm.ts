import "server-only";
import { decodePolyline } from "./borders";
import type { DriveProvider, DriveQuery, ProviderRoute } from "./drive";

/*
 * OSRM (self-hosted, OpenStreetMap data): the fallback when the map provider is down or not set up, and the default
 * when DRIVE_PROVIDER=osrm (owner decision 4). DRIVE_OSRM_URL is the server's base URL (http://osrm.internal:5000).
 *   GET {base}/route/v1/driving/{lng},{lat};{lng},{lat}?overview=simplified&geometries=polyline&steps=true
 * Answers "Ok" with routes[0].distance (m) and duration (s), "NoRoute"/"NoSegment" when there's no road. Steps carry
 * ferries (mode "ferry") and toll roads (intersection class "toll"); without either we say unknown, not none.
 */

type Step = { mode?: string; intersections?: { classes?: string[] }[] };
type ORoute = { distance?: number; duration?: number; geometry?: string; legs?: { steps?: Step[] }[] };

export const osrmUrl = () => process.env.DRIVE_OSRM_URL?.trim().replace(/\/+$/, "") || null;

export function osrmPath(q: Pick<DriveQuery, "from" | "to" | "avoidTolls" | "avoidFerries">): string {
  const exclude = [q.avoidTolls && "toll", q.avoidFerries && "ferry"].filter(Boolean).join(",");
  const pts = `${q.from.lng.toFixed(5)},${q.from.lat.toFixed(5)};${q.to.lng.toFixed(5)},${q.to.lat.toFixed(5)}`;
  return `/route/v1/driving/${pts}?overview=simplified&geometries=polyline&steps=true${exclude ? `&exclude=${exclude}` : ""}`;
}

/** OSRM's answer as a route, null for no road; anything else (a bad answer) throws. */
export function parseOsrm(data: unknown): ProviderRoute | null {
  const d = data as { code?: string; routes?: ORoute[] };
  if (d?.code === "NoRoute" || d?.code === "NoSegment") return null;
  const r = d?.routes?.[0];
  if (d?.code !== "Ok" || !r || typeof r.distance !== "number" || typeof r.duration !== "number") throw new Error(`OSRM answered ${d?.code ?? "nothing"}`);
  const steps = (r.legs ?? []).flatMap((l) => l.steps ?? []);
  const classes = steps.flatMap((s) => (s.intersections ?? []).flatMap((i) => i.classes ?? []));
  let line: [number, number][] | null = null;
  try { line = r.geometry ? decodePolyline(r.geometry) : null; } catch { line = null; }
  return {
    km: Math.round(r.distance / 100) / 10, minutes: Math.max(1, Math.round(r.duration / 60)),
    tolls: classes.includes("toll") ? true : null,
    ferries: steps.some((s) => s.mode === "ferry") || classes.includes("ferry") ? true : null,
    line, routerSaysBorder: false,
  };
}

export const osrmProvider = (): DriveProvider | null => {
  const base = osrmUrl();
  if (!base) return null;
  return {
    name: "osrm",
    async route(q) {
      const res = await fetch(base + osrmPath(q), { signal: AbortSignal.timeout(7000) });
      // OSRM answers 400 with code NoRoute for an unroutable pair: read the body whatever the status.
      if (res.status >= 500) throw new Error(`OSRM answered ${res.status}`);
      return parseOsrm(await res.json());
    },
  };
};
