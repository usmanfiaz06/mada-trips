import type { ItineraryResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { itinerary } from "@/lib/app/trips/overview";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/itinerary → day by day, calendar events, and the plan as text to share (no passport
// numbers, no prices, no booking code).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  return json((await itinerary(userId, await loadTrip(req, userId, id))) satisfies ItineraryResponse);
});
