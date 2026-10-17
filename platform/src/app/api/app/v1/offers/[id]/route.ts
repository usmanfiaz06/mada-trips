import { OfferResponse } from "@mada/shared";
import { json } from "@/lib/app/http";
import { offerView, ownOffer } from "@/lib/app/booking/search";
import { openRoute } from "@/lib/app/guest";

// GET /offers/{id} → the option as priced, and whether its hold has ended.
export const dynamic = "force-dynamic";

// A guest reads the offers of its own searches (no owner yet); signed in, yours or one you're about to book.
export const GET = openRoute<{ id: string }>("read", async (_req, { userId }, p) => json(OfferResponse.parse(offerView(await ownOffer(userId, p.id)))));
