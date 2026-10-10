import "server-only";
import { and, desc, eq, inArray, isNull, or, sql } from "drizzle-orm";
import { CreatePostRequest, LIMITS, t, type Post, type PostKind } from "@mada/shared";
import { db } from "@/db";
import { appPostPhotos, appPostThanks, appPosts, appSaved } from "@/db/app-schema-circles";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { assertUnder, graphOf, notify, pastTrips, peopleByIds, relationOf, type Graph } from "./common";
import { initialModeration, settleDue } from "./moderation";

/*
 * Tips: a place, a line about it, a kind (food or things to do), who sees it (friends or everyone on Mada), an
 * optional photo that everyone in it agreed to. Pending until checked; the author sees their own pending tips.
 * Friends' tips come first. Blocked people's tips never show, either way round.
 */

type Row = typeof appPosts.$inferSelect;

async function serialize(me: string, rows: Row[], g: Graph): Promise<Post[]> {
  if (!rows.length) return [];
  const ids = rows.map((r) => r.id);
  const authors = [...new Set(rows.map((r) => r.authorId))];
  const [people, trips, saves, mine] = await Promise.all([
    peopleByIds(authors),
    pastTrips(authors),
    db.select({ ref: appSaved.refId, n: sql<number>`count(*)::int` }).from(appSaved).where(and(eq(appSaved.kind, "post"), inArray(appSaved.refId, ids))).groupBy(appSaved.refId),
    db.select({ ref: appSaved.refId }).from(appSaved).where(and(eq(appSaved.userId, me), eq(appSaved.kind, "post"), inArray(appSaved.refId, ids))),
  ]);
  return rows.map((r) => ({
    id: r.id, author: people.get(r.authorId)!, relation: relationOf(g, me, r.authorId), authorTrips: trips.filter((x) => x.ownerId === r.authorId).length,
    city: r.city, place: r.place, text: r.body, kind: r.kind === "food" ? "food" : "todo", audience: r.audience === "everyone" ? "everyone" : "friends",
    photoKey: (r.photoKey as Post["photoKey"]) ?? null, photoUrl: r.hasPhoto ? `/api/app/v1/posts/${r.id}/photo` : null,
    saves: saves.find((s) => s.ref === r.id)?.n ?? 0, saved: mine.some((s) => s.ref === r.id),
    status: r.status === "approved" ? "approved" : r.status === "rejected" ? "rejected" : "pending", createdAt: r.createdAt.toISOString(),
  }));
}

/** What a viewer may see: approved tips for everyone, approved friends-only tips from friends, and their own. */
function visible(me: string, g: Graph) {
  const friends = [...g.friends];
  const blocked = [...g.blocked];
  return and(
    isNull(appPosts.deletedAt),
    blocked.length ? sql`${appPosts.authorId} NOT IN ${blocked}` : undefined,
    or(
      eq(appPosts.authorId, me),
      and(eq(appPosts.status, "approved"), or(eq(appPosts.audience, "everyone"), friends.length ? inArray(appPosts.authorId, friends) : sql`false`)),
    ),
  );
}

/** A city's tips, friends first then newest; or "from people you know" (any city, newest first). */
export async function feed(me: string, q: { city?: string | null; kind?: PostKind | null; scope?: "city" | "known" }): Promise<Post[]> {
  await settleDue();
  const g = await graphOf(me);
  const known = [me, ...g.friends, ...g.following];
  const rows = await db.select().from(appPosts).where(and(
    visible(me, g),
    q.scope === "known" ? inArray(appPosts.authorId, known) : q.city ? sql`lower(${appPosts.city}) = lower(${q.city})` : undefined,
    q.kind ? eq(appPosts.kind, q.kind) : undefined,
    sql`${appPosts.status} <> 'rejected' OR ${appPosts.authorId} = ${me}`,
  )).orderBy(desc(appPosts.createdAt)).limit(60);
  const posts = await serialize(me, rows, g);
  if (q.scope === "known") return posts;
  const rank = (p: Post) => (p.relation === "family" || p.relation === "friend" ? 0 : p.relation === "you" ? 1 : p.relation === "following" ? 2 : 3);
  return posts.sort((a, b) => rank(a) - rank(b) || b.createdAt.localeCompare(a.createdAt));
}

export async function postsBy(me: string, author: string): Promise<Post[]> {
  await settleDue();
  const g = await graphOf(me);
  const rows = await db.select().from(appPosts).where(and(visible(me, g), eq(appPosts.authorId, author), eq(appPosts.status, "approved"))).orderBy(desc(appPosts.createdAt)).limit(30);
  return serialize(me, rows, g);
}

export async function getPost(me: string, id: string): Promise<Post> {
  await settleDue();
  const g = await graphOf(me);
  const [row] = await db.select().from(appPosts).where(and(eq(appPosts.id, id), visible(me, g)));
  if (!row) throw new AppError("NOT_FOUND");
  return (await serialize(me, [row], g))[0]!;
}

export async function createPost(me: string, raw: unknown, ipHash: string | null): Promise<Post> {
  const p = CreatePostRequest.parse(raw);
  const [n] = await db.select({ n: sql<number>`count(*)::int` }).from(appPosts).where(and(eq(appPosts.authorId, me), sql`${appPosts.createdAt} > now() - interval '1 hour'`));
  assertUnder(n?.n ?? 0, LIMITS.postsPerHour, 3600);
  const mod = initialModeration(`${p.place}\n${p.text}`);
  const photo = p.photo ? /^data:(image\/\w+);base64,(.*)$/.exec(p.photo) : null;
  if (photo && Buffer.byteLength(photo[2]!, "base64") > 2_000_000) throw new AppError("VALIDATION", { copy: "circles.postTip.photoTooBig", fields: { photo: t("circles.postTip.photoTooBig") } });
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appPosts).values({
      authorId: me, city: p.city, place: p.place, body: p.text, kind: p.kind, audience: p.audience, hasPhoto: !!photo, photoConsent: !!p.photoConsent,
      status: mod.status, flagged: mod.flagged, autoApproveAt: mod.autoApproveAt,
    }).returning();
    if (photo) await tx.insert(appPostPhotos).values({ postId: r!.id, mime: photo[1]!, data: photo[2]! });
    await appAuditLog(tx, { actorKind: "user", actorId: me, action: "post.created", entityType: "post", entityId: r!.id, summary: `Posted a tip in ${p.city}${photo ? " with a photo (consent confirmed)" : ""}`, data: { flagged: !!mod.flagged }, ipHash });
    return r!;
  });
  return (await serialize(me, [row], await graphOf(me)))[0]!;
}

/** The author takes a tip down. It goes for everyone; saved copies stay with the people who saved them. */
export async function deletePost(me: string, id: string, ipHash: string | null) {
  await db.transaction(async (tx) => {
    const [r] = await tx.update(appPosts).set({ deletedAt: new Date() }).where(and(eq(appPosts.id, id), eq(appPosts.authorId, me), isNull(appPosts.deletedAt))).returning({ id: appPosts.id });
    if (!r) throw new AppError("NOT_FOUND");
    await tx.delete(appPostPhotos).where(eq(appPostPhotos.postId, id));
    await appAuditLog(tx, { actorKind: "user", actorId: me, action: "post.deleted", entityType: "post", entityId: id, summary: "Took a tip down", ipHash });
  });
}

export async function thank(me: string, id: string) {
  const post = await getPost(me, id);
  if (post.author.id === me) throw new AppError("VALIDATION", { copy: "circles.err.self" });
  const name = (await peopleByIds([me])).get(me)!.short;
  await db.transaction(async (tx) => {
    const ins = await tx.insert(appPostThanks).values({ postId: id, userId: me }).onConflictDoNothing().returning({ p: appPostThanks.postId });
    if (ins.length) await notify(tx, post.author.id, "post.thanks", ["notify.circles.thanks.title", { name }], ["notify.circles.thanks.body", { place: post.place }], null, { postId: id });
  });
}

export async function photo(me: string, id: string): Promise<{ mime: string; data: Buffer }> {
  await getPost(me, id);
  const [p] = await db.select().from(appPostPhotos).where(eq(appPostPhotos.postId, id));
  if (!p) throw new AppError("NOT_FOUND");
  return { mime: p.mime, data: Buffer.from(p.data, "base64") };
}
