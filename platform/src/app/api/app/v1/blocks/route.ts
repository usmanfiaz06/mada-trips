import { BlockRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { block, listBlocks } from "@/lib/app/circles/safety";

// GET /blocks → { blocked }. POST /blocks { userId } → { ok }: they can't find or message you, and aren't told.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json({ blocked: await listBlocks(userId) });
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, BlockRequest);
  await block(userId, input.userId, requestContext(req).ipHash);
  return json({ ok: true });
});
