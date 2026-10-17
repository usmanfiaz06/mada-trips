import { json } from "@/lib/app/http";
import { openRoute } from "@/lib/app/guest";
import { discover } from "@/lib/app/circles/discover";

// GET /discover?city= → DiscoverResponse: what's on this week, Mada's plans, and the city picker's rows.
// Without a city: your trip's city, else Riyadh. A city we don't cover is 404 (the app offers "Tell me when it's here").
export const dynamic = "force-dynamic";

// Open to guests: no trip to start from, so the city asked for (the app sends the phone's), else Riyadh.
export const GET = openRoute("read", async (req, { userId }) => {
  return json(await discover(userId, new URL(req.url).searchParams.get("city")));
});
