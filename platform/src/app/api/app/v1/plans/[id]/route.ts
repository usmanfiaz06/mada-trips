import { PlanResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getPlan, travellersParam } from "@/lib/app/booking/plans";
import { openRoute } from "@/lib/app/guest";

// GET /plans/{id} → the day-by-day plan. Booked as a package through POST /orders { draft: { kind: "package", planId } }.
export const dynamic = "force-dynamic";

// Open to guests (a shared plan link opens for anyone): priced for ?travellers= (default two).
export const GET = openRoute<{ id: string }>("read", async (req, { userId }, p) => json(PlanResponse.parse({ plan: await getPlan(userId, p.id, travellersParam(req)) })));
