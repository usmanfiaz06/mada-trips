import type { FlightPosition } from "@mada/shared";
import type { FlightPositionsSupplier } from "../types";

/* Mock positions: SVA263 is over the Gulf of Aqaba at cruise, on its way to Istanbul. Anything else isn't airborne. */
export const mockFlightPositions: FlightPositionsSupplier = {
  name: "mock-positions",
  async byCallsign(callsign) {
    if (callsign !== "SVA263") return null;
    const p: FlightPosition = { lat: 29.12, lon: 35.02, altitudeFt: 37000, groundSpeedKt: 468, track: 322, onGround: false, seenAt: new Date().toISOString(), source: "mock" };
    return p;
  },
  async byHex() { return null; },
};
