import { PlanChangeResponse, PlanOpsRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { applyOps } from "@/lib/app/plans/ops";
import { withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/plan/ops { version, ops: [add | update | move | remove | skip | unskip] (≤ 10) }
// → { plan, changes }. All or none. A stale version → 409 PLAN_CHANGED { details.version }; a booked item can't be
// moved, removed or skipped (400 VALIDATION, details.booked): that's the change flow.
export const dynamic = "force-dynamic";

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, PlanOpsRequest);
  return json(PlanChangeResponse.parse(await applyOps(userId, id, input, "traveller")));
});
