import { PreviewBody, PreviewResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { priceDraft } from "@/lib/app/booking/pricing";
import { bookingRoute } from "@/lib/app/booking/route";
import { logPaySheet } from "@/lib/app/booking/search-log";

// POST /orders/preview { draft, promo?, useCredit } → the order sheet: lines, all-in total, promo, credit, instalments,
// the cancellation rule, the hold and passports still missing.
export const dynamic = "force-dynamic";

export const POST = bookingRoute(async (req, { userId, demo }) => {
  const b = await body(req, PreviewBody);
  const out = PreviewResponse.parse({ preview: (await priceDraft(userId, b, { demo })).preview });
  // The pay sheet was opened: the desk's Drop-offs see it if no order follows (booking/search-log.ts).
  await logPaySheet(userId, out.preview);
  return json(out);
});
