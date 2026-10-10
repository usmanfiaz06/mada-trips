import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { leaveCircle } from "@/lib/app/circles/circles";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/leave → { deleted }: the next person becomes admin; the last one out deletes the circle.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json(await leaveCircle(uuidParam(p.id), userId));
});
