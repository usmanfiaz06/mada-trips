import { PlansResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { listPlans, travellersParam } from "@/lib/app/booking/plans";
import { openRoute } from "@/lib/app/guest";

// GET /plans → the curated plans, priced for this household.
export const dynamic = "force-dynamic";

// Open to guests: priced for ?travellers= (default two).
export const GET = openRoute("read", async (req, { userId }) => json(PlansResponse.parse({ plans: await listPlans(userId, travellersParam(req)) })));
