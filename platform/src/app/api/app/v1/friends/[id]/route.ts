import { FriendPatchRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { profile, removeFriend, tagFriend } from "@/lib/app/circles/friends";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /friends/{id} → ProfileResponse: someone's page as you may see it (404 if either of you blocked the other).
// PATCH /friends/{id} { tag: close | family | null } → { ok }.
// DELETE /friends/{id} → { ok }: remove a friend, decline their request, or withdraw yours. Nobody is told.
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json(await profile(userId, uuidParam(p.id)));
});

export const PATCH = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, FriendPatchRequest);
  await tagFriend(userId, uuidParam(p.id), input.tag);
  return json({ ok: true });
});

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await removeFriend(userId, uuidParam(p.id));
  return json({ ok: true });
});
