import { CreateVoteRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { createVote } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/votes { q, kind, options[2..4] } → 201 { items }.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreateVoteRequest);
  return json({ items: [await createVote(uuidParam(p.id), userId, input)] }, 201);
});
