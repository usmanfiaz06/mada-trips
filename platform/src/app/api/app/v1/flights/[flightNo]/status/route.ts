import { AIRLINE_INFO, FlightNumber, isIsoDay, type FlightStatusResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, json, resilient } from "@/lib/app/http";
import { guestLimit, lookupFlight } from "@/lib/app/trips/status";
import { authenticateOptional } from "@/lib/app/tokens";

// GET /api/app/v1/flights/{flightNo}/status?date=YYYY-MM-DD → { flight | null }: the schedule and live status from the
// flightStatus supplier. Guests can call it too ("Track any flight", no account), 30 lookups an hour per network.
export const dynamic = "force-dynamic";

export async function GET(req: Request, ctx: { params: Promise<{ flightNo: string }> }) {
  return resilient(req, async () => {
    const auth = await authenticateOptional(req);
    if (!auth) {
      const wait = guestLimit(`status:${requestContext(req).ipHash ?? "unknown"}`);
      if (wait) throw new AppError("RATE_LIMITED", { vars: { seconds: wait }, retryAfter: wait });
    }
    const raw = decodeURIComponent((await ctx.params).flightNo).replace(/\s+/g, "").toUpperCase();
    if (!FlightNumber.safeParse(raw).success) throw new AppError("VALIDATION", { fields: { flightNo: "Expected a flight number like SV263" } });
    const date = new URL(req.url).searchParams.get("date") ?? "";
    if (!isIsoDay(date)) throw new AppError("VALIDATION", { fields: { date: "Expected a day as YYYY-MM-DD" } });
    const info = await lookupFlight(raw, date);
    const dur = info?.departLocal && info.arriveLocal ? ((Number(info.arriveLocal.slice(11, 13)) * 60 + Number(info.arriveLocal.slice(14, 16)) - Number(info.departLocal.slice(11, 13)) * 60 - Number(info.departLocal.slice(14, 16))) + 1440) % 1440 : null;
    const flight = info ? {
      flightNumber: info.flightNumber, carrierName: info.carrierName, date, from: info.from, to: info.to, departLocal: info.departLocal, arriveLocal: info.arriveLocal,
      status: info.status, gate: info.gate, terminal: info.terminal, source: info.source, updatedAt: new Date().toISOString(), known: true, durationMin: dur, brand: AIRLINE_INFO[raw.slice(0, 2)]?.brand ?? null,
    } : null;
    return json({ flight } satisfies FlightStatusResponse, 200, { "Cache-Control": "private, max-age=60" });
  });
}
