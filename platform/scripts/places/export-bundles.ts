/*
 * Small, offline city lists built from the same open datasets as the database, for places that can't search the
 * server: the clickable prototype (no network at runtime) and the app's mock mode.
 *
 *   npx tsx scripts/places/export-bundles.ts --dir .cache/places
 *
 * Keeps the 1,500 biggest cities, every capital and every city with a large airport, in a compact form:
 *   { v, attribution, countries: { GE: "Georgia" }, tz: ["Asia/Tbilisi", …],
 *     cities: [[id, name, countryCode, iata | "", tzIndex, population in thousands, curated photo | "", other names | ""]] }
 * Writes docs/app/prototype-app/src/data/cities.json and apps/mobile/src/lib/mock/places-cities.json.
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { loadSources } from "../../src/lib/app/places/ingest";
import { CURATED } from "../../src/lib/app/places/curated";

const args = process.argv.slice(2);
const dir = args[args.indexOf("--dir") + 1] && args.includes("--dir") ? args[args.indexOf("--dir") + 1]! : ".cache/places";
const TOP = Number(args.includes("--top") ? args[args.indexOf("--top") + 1] : 1500);
const ROOT = join(__dirname, "../../..");

async function main() {
  const d = await loadSources({ dir, altNames: true });
  const largeCityIds = new Set(d.airports.filter((a) => a.size === "large" && a.cityId).map((a) => a.cityId!));
  const byPop = [...d.places].sort((a, b) => b.population - a.population);
  const keep = new Set<number>([...byPop.slice(0, TOP).map((p) => p.id), ...d.places.filter((p) => p.isCapital || largeCityIds.has(p.id) || p.curation === "curated").map((p) => p.id)]);
  const chosen = byPop.filter((p) => keep.has(p.id));
  const tz: string[] = [];
  const tzi = (z: string) => { let i = tz.indexOf(z); if (i < 0) { tz.push(z); i = tz.length - 1; } return i; };
  const countries: Record<string, string> = {};
  const curated = new Map(CURATED.map((c) => [c.geonameId, c]));
  const cities = chosen.map((p) => {
    countries[p.countryCode] = d.countries.get(p.countryCode)!.name;
    // Other names people search by: our aliases, and the city's own airport codes beyond the first.
    const codes = d.names.filter((n) => n.placeId === p.id && n.kind === "iata").map((n) => n.name).filter((c) => c !== p.iata);
    const alts = [...(curated.get(p.id)?.aliases ?? []).filter((a) => !/\p{Script=Arabic}/u.test(a)), ...codes];
    return [p.id, p.name, p.countryCode, p.iata ?? "", tzi(p.timezone), Math.round(p.population / 1000), curated.get(p.id)?.photo ?? "", [...new Set(alts)].join("|")];
  });
  const out = {
    v: 1,
    attribution: "Cities: GeoNames (CC BY 4.0, geonames.org). Airports: OurAirports (public domain, ourairports.com).",
    countries, tz, cities,
  };
  const json = JSON.stringify(out);
  for (const target of ["docs/app/prototype-app/src/data/cities.json", "apps/mobile/src/lib/mock/places-cities.json"]) {
    const path = join(ROOT, target);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, json);
    console.log(`${target}: ${cities.length} cities, ${Math.round(json.length / 1024)} KB`);
  }
}

main().catch((e) => { console.error(e); process.exit(1); });
