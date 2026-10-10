import { InviteToCircleRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { circleDetail } from "@/lib/app/circles/circles";
import { inviteToCircle } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/invites { userIds } → CircleDetail: invite people on Mada (the admin). They join when they say yes.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, InviteToCircleRequest);
  await inviteToCircle(uuidParam(p.id), userId, input.userIds);
  return json(await circleDetail(uuidParam(p.id), userId));
});
