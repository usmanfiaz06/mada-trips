import { BlockRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { openDm } from "@/lib/app/circles/circles";

// POST /circles/dm { userId } → { circleId }: the one conversation between two friends, made on first use.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, BlockRequest);
  return json({ circleId: await openDm(userId, input.userId) });
});
