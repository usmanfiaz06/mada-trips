import { CreateRefundRequest, type RefundResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { createRefund, ensureCharges, listRefunds } from "@/lib/app/trips/money";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/refunds → { refunds }. POST { paymentIds, reason, destination, clientKey } → 201 { refund }.
// The amount comes from the fare and hotel rules, never from the phone. Credit is instant; a card takes 5–10 working days.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  await loadTrip(req, userId, id);
  return json({ refunds: await listRefunds(userId, id) });
});

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const input = await body(req, CreateRefundRequest);
  const trip = await loadTrip(req, userId, id);
  await ensureCharges(trip);
  return json({ refund: await createRefund(userId, trip, input, requestContext(req).ipHash) } satisfies RefundResponse, 201);
});
