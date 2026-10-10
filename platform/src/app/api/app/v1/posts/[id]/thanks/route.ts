import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { thank } from "@/lib/app/circles/posts";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /posts/{id}/thanks → { ok }: the author gets a quiet notification, once.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await thank(userId, uuidParam(p.id));
  return json({ ok: true });
});
