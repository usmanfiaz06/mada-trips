import { json, route, AppError } from "@/lib/app/http";
import { demoAllowed } from "@/lib/app/trips/core";
import { seedDemoTrip } from "@/lib/app/trips/seed";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/trips/demo → 201 { tripId }: the prototype's Istanbul trip for the signed-in account.
// Mock mode only (never on a production deployment): screenshots, app review and end-to-end tests.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  if (!demoAllowed()) throw new AppError("NOT_FOUND");
  return json({ tripId: await seedDemoTrip(userId) }, 201);
});
