import { PreviewBody, PreviewResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { priceDraft } from "@/lib/app/booking/pricing";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /orders/preview { draft, promo?, useCredit } → the order sheet: lines, all-in total, promo, credit, instalments,
// the cancellation rule, the hold and passports still missing.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId }) => {
  const b = await body(req, PreviewBody);
  return json(PreviewResponse.parse({ preview: (await priceDraft(userId, b)).preview }));
});
