import type { TripsResponse } from "@mada/shared";
import { json, route } from "@/lib/app/http";
import { demoPhase } from "@/lib/app/trips/core";
import { overview } from "@/lib/app/trips/overview";
import { authenticate } from "@/lib/app/tokens";

// GET /api/app/v1/trips → the trip clock, the trip Today is about (currentId), upcoming and past trips, requests,
// refunds, tracked flights, unread count, credit. In mock mode `x-mada-demo-phase` sets the moment to show.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json((await overview(userId, demoPhase(req))) satisfies TripsResponse);
});
