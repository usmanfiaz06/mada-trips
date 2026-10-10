import type { FlightStatusSupplier, FlightStatusInfo } from "../types";
import { AIRLINES } from "./data";

/* Mock flight status: SV263 RUH→IST departs 09:40 from Terminal 3, gate B12 (the prototype changes it to C4 on travel day).
   Other numbers get a plausible schedule from the number alone, the way the prototype's lookupFlight does. */

const FLIGHT_NO = /^([A-Z][A-Z0-9]|[0-9][A-Z])\s?(\d{1,4})$/;

export const mockFlightStatus: FlightStatusSupplier = {
  name: "mock-flightstatus",
  async lookup(raw, date): Promise<FlightStatusInfo | null> {
    const m = FLIGHT_NO.exec(raw.trim().toUpperCase());
    if (!m) return null;
    const [, iata, numS] = m as unknown as [string, string, string];
    const num = Number(numS);
    const code = `${iata}${num}`;
    if (code === "SV263") {
      return { flightNumber: code, carrierName: "Saudia", date, from: "RUH", to: "IST", departLocal: `${date}T09:40`, arriveLocal: `${date}T13:55`, status: "on_time", gate: "B12", terminal: "Terminal 3", source: "Live · airline (mock)" };
    }
    const al = AIRLINES[iata];
    if (!al) return null;
    const [from, to, dur] = al.routes[num % al.routes.length]!;
    const depMin = (5 + ((num * 7) % 17)) * 60 + ((num * 13) % 12) * 5;
    const fmt = (min: number) => `${String(Math.floor(min / 60) % 24).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
    return { flightNumber: code, carrierName: al.name, date, from, to, departLocal: `${date}T${fmt(depMin)}`, arriveLocal: `${date}T${fmt(depMin + dur)}`, status: "scheduled", gate: null, terminal: null, source: "Schedule (mock)" };
  },
  async watch(flightNumber, date) {
    return { alertId: `mock_alert_${flightNumber}_${date}` };
  },
};
