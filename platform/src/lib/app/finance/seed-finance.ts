/**
 * App finance demo data (DESK-PLAN U6), on a local database:
 *   npx tsx src/lib/app/finance/seed-finance.ts [settlement.csv]
 * Captured app sales over the last week across products, invoices with VAT, refunds at each stage; then writes the
 * MyFatoorah settlement file those captures would appear in (to import on Reconciliation). Local databases only.
 */
import { writeFileSync } from "node:fs";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import { seedFinance, settlementCsv } from "./seed-data";

const url = process.env.DATABASE_URL ?? "postgres://mada:mada@localhost:5432/mada_ops";
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) && process.env.ALLOW_DESK_SEED !== "yes") throw new Error("The finance demo seed only runs against a local database");
const client = postgres(url, { max: 1, prepare: false, onnotice: () => {} });

async function main() {
  const s = await seedFinance(drizzle(client));
  const out = process.argv[2] ?? "myfatoorah-settlement-demo.csv";
  writeFileSync(out, settlementCsv(s));
  console.log(`Finance demo data loaded: ${s.captures.length} card captures, ${s.refunds.length} refund in the settlement file (${out}).`);
}

main().then(() => client.end()).catch(async (e) => { console.error(e); await client.end(); process.exit(1); });
