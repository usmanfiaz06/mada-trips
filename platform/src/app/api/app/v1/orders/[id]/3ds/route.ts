import { OrderResponse, ThreeDsBody } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { submitOtp } from "@/lib/app/booking/orders";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /orders/{id}/3ds { code } → the bank's check. Wrong: tries left. Three wrong: the bank stops it (declined).
export const dynamic = "force-dynamic";

export const POST = bookingRoute<{ id: string }>(async (req, { userId }, p) => {
  const { code } = await body(req, ThreeDsBody);
  return json(OrderResponse.parse({ order: await submitOtp(userId, p.id, code) }));
});
