/*
 * Things to do: load or refresh cities' open data (OpenStreetMap via Overpass, Wikidata, Wikipedia pageviews, Commons).
 *
 *   DATABASE_URL=… npx tsx scripts/activities/refresh.ts                 # the cities due (5)
 *   DATABASE_URL=… npx tsx scripts/activities/refresh.ts --limit 20
 *   DATABASE_URL=… npx tsx scripts/activities/refresh.ts --place 108410  # one city now (Riyadh), due or not
 *
 * Set PLACES_CONTACT to a monitored address: it goes in the User-Agent every request sends. Waits 1.5 s between cities.
 */
import { refreshCity, refreshDue } from "../../src/lib/app/activities/ingest";

const arg = (name: string) => { const i = process.argv.indexOf(name); return i > 0 ? process.argv[i + 1] : undefined; };

async function main() {
  const place = arg("--place");
  const out = place ? [await refreshCity(Number(place), (u, i) => fetch(u, i))] : await refreshDue({ limit: Number(arg("--limit") ?? 5), pauseMs: 1500 });
  for (const r of out) console.log(`${r.placeId}: ${r.status}, ${r.stored} places`);
  const { sql } = await import("../../src/db");
  await sql.end({ timeout: 5 });
}

main().catch((e) => { console.error(e); process.exit(1); });
