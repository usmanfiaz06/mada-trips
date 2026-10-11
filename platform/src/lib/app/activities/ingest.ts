import { and, asc, desc, eq, isNull, lt, or, sql } from "drizzle-orm";
import { popularityOf, rawScore, type PlaceImage } from "@mada/shared";
import { db } from "@/db";
import { appActivities, appActivityCities } from "@/db/app-schema-activities";
import { appPlaces } from "@/db/app-schema-places";
import { commonsImage, type Fetch } from "../places/wiki";
import { fetchOverpass, fetchPageviews, fetchWikidata, radiusKmFor, type Candidate, type WikidataFacts } from "./opendata";

/*
 * Loads one city's things to do from open data into app_activities (replacing the last load in one transaction), and
 * the scheduled refresh that walks the cities due (scripts/activities/refresh.ts, or GET /cron/activities daily).
 * Fresh for 30 days; a city whose sources didn't answer is tried again the next day. A refresh that finds less than
 * half of what we had keeps the old list (a flaky Overpass mirror never empties a city).
 */

export const ACTIVITIES_TTL_MS = 30 * 86_400_000;
const RETRY_MS = 86_400_000;
const LOCK_MS = 10 * 60_000;
const KEEP = 120;
const PAGEVIEWS_FOR = 40;
const IMAGES_FOR = 30;

export type CityRow = { id: number; name: string; lat: number; lon: number; population: number };
export type Gathered = { rows: (typeof appActivities.$inferInsert)[]; status: "ok" | "partial" | "none"; problem: string | null };

/** Everything for one city, read from the open sources. No database writes. */
export async function gatherCity(city: CityRow, f: Fetch, now = new Date()): Promise<Gathered> {
  const found = await fetchOverpass(f, city.lat, city.lon, radiusKmFor(city.population));
  if (found === "unavailable") return { rows: [], status: "none", problem: "OpenStreetMap (Overpass) did not answer" };
  let partial = false;
  const qids = [...new Set(found.map((c) => c.wikidata).filter((q): q is string => !!q))].slice(0, 250);
  const wd = qids.length ? await fetchWikidata(f, qids) : new Map<string, WikidataFacts>();
  const facts = wd === "unavailable" ? (partial = true, new Map<string, WikidataFacts>()) : wd;

  type Scored = Candidate & { w: WikidataFacts | null; pageviews: number; image: PlaceImage | null; score: number };
  const scored: Scored[] = found.map((c) => ({ ...c, w: c.wikidata ? facts.get(c.wikidata) ?? null : null, pageviews: 0, image: null, score: 0 }));
  // Untitled, unknown and unnamed in English: an OSM "attraction" with no Wikidata item is often a bench or a statue.
  const keep = scored.filter((c) => c.w || c.kind !== "attraction" || c.tags.website || c.hours);
  const pre = (c: Scored) => rawScore({ pageviews: 0, sitelinks: c.w?.sitelinks ?? 0, hasImage: !!c.w?.image, hasWikidata: !!c.wikidata, kind: c.kind });
  keep.sort((a, b) => pre(b) - pre(a));

  for (const c of keep.slice(0, PAGEVIEWS_FOR)) {
    const title = c.wikipediaTitle ?? c.w?.enwiki ?? null;
    if (!title) continue;
    const v = await fetchPageviews(f, title, now);
    if (v === null) partial = true;
    c.pageviews = v ?? 0;
    c.wikipediaTitle = title;
  }
  for (const c of keep) {
    c.score = rawScore({ pageviews: c.pageviews, sitelinks: c.w?.sitelinks ?? 0, hasImage: !!c.w?.image, hasWikidata: !!c.wikidata, kind: c.kind });
    if (!c.wikipediaTitle && c.w?.enwiki) c.wikipediaTitle = c.w.enwiki;
  }
  keep.sort((a, b) => b.score - a.score);
  const top = keep.slice(0, KEEP);
  for (const c of top.slice(0, IMAGES_FOR)) if (c.w?.image) c.image = await commonsImage(f, c.w.image);
  const pop = popularityOf(top.map((c) => c.score));
  const rows = top.map((c, i) => ({
    id: c.id, placeId: city.id, kind: c.kind, name: c.w?.labelEn && c.name === c.tags.name && /[^\x20-\x7E]/.test(c.name) ? c.w.labelEn : c.name,
    nameAr: c.nameAr ?? c.w?.labelAr ?? null, lat: c.lat, lon: c.lon, wikidata: c.wikidata, wikipediaTitle: c.wikipediaTitle,
    summary: c.w?.descEn ?? null, summaryAr: c.w?.descAr ?? null, image: c.image as unknown as Record<string, unknown> | null, hours: c.hours, indoor: c.indoor,
    family: c.family, free: c.free, website: c.website, address: c.address ?? null, sitelinks: c.w?.sitelinks ?? 0, pageviews: c.pageviews, score: c.score, popularity: pop[i]!, updatedAt: now,
  }));
  return { rows, status: rows.length ? (partial ? "partial" : "ok") : "none", problem: partial ? "Wikidata or pageviews did not answer" : null };
}

/** Replace the city's list (unless the new one is much thinner) and note when to look again. */
export async function storeCity(placeId: number, g: Gathered, now = new Date()): Promise<{ stored: number; kept: boolean }> {
  return db.transaction(async (tx) => {
    const [{ n }] = await tx.select({ n: sql<number>`count(*)::int` }).from(appActivities).where(eq(appActivities.placeId, placeId)) as [{ n: number }];
    const thinner = g.rows.length < n / 2;
    if (!thinner) {
      await tx.delete(appActivities).where(eq(appActivities.placeId, placeId));
      if (g.rows.length) await tx.insert(appActivities).values(g.rows);
    }
    const ttl = g.status === "ok" && !thinner ? ACTIVITIES_TTL_MS : RETRY_MS;
    const values = { status: thinner && n ? "partial" : g.status, count: thinner ? n : g.rows.length, fetchedAt: now, expiresAt: new Date(now.getTime() + ttl), refreshingAt: null, lastProblem: thinner ? "fewer places than last time; kept the old list" : g.problem };
    await tx.insert(appActivityCities).values({ placeId, ...values }).onConflictDoUpdate({ target: appActivityCities.placeId, set: values });
    return { stored: thinner ? 0 : g.rows.length, kept: thinner };
  });
}

/** Claim a city for refreshing (one worker at a time). */
export async function claimCity(placeId: number, now = new Date()): Promise<boolean> {
  await db.insert(appActivityCities).values({ placeId }).onConflictDoNothing();
  const [got] = await db.update(appActivityCities).set({ refreshingAt: now })
    .where(and(eq(appActivityCities.placeId, placeId), or(isNull(appActivityCities.refreshingAt), lt(appActivityCities.refreshingAt, new Date(now.getTime() - LOCK_MS)))))
    .returning({ id: appActivityCities.placeId });
  return !!got;
}

export async function refreshCity(placeId: number, f: Fetch, now = new Date()): Promise<{ placeId: number; status: string; stored: number }> {
  const [p] = await db.select({ id: appPlaces.id, name: appPlaces.name, lat: appPlaces.lat, lon: appPlaces.lon, population: appPlaces.population }).from(appPlaces).where(eq(appPlaces.id, placeId));
  if (!p) return { placeId, status: "missing", stored: 0 };
  const g = await gatherCity(p, f, now);
  const r = await storeCity(placeId, g, now);
  return { placeId, status: g.status, stored: r.stored };
}

/**
 * The scheduled job: cities due (expired, or never loaded and either sold by us, curated or asked about), most
 * important first, one at a time with a pause between (Overpass and Wikimedia ask for that).
 */
export async function refreshDue(opts: { limit?: number; fetch?: Fetch; now?: Date; pauseMs?: number } = {}) {
  const now = opts.now ?? new Date();
  const f = opts.fetch ?? ((url, init) => fetch(url, init));
  const due = await db.select({ id: appPlaces.id }).from(appPlaces)
    .leftJoin(appActivityCities, eq(appActivityCities.placeId, appPlaces.id))
    .where(or(
      lt(appActivityCities.expiresAt, now),
      and(isNull(appActivityCities.fetchedAt), or(eq(appPlaces.served, true), eq(appPlaces.curation, "curated"), sql`${appActivityCities.placeId} IS NOT NULL`)),
    ))
    .orderBy(desc(appPlaces.served), asc(appActivityCities.expiresAt), desc(appPlaces.population))
    .limit(opts.limit ?? 5);
  const done: { placeId: number; status: string; stored: number }[] = [];
  for (const d of due) {
    if (!(await claimCity(d.id, now))) continue;
    try {
      done.push(await refreshCity(d.id, f, now));
    } catch (e) {
      console.error("[activities] refresh", d.id, e instanceof Error ? e.message : e);
      await db.update(appActivityCities).set({ refreshingAt: null, lastProblem: "refresh failed", expiresAt: new Date(now.getTime() + RETRY_MS) }).where(eq(appActivityCities.placeId, d.id));
    }
    if (opts.pauseMs) await new Promise((r) => setTimeout(r, opts.pauseMs));
  }
  return done;
}
