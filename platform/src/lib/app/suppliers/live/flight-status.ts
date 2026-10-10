import type { FlightStatus } from "@mada/shared";
import type { FlightStatusInfo, FlightStatusSupplier } from "../types";
import { notConfigured, requireEnv } from "./not-configured";

/** FlightAware AeroAPI v4. Lookups by ident; alerts (push to our webhook) are configured in M3. */
type AeroFlight = {
  ident_iata?: string; operator?: string; status?: string; cancelled?: boolean; diverted?: boolean;
  origin?: { code_iata?: string }; destination?: { code_iata?: string };
  scheduled_out?: string; estimated_out?: string; actual_out?: string; actual_off?: string; actual_on?: string; scheduled_in?: string; estimated_in?: string;
  gate_origin?: string | null; terminal_origin?: string | null; departure_delay?: number;
};

function statusOf(f: AeroFlight): FlightStatus {
  if (f.cancelled) return "cancelled";
  if (f.diverted) return "diverted";
  if (f.actual_on) return "landed";
  if (f.actual_off) return "in_air";
  if (f.actual_out) return "departed";
  if ((f.departure_delay ?? 0) >= 15 * 60) return "delayed";
  return "on_time";
}

export const flightAware: FlightStatusSupplier = {
  name: "flightaware-aeroapi",
  async lookup(flightNumber, date): Promise<FlightStatusInfo | null> {
    const env = requireEnv("flightaware", ["FLIGHTAWARE_API_KEY"]);
    const start = `${date}T00:00:00Z`;
    const end = new Date(Date.parse(start) + 36 * 3_600_000).toISOString();
    const url = `https://aeroapi.flightaware.com/aeroapi/flights/${encodeURIComponent(flightNumber)}?ident_type=designator&start=${start}&end=${end}`;
    const res = await fetch(url, { headers: { "x-apikey": env.FLIGHTAWARE_API_KEY! }, signal: AbortSignal.timeout(8_000) });
    if (res.status === 404) return null;
    if (!res.ok) throw new Error(`FlightAware answered ${res.status}`);
    const data = (await res.json()) as { flights?: AeroFlight[] };
    const f = data.flights?.[0];
    if (!f) return null;
    return {
      flightNumber, carrierName: f.operator ?? null, date, from: f.origin?.code_iata ?? null, to: f.destination?.code_iata ?? null,
      // AeroAPI returns UTC instants; local wall-clock conversion happens with the airport zone when stored.
      departLocal: (f.estimated_out ?? f.scheduled_out)?.slice(0, 16) ?? null, arriveLocal: (f.estimated_in ?? f.scheduled_in)?.slice(0, 16) ?? null,
      status: statusOf(f), gate: f.gate_origin ?? null, terminal: f.terminal_origin ?? null, source: "FlightAware",
    };
  },
  async watch() { return notConfigured("flightaware alerts", ["webhook endpoint (M3)"]); },
};
