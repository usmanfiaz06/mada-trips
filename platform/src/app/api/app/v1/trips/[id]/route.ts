import { PatchTripRequest, moveNeeded, type TripResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { patchTrip } from "@/lib/app/trips/changes";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id} → { trip, move }: the one source of truth for seats, terminal, gate, drivers, pickup times
// and the hotel address. PATCH { noStay?, pickupOffsetMin?, bagReport?, rating?, picks? } → the same, after the change.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  return json({ trip, move: moveNeeded(trip) } satisfies TripResponse);
});

export const PATCH = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, PatchTripRequest);
  await patchTrip(userId, await loadTrip(req, userId, id), input, requestContext(req).ipHash);
  const trip = await loadTrip(req, userId, id);
  return json({ trip, move: moveNeeded(trip) } satisfies TripResponse);
});
