import "server-only";
import { and, asc, desc, eq, gte, lte } from "drizzle-orm";
import {
  MOCK_ACTIVITIES, THINGS_ATTRIBUTIONS, ThingsQuery, filterActivities, kmBetween, localClock, mockEvents, nextPrayer, openState,
  todayIdeas, utcOffsetMin, type Activity, type Experience, type PlaceAttribution, type PlaceImage, type ThingsResponse, type TodayWeather, type WhatsOn,
} from "@mada/shared";
import { db } from "@/db";
import { appActivities, appActivityCities, appWhatsOn } from "@/db/app-schema-activities";
import { supplierMode } from "../config";
import { AppError } from "../http";
import { findPlace, type PlaceRowSql } from "../places/search";
import { attributionFor, type Fetch } from "../places/wiki";
import { activitySuppliers } from "../suppliers/activities";
import { claimCity, refreshCity } from "./ingest";
import { fetchTicketmaster } from "./ticketmaster";
import { fetchWeather, mockWeather } from "./weather";

/*
 * GET /places/:id/things (and /trips/:id/things, which fills in the hotel, the children's ages and the day): open-data
 * places with their hours read against the city's clock, bookable experiences, what's on, today's weather and ideas
 * that suit it. Each upstream part is cached per city (weather 1 h, events and experiences 6 h); any part that fails
 * is simply left out. The first time anyone opens a city we haven't loaded, its open data is gathered in the
 * background and the answer says "gathering".
 */

const WEATHER_TTL = 3_600_000;
const EVENTS_TTL = 6 * 3_600_000;
const EXPERIENCES_TTL = 6 * 3_600_000;

export const pendingThings = new Set<Promise<unknown>>();
async function later(task: () => Promise<unknown>) {
  const p = task().catch((e) => console.error("[activities] background", e instanceof Error ? e.message : e));
  pendingThings.add(p);
  void p.finally(() => pendingThings.delete(p));
  try {
    const { after } = await import("next/server");
    after(() => p);
  } catch { /* outside a request */ }
}

const addDays = (day: string, n: number) => { const d = new Date(`${day}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
type Row = typeof appActivities.$inferSelect;

function activityOf(r: Row, clock: { weekday: number; minutes: number } | null, near: { lat: number; lon: number } | null): Activity {
  const st = clock ? openState(r.hours, clock) : { open: null, closesAt: null };
  const image = (r.image ?? null) as PlaceImage | null;
  const attributions: PlaceAttribution[] = [THINGS_ATTRIBUTIONS.osm];
  if (r.wikidata) attributions.push({ ...THINGS_ATTRIBUTIONS.wikidata, url: `https://www.wikidata.org/wiki/${r.wikidata}` });
  if (image) attributions.push(attributionFor.image(image));
  return {
    id: r.id, placeId: String(r.placeId), name: r.name, nameAr: r.nameAr, kind: r.kind as Activity["kind"], lat: r.lat, lon: r.lon, summary: r.summary, summaryAr: r.summaryAr,
    image, photo: null, hours: r.hours, openNow: st.open, closesAt: st.closesAt, indoor: r.indoor, family: r.family, free: r.free, website: r.website,
    wikipedia: r.wikipediaTitle ? `https://en.wikipedia.org/wiki/${encodeURIComponent(r.wikipediaTitle.replace(/ /g, "_"))}` : null, popularity: r.popularity,
    distanceKm: near ? Math.round(kmBetween(near.lat, near.lon, r.lat, r.lon) * 10) / 10 : null, attributions,
  };
}

async function cityRow(placeId: number) {
  const [c] = await db.select().from(appActivityCities).where(eq(appActivityCities.placeId, placeId));
  return c ?? null;
}

async function cache(placeId: number, set: Partial<typeof appActivityCities.$inferInsert>) {
  await db.insert(appActivityCities).values({ placeId, ...set }).onConflictDoUpdate({ target: appActivityCities.placeId, set });
}

async function weatherFor(place: PlaceRowSql, c: Awaited<ReturnType<typeof cityRow>>, f: Fetch, now: Date): Promise<TodayWeather | null> {
  if (supplierMode("weather") !== "live") return mockWeather(place.lat, place.country_code, now);
  if (c?.weather && c.weatherAt && now.getTime() - c.weatherAt.getTime() < WEATHER_TTL) return c.weather as unknown as TodayWeather;
  const w = await fetchWeather(f, place.lat, place.lon, now);
  if (w) await cache(place.id, { weather: w as unknown as Record<string, unknown>, weatherAt: now });
  return w ?? ((c?.weather as unknown as TodayWeather | null) ?? null);
}

export async function deskEvents(placeId: number, from: string, to: string, locale: "en" | "ar"): Promise<WhatsOn[]> {
  const rows = await db.select().from(appWhatsOn)
    .where(and(eq(appWhatsOn.placeId, placeId), eq(appWhatsOn.active, true), gte(appWhatsOn.endsOn, from), lte(appWhatsOn.startsOn, to)))
    .orderBy(asc(appWhatsOn.startsOn)).limit(20);
  return rows.map((r) => ({
    id: `desk:${r.id}`, source: "desk" as const, placeId: String(r.placeId), title: (locale === "ar" && r.titleAr) || r.title, body: (locale === "ar" && r.bodyAr) || r.body,
    startsOn: r.startsOn, endsOn: r.endsOn, time: r.time, venue: r.venue, image: r.imageUrl ? { url: r.imageUrl, credit: r.imageCredit } : null, photo: null, link: r.link, family: r.family,
  }));
}

async function eventsFor(place: PlaceRowSql, c: Awaited<ReturnType<typeof cityRow>>, from: string, to: string, f: Fetch, now: Date, locale: "en" | "ar"): Promise<WhatsOn[]> {
  const desk = await deskEvents(place.id, from, to, locale);
  if (supplierMode("events") !== "live") return [...desk, ...mockEvents(String(place.id), from).filter((e) => e.endsOn >= from && e.startsOn <= to && !desk.some((d) => d.id === e.id))];
  const key = process.env.TICKETMASTER_KEY;
  if (!key) return desk;
  let tm: WhatsOn[] | null = null;
  if (c?.events && c.eventsAt && now.getTime() - c.eventsAt.getTime() < EVENTS_TTL) tm = c.events as unknown as WhatsOn[];
  else {
    tm = await fetchTicketmaster(f, key, place.lat, place.lon, from, addDays(from, 30), String(place.id));
    if (tm) await cache(place.id, { events: tm as unknown as Record<string, unknown>[], eventsAt: now });
  }
  return [...desk, ...(tm ?? []).filter((e) => e.endsOn >= from && e.startsOn <= to)];
}

async function experiencesFor(place: PlaceRowSql, c: Awaited<ReturnType<typeof cityRow>>, day: string, ages: number[], now: Date): Promise<Experience[]> {
  const live = supplierMode("activities") === "live";
  let list: Experience[] | null = live && c?.experiences && c.experiencesAt && now.getTime() - c.experiencesAt.getTime() < EXPERIENCES_TTL ? c.experiences as unknown as Experience[] : null;
  if (!list) {
    const q = { placeId: String(place.id), city: place.name, countryCode: place.country_code, lat: place.lat, lon: place.lon, from: day, to: addDays(day, 6), ages: [30, 30], language: "en" as const, limit: 10 };
    const got = await Promise.allSettled(activitySuppliers().map((s) => s.search(q)));
    list = got.flatMap((g) => (g.status === "fulfilled" ? g.value : []));
    got.forEach((g) => { if (g.status === "rejected") console.warn("[activities] experiences", g.reason instanceof Error ? g.reason.message : g.reason); });
    if (live && got.some((g) => g.status === "fulfilled")) await cache(place.id, { experiences: list as unknown as Record<string, unknown>[], experiencesAt: now });
  }
  const youngest = ages.length ? Math.min(...ages) : null;
  return list.filter((e) => youngest === null || e.minAge === null || youngest >= e.minAge);
}

export type ThingsContext = { near?: { lat: number; lon: number; label: "hotel" | "you" | "centre" } | null; ages?: number[]; locale?: "en" | "ar"; fetch?: Fetch; now?: Date };

export async function thingsFor(idOrSlug: string, rawQuery: Record<string, string>, ctx: ThingsContext = {}): Promise<ThingsResponse> {
  const parsed = ThingsQuery.safeParse(rawQuery);
  if (!parsed.success) throw new AppError("VALIDATION", { fields: Object.fromEntries(parsed.error.issues.map((i) => [i.path.join(".") || "_", i.message])) });
  const q = parsed.data;
  const place = await findPlace(idOrSlug);
  if (!place) throw new AppError("NOT_FOUND");
  const f: Fetch = ctx.fetch ?? ((url, init) => fetch(url, init));
  const now = ctx.now ?? new Date();
  const locale = ctx.locale ?? "en";
  const clock = localClock(place.timezone, now);
  const day = q.day ?? clock.day;
  const isToday = day === clock.day;
  const ages = q.ages ? q.ages.split(",").map(Number) : ctx.ages ?? [];
  const near = q.near ? { lat: Number(q.near.split(",")[0]), lon: Number(q.near.split(",")[1]), label: "you" as const } : ctx.near ?? null;

  const c = await cityRow(place.id);
  const rows = await db.select().from(appActivities).where(eq(appActivities.placeId, place.id)).orderBy(desc(appActivities.popularity)).limit(200);
  let status: ThingsResponse["status"] = rows.length ? "ready" : "none";
  let acts: Activity[] = rows.map((r) => activityOf(r, isToday ? clock : null, near));
  if (!rows.length) {
    if (supplierMode("openData") === "live" && (!c?.fetchedAt || (c.expiresAt && c.expiresAt <= now))) {
      if (await claimCity(place.id, now)) await later(() => refreshCity(place.id, f, now));
      status = "gathering";
    } else if (MOCK_ACTIVITIES[String(place.id)]) {
      acts = MOCK_ACTIVITIES[String(place.id)]!.map((a) => {
        const st = isToday ? openState(a.hours, clock) : { open: null, closesAt: null };
        return { ...a, openNow: st.open, closesAt: st.closesAt, distanceKm: near ? Math.round(kmBetween(near.lat, near.lon, a.lat, a.lon) * 10) / 10 : null };
      });
      status = "ready";
    }
  } else if (c?.expiresAt && c.expiresAt <= now && supplierMode("openData") === "live" && await claimCity(place.id, now)) {
    await later(() => refreshCity(place.id, f, now));
  }
  if (near) acts.sort((a, b) => (a.distanceKm ?? 99) - (b.distanceKm ?? 99) || b.popularity - a.popularity);

  const [weather, events, experiences] = await Promise.all([
    isToday ? weatherFor(place, c, f, now).catch(() => null) : Promise.resolve(null),
    eventsFor(place, c, day, q.day ? day : addDays(day, 14), f, now, locale).catch(() => [] as WhatsOn[]),
    experiencesFor(place, c, day, ages, now).catch(() => [] as Experience[]),
  ]);
  const family = q.family ?? false;
  const shown = filterActivities(acts, { open: isToday && q.open, family, ages, kind: q.kind }).slice(0, q.limit);
  const prayer = nextPrayer(day, isToday ? clock.minutes : 0, place.lat, place.lon, utcOffsetMin(place.timezone, now));
  const today = isToday ? todayIdeas(acts, { day, minutes: clock.minutes, weather, family: family || ages.some((a) => a < 12), prayer }) : null;

  const attributions: PlaceAttribution[] = [];
  if (acts.length) attributions.push(THINGS_ATTRIBUTIONS.osm, THINGS_ATTRIBUTIONS.wikidata);
  if (rows.some((r) => r.pageviews > 0)) attributions.push(THINGS_ATTRIBUTIONS.wikipedia);
  if (shown.some((a) => a.image)) attributions.push(THINGS_ATTRIBUTIONS.commons);
  if (weather && supplierMode("weather") === "live") attributions.push(THINGS_ATTRIBUTIONS.openmeteo);
  if (events.some((e) => e.source === "ticketmaster")) attributions.push(THINGS_ATTRIBUTIONS.ticketmaster);
  attributions.push(attributionFor.geonames());

  return {
    place: { id: String(place.id), name: place.name, nameAr: place.name_ar, lat: place.lat, lon: place.lon, timezone: place.timezone, countryCode: place.country_code },
    status, day, localTime: clock.hhmm, weather, today, activities: shown, experiences, events, near: near ? { lat: near.lat, lon: near.lon, label: near.label } : null, ages,
    attributions, fetchedAt: c?.fetchedAt?.toISOString() ?? null,
  };
}

/** One thing by reference, for booking and "Add to my plan": the open-data place, the experience or the event. */
export async function findThing(placeId: number, ref: { kind: "activity" | "experience" | "event"; id: string }, now = new Date()) {
  const things = await thingsFor(String(placeId), { limit: "60" }, { now });
  if (ref.kind === "activity") {
    const [r] = await db.select().from(appActivities).where(and(eq(appActivities.id, ref.id), eq(appActivities.placeId, placeId)));
    const a = r ? activityOf(r, null, null) : (MOCK_ACTIVITIES[String(placeId)] ?? []).find((x) => x.id === ref.id) ?? null;
    return a ? { place: things.place, title: a.name, sub: a.summary, activity: a, experience: null, event: null } : null;
  }
  if (ref.kind === "experience") {
    const e = things.experiences.find((x) => x.id === ref.id) ?? null;
    return e ? { place: things.place, title: e.title, sub: e.summary, activity: null, experience: e, event: null } : null;
  }
  const from = now.toISOString().slice(0, 10);
  const all = ref.id.startsWith("desk:") ? await deskEvents(placeId, addDays(from, -1), addDays(from, 365), "en") : things.events;
  const ev = all.find((x) => x.id === ref.id) ?? null;
  return ev ? { place: things.place, title: ev.title, sub: ev.venue ?? ev.body, activity: null, experience: null, event: ev } : null;
}
