import { SaveRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { listSaved, save } from "@/lib/app/circles/saved";

// GET /saved → { saved }. POST /saved { kind: post | plan, refId } → 201 { item }: a tip is saved as a copy.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ saved: await listSaved(userId) });
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, SaveRequest);
  return json({ item: await save(userId, input) }, 201);
});
