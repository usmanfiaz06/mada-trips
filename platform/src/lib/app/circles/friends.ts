import "server-only";
import { and, eq, ilike, inArray, isNull, ne, or, sql } from "drizzle-orm";
import { CONTACT_SALT, LIMITS, checkSaudiMobile, type FriendTag, type FriendView, type FriendsResponse, type PersonRef, type ProfileResponse, type SearchHit } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { appFollows, appFriendships } from "@/db/app-schema-circles";
import { AppError } from "../http";
import { assertUnder, err, graphOf, liveUser, mutualCounts, nextTrip, notify, pastTrips, peopleByIds, relationOf, type Graph } from "./common";
import { postsBy } from "./posts";

/*
 * Friends are mutual (one asks, the other says yes, and nobody is told about a no). Following is one way and only
 * shows someone's public tips. Only friends see each other's trips and where they are. Blocks hide people both ways.
 */

/** Cities explored per person: trips taken plus places they posted tips from. */
async function placesOf(ids: string[]) {
  const trips = await pastTrips(ids);
  const out = new Map<string, { places: Set<string>; trips: number }>();
  for (const id of ids) out.set(id, { places: new Set(), trips: 0 });
  for (const tr of trips) { const o = out.get(tr.ownerId)!; o.places.add(tr.city); o.trips += 1; }
  if (ids.length) {
    const rows = await db.execute<{ author_id: string; city: string }>(sql`SELECT DISTINCT author_id, city FROM app_posts WHERE author_id IN ${ids} AND status = 'approved' AND deleted_at IS NULL`);
    for (const r of rows) out.get(r.author_id)?.places.add(r.city);
  }
  return out;
}

export async function friendViews(me: string, ids: string[], g?: Graph): Promise<FriendView[]> {
  if (!ids.length) return [];
  const graph = g ?? (await graphOf(me));
  const [people, places, mutual] = await Promise.all([peopleByIds(ids), placesOf(ids), mutualCounts(me, ids)]);
  const rows = await db.select().from(appFriendships).where(or(and(eq(appFriendships.requesterId, me), inArray(appFriendships.addresseeId, ids)), and(eq(appFriendships.addresseeId, me), inArray(appFriendships.requesterId, ids))));
  const out: FriendView[] = [];
  for (const id of ids) {
    const f = rows.find((r) => r.requesterId === id || r.addresseeId === id);
    const isFriend = graph.friends.has(id);
    const trip = isFriend ? await nextTrip(id) : null;
    const tag = f ? ((f.requesterId === me ? f.requesterTag : f.addresseeTag) as FriendTag | null) : null;
    out.push({
      ...people.get(id)!, since: isFriend && f?.acceptedAt ? String(f.acceptedAt.getUTCFullYear()) : null,
      places: places.get(id)!.places.size, trips: places.get(id)!.trips, going: trip ? trip.line : null, mutual: mutual.get(id) ?? 0, tag: graph.family.has(id) ? "family" : tag,
    });
  }
  return out;
}

export async function listFriends(me: string): Promise<FriendsResponse> {
  const g = await graphOf(me);
  const friends = [...g.friends].filter((id) => !g.blocked.has(id));
  const following = [...g.following].filter((id) => !g.blocked.has(id));
  const [fv, fov, rv] = await Promise.all([friendViews(me, friends, g), friendViews(me, following, g), friendViews(me, [...g.askedMe], g)]);
  const byName = (a: FriendView, b: FriendView) => a.name.localeCompare(b.name);
  return { friends: fv.sort(byName), following: fov.sort(byName), requests: rv, asked: [...g.asked] };
}

async function pair(a: string, b: string) {
  const [f] = await db.select().from(appFriendships).where(or(and(eq(appFriendships.requesterId, a), eq(appFriendships.addresseeId, b)), and(eq(appFriendships.requesterId, b), eq(appFriendships.addresseeId, a))));
  return f ?? null;
}

async function reachable(me: string, other: string) {
  if (me === other) throw err("VALIDATION", "circles.err.self");
  const g = await graphOf(me);
  if (g.blocked.has(other) || !(await liveUser(other))) throw new AppError("NOT_FOUND");
  return g;
}

/** Ask to be friends. If they already asked you, this says yes. */
export async function requestFriend(me: string, other: string): Promise<{ status: "asked" | "friends" }> {
  await reachable(me, other);
  const f = await pair(me, other);
  if (f?.status === "accepted") return { status: "friends" };
  if (f && f.requesterId === other) { await acceptFriend(me, other); return { status: "friends" }; }
  if (f) return { status: "asked" };
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(appFriendships).where(and(eq(appFriendships.requesterId, me), sql`${appFriendships.createdAt} > now() - interval '1 hour'`));
  assertUnder(n?.n ?? 0, LIMITS.invitesPerHour, 3600);
  const name = (await peopleByIds([me])).get(me)!.short;
  await db.transaction(async (tx) => {
    await tx.insert(appFriendships).values({ requesterId: me, addresseeId: other }).onConflictDoNothing();
    await notify(tx, other, "friend.request", ["notify.circles.friend.title", { name }], ["notify.circles.friend.body"], "/people?tab=requests");
  });
  return { status: "asked" };
}

export async function acceptFriend(me: string, other: string) {
  const f = await pair(me, other);
  if (!f || f.status !== "pending" || f.addresseeId !== me || (await graphOf(me)).blocked.has(other)) throw new AppError("NOT_FOUND");
  await db.update(appFriendships).set({ status: "accepted", acceptedAt: new Date() }).where(eq(appFriendships.id, f.id));
}

/** Decline a request, withdraw your own, or remove a friend. Nobody is told. */
export async function removeFriend(me: string, other: string) {
  const f = await pair(me, other);
  if (!f) throw new AppError("NOT_FOUND");
  await db.delete(appFriendships).where(eq(appFriendships.id, f.id));
}

export async function tagFriend(me: string, other: string, tag: FriendTag | null) {
  const f = await pair(me, other);
  if (!f || f.status !== "accepted") throw new AppError("NOT_FOUND");
  await db.update(appFriendships).set(f.requesterId === me ? { requesterTag: tag } : { addresseeTag: tag }).where(eq(appFriendships.id, f.id));
}

export async function follow(me: string, other: string) {
  await reachable(me, other);
  await db.insert(appFollows).values({ followerId: me, followeeId: other }).onConflictDoNothing();
}
export async function unfollow(me: string, other: string) {
  await db.delete(appFollows).where(and(eq(appFollows.followerId, me), eq(appFollows.followeeId, other)));
}

const hit = (g: Graph, me: string, p: PersonRef, mutual: number): SearchHit => ({ ...p, relation: relationOf(g, me, p.id), mutual });

/** Search everyone on Mada by name, or find one person by their exact mobile number. Blocked people never show. */
export async function search(me: string, q: string): Promise<{ people: SearchHit[]; byPhone: boolean }> {
  const term = q.trim().slice(0, 40);
  if (!term) return { people: [], byPhone: false };
  const g = await graphOf(me);
  const digits = term.replace(/[\s()-]/g, "");
  let ids: string[] = [];
  let byPhone = false;
  if (/^\+?\d{9,14}$/.test(digits)) {
    byPhone = true;
    const p = checkSaudiMobile(digits);
    if (p.ok) ids = (await db.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, p.e164), isNull(appUsers.deletedAt)))).map((r) => r.id);
  } else {
    const like = `%${term.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await db.select({ id: appUsers.id }).from(appUsers)
      .leftJoin(appPeople, and(eq(appPeople.ownerId, appUsers.id), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt)))
      .where(and(isNull(appUsers.deletedAt), ne(appUsers.name, ""), or(ilike(appUsers.name, like), ilike(sql`${appPeople.givenNames} || ' ' || ${appPeople.surname}`, like))))
      .limit(30);
    ids = rows.map((r) => r.id);
  }
  ids = ids.filter((id) => id !== me && !g.blocked.has(id));
  const [people, mutual] = await Promise.all([peopleByIds(ids), mutualCounts(me, ids)]);
  const rank = (h: SearchHit) => ["family", "friend", "following", "mada", "you"].indexOf(h.relation);
  return { people: ids.map((id) => hit(g, me, people.get(id)!, mutual.get(id) ?? 0)).sort((a, b) => rank(a) - rank(b) || b.mutual - a.mutual).slice(0, 20), byPhone };
}

/** Contacts already on Mada. The phone sends only salted hashes of numbers; we hash ours the same way and compare. */
export async function matchContacts(me: string, hashes: string[]): Promise<SearchHit[]> {
  if (!hashes.length) return [];
  const rows = await db.select({ id: appUsers.id }).from(appUsers)
    .where(and(isNull(appUsers.deletedAt), sql`${appUsers.phone} IS NOT NULL`, sql`encode(sha256(convert_to(${CONTACT_SALT + ":"} || ${appUsers.phone}, 'UTF8')), 'hex') IN ${hashes}`));
  const g = await graphOf(me);
  const ids = rows.map((r) => r.id).filter((id) => id !== me && !g.blocked.has(id));
  const [people, mutual] = await Promise.all([peopleByIds(ids), mutualCounts(me, ids)]);
  return ids.map((id) => hit(g, me, people.get(id)!, mutual.get(id) ?? 0));
}

export async function profile(me: string, other: string): Promise<ProfileResponse> {
  const g = await graphOf(me);
  if (other !== me && (g.blocked.has(other) || !(await liveUser(other)))) throw new AppError("NOT_FOUND");
  const [person] = await friendViews(me, [other], g);
  const [followers] = await db.select({ n: sql<number>`count(*)::int` }).from(appFollows).where(eq(appFollows.followeeId, other));
  const shared = await db.execute<{ id: string; name: string; n: number }>(sql`
    SELECT c.id, c.name, (SELECT count(*)::int FROM app_circle_members x WHERE x.circle_id = c.id) AS n
    FROM app_circles c
    JOIN app_circle_members a ON a.circle_id = c.id AND a.user_id = ${me}
    JOIN app_circle_members b ON b.circle_id = c.id AND b.user_id = ${other}
    LEFT JOIN app_circle_details d ON d.circle_id = c.id
    WHERE coalesce(d.dm, false) = false ORDER BY c.updated_at DESC`);
  return {
    person: person!, isFriend: g.friends.has(other), following: g.following.has(other), asked: g.asked.has(other), askedMe: g.askedMe.has(other),
    followers: followers?.n ?? 0, circles: shared.map((c) => ({ id: c.id, name: c.name, memberCount: Number(c.n) })),
    posts: await postsBy(me, other),
  };
}
