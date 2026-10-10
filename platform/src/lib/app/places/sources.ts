/*
 * Reading the open datasets behind Places, without touching a database (the ingestion script and its tests use it):
 *  - GeoNames cities15000.txt, countryInfo.txt, admin1CodesASCII.txt and, optionally, alternateNamesV2.txt
 *    (CC BY 4.0, https://www.geonames.org) for cities, countries, regions, Arabic names and Wikipedia links;
 *  - OurAirports airports.csv (public domain, https://ourairports.com/data/) for airports and their IATA codes.
 * Everything here is pure: text in, rows out. See README.md for licences and attribution.
 */
import { normPlace } from "@mada/shared";
import { COUNTRY_NAME_OVERRIDES, curatedById } from "./curated";

export type Country = { code: string; name: string; capital: string; currencyCode: string | null; currencyName: string | null; continent: string; geonameId: number | null };
export type City = {
  id: number; name: string; ascii: string; alternates: string[]; lat: number; lon: number; featureCode: string;
  countryCode: string; admin1: string; population: number; timezone: string;
};
export type Airport = {
  iata: string; icao: string | null; name: string; municipality: string | null; countryCode: string; lat: number; lon: number;
  size: "large" | "medium"; scheduled: boolean; wikipedia: string | null;
};
export type NearAirport = { iata: string; name: string; km: number; size: "large" | "medium" };
export type NameKind = "name" | "ascii" | "alt" | "ar" | "iata" | "airport" | "country";
export type NameRow = { placeId: number; name: string; norm: string; kind: NameKind; label: string | null; rank: number };
export type PlaceRow = {
  id: number; slug: string; name: string; nameAr: string | null; region: string | null; countryCode: string; lat: number; lon: number;
  timezone: string; population: number; featureCode: string; isCapital: boolean; airports: NearAirport[]; iata: string | null;
  curation: "curated" | "guide" | "basic"; served: boolean; photo: string | null; bookingKey: string | null; wikipediaTitle: string | null;
};
export type AirportRow = Airport & { cityId: number | null };

const tsvRows = (text: string) => text.split(/\r?\n/).filter((l) => l && !l.startsWith("#")).map((l) => l.split("\t"));

export function parseCountries(text: string): Map<string, Country> {
  const out = new Map<string, Country>();
  for (const f of tsvRows(text)) {
    if (f.length < 17 || !/^[A-Z]{2}$/.test(f[0]!)) continue;
    const code = f[0]!;
    out.set(code, {
      code, name: COUNTRY_NAME_OVERRIDES[code] ?? f[4]!, capital: f[5] ?? "", continent: f[8] ?? "",
      currencyCode: /^[A-Z]{3}$/.test(f[10] ?? "") ? f[10]! : null, currencyName: f[11] || null, geonameId: Number(f[16]) || null,
    });
  }
  return out;
}

export function parseAdmin1(text: string): Map<string, string> {
  const out = new Map<string, string>();
  for (const f of tsvRows(text)) if (f[0] && f[1]) out.set(f[0], f[1]);
  return out;
}

/** cities15000.txt: populated places with 15,000 people or more, plus capitals. */
export function parseCities(text: string, minPopulation = 15_000): City[] {
  const out: City[] = [];
  for (const f of tsvRows(text)) {
    if (f.length < 19) continue;
    const population = Number(f[14]) || 0;
    const featureCode = f[7] ?? "";
    if (population < minPopulation && featureCode !== "PPLC") continue;
    const lat = Number(f[4]);
    const lon = Number(f[5]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || !f[17]) continue;
    out.push({
      id: Number(f[0]), name: f[1]!, ascii: f[2]!, alternates: f[3] ? f[3].split(",") : [], lat, lon, featureCode,
      countryCode: f[8]!, admin1: f[10] ?? "", population, timezone: f[17]!,
    });
  }
  return out;
}

/** RFC 4180 CSV (quoted fields, doubled quotes), enough for OurAirports. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') { if (text[i + 1] === '"') { field += '"'; i++; } else quoted = false; } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === ",") { row.push(field); field = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(field); field = "";
      if (row.length > 1 || row[0]) rows.push(row);
      row = [];
    } else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  return rows;
}

/** Large and medium airports with an IATA code and scheduled passenger flights. */
export function parseAirports(text: string): Airport[] {
  const [head, ...rows] = parseCsv(text);
  if (!head) return [];
  const col = (n: string) => head.indexOf(n);
  const I = { type: col("type"), name: col("name"), lat: col("latitude_deg"), lon: col("longitude_deg"), country: col("iso_country"), muni: col("municipality"), sched: col("scheduled_service"), icao: col("icao_code"), gps: col("gps_code"), iata: col("iata_code"), wiki: col("wikipedia_link") };
  const out: Airport[] = [];
  for (const r of rows) {
    const type = r[I.type];
    const iata = (r[I.iata] ?? "").trim().toUpperCase();
    if ((type !== "large_airport" && type !== "medium_airport") || !/^[A-Z]{3}$/.test(iata)) continue;
    const scheduled = r[I.sched] === "yes";
    if (!scheduled) continue;
    const lat = Number(r[I.lat]);
    const lon = Number(r[I.lon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    out.push({
      iata, icao: (r[I.icao] || r[I.gps] || "").trim() || null, name: r[I.name]!.trim(), municipality: r[I.muni]?.trim() || null, countryCode: r[I.country]!,
      lat, lon, size: type === "large_airport" ? "large" : "medium", scheduled, wikipedia: r[I.wiki]?.trim() || null,
    });
  }
  // One row per code (a handful of codes appear twice in the source): keep the larger, scheduled one.
  const best = new Map<string, Airport>();
  for (const a of out) {
    const b = best.get(a.iata);
    if (!b || (a.size === "large" && b.size !== "large") || (a.size === b.size && a.scheduled && !b.scheduled)) best.set(a.iata, a);
  }
  return [...best.values()];
}

/**
 * alternateNamesV2.txt, one line at a time: Arabic names (isolanguage "ar") and English Wikipedia links ("link")
 * for the ids we keep. Columns: id, geonameid, isolanguage, name, isPreferred, isShort, isColloquial, isHistoric, from, to.
 */
export function makeAlternateNamesReader(keep: Set<number>) {
  const ar = new Map<number, { name: string; score: number }[]>();
  const wiki = new Map<number, string[]>();
  return {
    line(l: string) {
      const tab1 = l.indexOf("\t");
      const tab2 = l.indexOf("\t", tab1 + 1);
      const tab3 = l.indexOf("\t", tab2 + 1);
      if (tab3 < 0) return;
      const lang = l.slice(tab2 + 1, tab3);
      if (lang !== "ar" && lang !== "link") return;
      const id = Number(l.slice(tab1 + 1, tab2));
      if (!keep.has(id)) return;
      const f = l.split("\t");
      const name = f[3] ?? "";
      if (lang === "link") {
        const m = /^https?:\/\/en\.wikipedia\.org\/wiki\/(.+)$/.exec(name);
        if (m) { let title = m[1]!; try { title = decodeURIComponent(title); } catch { /* keep as is */ } wiki.set(id, [...(wiki.get(id) ?? []), title.replace(/_/g, " ")]); }
        return;
      }
      if (f[6] === "1" || f[7] === "1" || !/\p{Script=Arabic}/u.test(name)) return; // colloquial, historic, or not Arabic script
      const list = ar.get(id) ?? [];
      list.push({ name: name.trim(), score: (f[4] === "1" ? 2 : 0) + (f[5] === "1" ? 1 : 0) });
      ar.set(id, list);
    },
    result() {
      const arabic = new Map<number, string[]>();
      for (const [id, list] of ar) arabic.set(id, [...new Set(list.sort((a, b) => b.score - a.score).map((x) => x.name))].slice(0, 4));
      return { arabic, wiki };
    },
  };
}

/* ───────────── geography ───────────── */

export function km(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Points bucketed by whole degrees, for "what's within N km" without comparing everything with everything. */
function grid<T extends { lat: number; lon: number }>(items: T[]) {
  const cells = new Map<string, T[]>();
  for (const it of items) {
    const k = `${Math.floor(it.lat)}:${Math.floor(it.lon)}`;
    const c = cells.get(k);
    if (c) c.push(it); else cells.set(k, [it]);
  }
  return (lat: number, lon: number, radiusKm: number): { item: T; km: number }[] => {
    const dLat = Math.ceil(radiusKm / 111) + 0;
    const dLon = Math.min(180, Math.ceil(radiusKm / (111 * Math.max(0.05, Math.cos((lat * Math.PI) / 180)))));
    const out: { item: T; km: number }[] = [];
    const la = Math.floor(lat);
    const lo = Math.floor(lon);
    for (let i = la - dLat; i <= la + dLat; i++) {
      for (let j = lo - dLon; j <= lo + dLon; j++) {
        const jj = ((j + 180) % 360 + 360) % 360 - 180;
        for (const it of cells.get(`${i}:${jj}`) ?? []) {
          const d = km(lat, lon, it.lat, it.lon);
          if (d <= radiusKm) out.push({ item: it, km: d });
        }
      }
    }
    return out.sort((a, b) => a.km - b.km);
  };
}

/** "London Heathrow Airport" → "Heathrow"; falls back to the full name when nothing distinctive is left. */
export function airportShortName(name: string, city: string): string {
  const cityNorm = normPlace(city);
  const s = name.replace(/\b(International|Intl\.?|Airport|Aeroporto|Aéroport|Aeropuerto|Flughafen|Havalimanı|Regional|Airfield)\b/gi, " ")
    .split(/\s+/).filter((w) => w && normPlace(w) !== cityNorm).join(" ").replace(/^[-–,\s]+|[-–,\s]+$/g, "").trim();
  if (s.length < 3) return name;
  // "City", "North": too plain on its own, so the city stays in ("London City").
  if (!s.includes(" ") && (s.length <= 4 || /^(City|Central|North|South|East|West|Intercontinental)$/i.test(s))) return name.replace(/\s*\b(International|Airport)\b/gi, "").trim() || name;
  return s;
}

/**
 * The main airport of cities with several, when distance alone picks the wrong one (Ciampino is nearer Rome than
 * Fiumicino). Listed first for any city within reach of them.
 */
export const HUBS = new Set([
  "IST", "FCO", "CDG", "JFK", "MXP", "HND", "SVO", "BKK", "IAD", "ORD", "GRU", "EZE", "ICN", "PVG", "PEK", "KIX", "ARN", "BER", "CGK", "KUL", "DXB",
  "IKA", "YUL", "YYZ", "IAH", "GIG", "TPE", "MNL", "BOM", "DEL", "CAI", "RUH", "LHR", "MAD", "BCN", "FRA", "MUC", "AMS", "ZRH", "VIE", "ATH", "DOH",
  "AUH", "KWI", "BAH", "MCT", "AMM", "BEY", "TBS", "GYD", "EVN", "TAS", "ALA", "NQZ", "SAW", "LAX", "SFO", "MIA", "DFW", "ATL", "SEA", "BOS", "YVR",
  "SYD", "MEL", "AKL", "SIN", "HKG", "NRT", "CMB", "MLE", "DPS", "KHI", "LHE", "ISB", "DAC", "KTM", "JNB", "CPT", "NBO", "ADD", "CMN", "TUN", "ALG",
  "LOS", "ACC", "DKR", "MEX", "BOG", "LIM", "SCL", "PTY", "HAN", "SGN", "PNH", "RGN", "LIS", "OPO", "DUB", "CPH", "OSL", "HEL", "WAW", "PRG", "BUD",
  "OTP", "SOF", "BEG", "ZAG", "LJU", "SKP", "TIA", "KBP", "LED", "MSQ", "RIX", "VNO", "TLL", "JED", "MED", "DMM", "AHB", "ULH", "BRU", "GVA", "NCE",
  "MAN", "EDI", "MLA", "LCA", "SSH", "HRG", "RAK", "SAH", "BGW", "EBL", "KBL", "DYU", "FRU", "ASB", "TSE",
]);

const LATIN = /^[\p{Script=Latin}\p{M}\s'’.\-()]+$/u;

/** Turns parsed sources into rows: places, the names search matches, and airports linked to their city. */
export function buildPlaces(input: {
  cities: City[]; countries: Map<string, Country>; admin1: Map<string, string>; airports: Airport[];
  arabic?: Map<number, string[]>; wiki?: Map<number, string[]>;
}): { places: PlaceRow[]; names: NameRow[]; airports: AirportRow[] } {
  const { cities, countries, admin1, airports } = input;
  const arabic = input.arabic ?? new Map<number, string[]>();
  const wiki = input.wiki ?? new Map<number, string[]>();
  // A city can carry several Wikipedia links (Istanbul also links "Constantinople"): the one named like the city wins.
  const wikiTitle = (c: City, name: string) => {
    const all = wiki.get(c.id) ?? [];
    const want = new Set([normPlace(name), normPlace(c.name), normPlace(c.ascii)]);
    return all.find((t) => want.has(normPlace(t))) ?? all.find((t) => [...want].some((w) => normPlace(t).startsWith(w))) ?? all[0] ?? null;
  };
  const nearAirports = grid(airports);
  const nearCities = grid(cities);

  // Each airport belongs to one city: the one its municipality names (within 100 km), else the biggest city within
  // 30 km, else the nearest within 100 km.
  const airportRows: AirportRow[] = airports.map((a) => {
    const around = nearCities(a.lat, a.lon, 100);
    const muni = a.municipality ? normPlace(a.municipality) : null;
    const byName = muni ? around.filter((c) => c.item.countryCode === a.countryCode && (normPlace(c.item.name) === muni || normPlace(c.item.ascii) === muni)).sort((x, y) => y.item.population - x.item.population)[0] : undefined;
    const big = around.filter((c) => c.km <= 30).sort((x, y) => y.item.population - x.item.population)[0];
    const city = byName ?? big ?? around[0];
    return { ...a, cityId: city?.item.id ?? null };
  });
  const servesCity = new Map<number, AirportRow[]>();
  for (const a of airportRows) if (a.cityId) servesCity.set(a.cityId, [...(servesCity.get(a.cityId) ?? []), a]);

  const places: PlaceRow[] = [];
  const names: NameRow[] = [];
  for (const c of cities) {
    const country = countries.get(c.countryCode);
    if (!country) continue;
    const cur = curatedById.get(c.id);
    const name = cur?.name ?? c.name;
    // Airports within 150 km: the ones linked to this city first, then large before medium, then by distance.
    const linked = new Set((servesCity.get(c.id) ?? []).map((a) => a.iata));
    // Across a border only when it's close (Basel–Mulhouse), never the next country's capital.
    const score = (x: { item: Airport; km: number }) => (x.item.iata === cur?.airport ? 1000 : 0) + (linked.has(x.item.iata) ? 100 : 0) + (HUBS.has(x.item.iata) && x.km <= 80 ? 10 : 0) + (x.item.size === "large" ? 1 : 0);
    const near = nearAirports(c.lat, c.lon, 150)
      .filter((x) => x.item.countryCode === c.countryCode || x.km <= 80)
      .sort((x, y) => score(y) - score(x) || x.km - y.km)
      .slice(0, 3)
      .map((x) => ({ iata: x.item.iata, name: x.item.name, km: Math.round(x.km), size: x.item.size }));
    if (cur?.airport && !near.some((a) => a.iata === cur.airport)) {
      const a = airports.find((x) => x.iata === cur.airport);
      if (a) near.unshift({ iata: a.iata, name: a.name, km: Math.round(km(c.lat, c.lon, a.lat, a.lon)), size: a.size });
    }
    const ar = arabic.get(c.id) ?? [];
    places.push({
      id: c.id, slug: cur?.slug ?? normPlace(name).replace(/ /g, "-"), name, nameAr: ar[0] ?? null,
      region: admin1.get(`${c.countryCode}.${c.admin1}`) ?? null, countryCode: c.countryCode, lat: c.lat, lon: c.lon, timezone: c.timezone,
      population: c.population, featureCode: c.featureCode, isCapital: c.featureCode === "PPLC", airports: near.slice(0, 3), iata: near[0]?.iata ?? null,
      curation: cur ? "curated" : "basic", served: !!cur?.served, photo: cur?.photo ?? null, bookingKey: cur?.bookingKey ?? null, wikipediaTitle: wikiTitle(c, name),
    });

    const seen = new Set<string>();
    const add = (n: string, kind: NameKind, label: string | null = null, rank = 0) => {
      const norm = normPlace(n);
      if (!norm || seen.has(`${kind}:${norm}`)) return;
      if (kind !== "iata" && kind !== "airport" && seen.has(`name:${norm}`)) return;
      seen.add(`${kind}:${norm}`);
      names.push({ placeId: c.id, name: n, norm, kind, label, rank });
    };
    add(name, "name");
    add(c.name, "name");
    add(c.ascii, "ascii");
    for (const a of cur?.aliases ?? []) add(a, /\p{Script=Arabic}/u.test(a) ? "ar" : "alt");
    ar.forEach((n, i) => add(n, "ar", null, i));
    // A country finds its capital ("Japan" → Tokyo).
    if (c.featureCode === "PPLC") add(country.name, "country");
    // Other spellings in Latin script ("Tiflis", "Mecca"); codes and very long forms left out.
    let alts = 0;
    for (const a of c.alternates) {
      if (alts >= 25) break;
      const t = a.trim();
      if (t.length < 3 || t.length > 40 || !LATIN.test(t) || /^[A-Z0-9]{2,4}$/.test(t)) continue;
      const before = names.length;
      add(t, "alt");
      if (names.length > before) alts++;
    }
    // Its own airports, and the one it flies from when that belongs to a neighbour ("JED" finds Makkah too). A code
    // never finds every town around a hub ("LHR" is London, not Luton).
    const own = [...(servesCity.get(c.id) ?? []).map((a) => ({ iata: a.iata, name: a.name })), ...near.slice(0, 1).filter((a) => a.km <= 60 || a.iata === cur?.airport)];
    for (const a of own) {
      add(a.iata, "iata", `${airportShortName(a.name, c.name)} (${a.iata})`);
      add(a.name, "airport", `${airportShortName(a.name, c.name)} (${a.iata})`);
    }
  }
  return { places, names, airports: airportRows };
}
