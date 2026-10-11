import { requestContext } from "@/lib/app/context";
import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { accept } from "@/lib/app/circles/invites";
import { isUuid, routeP } from "@/lib/app/circles/common";

// POST /invites/{code or id}/accept → { circleId, friendId, already }: join the circle, or become friends. The person
// who sent it is told (inbox and push). A link with a limit that's full answers 404 "This link is full."
export const dynamic = "force-dynamic";

export const POST = routeP<{ ref: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const ref = decodeURIComponent(p.ref);
  return json(await accept(ref, userId, isUuid(ref), requestContext(req).ipHash));
});
