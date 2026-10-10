import type { PaymentsResponse } from "@mada/shared";
import { getBalance } from "@/lib/app/credit";
import { json } from "@/lib/app/http";
import { ensureCharges, listPayments } from "@/lib/app/trips/money";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/payments → every payment on the trip with its invoice, instalments and refunds.
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  await ensureCharges(trip);
  const payments = await listPayments(trip);
  const total = payments.reduce((a, p) => a + p.amount.amount, 0);
  const refunded = payments.reduce((a, p) => a + (p.refunded?.amount ?? 0), 0);
  return json({ payments, total: { amount: total, currency: "SAR" }, refunded: { amount: refunded, currency: "SAR" }, credit: { amount: await getBalance(userId), currency: "SAR" } } satisfies PaymentsResponse);
});
