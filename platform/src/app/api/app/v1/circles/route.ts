import { CreateCircleRequest } from "@mada/shared";
import { requestContext } from "@/lib/app/context";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { createCircle, listCircles } from "@/lib/app/circles/circles";
import { isLimited } from "@/lib/app/limits";

// GET /circles → { circles, incoming }: yours, newest activity first, and invites waiting for your yes.
// POST /circles { name, cover?, dest?, invite? } → 201 CircleDetail. People are invited, not added.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  // `limited`: the desk paused posting and messages for this account (lib/app/limits.ts); the app says so up front.
  return json({ ...(await listCircles(userId)), limited: await isLimited(userId) });
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, CreateCircleRequest);
  return json(await createCircle(userId, input, requestContext(req).ipHash), 201);
});
