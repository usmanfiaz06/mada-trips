import { OfferResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { offerView, ownOffer } from "@/lib/app/booking/search";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /offers/{id} → the option as priced, and whether its hold has ended.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json(OfferResponse.parse(offerView(await ownOffer(userId, p.id)))));
