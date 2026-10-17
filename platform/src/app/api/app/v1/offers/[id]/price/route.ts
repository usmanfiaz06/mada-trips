import { OfferResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { offerView, repriceOffer } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";

// POST /offers/{id}/price → "Check the price again": the supplier prices it now and the 20-minute hold starts again.
export const dynamic = "force-dynamic";

export const POST = openRoute<{ id: string }>("search", async (_req, { userId, demo }, p) => {
  const { row, changedBy } = await repriceOffer(userId, p.id, undefined, undefined, demo);
  return json(OfferResponse.parse(offerView(row, changedBy)));
});
