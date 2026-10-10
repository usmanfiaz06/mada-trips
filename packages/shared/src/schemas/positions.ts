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

export const FlightPositionResponse = z.object({
  flightNumber: z.string(),
  callsign: z.string().nullable(),
  /** null when the flight isn't airborne or the feed is down. */
  position: FlightPosition.nullable(),
  attribution: z.string(),
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
