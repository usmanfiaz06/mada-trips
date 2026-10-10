import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { decline } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /invites/{id}/decline → { ok }: say no to a circle invite. The sender isn't told.
export const dynamic = "force-dynamic";

export const POST = routeP<{ ref: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await decline(uuidParam(p.ref), userId);
  return json({ ok: true });
});
