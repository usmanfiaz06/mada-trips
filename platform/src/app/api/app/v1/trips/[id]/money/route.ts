import { TripMoneyResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { tripMoney } from "@/lib/app/trips/money-view";
import { loadTrip, withParams } from "@/lib/app/trips/route";

// GET /api/app/v1/trips/{id}/money → { money }: everything paid on the trip per traveller and in total, refunds, what is
// priced but not paid yet, who paid, splits in circles for this trip, and the statement in words (owner audit item 7).
export const dynamic = "force-dynamic";

export const GET = withParams<{ id: string }>(async (req, { id }, { userId }) => {
  const trip = await loadTrip(req, userId, id);
  return json(TripMoneyResponse.parse({ money: await tripMoney(userId, trip) }));
});
