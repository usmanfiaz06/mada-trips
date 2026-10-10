import { sql } from "@/db";
import type { HealthResponse } from "@mada/shared";
import { SUPPLIERS, supplierModes } from "@/lib/app/config";
import { hasDataKey } from "@/lib/app/crypto";
import { json, route } from "@/lib/app/http";
import { healthOf } from "@/lib/app/resilience/breaker";
import { runtimeConfig } from "@/lib/app/resilience/runtime";

// GET /api/app/v1/health: can the Core API reach its database (and how fast), which suppliers are mocked, which
// suppliers' circuit breakers are open on this instance, whether maintenance is on, is the data key set.
export const dynamic = "force-dynamic";

export const GET = route(async () => {
  let db: HealthResponse["db"] = "ok";
  const t0 = Date.now();
  try {
    await sql`SELECT 1 FROM app_users LIMIT 1`;
  } catch {
    db = "error";
  }
  const dbMs = Date.now() - t0;
  const breakers: NonNullable<HealthResponse["breakers"]> = {};
  for (const s of SUPPLIERS) {
    const h = healthOf(s);
    if (h !== "up") breakers[s] = h;
  }
  const body: HealthResponse = {
    ok: db === "ok", service: "mada-core", apiVersion: "v1", db, suppliers: supplierModes(),
    dataKey: hasDataKey() ? "ok" : "missing", time: new Date().toISOString(), breakers,
    maintenance: (await runtimeConfig()).maintenance.on, dbMs,
  };
  return json(body, db === "ok" ? 200 : 503);
}, { ungated: true });
