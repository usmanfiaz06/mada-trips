import { sql } from "@/db";
import type { HealthResponse } from "@mada/shared";
import { supplierModes } from "@/lib/app/config";
import { hasDataKey } from "@/lib/app/crypto";
import { json } from "@/lib/app/http";

// GET /api/app/v1/health: can the Core API reach its database, which suppliers are mocked, is the data key set.
export const dynamic = "force-dynamic";

export async function GET() {
  let db: HealthResponse["db"] = "ok";
  try {
    await sql`SELECT 1 FROM app_users LIMIT 1`;
  } catch {
    db = "error";
  }
  const body: HealthResponse = {
    ok: db === "ok", service: "mada-core", apiVersion: "v1", db, suppliers: supplierModes(),
    dataKey: hasDataKey() ? "ok" : "missing", time: new Date().toISOString(),
  };
  return json(body, db === "ok" ? 200 : 503);
}
