import { PickRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { pickWinner } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/votes/{mid}/pick { option } → { items }: break a tie.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, PickRequest);
  return json({ items: await pickWinner(uuidParam(p.id), userId, uuidParam(p.mid), input.option) });
});
