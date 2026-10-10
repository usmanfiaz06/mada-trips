import { PlaceId, PlanPlaceRequest, PlanPlaceResponse } from "@mada/shared";
import { AppError, body, json } from "@/lib/app/http";
import { planPlace } from "@/lib/app/places/plan";
import { placesRoute } from "@/lib/app/places/route";

// POST /places/:id/plan { depart?, return?, month?, travellers?, travellerIds?, message?, from?, clientId? }
// → 201 { request, message }: a "destination" request for the desk, with the traveller's words as the first message.
export const dynamic = "force-dynamic";

export const POST = placesRoute<{ id: string }>(async (req, { userId, ipHash }, { id }) => {
  const p = PlaceId.safeParse(decodeURIComponent(id ?? ""));
  if (!p.success) throw new AppError("NOT_FOUND");
  const b = await body(req, PlanPlaceRequest);
  return json(PlanPlaceResponse.parse(await planPlace(userId, p.data, b, ipHash)), 201);
});
