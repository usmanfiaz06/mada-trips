import { OrderAnswerBody, OrderResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { answerOrder } from "@/lib/app/booking/orders";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /orders/{id}/answer { answer: yes | call | accept_fare | stop | retry_by_phone | cancel } → the order, moving again.
export const dynamic = "force-dynamic";

export const POST = bookingRoute<{ id: string }>(async (req, { userId }, p) => {
  const { answer } = await body(req, OrderAnswerBody);
  return json(OrderResponse.parse({ order: await answerOrder(userId, p.id, answer) }));
});
