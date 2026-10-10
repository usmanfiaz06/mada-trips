import { UpdateCircleRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { circleDetail, deleteCircle, updateCircle } from "@/lib/app/circles/circles";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /circles/{id} → CircleDetail (members, invited, pinned plan, read receipts). Members only (404 otherwise).
// PATCH /circles/{id} { name?, cover? (admin), muted?, dest?, pin?, read? } → CircleDetail.
// DELETE /circles/{id} → { ok }: delete for everyone (admin).
export const dynamic = "force-dynamic";

export const GET = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json(await circleDetail(uuidParam(p.id), userId));
});

export const PATCH = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const patch = await body(req, UpdateCircleRequest);
  return json(await updateCircle(uuidParam(p.id), userId, patch));
});

export const DELETE = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await deleteCircle(uuidParam(p.id), userId, requestContext(req).ipHash);
  return json({ ok: true });
});
