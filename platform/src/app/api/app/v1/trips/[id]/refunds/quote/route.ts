import { refundQuoteItems, timing, type RefundQuoteResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { ensureCharges, listPayments } from "@/lib/app/trips/money";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/refunds/quote → what comes back for each payment if cancelled now, and the rule that says so.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  await ensureCharges(trip);
  const payments = await listPayments(trip);
  const tm = timing(trip.clock.phase);
  const card = payments.find((p) => p.method !== "tabby" && p.method !== "tamara")?.label ?? payments[0]?.label ?? "your card";
  return json({ items: refundQuoteItems(trip, payments), airlineCancelled: tm.airlineCancelled, partlyUsed: tm.outUsed && !tm.allUsed, allUsed: tm.allUsed, card } satisfies RefundQuoteResponse);
});
