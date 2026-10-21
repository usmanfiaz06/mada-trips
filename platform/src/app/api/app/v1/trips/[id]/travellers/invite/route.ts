import { TripInviteRequest, TripInviteResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { withParams } from "@/lib/app/trips/route";
import { inviteTraveller } from "@/lib/app/trips/travellers";

// POST /api/app/v1/trips/{id}/travellers/invite { name, phone, channel, role? } → { result, traveller }: the invite
// card's tap (§9.6), the only way an invite with the trip's name and dates goes to someone outside the household.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const b = await body(req, TripInviteRequest);
  return json(TripInviteResponse.parse(await inviteTraveller(userId, id, b, requestContext(req).ipHash)), 201);
});
