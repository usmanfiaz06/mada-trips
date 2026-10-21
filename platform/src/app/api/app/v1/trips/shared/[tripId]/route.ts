import { SharedTripResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { withParams } from "@/lib/app/trips/route";
import { sharedTrip } from "@/lib/app/trips/travellers";

// GET /api/app/v1/trips/shared/{tripId} → { trip }: the plan as a companion sees it, his role and his suggestions.
export const dynamic = "force-dynamic";

export const GET = withParams<{ tripId: string }>(async (_req, { tripId }, { userId }) => json(SharedTripResponse.parse({ trip: await sharedTrip(userId, tripId) })));
