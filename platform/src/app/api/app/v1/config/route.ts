import type { ConfigResponse } from "@mada/shared";
import { json, route } from "@/lib/app/http";
import { runtimeConfig } from "@/lib/app/resilience/runtime";

// GET /api/app/v1/config → { minVersion, latestVersion, maintenance: { on, message, until }, features, serverTime, storeUrls }.
// Public (the app asks before sign-in and while signed out) and cached briefly at the edge. No secrets in here.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const c = await runtimeConfig();
  const body: ConfigResponse = { ...c, serverTime: new Date().toISOString() };
  return json(body, 200, { "Cache-Control": "public, max-age=30, s-maxage=30, stale-while-revalidate=120" });
}, { ungated: true });
