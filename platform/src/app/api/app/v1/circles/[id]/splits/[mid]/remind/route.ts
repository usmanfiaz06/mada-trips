import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { remindSplit } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/splits/{mid}/remind → { items }: the payer reminds everyone still owing, once a day.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json({ items: await remindSplit(uuidParam(p.id), userId, uuidParam(p.mid)) });
});
