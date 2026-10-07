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

// Temporary diagnostic token. Lets us probe the write path and lock state without exposing it publicly.
const PROBE_TOKEN = "mada-writecheck-7f3c";

export async function GET(req: Request) {
  if (!process.env.DATABASE_URL && process.env.VERCEL) {
    return Response.json({ ok: false, db: "error", code: "NO_URL", hint: HINTS.NO_URL }, { status: 503 });
  }

  const probe = new URL(req.url).searchParams.get("probe");
  if (probe === PROBE_TOKEN) return probeWrites();

  try {
    const [{ n }] = await sql<{ n: number }[]>`SELECT count(*)::int AS n FROM users`;
    return Response.json({ ok: true, db: "ok", users: n > 0 ? "set up" : "no users yet (set SEED_PASSWORD and redeploy)" });
  } catch (e) {
    const code = (e as { code?: string }).code ?? "UNKNOWN";
    return Response.json({ ok: false, db: "error", code, hint: HINTS[code] ?? "See Vercel function logs" }, { status: 503 });
  }
}

// Diagnostic: time a read, time a write (rolled back so nothing persists), and list any sessions
// that are blocked or stuck "idle in transaction" — the exact thing that jams sign-in.
async function probeWrites() {
  const out: Record<string, unknown> = {};
  const ms = async (label: string, fn: () => Promise<unknown>) => {
    const t0 = Date.now();
    try { await fn(); out[label] = `${Date.now() - t0}ms ok`; }
    catch (e) { out[label] = `${Date.now() - t0}ms FAIL code=${(e as { code?: string }).code ?? "?"} ${(e as Error).message?.slice(0, 120)}`; }
  };

  await ms("read_users", () => sql`SELECT count(*) FROM users`);
  // Mirror sign-in's write path: a transaction that touches audit_events, then rolls back.
  await ms("write_rollback", () =>
    sql.begin(async (tx) => {
      await tx`INSERT INTO audit_events (action, entity_type, entity_ref, summary)
               VALUES ('health.probe', 'health', 'probe', 'write probe — rolled back')`;
      throw new Error("rollback");
    }).catch((e) => { if ((e as Error).message !== "rollback") throw e; }),
  );

  try {
    const activity = await sql<Record<string, unknown>[]>`
      SELECT pid, state, wait_event_type, wait_event,
             round(extract(epoch from (now() - query_start)))::int AS running_s,
             left(query, 120) AS query
      FROM pg_stat_activity
      WHERE datname = current_database() AND pid <> pg_backend_pid()
        AND (state <> 'idle' OR state IS NULL)
      ORDER BY (now() - query_start) DESC NULLS LAST
      LIMIT 20`;
    out.blocking_sessions = activity;
  } catch (e) {
    out.blocking_sessions = `could not read pg_stat_activity: ${(e as Error).message?.slice(0, 120)}`;
  }

  return Response.json(out, { status: 200, headers: { "cache-control": "no-store" } });
}
