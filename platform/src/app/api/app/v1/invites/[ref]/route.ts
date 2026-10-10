import { json } from "@/lib/app/http";
import { authenticate, authenticateOptional } from "@/lib/app/tokens";
import { cancel, preview } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// GET /invites/{code} → InvitePreview. No sign-in needed: this is what someone opening the link sees first.
// DELETE /invites/{id} → { ok }: cancel an invite you sent (or, for a circle, the admin). The link stops working.
export const dynamic = "force-dynamic";

export const GET = routeP<{ ref: string }>(async (req, p) => {
  const viewer = await authenticateOptional(req);
  return json(await preview(decodeURIComponent(p.ref), viewer?.userId ?? null));
});

export const DELETE = routeP<{ ref: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await cancel(uuidParam(p.ref), userId);
  return json({ ok: true });
});
