import "server-only";
import { routesSupplier } from "../suppliers/routes";
import { decodePolyline } from "./borders";
import type { DriveProvider, ProviderRoute } from "./drive";

/*
 * The map provider for drives: the existing Routes supplier (suppliers/routes: Google computeRoutes behind the
 * "routes" breaker when GOOGLE_ROUTES_API_KEY is set, its fixtures in mock), not a second client. Its 24-hour memory
 * cache is skipped on purpose: drive.ts keeps the numbers in the drive cache table.
 *
 * Google's own warnings tell us tolls and ferries when they're there ("This route has tolls.", "…includes a ferry");
 * their absence is "unknown", not "none" (we don't buy the toll SKU). A mock leg that fell back to its own estimate
 * isn't a map answer: thrown, so drive.ts labels it an estimate like any other miss.
 */

export const routesProvider = (): DriveProvider | null => {
  const s = routesSupplier();
  if (!s) return null;
  return {
    name: s.name === "google" ? "google" : "mock",
    async route(q): Promise<ProviderRoute | null> {
      const leg = await s.drive({
        from: { lat: q.from.lat, lng: q.from.lng, countryCode: q.from.country ?? null },
        to: { lat: q.to.lat, lng: q.to.lng, countryCode: q.to.country ?? null },
        day: q.date ?? "any", avoidTolls: q.avoidTolls, avoidFerries: q.avoidFerries, language: q.language,
      });
      if (!leg) return null;
      if (leg.source === "estimate") throw new Error("no map answer for this pair");
      let line: [number, number][] | null = null;
      try { line = leg.polyline ? decodePolyline(leg.polyline) : null; } catch { line = null; }
      return {
        km: leg.distanceKm, minutes: leg.durationMin,
        tolls: leg.warnings.some((w) => /toll/i.test(w)) ? true : null,
        ferries: leg.warnings.some((w) => /ferr/i.test(w)) ? true : null,
        line, routerSaysBorder: leg.warnings.some((w) => /border/i.test(w)),
      };
    },
  };
};
