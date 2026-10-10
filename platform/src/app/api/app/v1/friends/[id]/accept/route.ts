import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { acceptFriend } from "@/lib/app/circles/friends";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /friends/{id}/accept → { ok }.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await acceptFriend(userId, uuidParam(p.id));
  return json({ ok: true });
});
