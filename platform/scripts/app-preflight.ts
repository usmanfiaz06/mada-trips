/*
 * npm run app:preflight: the launch checklist for the Core API, for whatever environment this shell has.
 * Prints every check (✓ ready, ! worth a look, ✗ blocks a production launch) and exits 1 when anything blocks.
 * Run it with the production env (vercel env pull) before a release; APP_ENV=production checks as production would.
 *
 *   npm run app:preflight                       this environment
 *   APP_ENV=production npm run app:preflight    as a production deployment would see it
 */
import { launchChecks } from "../src/lib/app/launch";
import { isProductionDeploy } from "../src/lib/app/config";

const production = isProductionDeploy() || process.argv.includes("--production");
const checks = launchChecks(production);
const mark = { ok: "✓", warn: "!", block: "✗" } as const;
console.log(`Mada Trips Core API preflight (${production ? "production" : "not production: problems show as warnings"})\n`);
let area = "";
for (const c of checks) {
  if (c.area !== area) { area = c.area; console.log(`  ${area}`); }
  console.log(`    ${mark[c.level]} ${c.text}`);
}
const blocks = checks.filter((c) => c.level === "block").length;
const warns = checks.filter((c) => c.level === "warn").length;
console.log(`\n${blocks ? `${blocks} blocker${blocks === 1 ? "" : "s"}: app routes stay closed on production until fixed.` : "No blockers."}${warns ? ` ${warns} to look at.` : ""}`);
process.exit(blocks ? 1 : 0);
