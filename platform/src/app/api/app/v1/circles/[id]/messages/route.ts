import { SendCircleMessageRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { listMessages, sendMessage } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /circles/{id}/messages?before=&after=&limit= → { items, next, reads }. Without a cursor: the newest page.
// POST /circles/{id}/messages { body } | { card, pin? } → 201 { items }: your message, and Mada's answer to "@Mada".
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const u = new URL(req.url);
  return json(await listMessages(uuidParam(p.id), userId, { before: u.searchParams.get("before"), after: u.searchParams.get("after"), limit: Number(u.searchParams.get("limit")) || undefined }));
});

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, SendCircleMessageRequest);
  return json({ items: await sendMessage(uuidParam(p.id), userId, input) }, 201);
});
