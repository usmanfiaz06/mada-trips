import { json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { search } from "@/lib/app/circles/friends";

// GET /friends/search?q= → { people, byPhone }: anyone on Mada by name, or one person by their exact number.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await search(userId, new URL(req.url).searchParams.get("q") ?? ""));
});
