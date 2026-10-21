import { AddTravellerRequest, TripSharingRequest, TripTravellersResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { addTraveller, listTravellers, setSharePrices } from "@/lib/app/trips/travellers";

// GET /api/app/v1/trips/{id}/travellers → who goes and each one's role (the owner's Travellers screen, ASK-INTEGRATED
// §5.5). POST { personId | userId, role? } (a pick from "Which Abdullah?") or { name } ("Just add the name") → 201 the
// list; a circle member picked is told in his app. PATCH { sharePrices } → the list.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(TripTravellersResponse.parse(await listTravellers(userId, id))));

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await addTraveller(userId, id, await body(req, AddTravellerRequest), "traveller");
  return json(TripTravellersResponse.parse(await listTravellers(userId, id)), 201);
});

export const PATCH = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await setSharePrices(userId, id, (await body(req, TripSharingRequest)).sharePrices);
  return json(TripTravellersResponse.parse(await listTravellers(userId, id)));
});
