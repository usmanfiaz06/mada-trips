import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { follow, unfollow } from "@/lib/app/circles/friends";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /follows/{id} → { ok }: see their public tips first. DELETE /follows/{id} → { ok }.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await follow(userId, uuidParam(p.id));
  return json({ ok: true });
});

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await unfollow(userId, uuidParam(p.id));
  return json({ ok: true });
});
