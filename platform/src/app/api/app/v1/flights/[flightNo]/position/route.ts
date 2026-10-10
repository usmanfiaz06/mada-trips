import { FLIGHT_POSITION_ATTRIBUTION, FlightNumber, icaoCallsign, type FlightPositionResponse } from "@mada/shared";
import { AppError, errorResponse, json } from "@/lib/app/http";
import { suppliers } from "@/lib/app/suppliers";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/flights/{flightNo}/position → { flightNumber, callsign, position | null, attribution }.
// Open ADS-B data (adsb.lol, OpenSky fallback): position and altitude only. Gates and delays come from flightStatus.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ flightNo: string }> }) {
  try {
    await authenticate(req);
    const raw = decodeURIComponent((await ctx.params).flightNo).replace(/\s+/g, "").toUpperCase();
    if (!FlightNumber.safeParse(raw).success) throw new AppError("VALIDATION", { fields: { flightNo: "Expected a flight number like SV263" } });
    const callsign = icaoCallsign(raw);
    const position = callsign ? await suppliers.flightPositions().byCallsign(callsign).catch(() => null) : null;
    return json({ flightNumber: raw, callsign, position, attribution: FLIGHT_POSITION_ATTRIBUTION } satisfies FlightPositionResponse, 200, { "Cache-Control": "private, max-age=30" });
  } catch (e) {
    return errorResponse(e);
  }
}
