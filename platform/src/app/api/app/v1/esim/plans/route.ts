import { EsimPlansResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { esimPlans } from "@/lib/app/esim/service";

// GET /esim/plans?tripId= | ?destination=istanbul&days=7 | ?countries=TR,GR&days=10 → 2–3 eSIM sizes for the trip's
// country (or region) and days, priced in SAR, and who on the trip already has one.
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async (req, { userId }) => {
  const q = Object.fromEntries(new URL(req.url).searchParams) as Record<string, string>;
  return json(EsimPlansResponse.parse(await esimPlans(userId, q)));
});
