import { isProductionDeploy } from "@/lib/app/config";
import { JOBS, cronAllowed, quietSkip, runJobs, type JobName } from "@/lib/app/jobs";

// GET /api/cron/{exports|deletions|recovery|quotes|all}: the scheduled jobs (lib/app/jobs.ts). Vercel Cron calls these
// with `Authorization: Bearer $CRON_SECRET` (platform/vercel.json); anything else is refused. Never cached.
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function GET(req: Request, { params }: { params: Promise<{ job: string }> }) {
  const headers = { "Cache-Control": "no-store", "Content-Type": "application/json" };
  if (!cronAllowed(req, isProductionDeploy())) return new Response(JSON.stringify({ error: "unauthorized" }), { status: 401, headers });
  const { job } = await params;
  const names = job === "all" ? JOBS : (JOBS as readonly string[]).includes(job) ? [job as JobName] : null;
  if (!names) return new Response(JSON.stringify({ error: "unknown job" }), { status: 404, headers });
  // Before anything touches the database, so a quiet staging database can sleep (APP_CRONS=quiet).
  if (quietSkip(names)) return new Response(JSON.stringify({ skipped: "quiet" }), { status: 200, headers });
  return new Response(JSON.stringify({ ran: await runJobs(names) }), { status: 200, headers });
}
