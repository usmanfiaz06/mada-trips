import { RideThingRequest, RideThingResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { rideToThing } from "@/lib/app/activities/ride";
import { placesRoute } from "@/lib/app/places/route";

// POST /things/ride { ref: { kind, id }, placeId, tripId?, day, time, pickup: hotel | other, pickupText?, travellers?, message?, clientId }
// → 201 { request, message }: "Get there with Mada", a car to a place as a desk request (the beta books cars through
// the desk, like airport pickups). Pickup from the hotel needs a trip with one. Idempotent by clientId; owner only.
export const dynamic = "force-dynamic";

export const POST = placesRoute(async (req, { userId, ipHash }) => {
  const b = await body(req, RideThingRequest);
  return json(RideThingResponse.parse(await rideToThing(userId, b, ipHash)), 201);
});
