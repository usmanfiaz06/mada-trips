import { NotifyCityRequest } from "@mada/shared";
import { body, json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { notifyCity } from "@/lib/app/circles/discover";

// POST /discover/notify { city } → { ok }: tell me when Discover covers this city.
export const dynamic = "force-dynamic";

export const POST = route(async (req) => {
  const { userId } = await authenticate(req);
  const input = await body(req, NotifyCityRequest);
  await notifyCity(userId, input.city);
  return json({ ok: true });
});
