import { PlansResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { listPlans } from "@/lib/app/booking/plans";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /plans → the curated plans, priced for this household.
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async (_req, { userId }) => json(PlansResponse.parse({ plans: await listPlans(userId) })));
