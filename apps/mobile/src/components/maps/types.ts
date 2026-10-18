/** What the stays map draws: hotels as price pins, and the places distances are measured from. */
export type MapPoint = {
  id: string; lat: number; lng: number; label: string; selected?: boolean;
  /** The price in halalas: a group of pins says the lowest. */
  price?: number;
  /** What a screen reader says for the pin ("Bereketzade Hotel, SAR 3,365"); the label when absent. */
  a11y?: string;
};
export type MapMark = { id: string; lat: number; lng: number; name: string };
export type StaysMapProps = {
  points: MapPoint[];
  /** Landmarks mentioned in a wish, and the "distance from" place: drawn as a distinct pin. */
  marks?: MapMark[];
  onPick?: (id: string) => void;
  /** A tap on the map itself, not on a pin (closes the hotel's card). */
  onMapPress?: () => void;
  height: number;
  /** The map takes the height its parent gives it (flex), not `height`. */
  fill?: boolean;
  /** Space covered at the bottom (the hotel's card): the chosen pin is kept above it. */
  coverBottom?: number;
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

/** A pin or a group of pins as drawn at the current zoom. */
export type PinGroup = {
  id: string; members: MapPoint[]; lat: number; lng: number;
  /** Places at the same spot: zooming in can't split them, so they are drawn one above the other instead. */
  stack: boolean;
  /** Pixels to move it up so the chosen place's pin, always on top, doesn't hide it (0 when clear). */
  dy: number;
};

/** How wide a price pill is on screen, near enough (11px semibold digits, 7px padding each side). */
export const pillWidth = (label: string) => label.length * 6.6 + 16;
export const PILL_H = 22;
/** Below this spread (in degrees, about 20 m) places count as one spot. */
const SAME_SPOT = 0.0002;

/**
 * Every price stays reachable and readable: pins whose pills would sit on each other at this zoom become one group
 * (a pill with the count and the lowest price, which zooms in to split on tap); pins with room show their own price.
 * The chosen place is never grouped. `at` projects a point to screen pixels at the current zoom.
 */
export function groupPins(points: MapPoint[], at: (p: { lat: number; lng: number }) => { x: number; y: number }): PinGroup[] {
  const free = points.filter((p) => !p.selected);
  const xy = free.map((p) => at(p));
  const parent = free.map((_, i) => i);
  const root = (i: number): number => { while (parent[i] !== i) { parent[i] = parent[parent[i]!]!; i = parent[i]!; } return i; };
  for (let i = 0; i < free.length; i++) {
    for (let j = i + 1; j < free.length; j++) {
      const a = xy[i]!; const b = xy[j]!;
      const overlap = Math.abs(a.x - b.x) < (pillWidth(free[i]!.label) + pillWidth(free[j]!.label)) / 2 + 2 && Math.abs(a.y - b.y) < PILL_H + 2;
      if (overlap) parent[root(i)] = root(j);
    }
  }
  const byRoot = new Map<number, MapPoint[]>();
  free.forEach((p, i) => { const r = root(i); byRoot.set(r, [...(byRoot.get(r) ?? []), p]); });
  const chosen = points.filter((p) => p.selected).map((p) => ({ ...at(p), w: pillWidth(p.label) + 8 }));
  const out: PinGroup[] = [];
  for (const members of byRoot.values()) {
    const lats = members.map((m) => m.lat); const lngs = members.map((m) => m.lng);
    const stack = members.length > 1 && Math.max(...lats) - Math.min(...lats) < SAME_SPOT && Math.max(...lngs) - Math.min(...lngs) < SAME_SPOT;
    const lat = lats.reduce((a, b) => a + b, 0) / lats.length; const lng = lngs.reduce((a, b) => a + b, 0) / lngs.length;
    // A group's pill says "5 · from SAR 1,903": about ten characters more than its lowest price.
    const w = members.length > 1 && !stack ? pillWidth(lowestOf(members).label) + 66 : pillWidth(members[0]!.label);
    const c = at({ lat, lng });
    const hidden = !stack && chosen.some((k) => Math.abs(k.x - c.x) < (k.w + w) / 2 + 2 && Math.abs(k.y - c.y) < PILL_H + 4);
    out.push({ id: members.length > 1 ? `group-${members.map((m) => m.id).sort()[0]}` : members[0]!.id, members, lat, lng, stack, dy: hidden ? -(PILL_H + 8) : 0 });
  }
  for (const p of points) if (p.selected) out.push({ id: p.id, members: [p], lat: p.lat, lng: p.lng, stack: false, dy: 0 });
  return out;
}

/** The lowest-priced member of a group (by price, else by the order given). */
export const lowestOf = (members: MapPoint[]) => members.reduce((a, b) => ((b.price ?? Infinity) < (a.price ?? Infinity) ? b : a));
