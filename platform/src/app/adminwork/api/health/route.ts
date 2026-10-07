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
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    return Response.json({ ok: false, db: "error", code: "NO_URL", hint: HINTS.NO_URL }, { status: 503 });
  }
  try {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    return Response.json({ ok: true, db: "ok", users: n > 0 ? "set up" : "no users yet (set SEED_PASSWORD and redeploy)" });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "UNKNOWN";
    return Response.json({ ok: false, db: "error", code, hint: HINTS[code] ?? "See Vercel function logs" }, { status: 503 });
  }
}
