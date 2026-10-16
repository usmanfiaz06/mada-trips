import { json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { requestContext } from "@/lib/app/context";
import { takeBackSplit } from "@/lib/app/circles/take-back";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/splits/{mid}/withdraw → { items }: take back a split while nobody else has paid a share.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  return json({ items: await takeBackSplit(uuidParam(p.id), userId, uuidParam(p.mid), requestContext(req).ipHash) });
});
