import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { remind } from "@/lib/app/circles/invites";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /invites/{id}/remind → { ok }: once a day.
export const dynamic = "force-dynamic";

export const POST = routeP<{ ref: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await remind(uuidParam(p.ref), userId);
  return json({ ok: true });
});
