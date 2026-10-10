import { MarkPaidRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { markPaid } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/splits/{mid}/paid { key, via: cash | card, paymentId? } → { items }.
// Your own share (cash, or after paying it on the pay screen), or anyone's when you paid the bill.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, MarkPaidRequest);
  return json({ items: await markPaid(uuidParam(p.id), userId, uuidParam(p.mid), input, requestContext(req).ipHash) });
});
