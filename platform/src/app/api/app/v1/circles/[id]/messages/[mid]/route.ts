import { PatchMessageRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { dismissMada } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// PATCH /circles/{id}/messages/{mid} { done: true } → { items }: hide the buttons under a Mada message ("Not now").
export const dynamic = "force-dynamic";

export const PATCH = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  await body(req, PatchMessageRequest);
  return json({ items: [await dismissMada(uuidParam(p.id), userId, uuidParam(p.mid))] });
});
