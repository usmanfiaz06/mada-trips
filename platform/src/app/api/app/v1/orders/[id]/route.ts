import { OrderResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getOrder } from "@/lib/app/booking/orders";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /orders/{id} → live status for the With Mada screen (holding seats → price locked → issuing → confirmed, or a
// question, a fare that moved, tickets that didn't issue).
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json(OrderResponse.parse({ order: await getOrder(userId, p.id) })));
