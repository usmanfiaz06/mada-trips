import { CreateRequestBody, RequestResponse, RequestsResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { createRequest, listBookingRequests } from "@/lib/app/booking/requests";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /requests → this traveller's requests from Ask, newest first, with quotes.
// POST /requests { kind, query, answers, travellerIds, needs, note, search?, service?, clientId? } → 201 { request }.
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async (_req, { userId }) => json(RequestsResponse.parse({ requests: await listBookingRequests(userId) })));

export const POST = bookingRoute(async (req, { userId, ipHash }) => {
  const b = await body(req, CreateRequestBody);
  return json(RequestResponse.parse({ request: await createRequest(userId, b, ipHash) }), 201);
});
