import { TodayPlanResponse } from "@mada/shared";
import { json, resilient } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { todayFromPlan } from "@/lib/app/plans/today";

// GET /api/app/v1/trips/plan-today → { trip, cards }: the trip that's near (owned or going) and what its plan says for
// today and tomorrow (pickup, check-in, a measured drive) and what's left before it (ASK-INTEGRATED §1.3, U9). Today
// puts these above the ideas. A companion reads them without prices (plans/access.ts).
export const dynamic = "force-dynamic";

export const GET = (req: Request) => resilient(req, async () => {
  const { userId } = await authenticate(req);
  return json(TodayPlanResponse.parse(await todayFromPlan(userId)));
});
