import { afterEach, describe, expect, it } from "vitest";
import { sql as raw } from "drizzle-orm";
import { AroundResponse, CONTACT_SALT, DiscoverResponse, FriendsResponse, InvitesResponse, PostsResponse, ProfileResponse, SavedResponse, SearchResponse, StampsResponse, addDays, todayIn } from "@mada/shared";
import { createHash } from "node:crypto";
import { db } from "@/db";
import { outbox } from "@/lib/app/suppliers";
import { decide, pendingQueue, screen } from "@/lib/app/circles/moderation";
import { GET as friendsGet, POST as friendsPost } from "@/app/api/app/v1/friends/route";
import { GET as searchGet } from "@/app/api/app/v1/friends/search/route";
import { POST as contactsPost } from "@/app/api/app/v1/friends/contacts/route";
import { DELETE as friendDelete, GET as profileGet } from "@/app/api/app/v1/friends/[id]/route";
import { POST as friendAccept } from "@/app/api/app/v1/friends/[id]/accept/route";
import { DELETE as unfollowDel, POST as followPost } from "@/app/api/app/v1/follows/[id]/route";
import { GET as postsGet, POST as postsPost } from "@/app/api/app/v1/posts/route";
import { DELETE as postDelete, GET as postGet } from "@/app/api/app/v1/posts/[id]/route";
import { POST as thanksPost } from "@/app/api/app/v1/posts/[id]/thanks/route";
import { GET as photoGet } from "@/app/api/app/v1/posts/[id]/photo/route";
import { GET as savedGet, POST as savedPost } from "@/app/api/app/v1/saved/route";
import { DELETE as savedDelete } from "@/app/api/app/v1/saved/[id]/route";
import { GET as discoverGet } from "@/app/api/app/v1/discover/route";
import { POST as notifyPost } from "@/app/api/app/v1/discover/notify/route";
import { GET as aroundGet, POST as aroundPost, PUT as aroundPut } from "@/app/api/app/v1/discover/around/route";
import { GET as stampsGet } from "@/app/api/app/v1/discover/stamps/route";
import { POST as reportsPost } from "@/app/api/app/v1/reports/route";
import { GET as blocksGet, POST as blocksPost } from "@/app/api/app/v1/blocks/route";
import { DELETE as unblockDel } from "@/app/api/app/v1/blocks/[id]/route";
import { GET as invitesGet, POST as invitesPost } from "@/app/api/app/v1/invites/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { GET as previewGet } from "@/app/api/app/v1/invites/[ref]/route";
import { POST as remindPost } from "@/app/api/app/v1/invites/[ref]/remind/route";
import { call, person, trip, withParams, type Who } from "./circles-helpers";
import { newPhone } from "./helpers";

const auth = (w: Who) => ({ token: w.token });
const get = (h: Parameters<typeof call>[0], w: Who, path = "/api/app/v1/x") => call(h, { method: "GET", path, ...auth(w) });
async function befriend(a: Who, b: Who) {
  await call(friendsPost, { ...auth(a), body: { userId: b.id } });
  await call(withParams(friendAccept, { id: a.id }), auth(b));
}
const TIP = { city: "Istanbul", place: "Künefe near Galata Tower", text: "Go before 8pm, it sells out. Ask for kaymak.", kind: "food", audience: "everyone" };
const feed = async (w: Who, q: string) => PostsResponse.parse((await get(postsGet, w, `/api/app/v1/posts?${q}`)).json).posts;

afterEach(() => { delete process.env.APP_MODERATION_DELAY_SECONDS; delete process.env.APP_MODERATION; });

describe("friends", () => {
  it("asks, accepts, and nobody is told about a no", async () => {
    const [omar, reem, khalid] = [await person("Omar"), await person("Reem"), await person("Khalid")];
    expect((await call(friendsPost, { ...auth(reem), body: { userId: omar.id } })).json).toEqual({ status: "asked" });
    let mine = FriendsResponse.parse((await get(friendsGet, omar)).json);
    expect(mine.requests.map((r) => r.short)).toEqual(["Reem"]);
    expect(FriendsResponse.parse((await get(friendsGet, reem)).json).asked).toEqual([omar.id]);
    const n = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_notifications WHERE user_id = ${omar.id} AND kind = 'friend.request'`);
    expect(n[0]!.n).toBe(1);
    // Asking someone who already asked you says yes.
    expect((await call(friendsPost, { ...auth(omar), body: { userId: reem.id } })).json).toEqual({ status: "friends" });
    mine = FriendsResponse.parse((await get(friendsGet, omar)).json);
    expect(mine.friends.map((f) => f.short)).toEqual(["Reem"]);
    expect(mine.friends[0]!.since).toBe(String(new Date().getUTCFullYear()));
    await call(friendsPost, { ...auth(khalid), body: { userId: omar.id } });
    expect((await call(withParams(friendDelete, { id: khalid.id }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect(FriendsResponse.parse((await get(friendsGet, khalid)).json).asked).toEqual([]);
    expect((await call(friendsPost, { ...auth(omar), body: { userId: omar.id } })).status).toBe(400);
    expect((await call(withParams(friendAccept, { id: khalid.id }), auth(omar))).status).toBe(404);
    expect((await call(friendsGet, { method: "GET" })).status).toBe(401);
  });

  it("finds anyone on Mada by name or exact number, never blocked people, and counts friends in common", async () => {
    const tag = `Zz${Date.now().toString(36)}`;
    const [omar, a, b] = [await person("Omar"), await person(`${tag}a`), await person(`${tag}b`)];
    const mutual = await person("Mutual");
    await befriend(omar, mutual);
    await befriend(a, mutual);
    const r = SearchResponse.parse((await get(searchGet, omar, `/api/app/v1/friends/search?q=${tag}`)).json);
    expect(r.people.map((p) => p.short).sort()).toEqual([`${tag}a`, `${tag}b`]);
    expect(r.people.find((p) => p.id === a.id)!.mutual).toBe(1);
    const byPhone = SearchResponse.parse((await get(searchGet, omar, `/api/app/v1/friends/search?q=${encodeURIComponent(b.phone.replace("+966", "0"))}`)).json);
    expect(byPhone).toMatchObject({ byPhone: true, people: [{ id: b.id, relation: "mada" }] });
    expect(JSON.stringify(byPhone)).not.toContain(b.phone);
    await call(blocksPost, { ...auth(b), body: { userId: omar.id } });
    expect(SearchResponse.parse((await get(searchGet, omar, `/api/app/v1/friends/search?q=${tag}`)).json).people.map((p) => p.id)).toEqual([a.id]);
    expect((await get(withParams(profileGet, { id: b.id }), omar)).status).toBe(404);
    expect(SearchResponse.parse((await get(searchGet, omar, `/api/app/v1/friends/search?q=${newPhone()}`)).json)).toEqual({ people: [], byPhone: true });
  });

  it("matches contacts by salted hash only", async () => {
    const [omar, maha] = [await person("Omar"), await person("Maha")];
    const h = (p: string) => createHash("sha256").update(`${CONTACT_SALT}:${p}`).digest("hex");
    const r = await call(contactsPost, { ...auth(omar), body: { hashes: [h(maha.phone), h(newPhone()), h(omar.phone)] } });
    expect(r.json.people.map((p: { id: string }) => p.id)).toEqual([maha.id]);
    expect((await call(contactsPost, { ...auth(omar), body: { hashes: ["+966500004127"] } })).status).toBe(400);
  });

  it("shows a profile: friends see where you're going, followers only your public tips", async () => {
    const [omar, noor, fan] = [await person("Omar"), await person("Noor"), await person("Fan")];
    await befriend(omar, noor);
    await trip(noor.id, "Istanbul", "Türkiye", addDays(todayIn(), 30), addDays(todayIn(), 34));
    await trip(noor.id, "Baku", "Azerbaijan", addDays(todayIn(), -100), addDays(todayIn(), -95));
    const p = ProfileResponse.parse((await get(withParams(profileGet, { id: noor.id }), omar)).json);
    expect(p.isFriend).toBe(true);
    expect(p.person.going).toMatch(/^Istanbul · /);
    expect(p.person).toMatchObject({ places: 1, trips: 1 });
    expect((await call(withParams(followPost, { id: noor.id }), auth(fan))).status).toBe(200);
    const asFan = ProfileResponse.parse((await get(withParams(profileGet, { id: noor.id }), fan)).json);
    expect(asFan).toMatchObject({ isFriend: false, following: true, followers: 1, person: { going: null } });
    expect(FriendsResponse.parse((await get(friendsGet, fan)).json).following.map((f) => f.short)).toEqual(["Noor"]);
    await call(withParams(unfollowDel, { id: noor.id }), { method: "DELETE", ...auth(fan) });
    expect(ProfileResponse.parse((await get(withParams(profileGet, { id: noor.id }), fan)).json).following).toBe(false);
  });
});

describe("tips and moderation", () => {
  it("a tip is pending until checked; auto mode approves a clean one, the blocklist holds one for a person", async () => {
    process.env.APP_MODERATION_DELAY_SECONDS = "0";
    const [omar, reem] = [await person("Omar"), await person("Reem")];
    const r = await call(postsPost, { ...auth(reem), body: TIP });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.post).toMatchObject({ status: "pending", relation: "you", city: "Istanbul" });
    const held = await call(postsPost, { ...auth(reem), body: { ...TIP, place: "My flat", text: "Call me on 0551234567 for the address" } });
    expect(held.json.post.status).toBe("pending");
    const seen = await feed(omar, "city=Istanbul");
    expect(seen.map((p) => p.id)).toContain(r.json.post.id);
    expect(seen.map((p) => p.id)).not.toContain(held.json.post.id);
    expect((await feed(reem, "city=Istanbul")).find((p) => p.id === held.json.post.id)!.status).toBe("pending");
    expect((await pendingQueue(500)).map((p) => p.id)).toContain(held.json.post.id);
    await decide(held.json.post.id, "reject", { kind: "agent", id: "desk-test" }, "contact details");
    expect((await feed(omar, "city=Istanbul")).map((p) => p.id)).not.toContain(held.json.post.id);
    expect(screen("A quiet café by the water")).toBeNull();
    expect(screen("see www.example.com")).not.toBeNull();
  });

  it("manual mode waits for a person; friends-only tips stay with friends; friends come first", async () => {
    process.env.APP_MODERATION = "manual";
    const [omar, noor, stranger] = [await person("Omar"), await person("Noor"), await person("Stranger")];
    await befriend(omar, noor);
    const city = `City${Date.now().toString(36)}`;
    const mine = (await call(postsPost, { ...auth(stranger), body: { ...TIP, city } })).json.post;
    const theirs = (await call(postsPost, { ...auth(noor), body: { ...TIP, city, audience: "friends", kind: "todo" } })).json.post;
    expect(await feed(omar, `city=${city}`)).toHaveLength(0);
    await decide(mine.id, "approve", { kind: "agent", id: "desk" });
    await decide(theirs.id, "approve", { kind: "agent", id: "desk" });
    expect((await feed(omar, `city=${city}`)).map((p) => [p.author.short, p.relation])).toEqual([["Noor", "friend"], ["Stranger", "mada"]]);
    expect((await feed(omar, `city=${city}&kind=todo`)).map((p) => p.author.short)).toEqual(["Noor"]);
    expect((await feed(stranger, `city=${city}`)).map((p) => p.author.short)).toEqual(["Stranger"]);
    expect((await get(withParams(postGet, { id: theirs.id }), stranger)).status).toBe(404);
    expect((await feed(omar, "scope=known")).map((p) => p.id)).toEqual([theirs.id]);
    const audit = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_audit WHERE action = 'post.approved' AND entity_id = ${mine.id}`);
    expect(audit[0]!.n).toBe(1);
  });

  it("a photo needs everyone's consent, is served only to people who may see the tip, and goes when the tip goes", async () => {
    process.env.APP_MODERATION_DELAY_SECONDS = "0";
    const [omar, reem] = [await person("Omar"), await person("Reem")];
    const png = `data:image/png;base64,${Buffer.from("\x89PNG fake image bytes").toString("base64")}`;
    expect((await call(postsPost, { ...auth(reem), body: { ...TIP, photo: png } })).status).toBe(400);
    const p = (await call(postsPost, { ...auth(reem), body: { ...TIP, photo: png, photoConsent: true } })).json.post;
    expect(p.photoUrl).toBe(`/api/app/v1/posts/${p.id}/photo`);
    const res = await withParams(photoGet, { id: p.id })(new Request("http://x/", { headers: { authorization: `Bearer ${omar.token}` } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect((await call(withParams(postDelete, { id: p.id }), { method: "DELETE", ...auth(omar) })).status).toBe(404);
    expect((await call(withParams(postDelete, { id: p.id }), { method: "DELETE", ...auth(reem) })).status).toBe(200);
    expect((await get(withParams(postGet, { id: p.id }), omar)).status).toBe(404);
  });

  it("thanks reach the author once; tips are limited per hour", async () => {
    process.env.APP_MODERATION_DELAY_SECONDS = "0";
    const [omar, reem] = [await person("Omar"), await person("Reem")];
    const p = (await call(postsPost, { ...auth(reem), body: TIP })).json.post;
    expect((await call(withParams(thanksPost, { id: p.id }), auth(omar))).status).toBe(200);
    await call(withParams(thanksPost, { id: p.id }), auth(omar));
    const n = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_notifications WHERE user_id = ${reem.id} AND kind = 'post.thanks'`);
    expect(n[0]!.n).toBe(1);
    expect((await call(withParams(thanksPost, { id: p.id }), auth(reem))).status).toBe(400);
    for (let i = 0; i < 4; i += 1) await call(postsPost, { ...auth(reem), body: TIP });
    const limited = await call(postsPost, { ...auth(reem), body: TIP });
    expect(limited.status).toBe(429);
    expect(limited.json.error.retryAfter).toBe(3600);
  });
});

describe("saved", () => {
  it("keeps a copy of a tip even after it goes, and saves Mada's plans; only yours", async () => {
    process.env.APP_MODERATION_DELAY_SECONDS = "0";
    const [omar, reem] = [await person("Omar"), await person("Reem")];
    const p = (await call(postsPost, { ...auth(reem), body: TIP })).json.post;
    await feed(omar, "city=Istanbul");
    const s = await call(savedPost, { ...auth(omar), body: { kind: "post", refId: p.id } });
    expect(s.status).toBe(201);
    await call(savedPost, { ...auth(omar), body: { kind: "post", refId: p.id } }); // twice is still once
    await call(savedPost, { ...auth(omar), body: { kind: "plan", refId: "alula2" } });
    expect((await call(savedPost, { ...auth(omar), body: { kind: "plan", refId: "nope" } })).status).toBe(404);
    expect((await feed(omar, "city=Istanbul")).find((x) => x.id === p.id)).toMatchObject({ saved: true, saves: 1 });
    await call(withParams(postDelete, { id: p.id }), { method: "DELETE", ...auth(reem) });
    const list = SavedResponse.parse((await get(savedGet, omar)).json).saved;
    expect(list.map((x) => [x.kind, x.city])).toEqual([["plan", "AlUla"], ["post", "Istanbul"]]);
    expect(list[1]!.post).toMatchObject({ place: TIP.place, author: { short: "Reem" } });
    expect((await call(withParams(savedDelete, { id: list[0]!.id }), { method: "DELETE", ...auth(reem) })).status).toBe(404);
    expect((await call(withParams(savedDelete, { id: list[0]!.id }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
  });
});

describe("discover, who's around, stamps", () => {
  it("Discover opens on your trip's city, else Riyadh; a city we don't cover is asked for, not faked", async () => {
    const omar = await person("Omar");
    let d = DiscoverResponse.parse((await get(discoverGet, omar, "/api/app/v1/discover")).json);
    expect(d).toMatchObject({ city: "Riyadh", tripDates: null });
    expect(d.events.map((e) => e.title)).toContain("Boulevard World at night");
    expect(d.sheet.map((g) => g.title)).toEqual(["here", "worth"]);
    await trip(omar.id, "Istanbul", "Türkiye", addDays(todayIn(), 20), addDays(todayIn(), 26));
    d = DiscoverResponse.parse((await get(discoverGet, omar, "/api/app/v1/discover")).json);
    expect(d.city).toBe("Istanbul");
    expect(d.tripDates).toBeTruthy();
    expect(d.sheet.map((g) => g.title)).toEqual(["here", "trips", "worth"]);
    expect((await get(discoverGet, omar, "/api/app/v1/discover?city=Tbilisi")).status).toBe(404);
    expect((await call(notifyPost, { ...auth(omar), body: { city: "Tbilisi" } })).status).toBe(200);
  });

  it("who's around: off by default, city only, for the people you choose, hidden people stay hidden", async () => {
    const [omar, noor, abdullah] = [await person("Omar"), await person("Noor"), await person("Abdullah")];
    await befriend(omar, noor);
    await befriend(omar, abdullah);
    for (const w of [omar, noor]) await trip(w.id, "Istanbul", "Türkiye", addDays(todayIn(), 3), addDays(todayIn(), 8));
    let me = AroundResponse.parse((await get(aroundGet, omar)).json);
    expect(me).toMatchObject({ city: "Istanbul", on: false, people: [] });
    expect(me.options.picked.map((p) => p.short)).toEqual(["Noor"]);
    const on = AroundResponse.parse((await call(aroundPut, { method: "PUT", ...auth(noor), body: { on: true, audience: "picked" } })).json);
    expect(on.on).toBe(true);
    expect(Date.parse(on.endsAt!)).toBeGreaterThan(Date.now() + 8 * 86_400_000);
    me = AroundResponse.parse((await get(aroundGet, omar)).json);
    expect(me.people.map((p) => [p.person.short, p.city])).toEqual([["Noor", "Istanbul"]]);
    expect(AroundResponse.parse((await get(aroundGet, abdullah)).json).people).toEqual([]); // not her audience, not in Istanbul
    me = AroundResponse.parse((await call(aroundPost, { ...auth(omar), body: { userId: noor.id, action: "hello" } })).json);
    expect(me.people[0]!.hello).toBe("sent");
    me = AroundResponse.parse((await call(aroundPost, { ...auth(omar), body: { userId: noor.id, action: "hide" } })).json);
    expect(me.people).toEqual([]);
    await call(aroundPut, { method: "PUT", ...auth(noor), body: { on: false } });
    expect(AroundResponse.parse((await get(aroundGet, noor)).json).on).toBe(false);
    // An expired presence is simply off.
    await call(aroundPut, { method: "PUT", ...auth(noor), body: { on: true } });
    await db.execute(raw`UPDATE app_presence SET ends_at = now() - interval '1 minute' WHERE user_id = ${noor.id}`);
    expect(AroundResponse.parse((await get(aroundGet, noor)).json).on).toBe(false);
    expect((await call(aroundPost, { ...auth(abdullah), body: { userId: noor.id, action: "hello" } })).status).toBe(404);
  });

  it("stamps come from trips taken; a new account has none, with the next trip pencilled in", async () => {
    const omar = await person("Omar");
    expect(StampsResponse.parse((await get(stampsGet, omar)).json)).toMatchObject({ stamps: [], countries: 0, next: null, rank: null });
    await trip(omar.id, "Istanbul", "Türkiye", addDays(todayIn(), 20), addDays(todayIn(), 26));
    expect(StampsResponse.parse((await get(stampsGet, omar)).json)).toMatchObject({ stamps: [], next: "Istanbul" });
    await trip(omar.id, "Baku", "Azerbaijan", "2026-03-30", "2026-04-04");
    await trip(omar.id, "AlUla", "Saudi Arabia", "2026-01-10", "2026-01-12");
    const s = StampsResponse.parse((await get(stampsGet, omar)).json);
    expect(s.stamps.map((x) => [x.city, x.month, x.upcoming])).toEqual([["Istanbul", expect.any(String), true], ["Baku", "APR 26", false], ["AlUla", "JAN 26", false]]);
    expect(s).toMatchObject({ countries: 1, places: 1 });
  });
});

describe("reports and blocks", () => {
  it("reports people and tips for a person to review; report and block in one go", async () => {
    process.env.APP_MODERATION_DELAY_SECONDS = "0";
    const [omar, pest] = [await person("Omar"), await person("Pest")];
    await befriend(omar, pest);
    const p = (await call(postsPost, { ...auth(pest), body: TIP })).json.post;
    expect((await call(reportsPost, { ...auth(omar), body: { targetKind: "post", targetId: p.id, reason: "unsafe" } })).status).toBe(201);
    expect((await call(reportsPost, { ...auth(omar), body: { targetKind: "user", targetId: pest.id, reason: "unwanted", block: true } })).status).toBe(201);
    const rows = await db.execute<{ target_kind: string; status: string }>(raw`SELECT target_kind, status FROM app_reports WHERE reporter_id = ${omar.id} ORDER BY created_at`);
    expect(rows.map((r) => [r.target_kind, r.status])).toEqual([["post", "open"], ["user", "open"]]);
    expect(FriendsResponse.parse((await get(friendsGet, omar)).json).friends).toEqual([]);
    expect((await call(blocksGet, { method: "GET", ...auth(omar) })).json.blocked.map((b: { short: string }) => b.short)).toEqual(["Pest"]);
    expect((await call(friendsPost, { ...auth(pest), body: { userId: omar.id } })).status).toBe(404);
    expect((await feed(omar, "city=Istanbul")).map((x) => x.id)).not.toContain(p.id);
    expect((await call(reportsPost, { ...auth(omar), body: { targetKind: "user", targetId: omar.id, reason: "other" } })).status).toBe(404);
    await call(withParams(unblockDel, { id: pest.id }), { method: "DELETE", ...auth(omar) });
    expect((await call(blocksGet, { method: "GET", ...auth(omar) })).json.blocked).toEqual([]);
  });
});

describe("Mada invites", () => {
  it("invites a number by SMS, refuses to invite someone already on Mada, and a Mada link makes you friends", async () => {
    const [omar, maha] = [await person("Omar"), await person("Maha")];
    const phone = newPhone();
    const sent = await call(invitesPost, { ...auth(omar), body: { phone } });
    expect(sent.status).toBe(201);
    expect(sent.json.invite).toMatchObject({ status: "pending", channel: "sms" });
    expect(sent.json.invite.label).not.toBe(phone);
    const sms = outbox.filter((m) => m.to === phone);
    expect(sms[0]!.body).toMatch(/^Omar invited you to Mada Trips: https:\/\/madatrips\.sa\/join\/[a-z0-9]{8}-[a-z0-9]{6}$/);
    const already = await call(invitesPost, { ...auth(omar), body: { phone: maha.phone } });
    expect(already.json).toMatchObject({ invite: null, onMada: { id: maha.id } });
    const iv = InvitesResponse.parse((await get(invitesGet, omar)).json).sent[0]!;
    expect((await call(withParams(remindPost, { ref: iv.id }), auth(omar))).status).toBe(200);
    expect(outbox.filter((m) => m.to === phone)[0]!.body).toContain("is waiting for you");

    const link = (await call(invitesPost, { ...auth(omar), body: { link: true } })).json.link;
    expect((await call(withParams(previewGet, { ref: link.code }), { method: "GET" })).json).toMatchObject({ kind: "mada", circle: null, from: { short: "Omar" } });
    const yousef = await person("Yousef");
    expect((await call(withParams(acceptPost, { ref: link.code }), auth(yousef))).json).toEqual({ circleId: null, friendId: omar.id, already: false });
    const list = InvitesResponse.parse((await get(invitesGet, omar)).json);
    expect(list.sent.find((s) => s.status === "joined")!.joined!.short).toBe("Yousef");
    expect(list.link!.code).toBe(link.code);
    expect(FriendsResponse.parse((await get(friendsGet, yousef)).json).friends.map((f) => f.short)).toEqual(["Omar"]);
    expect((await call(withParams(acceptPost, { ref: link.code }), auth(omar))).status).toBe(400);
  });

  it("limits invites per hour", async () => {
    const omar = await person("Omar");
    let last = 0;
    for (let i = 0; i < 31; i += 1) last = (await call(invitesPost, { ...auth(omar), body: { phone: newPhone() } })).status;
    expect(last).toBe(429);
  });
});
