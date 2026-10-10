import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { closeVote } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/votes/{mid}/close → { items }: the closed vote and Mada's result (or the tie to break).
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json({ items: await closeVote(uuidParam(p.id), userId, uuidParam(p.mid)) });
});
