import { BookReadyResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { bookReady } from "@/lib/app/plans/booking";

// GET /api/app/v1/trips/{id}/plan/ready → "Book what's ready" (ASK-INTEGRATED §7.2): every priced item and desk quote on
// the trip's plan, each priced again as its own order with its lines, and the items whose price ran out. Never charges:
// the app's sheet sends each ticked item to POST /orders as it always has.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId, demo }, { id }) => json(BookReadyResponse.parse(await bookReady(userId, id, demo))));
