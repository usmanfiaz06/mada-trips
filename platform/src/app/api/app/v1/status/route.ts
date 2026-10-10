import type { StatusResponse } from "@mada/shared";
import { SUPPLIERS } from "@/lib/app/config";
import { json, route } from "@/lib/app/http";
import { degradedSuppliers } from "@/lib/app/resilience/breaker";
import { runtimeConfig } from "@/lib/app/resilience/runtime";

// GET /api/app/v1/status → { status: ok | degraded | down, degraded: [{ name, label, state, since }], maintenance, time }.
// Public and cached for 15 seconds: the app checks it when a supplier call fails, and before a search, to say
// "Saudia's system isn't answering" up front. Lists only suppliers that aren't fully up.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [degraded, cfg] = await Promise.all([degradedSuppliers(SUPPLIERS), runtimeConfig()]);
  const status: StatusResponse["status"] = cfg.maintenance.on || degraded.some((d) => d.state === "down" && (d.name === "flights" || d.name === "payments"))
    ? "down" : degraded.length ? "degraded" : "ok";
  const body: StatusResponse = { status, degraded, maintenance: cfg.maintenance, time: new Date().toISOString() };
  return json(body, 200, { "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60" });
}, { ungated: true });
