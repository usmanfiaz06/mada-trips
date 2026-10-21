import { SharedTripsResponse } from "@mada/shared";
import { json, resilient } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { sharedTrips } from "@/lib/app/trips/travellers";

// GET /api/app/v1/trips/shared → { trips }: trips others put him on (going, or an invite in his app waiting for his
// yes), for his Trips tab. No prices, ever (ASK-INTEGRATED §5.3).
export const dynamic = "force-dynamic";

export const GET = (req: Request) => resilient(req, async () => {
  const { userId } = await authenticate(req);
  return json(SharedTripsResponse.parse({ trips: await sharedTrips(userId) }));
});
