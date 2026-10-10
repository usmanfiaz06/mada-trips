import { CreateSplitRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { createSplit } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/splits { what, total (halalas), paidBy, mode, between, custom? } → 201 { items }. Exact to the halala.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreateSplitRequest);
  return json({ items: [await createSplit(uuidParam(p.id), userId, input, requestContext(req).ipHash)] }, 201);
});
