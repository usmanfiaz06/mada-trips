import { z } from "zod";
import type { RefundResponse } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { AppError, body, json } from "@/lib/app/http";
import { createRefund, ensureCharges, listPayments } from "@/lib/app/trips/money";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// POST /api/app/v1/trips/{id}/stay/cancel { clientKey } → 201 { refund }: cancels the stay under the hotel's rule.
// The flights stay as they are; the refund tracker starts at Requested.
export const dynamic = "force-dynamic";

const Body = z.object({ clientKey: z.string().min(8).max(64) });

export const POST = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const { clientKey } = await body(req, Body);
  const trip = await loadTrip(req, userId, id);
  await ensureCharges(trip);
  const stay = (await listPayments(trip)).find((p) => p.item === "stay");
  if (!stay || !trip.stays.some((s) => s.status !== "cancelled")) throw new AppError("VALIDATION", { message: "There’s no stay to cancel." });
  const refund = await createRefund(userId, trip, { paymentIds: [stay.id], reason: "plans", destination: "original", clientKey }, requestContext(req).ipHash, { titleOverride: `${trip.stays[0]!.name} · ${trip.stays[0]!.nights} nights` });
  return json({ refund } satisfies RefundResponse, 201);
});
