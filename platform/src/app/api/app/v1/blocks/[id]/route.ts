import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { unblock } from "@/lib/app/circles/safety";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// DELETE /blocks/{id} → { ok }: unblock.
export const dynamic = "force-dynamic";

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await unblock(userId, uuidParam(p.id));
  return json({ ok: true });
});
