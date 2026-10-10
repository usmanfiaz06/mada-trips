import { RequestResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getBookingRequest } from "@/lib/app/booking/requests";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /requests/{id} → the request, its status and its quote (per person).
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json(RequestResponse.parse({ request: await getBookingRequest(userId, p.id) })));
