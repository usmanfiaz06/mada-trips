import type { ConfigResponse } from "@mada/shared";
import { json, route } from "@/lib/app/http";
import { phoneChannels } from "@/lib/app/phone-channel";
import { runtimeConfig } from "@/lib/app/resilience/runtime";
import { bookingRequiresPhone, flightsMode } from "@/lib/app/switches";

// GET /api/app/v1/config → { minVersion, latestVersion, maintenance: { on, message, until }, features, serverTime, storeUrls,
// phoneChannels } (phoneChannels: how phone codes can travel, the usual way first: ["whatsapp", "sms"]).
// Public (the app asks before sign-in and while signed out) and cached briefly at the edge. No secrets in here.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const c = await runtimeConfig();
  // The beta's switches ride in features: flights by request, and whether booking needs a verified phone (switches.ts).
  const features = { ...c.features, flightsByRequest: flightsMode() === "request", bookingNeedsPhone: bookingRequiresPhone() };
  const body: ConfigResponse = { ...c, features, phoneChannels: phoneChannels(), serverTime: new Date().toISOString() };
  return json(body, 200, { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120" });
}, { ungated: true });
