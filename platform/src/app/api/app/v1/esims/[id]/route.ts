import { EsimResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { bookingRoute } from "@/lib/app/booking/route";
import { getEsim } from "@/lib/app/esim/service";

// GET /esims/{id} → { esim }: the install codes (iPhone link, QR, SM-DP+ and code), status, what's left, top-ups.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, { id }) => json(EsimResponse.parse({ esim: await getEsim(userId, id) })));
