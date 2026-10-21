import { PlanChangeResponse, SetOriginRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { setOrigin } from "@/lib/app/plans/ops";
import { withParams } from "@/lib/app/trips/route";

// PUT /api/app/v1/trips/{id}/plan/origin { origin, returnTo?: place | "same" | null, version? } → { plan, changes,
// untouched }: the legs out and home rebuilt from the new start; booked legs are never touched (listed in untouched).
export const dynamic = "force-dynamic";

export const PUT = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, SetOriginRequest);
  return json(PlanChangeResponse.parse(await setOrigin(userId, id, input, "traveller")));
});
