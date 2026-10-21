/*
 * Drives between the stops of a plan ("daily drives"): Google Routes (computeRoutes) live, fixtures and a road
 * estimate in mock. Everything in our words: kilometres and minutes, whether the drive crosses a border (a passport,
 * car papers and insurance for the other country), and where the figure came from.
 */

export type DrivePoint = {
  lat: number;
  lng: number;
  /** ISO 3166 alpha-2, when the caller knows it (a place row does). Decides the border flag with Google's warnings. */
  countryCode?: string | null;
  label?: string | null;
};

export type DriveQuery = {
  from: DrivePoint;
  to: DrivePoint;
  /** The day of the drive (YYYY-MM-DD): part of the cache key. */
  day: string;
  avoidTolls?: boolean;
  avoidFerries?: boolean;
  language?: "en" | "ar";
};

export type DriveLeg = {
  from: DrivePoint;
  to: DrivePoint;
  day: string;
  distanceKm: number;
  /** Without traffic (a plan days ahead can't know the traffic). */
  durationMin: number;
  crossesBorder: boolean;
  /** "SA→BH" when both countries are known. */
  border: string | null;
  /** Google's own warnings, as it wrote them. */
  warnings: string[];
  /** Google's encoded polyline (for a Google map only: see CONNECT.md §24), null in mock. */
  polyline: string | null;
  /** google: Routes API · mock: fixtures · estimate: straight line × road factor (no route found, or off). */
  source: "google" | "mock" | "estimate";
};

export interface RoutesSupplier {
  readonly name: "google" | "mock";
  /** One drive. Null when there is no road (an island, a closed border): the caller says "fly or take the ferry". */
  drive(q: DriveQuery): Promise<DriveLeg | null>;
}
