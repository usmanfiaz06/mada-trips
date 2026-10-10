/*
 * Load every city of 15,000 people or more, their airports and the names search matches into app_places*.
 *
 *   npx tsx scripts/places/ingest.ts --download            # fetch the open datasets into .cache/places, then load
 *   npx tsx scripts/places/ingest.ts --dir ./data --dry-run # parse and report, write nothing
 *   npx tsx scripts/places/ingest.ts --no-alt-names         # skip Arabic names and Wikipedia links (200 MB file)
 *
 * Idempotent and safe to re-run (monthly is plenty). Sources and licences: src/lib/app/places/README.md.
 */
import postgres from "postgres";
import { runIngest } from "../../src/lib/app/places/ingest";
import { sslFor } from "../../src/db/ssl";

const args = process.argv.slice(2);
const flag = (n: string) => args.includes(`--${n}`);
const value = (n: string) => { const i = args.indexOf(`--${n}`); return i >= 0 ? args[i + 1] : undefined; };

async function main() {
  const dryRun = flag("dry-run");
  const url = process.env.DATABASE_URL;
  if (!dryRun && !url) throw new Error("Set DATABASE_URL, or pass --dry-run");
  const sql = dryRun ? undefined : postgres(url!, { max: 1, onnotice: () => {}, ssl: sslFor(url!) });
  try {
    const report = await runIngest({
      dir: value("dir") ?? ".cache/places", download: flag("download"), altNames: !flag("no-alt-names"),
      minPopulation: value("min-pop") ? Number(value("min-pop")) : undefined, dryRun, sql, log: (l) => console.log(l),
    });
    console.log(JSON.stringify(report, null, 2));
  } finally {
    await sql?.end({ timeout: 5 });
  }
}

main().catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
