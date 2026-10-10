import "server-only";
import { and, eq, gt, inArray } from "drizzle-orm";
import {
  CITY_INFO, EVENTS, HOME_CITY, PLAN_SUMMARIES, addDays, rangeLabel, zonedToInstant,
  type AroundResponse, type Audience, type DiscoverResponse, type StampsResponse,
} from "@mada/shared";
import { db } from "@/db";
import { appPresence, appPresenceMarks } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { graphOf, nextTrip, notify, pastTrips, peopleByIds, stampMonth } from "./common";

/*
 * Discover: what's on this week in your city or your trip's city, Mada's plans, and the city picker. Who's around:
 * city only, never a place; off until you turn it on, for the people you choose; it ends by itself when you fly home.
 */

const coveredCity = (c: string) => Object.keys(CITY_INFO).find((k) => k.toLowerCase() === c.trim().toLowerCase()) ?? null;

export async function discover(me: string, cityParam: string | null): Promise<DiscoverResponse> {
  const trip = await nextTrip(me);
  const tripCity = trip ? coveredCity(trip.city) : null;
  const city = (cityParam && coveredCity(cityParam)) || tripCity || HOME_CITY;
  if (cityParam && !coveredCity(cityParam)) throw new AppError("NOT_FOUND");
  const sheet: DiscoverResponse["sheet"] = [{ title: "here", rows: [{ city: HOME_CITY, note: "here" }] }];
  if (trip) sheet.push({ title: "trips", rows: [{ city: trip.city, note: trip.dates }] });
  sheet.push({ title: "worth", rows: [{ city: "AlUla", note: "planned" }, ...(trip ? [] : [{ city: "Istanbul", note: "popular" }])].filter((r) => r.city !== trip?.city) });
  return {
    city, tripDates: trip && tripCity === city ? trip.dates : null, events: EVENTS[city] ?? [], plans: PLAN_SUMMARIES,
    sheet, covered: Object.entries(CITY_INFO).map(([c, i]) => ({ city: c, country: i.country })),
  };
}

/** "Tell me when it's here": recorded for the content team. */
export async function notifyCity(me: string, city: string) {
  await appAuditLog(db, { actorKind: "user", actorId: me, action: "discover.city_requested", entityType: "city", entityId: city.slice(0, 40), summary: `Asked for ${city.slice(0, 40)} on Discover` });
}

/* ───────────── who's around ───────────── */

async function myCity(me: string) {
  const trip = await nextTrip(me);
  if (trip) return { city: trip.city, from: trip.startDate, to: trip.endDate, dates: trip.dates };
  return { city: HOME_CITY, from: null, to: null, dates: null };
}

async function audienceOptions(me: string) {
  const g = await graphOf(me);
  const friends = [...g.friends].filter((id) => !g.blocked.has(id));
  const { city } = await myCity(me);
  const going: string[] = [];
  for (const f of friends) if ((await nextTrip(f))?.city === city) going.push(f);
  const picked = (going.length ? going : friends).filter((id) => !g.family.has(id));
  const people = await peopleByIds(friends);
  const refs = (ids: string[]) => ids.map((id) => people.get(id)!);
  return { g, ids: { picked, close: friends.filter((id) => g.close.has(id)), family: friends.filter((id) => g.family.has(id)) }, refs };
}

export async function around(me: string): Promise<AroundResponse> {
  const here = await myCity(me);
  const { g, ids, refs } = await audienceOptions(me);
  const [mine] = await db.select().from(appPresence).where(and(eq(appPresence.userId, me), gt(appPresence.endsAt, new Date())));
  const marks = await db.select().from(appPresenceMarks).where(eq(appPresenceMarks.userId, me));
  const hidden = new Set(marks.filter((m) => m.mark === "hidden").map((m) => m.otherId));
  const friends = [...g.friends].filter((id) => !g.blocked.has(id) && !hidden.has(id));
  const theirs = friends.length ? await db.select().from(appPresence).where(and(inArray(appPresence.userId, friends), gt(appPresence.endsAt, new Date()))) : [];
  const shown = theirs.filter((p) => p.city.toLowerCase() === here.city.toLowerCase() && p.audienceIds.includes(me));
  const people = await peopleByIds(shown.map((p) => p.userId));
  return {
    city: here.city, dates: here.dates, on: !!mine, audience: (mine?.audience as Audience) ?? "picked", endsAt: mine?.endsAt.toISOString() ?? null,
    options: { picked: refs(ids.picked), close: refs(ids.close), family: refs(ids.family) },
    people: shown.map((p) => {
      const m = marks.find((x) => x.otherId === p.userId && x.city === p.city);
      return { person: people.get(p.userId)!, city: p.city, dates: p.fromDate ? rangeLabel(p.fromDate, p.toDate) : null, hello: m?.mark === "hello" ? "sent" : m?.mark === "no" ? "no" : null };
    }),
  };
}

/** Turn it on for one audience, or off. On a trip it ends the day after you fly home; at home, after 3 days. */
export async function setPresence(me: string, input: { on: boolean; audience?: Audience; picked?: string[] }): Promise<AroundResponse> {
  if (!input.on) {
    await db.delete(appPresence).where(eq(appPresence.userId, me));
    return around(me);
  }
  const here = await myCity(me);
  const { g, ids } = await audienceOptions(me);
  const audience = input.audience ?? "picked";
  const chosen = audience === "picked" && input.picked?.length ? input.picked.filter((id) => g.friends.has(id) && !g.blocked.has(id)) : ids[audience];
  const endsAt = here.to ? zonedToInstant(`${addDays(here.to, 1)}T00:00`, "Asia/Riyadh") : new Date(Date.now() + 3 * 86_400_000);
  const row = { city: here.city, fromDate: here.from, toDate: here.to, audience, audienceIds: chosen, endsAt, updatedAt: new Date() };
  await db.insert(appPresence).values({ userId: me, ...row }).onConflictDoUpdate({ target: appPresence.userId, set: row });
  return around(me);
}

/** Say hello (they get a quiet notification), not now, or hide them here. They aren't told about the last two. */
export async function aroundAction(me: string, other: string, action: "hello" | "notNow" | "hide") {
  const g = await graphOf(me);
  if (!g.friends.has(other) || g.blocked.has(other)) throw new AppError("NOT_FOUND");
  const [p] = await db.select().from(appPresence).where(eq(appPresence.userId, other));
  const mark = action === "hide" ? "hidden" : action === "hello" ? "hello" : "no";
  await db.transaction(async (tx) => {
    await tx.insert(appPresenceMarks).values({ userId: me, otherId: other, mark, city: p?.city ?? null }).onConflictDoUpdate({ target: [appPresenceMarks.userId, appPresenceMarks.otherId], set: { mark, city: p?.city ?? null, createdAt: new Date() } });
    if (action === "hello" && p) {
      const name = (await peopleByIds([me], tx)).get(me)!.short;
      await notify(tx, other, "around.hello", ["notify.circles.hello.title", { name }], ["notify.circles.hello.body", { city: p.city }], `/friend/${me}`);
    }
  });
}

/* ───────────── stamps ───────────── */

export async function stamps(me: string): Promise<StampsResponse> {
  const trips = await pastTrips([me]);
  const seen = new Set<string>();
  const list: StampsResponse["stamps"] = [];
  for (const tr of trips) {
    if (seen.has(tr.city)) continue;
    seen.add(tr.city);
    list.push({ city: tr.city, month: stampMonth(tr.endDate ?? tr.startDate), upcoming: false });
  }
  const next = await nextTrip(me);
  if (next && list.length) list.unshift({ city: next.city, month: stampMonth(next.startDate), upcoming: true });
  const countries = new Set(trips.map((tr) => tr.country).filter((c) => c && c !== "Saudi Arabia")).size;
  const places = new Set(trips.filter((tr) => tr.country === "Saudi Arabia").map((tr) => tr.city)).size;
  const g = await graphOf(me);
  let rank: StampsResponse["rank"] = null;
  const friends = [...g.friends].filter((id) => !g.blocked.has(id));
  if (friends.length && trips.length) {
    const all = await pastTrips(friends);
    const score = new Map<string, number>([[me, seen.size]]);
    for (const f of friends) score.set(f, new Set(all.filter((x) => x.ownerId === f).map((x) => x.city)).size);
    const order = [...score.entries()].sort((a, b) => b[1] - a[1]);
    const people = await peopleByIds(order.slice(0, 3).map(([id]) => id));
    rank = { position: order.findIndex(([id]) => id === me) + 1, leader: people.get(order[0]![0])!, leaderPlaces: order[0]![1], faces: order.slice(0, 3).map(([id]) => people.get(id)!) };
  }
  return { stamps: list, countries, places, next: next?.city ?? null, rank };
}
