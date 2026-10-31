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

// The database's own region, read from the host in DATABASE_URL (Supabase pooler hosts look like
// aws-0-<region>.pooler.supabase.com). No credentials or project ref are exposed — only the region,
// so we can see at a glance whether compute and data are in the same place.
function dbRegion(): string {
  try {
    const host = new URL(process.env.DATABASE_URL ?? "").hostname;
    const m = host.match(/aws-[0-9]+-([a-z0-9-]+)\.pooler\.supabase\.com/);
    if (m) return m[1];
    if (/\.supabase\.(co|com)$/.test(host)) return "supabase-direct";
    return host ? "other" : "unknown";
  } catch {
    return "unknown";
  }
}

export async function GET() {
  // The region this function runs in, where the database lives, and how long one round trip takes.
  // Co-located (compute region == db region) dbMs is a few ms; a cross-continent gap shows 100–230ms.
  const region = process.env.VERCEL_REGION ?? "local";
  const db_region = dbRegion();
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    return Response.json({ ok: false, db: "error", code: "NO_URL", hint: HINTS.NO_URL, region, db_region }, { status: 503 });
  }
  try {
    const t = Date.now();
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    const dbMs = Date.now() - t;
    return Response.json({ ok: true, db: "ok", region, db_region, dbMs, users: n > 0 ? "set up" : "no users yet (set SEED_PASSWORD and redeploy)" });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "UNKNOWN";
    return Response.json({ ok: false, db: "error", code, hint: HINTS[code] ?? "See Vercel function logs", region, db_region }, { status: 503 });
  }
}
