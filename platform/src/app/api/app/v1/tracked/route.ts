import { TrackFlightRequest, type TrackedResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { listTracked, trackFlight } from "@/lib/app/trips/status";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/tracked → { flights }. POST { flightNumber, date, alerts } → 201 { flight }: "Just track a flight".
// The schedule comes from the flightStatus supplier; with alerts on, FlightAware pushes gate and time changes to us.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ flights: await listTracked(userId) } satisfies TrackedResponse);
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, TrackFlightRequest);
  return json({ flight: await trackFlight(userId, input, requestContext(req).ipHash) }, 201);
});
