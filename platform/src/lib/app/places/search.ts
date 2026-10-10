import "server-only";
import { sql } from "drizzle-orm";
import { normPlace, type PlaceHit, type PlaceSearchResponse } from "@mada/shared";
import { db } from "@/db";
import type { NearAirportJson } from "@/db/app-schema-places";

/*
 * City search for the typeahead: prefix first ("tbi" → Tbilisi), then words inside names ("heathrow"), then fuzzy
 * (pg_trgm: "tbilsi", "istambul"), across English, other Latin spellings, Arabic and airport names, and airport codes
 * ("IST"). Ranked by how well the name matched, then by size, then whether we sell it. Accents never matter
 * (normPlace in the app and server, unaccent in the database).
 */

export type PlaceRowSql = {
  id: number; slug: string; name: string; name_ar: string | null; region: string | null; country_code: string; country: string; lat: number; lon: number;
  timezone: string; population: string | number; airports: NearAirportJson[]; iata: string | null; curation: string; served: boolean; photo: string | null;
  booking_key: string | null; wikipedia_title: string | null; currency_code: string | null; currency_name: string | null;
};

type HitRow = PlaceRowSql & { match_kind: string | null; match_name: string | null; match_label: string | null };

export function hitOf(r: HitRow): PlaceHit {
  const kind = r.match_kind;
  const matched = !kind || kind === "name" || kind === "ascii" || kind === "country" ? null
    : kind === "iata" ? { kind: "code" as const, label: r.match_label ?? r.match_name ?? "" }
      : kind === "airport" ? { kind: "airport" as const, label: r.match_label ?? r.match_name ?? "" }
        : kind === "ar" ? { kind: "arabic" as const, label: r.match_name ?? "" }
          : normPlace(r.match_name ?? "") === normPlace(r.name) ? null : { kind: "alt" as const, label: r.match_name ?? "" };
  return {
    id: String(r.id), name: r.name, nameAr: r.name_ar, region: r.region, country: r.country, countryCode: r.country_code, population: Number(r.population),
    served: r.served, curation: r.curation as PlaceHit["curation"], photo: r.photo, iata: r.iata, matched, timezone: r.timezone,
  };
}

const rows = async <T>(q: ReturnType<typeof sql>) => (await db.execute(q)) as unknown as T[];

/** Size and what we know about a city, as a score added to how well its name matched. */
const RANK = sql`0.06 * log(greatest(p.population, 1000)) + CASE WHEN p.served THEN 0.12 ELSE 0 END + CASE p.curation WHEN 'curated' THEN 0.08 WHEN 'guide' THEN 0.02 ELSE 0 END`;

export async function searchPlaces(input: string, limit = 8): Promise<PlaceSearchResponse> {
  const query = input.trim().slice(0, 80);
  const q = normPlace(query);
  if (!q) return { query, results: [], suggestions: [] };
  const short = q.length < 3;
  const results = await rows<HitRow & { score: number }>(sql`
    WITH q AS (SELECT app_places_norm(${q}) AS q),
    m AS (
      SELECT n.place_id, n.kind, n.name, n.label,
        (CASE
          WHEN n.kind = 'iata' THEN CASE WHEN n.norm = q.q THEN 1.2 ELSE 0 END
          WHEN n.norm = q.q THEN 1.0
          WHEN n.norm LIKE q.q || '%' THEN 0.9 - least(0.15, (length(n.norm) - length(q.q)) * 0.005)
          WHEN n.norm LIKE '% ' || q.q || '%' THEN 0.72
          ELSE similarity(n.norm, q.q) * 0.85
        END) * (CASE n.kind WHEN 'alt' THEN 0.92 WHEN 'airport' THEN 0.9 WHEN 'country' THEN 0.95 ELSE 1 END) AS s
      FROM app_place_names n, q
      WHERE (n.kind = 'iata' AND n.norm = q.q)
         OR (n.kind <> 'iata' AND n.norm LIKE q.q || '%' AND (${!short}::boolean OR n.kind IN ('name', 'ascii', 'ar')))
         OR (${!short}::boolean AND n.kind <> 'iata' AND (n.norm LIKE '% ' || q.q || '%' OR n.norm % q.q))
    ),
    best AS (SELECT DISTINCT ON (place_id) place_id, kind, name, label, s FROM m WHERE s > 0 ORDER BY place_id, s DESC, kind)
    SELECT p.*, c.name AS country, b.kind AS match_kind, b.name AS match_name, b.label AS match_label, b.s + ${RANK} AS score
    FROM best b JOIN app_places p ON p.id = b.place_id JOIN app_place_countries c ON c.code = p.country_code
    ORDER BY score DESC, p.population DESC LIMIT ${limit}`);
  if (results.length) return { query, results: results.map(hitOf), suggestions: [] };
  return { query, results: [], suggestions: await closest(q) };
}

/**
 * Nothing matched: the closest names we know, biggest first. Short queries match the letters in order
 * ("sd" → Sydney, San Diego); longer ones by trigram similarity on a lower bar.
 */
async function closest(q: string): Promise<PlaceHit[]> {
  const letters = [...q.replace(/\s+/g, "")];
  const pattern = letters.map((c) => c.replace(/[%_\\]/g, (x) => `\\${x}`)).join("%") + "%";
  const found = await rows<HitRow>(sql`
    WITH c AS (
      SELECT DISTINCT ON (n.place_id) n.place_id, greatest(similarity(n.norm, app_places_norm(${q})), CASE WHEN n.norm LIKE ${pattern} THEN 0.3 ELSE 0 END) AS s
      FROM app_place_names n
      WHERE n.kind IN ('name', 'ascii') AND (n.norm LIKE ${pattern} OR similarity(n.norm, app_places_norm(${q})) > 0.15)
      ORDER BY n.place_id, 2 DESC
    )
    SELECT p.*, co.name AS country, NULL AS match_kind, NULL AS match_name, NULL AS match_label
    FROM c JOIN app_places p ON p.id = c.place_id JOIN app_place_countries co ON co.code = p.country_code
    WHERE p.population >= 500000 OR p.curation <> 'basic'
    ORDER BY c.s + ${RANK} DESC LIMIT 3`);
  return found.map(hitOf);
}

/** A city by GeoNames id, or by slug ("tbilisi", "Al Ula"): the best-known city of that name. */
export async function findPlace(idOrSlug: string): Promise<PlaceRowSql | null> {
  const base = sql`SELECT p.*, c.name AS country, c.currency_code, c.currency_name FROM app_places p JOIN app_place_countries c ON c.code = p.country_code`;
  if (/^\d{1,10}$/.test(idOrSlug)) {
    const [r] = await rows<PlaceRowSql>(sql`${base} WHERE p.id = ${Number(idOrSlug)}`);
    return r ?? null;
  }
  const slug = normPlace(idOrSlug).replace(/ /g, "-");
  if (!slug) return null;
  const [bySlug] = await rows<PlaceRowSql>(sql`${base} WHERE p.slug = ${slug} ORDER BY (p.curation = 'curated') DESC, p.population DESC LIMIT 1`);
  if (bySlug) return bySlug;
  // A name the slug doesn't cover ("Mecca", "Tiflis"): the top search result, only if it's an exact name.
  const [hit] = (await searchPlaces(idOrSlug, 1)).results;
  if (!hit) return null;
  const exact = await rows<{ ok: number }>(sql`SELECT 1 AS ok FROM app_place_names WHERE place_id = ${Number(hit.id)} AND norm = app_places_norm(${normPlace(idOrSlug)}) LIMIT 1`);
  if (!exact.length) return null;
  const [r] = await rows<PlaceRowSql>(sql`${base} WHERE p.id = ${Number(hit.id)}`);
  return r ?? null;
}

export async function placeHitById(id: number): Promise<PlaceHit | null> {
  const [r] = await rows<HitRow>(sql`SELECT p.*, c.name AS country, NULL AS match_kind, NULL AS match_name, NULL AS match_label FROM app_places p JOIN app_place_countries c ON c.code = p.country_code WHERE p.id = ${id}`);
  return r ? hitOf(r) : null;
}

/** Where people go from here: our cities first (in the order we chose), then the places people ask us for most. */
export async function popularPlaces(from: string, order: number[]): Promise<PlaceHit[]> {
  const curated = await rows<HitRow>(sql`
    SELECT p.*, c.name AS country, NULL AS match_kind, NULL AS match_name, NULL AS match_label
    FROM app_places p JOIN app_place_countries c ON c.code = p.country_code
    WHERE p.curation = 'curated' AND p.iata IS DISTINCT FROM ${from}`);
  const asked = await rows<HitRow>(sql`
    SELECT p.*, c.name AS country, NULL AS match_kind, NULL AS match_name, NULL AS match_label
    FROM (SELECT place_id, count(*) AS n FROM app_place_plans WHERE created_at > now() - interval '90 days' GROUP BY place_id) x
    JOIN app_places p ON p.id = x.place_id JOIN app_place_countries c ON c.code = p.country_code
    WHERE p.curation <> 'curated' AND p.iata IS DISTINCT FROM ${from}
    ORDER BY x.n DESC, p.population DESC LIMIT 4`);
  const pos = (id: number) => { const i = order.indexOf(id); return i < 0 ? 999 : i; };
  return [...curated.sort((a, b) => pos(a.id) - pos(b.id)), ...asked].map(hitOf);
}
