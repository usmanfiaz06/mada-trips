import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { typing } from "@/lib/app/circles/live";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/typing → { ok }: "Noor is typing" for the others, for a few seconds. At most every 3 s.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await typing(uuidParam(p.id), userId);
  return json({ ok: true });
}, { idempotent: false });
