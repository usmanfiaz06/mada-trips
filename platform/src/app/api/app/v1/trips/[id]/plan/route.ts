import { z } from "zod";
import { LivingPlanResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { createPlan } from "@/lib/app/plans/ops";
import { ownTrip, readPlan } from "@/lib/app/plans/plans";
import { withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/plan → { plan }: items with statuses read from the trip's bookings, checks, the title
// from the origin. 404 when the trip has no plan. POST (same body as POST /trips/plan; stops default to the trip's
// city and dates) → 201 { plan } for a trip that has none yet, its bookings linked to the new items.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (_req, { id }, { userId }) => json(LivingPlanResponse.parse({ plan: await readPlan(userId, id) })));

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const raw = (await body(req, z.record(z.string(), z.unknown()))) as Record<string, unknown>;
  const trip = await ownTrip(userId, id);
  if (!raw.templateId && !raw.stops) {
    const nights = trip.endDate ? Math.max(0, Math.round((Date.parse(trip.endDate) - Date.parse(trip.startDate)) / 86_400_000)) : 0;
    raw.stops = [{ place: { name: trip.city }, nights }];
    raw.start ??= trip.startDate;
  }
  const plan = await createPlan(userId, raw as never, { by: "traveller", tripId: trip.id });
  return json(LivingPlanResponse.parse({ plan }), 201);
});
