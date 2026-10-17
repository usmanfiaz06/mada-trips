import { EsimsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { listEsims } from "@/lib/app/esim/service";

// GET /esims?order={orderId}&trip={tripId} → { esims }: what's bought, the install codes, what's left (read through the
// supplier at most every 20 minutes).
export const dynamic = "force-dynamic";

export const GET = bookingRoute(async (req, { userId }) => {
  const u = new URL(req.url).searchParams;
  return json(EsimsResponse.parse({ esims: await listEsims(userId, { orderId: u.get("order"), tripId: u.get("trip") }) }));
});
