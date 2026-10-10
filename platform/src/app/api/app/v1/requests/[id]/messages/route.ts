import { MessagesResponse, PostMessageBody } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { postMessage, threadOf } from "@/lib/app/booking/requests";
import { bookingRoute } from "@/lib/app/booking/route";

// GET /requests/{id}/messages → the thread with the agent. POST { text } → the thread with the reply added.
export const dynamic = "force-dynamic";

export const GET = bookingRoute<{ id: string }>(async (_req, { userId }, p) => json(MessagesResponse.parse(await threadOf(userId, p.id))));

export const POST = bookingRoute<{ id: string }>(async (req, { userId }, p) => {
  const { text } = await body(req, PostMessageBody);
  return json(MessagesResponse.parse(await postMessage(userId, p.id, text)), 201);
});
