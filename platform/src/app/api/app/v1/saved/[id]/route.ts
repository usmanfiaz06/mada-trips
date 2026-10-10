import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { unsave } from "@/lib/app/circles/saved";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// DELETE /saved/{id} → { ok }.
export const dynamic = "force-dynamic";

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await unsave(userId, uuidParam(p.id));
  return json({ ok: true });
});
