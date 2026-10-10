import { json, route } from "@/lib/app/http";
import { authenticate } from "@/lib/app/tokens";
import { discover } from "@/lib/app/circles/discover";

// GET /discover?city= → DiscoverResponse: what's on this week, Mada's plans, and the city picker's rows.
// Without a city: your trip's city, else Riyadh. A city we don't cover is 404 (the app offers "Tell me when it's here").
export const dynamic = "force-dynamic";

export const GET = route(async (req) => {
  const { userId } = await authenticate(req);
  return json(await discover(userId, new URL(req.url).searchParams.get("city")));
});
