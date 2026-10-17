import { EsimTopupsResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { esimTopups } from "@/lib/app/esim/service";

// GET /esims/{id}/topups → { esim, plans }: up to three top-ups for this eSIM, priced in SAR. Paying one goes through the
// order sheet (draft { kind: "esim", count: 1, packageId, topupOf: id }).
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, { id }) => json(EsimTopupsResponse.parse(await esimTopups(userId, id))));
