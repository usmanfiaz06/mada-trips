import { json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { stamps } from "@/lib/app/circles/discover";

// GET /discover/stamps → StampsResponse: a stamp per city from trips taken, the next one pencilled in.
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await stamps(userId));
});
