import { MoveRequest, moveNeeded } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { moveToFlightDay } from "@/lib/app/trips/changes";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/move { hotel, pickup } → { say, back, quoted, trip, move }: after a date change, the hotel
// and the home pickup follow the flight. Fewer nights inside the free window come back; extra nights are a quote.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, MoveRequest);
  const r = await moveToFlightDay(userId, await loadTrip(req, userId, id), input, requestContext(req).ipHash);
  const trip = await loadTrip(req, userId, id);
  return json({ ...r, trip, move: moveNeeded(trip) });
});
