import { CastVoteRequest } from "@mada/shared";
import { body, json } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { castVote } from "@/lib/app/circles/messages";
import { routeP, uuidParam } from "@/lib/app/circles/common";

// POST /circles/{id}/votes/{mid} { option } → { items }: one vote each; the same choice again takes it back.
export const dynamic = "force-dynamic";

export const POST = routeP<{ id: string; mid: string }>(async (req, p) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CastVoteRequest);
  return json({ items: [await castVote(uuidParam(p.id), userId, uuidParam(p.mid), input.option)] });
});
