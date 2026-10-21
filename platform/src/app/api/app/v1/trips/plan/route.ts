import { CreatePlanRequest, LivingPlanResponse } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { createPlan } from "@/lib/app/plans/ops";
import { authenticate } from "@/lib/app/tokens";

// POST /api/app/v1/trips/plan { templateId? | stops[], origin?, returnTo?, start?, days?, travellerIds?, pace?, must?, travelMode? }
// → 201 { plan }: a new trip in "planning" with its living plan (ASK-INTEGRATED §3). Free: nothing priced or held.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreatePlanRequest);
  return json(LivingPlanResponse.parse({ plan: await createPlan(userId, input, { by: "traveller" }) }), 201);
});
