import { AcceptOfferBody, BookingRequestView, ThreadMessage } from "@mada/shared";
import { z } from "zod";
import { body, json } from "@/lib/app/http";
import { acceptThreadOffer } from "@/lib/app/booking/requests";
import { bookingRoute } from "@/lib/app/booking/route";

// POST /quotes/{id}/accept-offer { messageId } → "Switch it": the agent's offer in the thread goes into the quote.
export const dynamic = "force-dynamic";

const Out = z.object({ request: BookingRequestView, messages: z.array(ThreadMessage) });

export const POST = bookingRoute<{ id: string }>(async (req, { userId }, p) => {
  const { messageId } = await body(req, AcceptOfferBody);
  return json(Out.parse(await acceptThreadOffer(userId, p.id, messageId)));
});
