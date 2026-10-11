/*
 * Things to do from open data, the reading part (no database, no server-only, so tests can pass a fake fetch and
 * recorded answers from test/app/fixtures/activities):
 *
 *  - OpenStreetMap through the Overpass API (ODbL): museums, viewpoints, theme parks, zoos, aquariums, parks and
 *    water parks, historic sites, and mosques notable enough to have a Wikidata item, around the city centre.
 *  - Wikidata (CC0): English and Arabic names and descriptions, the image (P18), how many Wikipedias have it
 *    (sitelinks) and its English Wikipedia title.
 *  - Wikipedia pageviews (Wikimedia REST API): how often people read about it, the last two full months.
 *  - Wikimedia Commons: the photo's author and licence (places/wiki.ts commonsImage; free licences only).
 *
 * Every request names us (User-Agent with PLACES_CONTACT), waits a bounded time, and a failure only leaves a part out.
 * Nothing is scraped: these are the documented public APIs, used within their usage policies (one city at a time,
 * results cached for 30 days).
 */
import { isFamily, isIndoor, kindOf, type ActivityKind, type OsmTags } from "@mada/shared";
import { placesUserAgent } from "../places/ingest";
import type { Fetch } from "../places/wiki";

export const OVERPASS_URL = process.env.OVERPASS_URL ?? "https://overpass-api.de/api/interpreter";

const headers = () => ({ Accept: "application/json", "User-Agent": placesUserAgent(), "Api-User-Agent": placesUserAgent() });

export async function getJson(f: Fetch, url: string, init: RequestInit = {}, timeoutMs = 8000): Promise<{ ok: true; data: unknown } | { ok: false; status: number }> {
  try {
    const res = await f(url, { ...init, headers: { ...headers(), ...(init.headers as Record<string, string> | undefined) }, signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return { ok: false, status: res.status };
    return { ok: true, data: await res.json() };
  } catch {
    return { ok: false, status: 0 };
  }
}

/** How far out from the centre we look: bigger cities spread further. */
export function radiusKmFor(population: number): number {
  return population >= 3_000_000 ? 22 : population >= 800_000 ? 14 : population >= 150_000 ? 9 : 6;
}

/** The Overpass QL for one city. Parks, historic sites and mosques only when notable (they have a Wikidata item). */
export function overpassQuery(lat: number, lon: number, radiusKm: number): string {
  const around = `(around:${Math.round(radiusKm * 1000)},${lat.toFixed(5)},${lon.toFixed(5)})`;
  return [
    "[out:json][timeout:50];",
    "(",
    `  nwr["tourism"~"^(attraction|museum|gallery|viewpoint|theme_park|zoo|aquarium)$"]["name"]${around};`,
    `  nwr["leisure"="water_park"]["name"]${around};`,
    `  nwr["leisure"~"^(park|garden)$"]["name"]["wikidata"]${around};`,
    `  nwr["historic"]["name"]["wikidata"]${around};`,
    `  nwr["amenity"="place_of_worship"]["religion"="muslim"]["name"]["wikidata"]${around};`,
    ");",
    "out center tags 600;",
  ].join("\n");
}

export type Candidate = {
  id: string; kind: ActivityKind; name: string; nameAr: string | null; lat: number; lon: number; tags: OsmTags; wikidata: string | null;
  wikipediaTitle: string | null; hours: string | null; indoor: boolean; family: boolean; free: boolean | null; website: string | null;
  address: string | null;
};

type OsmElement = { type: "node" | "way" | "relation"; id: number; lat?: number; lon?: number; center?: { lat: number; lon: number }; tags?: OsmTags };

const norm = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
/** OSM's addr:* tags as one line ("Great Russell St 44, London WC1B 3DG"), or addr:full when that's what's mapped. */
export function addressOf(tags: OsmTags): string | null {
  const full = tags["addr:full"]?.trim();
  if (full) return full.slice(0, 200);
  const street = [tags["addr:street"] ?? tags["addr:place"], tags["addr:housenumber"]].filter(Boolean).join(" ").trim();
  const town = [tags["addr:postcode"], tags["addr:city"]].filter(Boolean).join(" ").trim();
  const line = [street, tags["addr:suburb"] ?? tags["addr:district"], town].filter((x) => x && x.trim()).join(", ");
  return street && line ? line.slice(0, 200) : null;
}

const httpsUrl = (u: string | undefined) => (u && /^https?:\/\/[^\s]+$/.test(u) ? u.replace(/^http:/, "https:") : null);

/** Overpass JSON → the places we'd show, one per thing (a museum mapped as a node and a building counts once). */
export function parseOverpass(data: unknown): Candidate[] {
  const els = ((data as { elements?: OsmElement[] })?.elements ?? []);
  const byKey = new Map<string, Candidate>();
  for (const e of els) {
    const tags = e.tags ?? {};
    const name = (tags["name:en"] ?? tags.name ?? "").trim();
    if (!name || name.length > 120) continue;
    const kind = kindOf(tags);
    if (!kind) continue;
    const lat = e.lat ?? e.center?.lat;
    const lon = e.lon ?? e.center?.lon;
    if (lat == null || lon == null) continue;
    const wikidata = /^Q\d+$/.test(tags.wikidata ?? "") ? tags.wikidata! : null;
    const wp = /^en:(.+)$/.exec(tags.wikipedia ?? "")?.[1] ?? null;
    const c: Candidate = {
      id: `osm:${e.type[0]}${e.id}`, kind, name, nameAr: tags["name:ar"]?.trim() || (/[؀-ۿ]/.test(tags.name ?? "") && tags.name !== name ? tags.name! : null),
      lat, lon, tags, wikidata, wikipediaTitle: wp, hours: tags.opening_hours?.trim() || null, indoor: isIndoor(kind, tags), family: isFamily(kind, tags, name),
      free: tags.fee === "no" ? true : tags.fee === "yes" ? false : null, website: httpsUrl(tags.website ?? tags["contact:website"]), address: addressOf(tags),
    };
    // One per Wikidata item, else per name: keep the richer record (hours, a relation over a node).
    const key = wikidata ?? `n:${norm(name)}`;
    const prev = byKey.get(key);
    const richness = (x: Candidate) => (x.hours ? 2 : 0) + (x.wikidata ? 2 : 0) + (x.website ? 1 : 0) + (x.id.startsWith("osm:r") ? 1 : x.id.startsWith("osm:w") ? 0.5 : 0);
    if (!prev || richness(c) > richness(prev)) byKey.set(key, prev ? { ...c, nameAr: c.nameAr ?? prev.nameAr, hours: c.hours ?? prev.hours } : c);
  }
  return [...byKey.values()];
}

export async function fetchOverpass(f: Fetch, lat: number, lon: number, radiusKm: number): Promise<Candidate[] | "unavailable"> {
  const r = await getJson(f, OVERPASS_URL, { method: "POST", body: new URLSearchParams({ data: overpassQuery(lat, lon, radiusKm) }).toString(), headers: { "Content-Type": "application/x-www-form-urlencoded" } }, 60_000);
  if (!r.ok) return "unavailable";
  return parseOverpass(r.data);
}

/* ───────────── Wikidata ───────────── */

export type WikidataFacts = { labelEn: string | null; labelAr: string | null; descEn: string | null; descAr: string | null; image: string | null; sitelinks: number; enwiki: string | null };

type Entity = {
  labels?: Record<string, { value: string }>; descriptions?: Record<string, { value: string }>; sitelinks?: Record<string, { title: string }>;
  claims?: Record<string, { mainsnak?: { datavalue?: { value?: unknown } } }[]>;
};

export function parseWikidata(data: unknown): Map<string, WikidataFacts> {
  const out = new Map<string, WikidataFacts>();
  const ents = (data as { entities?: Record<string, Entity & { missing?: string }> })?.entities ?? {};
  for (const [qid, e] of Object.entries(ents)) {
    if (!e || "missing" in e) continue;
    const p18 = e.claims?.P18?.[0]?.mainsnak?.datavalue?.value;
    const sitelinks = Object.keys(e.sitelinks ?? {}).filter((k) => k.endsWith("wiki") && k !== "commonswiki" && k !== "specieswiki").length;
    out.set(qid, {
      labelEn: e.labels?.en?.value ?? null, labelAr: e.labels?.ar?.value ?? null,
      descEn: e.descriptions?.en?.value ?? null, descAr: e.descriptions?.ar?.value ?? null,
      image: typeof p18 === "string" ? p18 : null, sitelinks, enwiki: e.sitelinks?.enwiki?.title ?? null,
    });
  }
  return out;
}

export async function fetchWikidata(f: Fetch, ids: string[]): Promise<Map<string, WikidataFacts> | "unavailable"> {
  const all = new Map<string, WikidataFacts>();
  for (let i = 0; i < ids.length; i += 50) {
    const batch = ids.slice(i, i + 50).filter((q) => /^Q\d+$/.test(q));
    if (!batch.length) continue;
    const r = await getJson(f, `https://www.wikidata.org/w/api.php?action=wbgetentities&format=json&props=labels%7Cdescriptions%7Csitelinks%7Cclaims&languages=en%7Car&ids=${batch.join("%7C")}`);
    if (!r.ok) return "unavailable";
    parseWikidata(r.data).forEach((v, k) => all.set(k, v));
  }
  return all;
}

/* ───────────── Wikipedia pageviews ───────────── */

/** The two full months before `now`, as the pageviews API wants them (YYYYMMDD00). */
export function pageviewWindow(now: Date): { start: string; end: string } {
  const y = now.getUTCFullYear();
  const m = now.getUTCMonth();
  const start = new Date(Date.UTC(y, m - 2, 1));
  const end = new Date(Date.UTC(y, m, 0));
  const f = (d: Date) => `${d.getUTCFullYear()}${String(d.getUTCMonth() + 1).padStart(2, "0")}${String(d.getUTCDate()).padStart(2, "0")}00`;
  return { start: f(start), end: f(end) };
}

export function parsePageviews(data: unknown): number {
  const items = (data as { items?: { views?: number }[] })?.items ?? [];
  return items.reduce((n, x) => n + (typeof x.views === "number" ? x.views : 0), 0);
}

export async function fetchPageviews(f: Fetch, title: string, now: Date): Promise<number | null> {
  const w = pageviewWindow(now);
  const t = encodeURIComponent(title.replace(/ /g, "_"));
  const r = await getJson(f, `https://wikimedia.org/api/rest_v1/metrics/pageviews/per-article/en.wikipedia/all-access/user/${t}/monthly/${w.start}/${w.end}`, {}, 5000);
  if (!r.ok) return r.status === 404 ? 0 : null;
  return parsePageviews(r.data);
}
