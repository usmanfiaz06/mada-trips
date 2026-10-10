import { RequestQuote } from "@mada/shared";
import { json } from "@/lib/app/http";
import { getQuote } from "@/lib/app/booking/requests";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /quotes/{id} → { quote }: total, per-person breakdown, the agent's words, its expiry. Paid through POST /orders.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json({ quote: RequestQuote.parse(await getQuote(userId, p.id)) }));
