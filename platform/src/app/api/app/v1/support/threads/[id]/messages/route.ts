import { SendSupportMessageRequest, SendSupportMessageResponse } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { sendMessage } from "@/lib/app/support/threads";
import { authed, uuidParam } from "@/lib/app/account/route";

// POST /support/threads/{id}/messages { body, clientId?, topic?, reply?, bag?, bagFor?, rating? } → 201 { messages }:
// the traveller's message, then any instant answers from Mada. A repeated clientId returns what was saved before.
export const dynamic = "force-dynamic";

export const POST = authed<{ id: string }>(async (req, { userId, ipHash }, p) => {
  const id = uuidParam(p.id);
  const input = await body(req, SendSupportMessageRequest);
  return json(SendSupportMessageResponse.parse({ messages: await sendMessage(userId, id, input, ipHash) }), 201);
});
