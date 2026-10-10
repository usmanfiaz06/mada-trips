/*
 * Loading Places from the open datasets: download (once), parse, link airports to cities, and write everything in one
 * transaction. Idempotent: re-running updates rows in place, keeps guides already fetched, and never downgrades a
 * city whose guide was found ("guide") back to "basic". Used by scripts/places/ingest.ts and its tests.
 * No server-only import: it runs from the command line.
 */
import { spawn } from "node:child_process";
import { createReadStream, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline";
import type { Sql } from "postgres";
import { buildPlaces, makeAlternateNamesReader, parseAdmin1, parseAirports, parseCities, parseCountries, type AirportRow, type NameRow, type PlaceRow } from "./sources";

export const SOURCES = {
  cities: { file: "cities15000.txt", url: "https://download.geonames.org/export/dump/cities15000.zip", zip: "cities15000.zip" },
  countries: { file: "countryInfo.txt", url: "https://download.geonames.org/export/dump/countryInfo.txt" },
  admin1: { file: "admin1CodesASCII.txt", url: "https://download.geonames.org/export/dump/admin1CodesASCII.txt" },
  airports: { file: "airports.csv", url: "https://davidmegginson.github.io/ourairports-data/airports.csv" },
  alternateNames: { file: "alternateNamesV2.txt", url: "https://download.geonames.org/export/dump/alternateNamesV2.zip", zip: "alternateNamesV2.zip" },
} as const;

export const placesUserAgent = () => `MadaTrips-Places/1.0 (+https://madatrips.sa; ${process.env.PLACES_CONTACT ?? "contact via https://madatrips.sa/contact"})`;

export type IngestOptions = {
  dir: string;
  download?: boolean;
  /** Skip the 200 MB alternate names file (no Arabic names, no Wikipedia links). */
  altNames?: boolean;
  minPopulation?: number;
  dryRun?: boolean;
  log?: (line: string) => void;
};
export type IngestReport = { countries: number; places: number; names: number; airports: number; arabic: number; wikipedia: number; curated: number; dryRun: boolean; ms: number };

async function download(url: string, to: string, log: (s: string) => void) {
  log(`Downloading ${url}`);
  const res = await fetch(url, { headers: { "User-Agent": placesUserAgent() } });
  if (!res.ok) throw new Error(`${new URL(url).host} answered ${res.status} for ${url}`);
  writeFileSync(to, Buffer.from(await res.arrayBuffer()));
}

/** Lines of a text file, or of one member of a zip (streamed through `unzip -p`, so 800 MB never sits in memory). */
async function eachLine(path: string, member: string | null, fn: (l: string) => void) {
  const child = member ? spawn("unzip", ["-p", path, member], { stdio: ["ignore", "pipe", "inherit"] }) : null;
  const input = child ? child.stdout! : createReadStream(path, "utf8");
  const rl = createInterface({ input, crlfDelay: Infinity });
  for await (const l of rl) fn(l);
  if (child) await new Promise<void>((res, rej) => child.on("close", (code) => (code === 0 || code === null ? res() : rej(new Error(`unzip exited ${code}`)))));
}

async function readText(dir: string, src: { file: string; zip?: string }): Promise<string> {
  const plain = join(dir, src.file);
  if (existsSync(plain)) return readFileSync(plain, "utf8");
  if (src.zip && existsSync(join(dir, src.zip))) {
    const lines: string[] = [];
    await eachLine(join(dir, src.zip), src.file, (l) => lines.push(l));
    return lines.join("\n");
  }
  throw new Error(`Missing ${src.file} in ${dir}. Run with --download, or put the file there.`);
}

/** Arabic names and Wikipedia links, cached beside the dump as a small TSV so re-runs skip the big file. */
async function alternateNames(dir: string, keep: Set<number>, log: (s: string) => void) {
  const zip = join(dir, SOURCES.alternateNames.zip!);
  const txt = join(dir, SOURCES.alternateNames.file);
  const source = existsSync(txt) ? txt : existsSync(zip) ? zip : null;
  if (!source) return null;
  const cache = join(dir, "alternate-names-ar-links.tsv");
  const reader = makeAlternateNamesReader(keep);
  if (existsSync(cache) && statSync(cache).mtimeMs > statSync(source).mtimeMs) {
    await eachLine(cache, null, (l) => reader.line(l));
    return reader.result();
  }
  log(`Reading ${source} for Arabic names and Wikipedia links (a minute or two)`);
  const kept: string[] = [];
  await eachLine(source, source === zip ? SOURCES.alternateNames.file : null, (l) => {
    const t2 = l.indexOf("\t", l.indexOf("\t") + 1);
    const lang = l.slice(t2 + 1, l.indexOf("\t", t2 + 1));
    if (lang !== "ar" && lang !== "link") return;
    reader.line(l);
    // The cache keeps every ar/link line for a kept id; the reader decides what to use.
    if (keep.has(Number(l.slice(l.indexOf("\t") + 1, t2)))) kept.push(l);
  });
  writeFileSync(cache, kept.join("\n"));
  return reader.result();
}

export async function loadSources(opts: IngestOptions) {
  const log = opts.log ?? (() => {});
  mkdirSync(opts.dir, { recursive: true });
  if (opts.download) {
    // Downloads stay out of git wherever they land.
    if (!existsSync(join(opts.dir, ".gitignore"))) writeFileSync(join(opts.dir, ".gitignore"), "*\n");
    for (const src of Object.values(SOURCES)) {
      if (src === SOURCES.alternateNames && opts.altNames === false) continue;
      const target = join(opts.dir, "zip" in src ? src.zip : src.file);
      if (!existsSync(target) && !existsSync(join(opts.dir, src.file))) await download(src.url, target, log);
    }
  }
  const countries = parseCountries(await readText(opts.dir, SOURCES.countries));
  const admin1 = parseAdmin1(await readText(opts.dir, SOURCES.admin1));
  const cities = parseCities(await readText(opts.dir, SOURCES.cities), opts.minPopulation ?? 15_000);
  const airports = parseAirports(await readText(opts.dir, SOURCES.airports));
  const keep = new Set<number>([...cities.map((c) => c.id), ...[...countries.values()].map((c) => c.geonameId).filter((x): x is number => !!x)]);
  const alt = opts.altNames === false ? null : await alternateNames(opts.dir, keep, log);
  const built = buildPlaces({ cities, countries, admin1, airports, arabic: alt?.arabic, wiki: alt?.wiki });
  const countryAr = new Map<string, string>();
  for (const c of countries.values()) { const ar = c.geonameId ? alt?.arabic.get(c.geonameId)?.[0] : undefined; if (ar) countryAr.set(c.code, ar); }
  return { countries, countryAr, ...built, arabicCount: alt?.arabic.size ?? 0, wikiCount: alt?.wiki.size ?? 0 };
}

const chunks = <T>(xs: T[], n: number) => Array.from({ length: Math.ceil(xs.length / n) }, (_, i) => xs.slice(i * n, i * n + n));

export async function writePlaces(sql: Sql, data: Awaited<ReturnType<typeof loadSources>>, log: (s: string) => void = () => {}) {
  const usedCountries = new Set(data.places.map((p) => p.countryCode));
  await sql.begin(async (tx) => {
    const countries = [...data.countries.values()].filter((c) => usedCountries.has(c.code)).map((c) => ({
      code: c.code, name: c.name, name_ar: data.countryAr.get(c.code) ?? null, capital: c.capital || null, continent: c.continent || null, currency_code: c.currencyCode, currency_name: c.currencyName,
    }));
    for (const part of chunks(countries, 500)) {
      await tx`INSERT INTO app_place_countries ${tx(part)} ON CONFLICT (code) DO UPDATE SET name = excluded.name, name_ar = excluded.name_ar, capital = excluded.capital,
        continent = excluded.continent, currency_code = excluded.currency_code, currency_name = excluded.currency_name, updated_at = now()`;
    }
    log(`countries: ${countries.length}`);
    const placeRow = (p: PlaceRow) => ({
      id: p.id, slug: p.slug, name: p.name, name_ar: p.nameAr, region: p.region, country_code: p.countryCode, lat: p.lat, lon: p.lon, timezone: p.timezone,
      population: p.population, feature_code: p.featureCode, is_capital: p.isCapital, airports: JSON.stringify(p.airports), iata: p.iata, curation: p.curation,
      served: p.served, photo: p.photo, booking_key: p.bookingKey, wikipedia_title: p.wikipediaTitle,
    });
    for (const part of chunks(data.places, 1000)) {
      await tx`INSERT INTO app_places ${tx(part.map(placeRow))} ON CONFLICT (id) DO UPDATE SET slug = excluded.slug, name = excluded.name, name_ar = excluded.name_ar,
        region = excluded.region, country_code = excluded.country_code, lat = excluded.lat, lon = excluded.lon, timezone = excluded.timezone, population = excluded.population,
        feature_code = excluded.feature_code, is_capital = excluded.is_capital, airports = excluded.airports, iata = excluded.iata,
        curation = CASE WHEN app_places.curation = 'guide' AND excluded.curation = 'basic' THEN 'guide' ELSE excluded.curation END,
        served = excluded.served, photo = excluded.photo, booking_key = excluded.booking_key, wikipedia_title = COALESCE(excluded.wikipedia_title, app_places.wikipedia_title), updated_at = now()`;
    }
    log(`places: ${data.places.length}`);
    // Names are derived data: replaced wholesale for the cities in this load.
    for (const part of chunks(data.places.map((p) => p.id), 5000)) await tx`DELETE FROM app_place_names WHERE place_id = ANY(${part}::int[])`;
    const nameRow = (n: NameRow) => ({ place_id: n.placeId, kind: n.kind, name: n.name, norm: n.norm, label: n.label, rank: n.rank });
    for (const part of chunks(data.names, 2000)) {
      await tx`INSERT INTO app_place_names (place_id, kind, name, norm, label, rank)
        SELECT place_id, kind, name, app_places_norm(norm), label, rank FROM json_populate_recordset(null::app_place_names, ${JSON.stringify(part.map(nameRow))}::json)
        ON CONFLICT DO NOTHING`;
    }
    log(`names: ${data.names.length}`);
    const airportRow = (a: AirportRow) => ({ iata: a.iata, icao: a.icao, name: a.name, municipality: a.municipality, country_code: a.countryCode, lat: a.lat, lon: a.lon, size: a.size, city_id: a.cityId });
    for (const part of chunks(data.airports, 1000)) {
      await tx`INSERT INTO app_place_airports ${tx(part.map(airportRow))} ON CONFLICT (iata) DO UPDATE SET icao = excluded.icao, name = excluded.name,
        municipality = excluded.municipality, country_code = excluded.country_code, lat = excluded.lat, lon = excluded.lon, size = excluded.size, city_id = excluded.city_id, updated_at = now()`;
    }
    log(`airports: ${data.airports.length}`);
  });
}

export async function runIngest(opts: IngestOptions & { sql?: Sql }): Promise<IngestReport> {
  const started = Date.now();
  const log = opts.log ?? (() => {});
  const data = await loadSources(opts);
  if (!opts.dryRun) {
    if (!opts.sql) throw new Error("A database connection is needed unless this is a dry run");
    await writePlaces(opts.sql, data, log);
  }
  return {
    countries: new Set(data.places.map((p) => p.countryCode)).size, places: data.places.length, names: data.names.length, airports: data.airports.length,
    arabic: data.places.filter((p) => p.nameAr).length, wikipedia: data.places.filter((p) => p.wikipediaTitle).length, curated: data.places.filter((p) => p.curation === "curated").length,
    dryRun: !!opts.dryRun, ms: Date.now() - started,
  };
}
