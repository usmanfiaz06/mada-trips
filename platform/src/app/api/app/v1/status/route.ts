import type { StatusResponse } from "@mada/shared";
import { KEYED_SUPPLIERS, SUPPLIERS } from "@/lib/app/config";
import { json, route } from "@/lib/app/http";
import { launchStatus } from "@/lib/app/launch";
import { degradedSuppliers } from "@/lib/app/resilience/breaker";
import { runtimeConfig } from "@/lib/app/resilience/runtime";
import { publicSlot } from "@/lib/app/shield";
import { flightStatusVendor } from "@/lib/app/suppliers";

// GET /api/app/v1/status → { status: ok | degraded | down, degraded: [{ name, label, state, since }], maintenance, time }.
// Public and cached for 15 seconds: the app checks it when a supplier call fails, and before a search, to say
// "Saudia's system isn't answering" up front. Lists only suppliers that aren't fully up.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  const [all, cfg] = await Promise.all([degradedSuppliers([...SUPPLIERS, ...Object.keys(KEYED_SUPPLIERS)]), runtimeConfig()]);
  // Partner-named slots answer as the kind of service, never the partner (docs/app/SUPPLIER-PRIVACY.md).
  const degraded = [...new Map(all.map((d) => { const name = publicSlot(d.name); return [name, { ...d, name }] as const; })).values()];
  const status: StatusResponse["status"] = cfg.maintenance.on || degraded.some((d) => d.state === "down" && (d.name === "flights" || d.name === "payments"))
    ? "down" : degraded.length ? "degraded" : "ok";
  // The launch guard: on production, what keeps app routes closed (launch.ts). Ready and empty elsewhere.
  // What blocks the launch names partners and env keys: the team reads it in the logs and /adminwork/api/health.
  const { ready } = launchStatus();
  const launch = { ready, problems: [] as string[] };
  const body: StatusResponse = { status: ready ? status : "down", degraded, maintenance: cfg.maintenance, time: new Date().toISOString(), launch, flightStatusSource: sourceKind(flightStatusVendor()) };
  return json(body, 200, { "Cache-Control": "public, max-age=15, s-maxage=15, stale-while-revalidate=60" });
}, { ungated: true });

/** Live, mock or none: which vendor stays on the server. */
function sourceKind(v: string): "live" | "mock" | "none" {
  return v === "mock" || v === "none" ? v : "live";
}
