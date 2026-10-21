import { SharedTripsResponse } from "@mada/shared";
import { AppError, json } from "@/lib/app/http";
import { requestContext } from "@/lib/app/context";
import { accept } from "@/lib/app/circles/invites";
import { withParams } from "@/lib/app/trips/route";
import { declineTripInvite, sharedTrips } from "@/lib/app/trips/travellers";

// POST /api/app/v1/trips/shared/invites/{inviteId}/accept | decline → { trips }: his answer to a trip invite in his
// app. Accepting joins the trip (and makes them friends, as any Mada invite does); the owner hears it.
export const dynamic = "force-dynamic";

export const POST = withParams<{ inviteId: string; answer: string }>(async (req, { inviteId, answer }, { userId }) => {
  if (answer === "accept") await accept(inviteId, userId, true, requestContext(req).ipHash);
  else if (answer === "decline") await declineTripInvite(inviteId, userId);
  else throw new AppError("NOT_FOUND");
  return json(SharedTripsResponse.parse({ trips: await sharedTrips(userId) }));
});
