import { TripTravellersResponse, UpdateTravellerRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { listTravellers, removeTraveller, setRole } from "@/lib/app/trips/travellers";

// PATCH /api/app/v1/trips/{id}/travellers/{travellerId} { role: view | suggest | edit } → the list (owner only).
// DELETE → the list; someone on a booking stays until the booking is changed (422, details.booked).
export const dynamic = "force-dynamic";

type P = { id: string; travellerId: string };

export const PATCH = withParams<P>(async (req, { id, travellerId }, { userId }) => {
  await setRole(userId, id, travellerId, (await body(req, UpdateTravellerRequest)).role);
  return json(TripTravellersResponse.parse(await listTravellers(userId, id)));
});

export const DELETE = withParams<P>(async (_req, { id, travellerId }, { userId }) => {
  await removeTraveller(userId, id, travellerId);
  return json(TripTravellersResponse.parse(await listTravellers(userId, id)));
});
