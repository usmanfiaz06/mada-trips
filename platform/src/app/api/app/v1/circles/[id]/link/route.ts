import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { linkFor } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/link → { code, url, expiresAt }: the circle's invite link (the same one until it expires).
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json(await linkFor(userId, uuidParam(p.id)));
});
