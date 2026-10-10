import { CreateTripAskRequest, type TripRequestView } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { shortenStay } from "@/lib/app/trips/changes";
import { createAsk, listRequests } from "@/lib/app/trips/requests";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/requests → { requests }: special requests, hotel options and changes, each with its status.
// POST { area, kind, option?, travellerIds?, count?, day?, note?, clientKey } → 201 { request, trip }. The server decides
// the words and any price. "Leave a night sooner" is made at once (free inside the hotel's window).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await loadTrip(req, userId, id);
  return json({ requests: await listRequests(userId, id) });
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, CreateTripAskRequest);
  const trip = await loadTrip(req, userId, id);
  const ip = requestContext(req).ipHash;
  let request: TripRequestView | null = null;
  let say: string | null = null;
  if (input.area === "hotel" && input.kind === "nights" && input.option === "cut") say = (await shortenStay(userId, trip, input.clientKey, ip)).say;
  else request = await createAsk(userId, trip, input, ip);
  const after = await loadTrip(req, userId, id);
  return json({ request: request ?? (await listRequests(userId, id))[0], say, trip: after }, 201);
});
