import { sql } from "@/db";

// Public health check: says whether the platform can reach its database, and if not, why (error code only).
export const dynamic = "force-dynamic";

const HINTS: Record<string, string> = {
  "28P01": "Wrong database password in DATABASE_URL",
  ENOTFOUND: "Database host not found: check the host in DATABASE_URL",
  ECONNREFUSED: "Database refused the connection: check host and port (6543)",
  ETIMEDOUT: "Database connection timed out",
  "3D000": "Database name not found (should be postgres)",
  "42P01": "Tables missing: migrations haven't run yet",
  NO_URL: "DATABASE_URL is not set in Vercel",
};

export async function GET() {
  // The region this function runs in, and how long one database round trip takes. When compute is
  // co-located with the database (both in Frankfurt) dbMs is a few ms; a transatlantic gap shows ~100ms.
  const region = process.env.VERCEL_REGION ?? "local";
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    return Response.json({ ok: false, db: "error", code: "NO_URL", hint: HINTS.NO_URL, region }, { status: 503 });
  }
  try {
    const t = Date.now();
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    const dbMs = Date.now() - t;
    return Response.json({ ok: true, db: "ok", region, dbMs, users: n > 0 ? "set up" : "no users yet (set SEED_PASSWORD and redeploy)" });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "UNKNOWN";
    return Response.json({ ok: false, db: "error", code, hint: HINTS[code] ?? "See Vercel function logs", region }, { status: 503 });
  }
}
