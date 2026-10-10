import "server-only";
import { eq, sql } from "drizzle-orm";
import type { CityGuide, GuideSection, PlaceAttribution, PlaceImage } from "@mada/shared";
import { db } from "@/db";
import { appPlaceGuides, appPlaces } from "@/db/app-schema-places";
import { AppError } from "../http";
import { findPlace, type PlaceRowSql } from "./search";
import { km } from "./sources";
import { attributionFor, commonsImage, wikipediaSummary, wikivoyageSections, wikivoyageTitle, type Fetch } from "./wiki";

/*
 * A city's guide: what we hold about it (name, country, airports, currency, time zone) plus the open-data part
 * (Wikipedia's lead and photo, Wikivoyage's sections), cached for 30 days. After that the old guide is served while
 * a fresh one is fetched in the background; when a source didn't answer, that part is retried the next day.
 * Nothing is invented: a section we couldn't find is left out.
 */

export const GUIDE_TTL_MS = 30 * 86_400_000;
const PARTIAL_TTL_MS = 86_400_000;
const NONE_TTL_MS = 6 * 3_600_000;
const LOCK_MS = 5 * 60_000;

type OpenPart = { image: PlaceImage | null; summary: CityGuide["summary"]; sections: GuideSection[]; attributions: PlaceAttribution[]; wikivoyageTitle: string | null };
type Status = "ok" | "partial" | "none";

/** Fetch Wikipedia, Commons, Wikidata and Wikivoyage for one city. */
export async function assembleOpenPart(place: Pick<PlaceRowSql, "name" | "lat" | "lon" | "wikipedia_title">, f: Fetch): Promise<{ part: OpenPart; status: Status }> {
  let missed = false;
  const attributions: PlaceAttribution[] = [];
  // Without GeoNames' own link, a page named like the city must also sit where the city is (within 50 km).
  const titleKnown = !!place.wikipedia_title;
  const wp = await wikipediaSummary(f, place.wikipedia_title ?? place.name);
  if (wp === "unavailable") missed = true;
  const summary = wp && wp !== "unavailable" && (titleKnown || (wp.lat !== null && wp.lon !== null && km(place.lat, place.lon, wp.lat, wp.lon) <= 50)) ? wp : null;
  let image: PlaceImage | null = null;
  if (summary) {
    attributions.push(attributionFor.wikipedia(summary.url));
    if (summary.imageFile) {
      image = await commonsImage(f, summary.imageFile);
      if (image) attributions.push(attributionFor.image(image));
    }
  }
  let sections: GuideSection[] = [];
  let voyTitle: string | null = null;
  if (summary?.qid) {
    const t = await wikivoyageTitle(f, summary.qid);
    if (t === "unavailable") missed = true;
    else if (t) {
      const v = await wikivoyageSections(f, t);
      if (v === "unavailable") missed = true;
      else if (v && v.sections.length) {
        sections = v.sections;
        voyTitle = v.title;
        attributions.push(attributionFor.wikivoyage(v.title));
      }
    }
  }
  const status: Status = missed ? (summary || sections.length ? "partial" : "none") : summary || sections.length ? "ok" : "none";
  return { part: { image, summary: summary ? { text: summary.text, url: summary.url } : null, sections, attributions, wikivoyageTitle: voyTitle }, status };
}

const ttlFor = (s: Status) => (s === "ok" ? GUIDE_TTL_MS : s === "partial" ? PARTIAL_TTL_MS : NONE_TTL_MS);

async function store(placeId: number, part: OpenPart, status: Status, now: Date) {
  const values = { guide: part as unknown as Record<string, unknown>, status, fetchedAt: now, expiresAt: new Date(now.getTime() + ttlFor(status)), refreshingAt: null, lastProblem: status === "ok" ? null : "a source did not answer" };
  // A failed refresh never replaces a good guide with an emptier one.
  await db.insert(appPlaceGuides).values({ placeId, ...values }).onConflictDoUpdate({
    target: appPlaceGuides.placeId,
    set: status === "none" ? { refreshingAt: null, expiresAt: values.expiresAt, lastProblem: values.lastProblem } : values,
  });
  if (part.sections.length >= 2) await db.update(appPlaces).set({ curation: sql`CASE WHEN ${appPlaces.curation} = 'basic' THEN 'guide' ELSE ${appPlaces.curation} END` }).where(eq(appPlaces.id, placeId));
}

const inflight = new Map<number, Promise<{ part: OpenPart; status: Status }>>();
/** Refreshes started in the background, for tests and for `after()` to wait on. */
export const pendingRefreshes = new Set<Promise<unknown>>();

function fetchAndStore(place: PlaceRowSql, f: Fetch, now: Date): Promise<{ part: OpenPart; status: Status }> {
  const running = inflight.get(place.id);
  if (running) return running;
  const p = (async () => {
    const got = await assembleOpenPart(place, f);
    await store(place.id, got.part, got.status, now);
    return got;
  })().finally(() => inflight.delete(place.id));
  inflight.set(place.id, p);
  return p;
}

/** Runs after the response when the platform supports it (Next's after()); otherwise just doesn't wait. */
async function later(task: () => Promise<unknown>) {
  const p = task().catch((e) => console.error("[places] guide refresh", e instanceof Error ? e.message : e));
  pendingRefreshes.add(p);
  void p.finally(() => pendingRefreshes.delete(p));
  try {
    const { after } = await import("next/server");
    after(() => p);
  } catch { /* outside a request (tests, scripts) */ }
}

export function guideOf(place: PlaceRowSql, part: OpenPart | null, fetchedAt: Date | null): CityGuide {
  const attributions = [...(part?.attributions ?? []), attributionFor.geonames(), ...(place.airports.length ? [attributionFor.ourairports()] : [])];
  return {
    id: String(place.id), name: place.name, nameAr: place.name_ar, region: place.region, country: place.country, countryCode: place.country_code,
    lat: place.lat, lon: place.lon, timezone: place.timezone, population: Number(place.population), served: place.served,
    curation: place.curation as CityGuide["curation"], photo: place.photo, bookingKey: place.booking_key, image: part?.image ?? null, summary: part?.summary ?? null,
    sections: part?.sections ?? [], airports: place.airports.slice(0, 4), currency: place.currency_code ? { code: place.currency_code, name: place.currency_name ?? place.currency_code } : null,
    attributions, fetchedAt: fetchedAt?.toISOString() ?? null,
  };
}

export async function getGuide(idOrSlug: string, opts: { fetch?: Fetch; now?: Date } = {}): Promise<CityGuide> {
  const f = opts.fetch ?? ((url, init) => fetch(url, init));
  const now = opts.now ?? new Date();
  const place = await findPlace(idOrSlug);
  if (!place) throw new AppError("NOT_FOUND");
  const [cached] = await db.select().from(appPlaceGuides).where(eq(appPlaceGuides.placeId, place.id));
  if (cached) {
    if (cached.expiresAt <= now) {
      // Stale: serve it, and refresh once (whoever claims the row first).
      const [claimed] = await db.update(appPlaceGuides).set({ refreshingAt: now })
        .where(sql`${appPlaceGuides.placeId} = ${place.id} AND (${appPlaceGuides.refreshingAt} IS NULL OR ${appPlaceGuides.refreshingAt} < ${new Date(now.getTime() - LOCK_MS).toISOString()}::timestamptz)`).returning({ id: appPlaceGuides.placeId });
      if (claimed) await later(() => fetchAndStore(place, f, now));
    }
    const part = cached.guide as unknown as OpenPart;
    return guideOf(place, cached.status === "none" ? null : part, cached.status === "none" ? null : cached.fetchedAt);
  }
  // First time anyone opens this city: fetch now (each source waits at most 5 s), then it's cached.
  try {
    const { part, status } = await fetchAndStore(place, f, now);
    return status === "none" ? guideOf(place, null, null) : guideOf(place, part, now);
  } catch (e) {
    console.error("[places] guide", e instanceof Error ? e.message : e);
    return guideOf(place, null, null);
  }
}
