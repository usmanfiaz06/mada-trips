import { OfferResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { offerView, repriceOffer } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /offers/{id}/price → "Check the price again": the supplier prices it now and the 20-minute hold starts again.
export const dynamic = "force-dynamic";

export const POST = bookingRoute<{ id: string }>(async (_req, { userId }, p) => {
  const { row, changedBy } = await repriceOffer(userId, p.id);
  return json(OfferResponse.parse(offerView(row, changedBy)));
});
