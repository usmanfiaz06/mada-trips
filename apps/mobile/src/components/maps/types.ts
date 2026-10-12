/** What the stays map draws: hotels as price pins, and the places distances are measured from. */
export type MapPoint = { id: string; lat: number; lng: number; label: string; selected?: boolean };
export type MapMark = { id: string; lat: number; lng: number; name: string };
export type StaysMapProps = {
  points: MapPoint[];
  /** Landmarks mentioned in a wish, and the "distance from" place: drawn as a distinct pin. */
  marks?: MapMark[];
  onPick?: (id: string) => void;
  height: number;
  /** One hotel (its details): no pins to tap, a fixed view. */
  single?: boolean;
  testID?: string;
};

/** The box the points fit in, with a margin, for the drawn fallback and the first view. */
export function boundsOf(all: { lat: number; lng: number }[]) {
  const lats = all.map((p) => p.lat);
  const lngs = all.map((p) => p.lng);
  const pad = (a: number, b: number) => Math.max(0.004, (b - a) * 0.12);
  const [s, n, w, e] = [Math.min(...lats), Math.max(...lats), Math.min(...lngs), Math.max(...lngs)];
  return { south: s - pad(s, n), north: n + pad(s, n), west: w - pad(w, e), east: e + pad(w, e) };
}
