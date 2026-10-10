import { CreateOrderBody, CreateOrderResponse, OrdersResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { activeOrders, createOrder } from "@/lib/app/booking/orders";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /orders { draft, promo?, useCredit, payment, plan, expectedTotal, idempotencyKey } → an outcome: created (with the
// desk), requires_action (3-D Secure), paid (charged now), declined, price_changed, hold_ended or blocked.
// GET /orders → orders still with the desk (and ones confirmed in the last 10 minutes), for the background banner.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, demo, ipHash }) => {
  const b = await body(req, CreateOrderBody);
  const out = CreateOrderResponse.parse(await createOrder(userId, b, demo, ipHash));
  return json(out, out.outcome === "created" || out.outcome === "paid" || out.outcome === "requires_action" ? 201 : 200);
});

export const GET = bookingRoute(async (_req, { userId }) => json(OrdersResponse.parse({ orders: await activeOrders(userId) })));
