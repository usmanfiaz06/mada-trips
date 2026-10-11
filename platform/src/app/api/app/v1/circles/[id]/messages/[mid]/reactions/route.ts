import { ReactRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { react } from "@/lib/app/circles/live";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/messages/{mid}/reactions { emoji, on? } → { items: [message] }: react to a message, or take
// the reaction back (on: false). One of each emoji per person.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, ReactRequest);
  return json({ items: [await react(uuidParam(p.id), userId, uuidParam(p.mid), input)] });
});
