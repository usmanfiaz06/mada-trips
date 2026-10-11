/*
 * npm run app:jobs -- <exports|deletions|recovery|quotes|all> [more…]: run the scheduled jobs once, here, against
 * DATABASE_URL (what Vercel Cron runs through GET /api/cron/{job} in production). Prints what each job did.
 */
import { JOBS, runJobs, type JobName } from "../src/lib/app/jobs";
import { sql } from "../src/db";

const args = process.argv.slice(2);
const names = (args.length === 0 || args.includes("all") ? [...JOBS] : args) as JobName[];
const unknown = names.filter((n) => !(JOBS as readonly string[]).includes(n));
if (unknown.length) {
  console.error(`Unknown job: ${unknown.join(", ")}. Jobs: ${JOBS.join(", ")}, or all.`);
  process.exit(2);
}
const out = await runJobs(names);
console.log(JSON.stringify(out, null, 2));
await sql.end({ timeout: 5 });
process.exit(Object.values(out).some((r) => "error" in r) ? 1 : 0);
