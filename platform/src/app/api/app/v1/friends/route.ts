import { BlockRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { listFriends, requestFriend } from "@/lib/app/circles/friends";

// GET /friends → { friends, following, requests, asked }.
// POST /friends { userId } → { status: asked | friends }: ask to be friends (says yes if they already asked you).
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await listFriends(userId));
});

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, BlockRequest);
  return json(await requestFriend(userId, input.userId));
});
