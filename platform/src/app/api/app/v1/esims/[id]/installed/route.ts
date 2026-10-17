import { EsimResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { markInstalled } from "@/lib/app/esim/service";

// POST /esims/{id}/installed → { esim }: the traveller installed it. It switches on when they land.
export const dynamic = "force-dynamic";

export const POST = bookingRoute<{ id: string }>(async (_req, { userId }, { id }) => json(EsimResponse.parse({ esim: await markInstalled(userId, id) })));
