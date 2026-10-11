import { z } from 'zod';
import { IsoDateTime } from './common';

/** Where an aircraft is right now, from open ADS-B data. Position and altitude only: no gates, delays or schedules. */
export const FlightPosition = z.object({
  lat: z.number(),
  lon: z.number(),
  altitudeFt: z.number().nullable(),
  groundSpeedKt: z.number().nullable(),
  track: z.number().nullable(),
  onGround: z.boolean(),
  seenAt: IsoDateTime,
  source: z.enum(['adsb.lol', 'opensky', 'mock']),
});
export type FlightPosition = z.infer<typeof FlightPosition>;

/** Shown wherever a position is shown. adsb.lol data is ODbL: attribution is required. */
export const FLIGHT_POSITION_ATTRIBUTION = 'Aircraft positions: adsb.lol (ODbL 1.0) · The OpenSky Network';

/** Where a plane probably is, from its times alone (great-circle path between the airports). Never shown as live. */
export const EstimatedPosition = z.object({
  lat: z.number(),
  lon: z.number(),
  /** 0 at take-off, 1 at landing. */
  fraction: z.number().min(0).max(1),
  /** What the times came from: the airline's actual take-off, or the schedule. */
  basis: z.enum(['actual', 'revised', 'schedule']),
});
export type EstimatedPosition = z.infer<typeof EstimatedPosition>;

export const FlightPositionResponse = z.object({
  flightNumber: z.string(),
  callsign: z.string().nullable(),
  /** null when the flight isn't airborne or the feed is down. */
  position: FlightPosition.nullable(),
  attribution: z.string(),
  /** ICAO 24-bit address of the aircraft operating the flight, when the status supplier knows it (with ?date=). */
  hex: z.string().nullable().optional(),
  /** How the live position was found: by the aircraft's hex address (most reliable) or by its callsign. */
  match: z.enum(['hex', 'callsign']).nullable().optional(),
  /** No live position but the flight should be in the air: where its times put it. Always labelled "estimated". */
  estimate: EstimatedPosition.nullable().optional(),
});
export type FlightPositionResponse = z.infer<typeof FlightPositionResponse>;

/** IATA airline code → ICAO airline code, for ADS-B callsigns (SV263 flies as SVA263). */
export const ICAO_AIRLINE: Readonly<Record<string, string>> = {
  SV: 'SVA', XY: 'KNE', F3: 'FAD', TK: 'THY', EK: 'UAE', QR: 'QTR', MS: 'MSR', EY: 'ETD', BA: 'BAW', LH: 'DLH',
};

/** "SV 263" → "SVA263"; null when we don't know the airline's ICAO code. */
export function icaoCallsign(flightNumber: string): string | null {
  const m = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s?0*(\d{1,4})$/.exec(flightNumber.trim().toUpperCase());
  if (!m) return null;
  const icao = ICAO_AIRLINE[m[1]!];
  return icao ? `${icao}${m[2]}` : null;
}

/* ───────── linking status to position, and the honest estimate when no receiver sees the plane ───────── */

/** Airports we draw and estimate between: [lat, lon, IANA zone]. */
export const AIRPORT_GEO: Readonly<Record<string, readonly [number, number, string]>> = {
  RUH: [24.957, 46.698, 'Asia/Riyadh'], JED: [21.679, 39.156, 'Asia/Riyadh'], DMM: [26.471, 49.798, 'Asia/Riyadh'], MED: [24.553, 39.705, 'Asia/Riyadh'],
  AHB: [18.24, 42.657, 'Asia/Riyadh'], TIF: [21.483, 40.544, 'Asia/Riyadh'], TUU: [28.365, 36.619, 'Asia/Riyadh'], ELQ: [26.303, 43.774, 'Asia/Riyadh'],
  ULH: [26.483, 38.117, 'Asia/Riyadh'], NUM: [27.567, 35.244, 'Asia/Riyadh'],
  IST: [41.275, 28.752, 'Europe/Istanbul'], SAW: [40.898, 29.309, 'Europe/Istanbul'], AYT: [36.899, 30.8, 'Europe/Istanbul'], TZX: [40.995, 39.79, 'Europe/Istanbul'],
  DXB: [25.253, 55.365, 'Asia/Dubai'], AUH: [24.433, 54.651, 'Asia/Dubai'], DOH: [25.273, 51.608, 'Asia/Qatar'], BAH: [26.271, 50.634, 'Asia/Bahrain'],
  KWI: [29.227, 47.969, 'Asia/Kuwait'], MCT: [23.593, 58.284, 'Asia/Muscat'], AMM: [31.723, 35.993, 'Asia/Amman'], CAI: [30.122, 31.406, 'Africa/Cairo'],
  LHR: [51.47, -0.454, 'Europe/London'], CDG: [49.01, 2.548, 'Europe/Paris'], FRA: [50.033, 8.571, 'Europe/Berlin'], GYD: [40.467, 50.047, 'Asia/Baku'],
  TBS: [41.669, 44.955, 'Asia/Tbilisi'], KUL: [2.746, 101.71, 'Asia/Kuala_Lumpur'], BKK: [13.69, 100.75, 'Asia/Bangkok'], MLE: [4.192, 73.529, 'Indian/Maldives'],
};

const toRad = (d: number) => (d * Math.PI) / 180;
const toDeg = (r: number) => (r * 180) / Math.PI;

/** Great-circle distance in km. */
export function distanceKm(a: readonly [number, number], b: readonly [number, number]): number {
  const x = Math.sin(toRad(b[0] - a[0]) / 2) ** 2 + Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * Math.sin(toRad(b[1] - a[1]) / 2) ** 2;
  return 6371 * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x));
}

/** The point a fraction f of the way along the great circle from a to b (spherical interpolation). */
export function greatCirclePoint(a: readonly [number, number], b: readonly [number, number], f: number): [number, number] {
  const [φ1, λ1, φ2, λ2] = [toRad(a[0]), toRad(a[1]), toRad(b[0]), toRad(b[1])];
  const d = distanceKm(a, b) / 6371;
  if (d < 1e-9) return [a[0], a[1]];
  const A = Math.sin((1 - f) * d) / Math.sin(d);
  const B = Math.sin(f * d) / Math.sin(d);
  const x = A * Math.cos(φ1) * Math.cos(λ1) + B * Math.cos(φ2) * Math.cos(λ2);
  const y = A * Math.cos(φ1) * Math.sin(λ1) + B * Math.cos(φ2) * Math.sin(λ2);
  const z = A * Math.sin(φ1) + B * Math.sin(φ2);
  return [Math.round(toDeg(Math.atan2(z, Math.sqrt(x * x + y * y))) * 1000) / 1000, Math.round(toDeg(Math.atan2(y, x)) * 1000) / 1000];
}

/**
 * Where the plane should be now, from take-off and landing instants. Null before take-off, after landing, or for an
 * airport we don't have on file. Linear in time: real flights climb and descend slower, so it's labelled "estimated".
 */
export function estimatePosition(from: string, to: string, departAt: number, arriveAt: number, now: number, basis: EstimatedPosition['basis']): EstimatedPosition | null {
  const a = AIRPORT_GEO[from];
  const b = AIRPORT_GEO[to];
  if (!a || !b || !(arriveAt > departAt) || now < departAt || now > arriveAt) return null;
  const fraction = Math.round(((now - departAt) / (arriveAt - departAt)) * 1000) / 1000;
  const [lat, lon] = greatCirclePoint([a[0], a[1]], [b[0], b[1]], fraction);
  return { lat, lon, fraction, basis };
}
