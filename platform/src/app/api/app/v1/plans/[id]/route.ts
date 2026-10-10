import { PlanResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getPlan } from "@/lib/app/booking/plans";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /plans/{id} → the day-by-day plan. Booked as a package through POST /orders { draft: { kind: "package", planId } }.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json(PlanResponse.parse({ plan: await getPlan(userId, p.id) })));
