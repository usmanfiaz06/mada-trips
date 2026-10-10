import { AroundActionRequest, PresenceRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { around, aroundAction, setPresence } from "@/lib/app/circles/discover";

// GET /discover/around → AroundResponse: your city, whether friends can see you're there, and friends here too.
// PUT /discover/around { on, audience?, picked? } → AroundResponse. City only; ends by itself when you fly home.
// POST /discover/around { userId, action: hello | notNow | hide } → AroundResponse.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await around(userId));
});

export const PUT = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, PresenceRequest);
  return json(await setPresence(userId, input));
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, AroundActionRequest);
  await aroundAction(userId, input.userId, input.action);
  return json(await around(userId));
});
