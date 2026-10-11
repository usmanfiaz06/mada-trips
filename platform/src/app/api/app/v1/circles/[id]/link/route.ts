import { LinkOptions } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { linkFor } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/link { expiresInDays?, maxUses?, fresh? } → InviteLink: the circle's invite link (the same one
// until it expires or fills up). Any option makes a new link and turns the old one off.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json(await linkFor(userId, uuidParam(p.id), await body(req, LinkOptions)));
});
