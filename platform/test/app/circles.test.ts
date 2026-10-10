import { describe, expect, it } from "vitest";
import { sql as raw } from "drizzle-orm";
import { CircleDetail, CirclesResponse, MessagesPage, SentMessages, addDays, todayIn } from "@mada/shared";
import { db } from "@/db";
import { GET as circlesGet, POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as dmPost } from "@/app/api/app/v1/circles/dm/route";
import { DELETE as circleDelete, GET as circleGet, PATCH as circlePatch } from "@/app/api/app/v1/circles/[id]/route";
import { POST as leavePost } from "@/app/api/app/v1/circles/[id]/leave/route";
import { GET as msgsGet, POST as msgsPost } from "@/app/api/app/v1/circles/[id]/messages/route";
import { PATCH as msgPatch } from "@/app/api/app/v1/circles/[id]/messages/[mid]/route";
import { POST as votePost } from "@/app/api/app/v1/circles/[id]/votes/route";
import { POST as castPost } from "@/app/api/app/v1/circles/[id]/votes/[mid]/route";
import { POST as closePost } from "@/app/api/app/v1/circles/[id]/votes/[mid]/close/route";
import { POST as pickPost } from "@/app/api/app/v1/circles/[id]/votes/[mid]/pick/route";
import { POST as splitPost } from "@/app/api/app/v1/circles/[id]/splits/route";
import { POST as paidPost } from "@/app/api/app/v1/circles/[id]/splits/[mid]/paid/route";
import { POST as remindSplitPost } from "@/app/api/app/v1/circles/[id]/splits/[mid]/remind/route";
import { DELETE as memberDelete, PATCH as memberPatch } from "@/app/api/app/v1/circles/[id]/members/[uid]/route";
import { POST as circleInvitesPost } from "@/app/api/app/v1/circles/[id]/invites/route";
import { POST as linkPost } from "@/app/api/app/v1/circles/[id]/link/route";
import { DELETE as inviteDelete, GET as invitePreview } from "@/app/api/app/v1/invites/[ref]/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { POST as declinePost } from "@/app/api/app/v1/invites/[ref]/decline/route";
import { POST as inviteRemind } from "@/app/api/app/v1/invites/[ref]/remind/route";
import { POST as friendsPost } from "@/app/api/app/v1/friends/route";
import { POST as friendAccept } from "@/app/api/app/v1/friends/[id]/accept/route";
import { PATCH as friendPatch } from "@/app/api/app/v1/friends/[id]/route";
import { POST as blocksPost } from "@/app/api/app/v1/blocks/route";
import { call, person, withParams, type Who } from "./circles-helpers";

const auth = (w: Who) => ({ token: w.token });
async function befriend(a: Who, b: Who) {
  await call(friendsPost, { ...auth(a), body: { userId: b.id } });
  await call(withParams(friendAccept, { id: a.id }), { ...auth(b) });
}
async function makeCircle(owner: Who, name: string, invite: Who[] = [], extra: Record<string, unknown> = {}) {
  const r = await call(circlesPost, { ...auth(owner), body: { name, invite: invite.map((w) => w.id), ...extra } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return CircleDetail.parse(r.json);
}
async function join(owner: Who, c: CircleDetail, ...people: Who[]) {
  for (const p of people) {
    const iv = c.invited.find((i) => i.person.id === p.id) ?? (await detail(owner, c.circle.id)).invited.find((i) => i.person.id === p.id);
    const r = await call(withParams(acceptPost, { ref: iv!.inviteId }), auth(p));
    expect(r.status, JSON.stringify(r.json)).toBe(200);
  }
}
const detail = async (w: Who, id: string) => CircleDetail.parse((await call(withParams(circleGet, { id }), { method: "GET", ...auth(w) })).json);
const msgs = async (w: Who, id: string, q = "") => MessagesPage.parse((await call(withParams(msgsGet, { id }), { method: "GET", path: `/api/app/v1/circles/${id}/messages${q}`, ...auth(w) })).json);
const say = async (w: Who, id: string, body: unknown) => call(withParams(msgsPost, { id }), { ...auth(w), body });

describe("circles", () => {
  it("makes a circle: you're the admin, people are invited not added, and the chat starts with the story", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const c = await makeCircle(omar, "Eid trip", [hessa], { cover: "istanbul" });
    expect(c.circle).toMatchObject({ name: "Eid trip", role: "admin", memberCount: 1, cover: "istanbul", invitedCount: 1, dm: false });
    expect(c.invited.map((i) => i.person.short)).toEqual(["Hessa"]);
    const page = await msgs(omar, c.circle.id);
    expect(page.items.map((m) => m.kind)).toEqual(["sys", "sys", "mada"]);
    expect(page.items[0]!.sys).toMatchObject({ event: "created", actor: omar.id });
    expect(page.items[1]!.sys).toMatchObject({ event: "invited", users: [hessa.id] });
    expect(page.items[2]!.mada!.kind).toBe("welcome");

    // Hessa sees the invite, not the circle, until she says yes.
    const hers = CirclesResponse.parse((await call(circlesGet, { method: "GET", ...auth(hessa) })).json);
    expect(hers.circles).toHaveLength(0);
    expect(hers.incoming[0]).toMatchObject({ from: { short: "Omar" }, circle: { name: "Eid trip", memberCount: 1 } });
    await join(omar, c, hessa);
    const after = await detail(hessa, c.circle.id);
    expect(after.members.map((m) => [m.short, m.role])).toEqual([["Omar", "admin"], ["Hessa", "member"]]);
    expect(after.invited).toHaveLength(0);
    expect((await msgs(omar, c.circle.id)).items.at(-1)!.sys).toMatchObject({ event: "joined", actor: hessa.id });
  });

  it("refuses a second circle with the same name, a name too short, and callers without a session", async () => {
    const omar = await person("Omar");
    await makeCircle(omar, "Cousins");
    const dupe = await call(circlesPost, { ...auth(omar), body: { name: "cousins" } });
    expect(dupe.status).toBe(400);
    expect(dupe.json.error.message).toContain("already have a circle");
    expect((await call(circlesPost, { ...auth(omar), body: { name: "A" } })).status).toBe(400);
    expect((await call(circlesGet, { method: "GET" })).status).toBe(401);
  });

  it("keeps circles private: strangers get 404 on every route, never a hint it exists", async () => {
    const omar = await person("Omar");
    const stranger = await person("Stranger");
    const c = await makeCircle(omar, "Family");
    const id = c.circle.id;
    expect((await call(withParams(circleGet, { id }), { method: "GET", ...auth(stranger) })).status).toBe(404);
    expect((await call(withParams(msgsGet, { id }), { method: "GET", ...auth(stranger) })).status).toBe(404);
    expect((await say(stranger, id, { body: "hello" })).status).toBe(404);
    expect((await call(withParams(linkPost, { id }), auth(stranger))).status).toBe(404);
    expect((await call(withParams(circleGet, { id: "not-a-uuid" }), { method: "GET", ...auth(omar) })).status).toBe(404);
  });

  it("pages messages newest-first with a cursor, and polls with ?after=", async () => {
    const omar = await person("Omar");
    const c = await makeCircle(omar, "Chatty");
    for (let i = 0; i < 55; i += 1) await db.execute(raw`INSERT INTO app_messages (thread_kind, thread_id, author_kind, author_user_id, body, created_at) VALUES ('circle', ${c.circle.id}, 'user', ${omar.id}, ${`m${i}`}, date_trunc('milliseconds', now()) + ${`${i} seconds`}::interval)`);
    const first = await msgs(omar, c.circle.id);
    expect(first.items).toHaveLength(50);
    expect(first.items.at(-1)!.body).toBe("m54");
    expect(first.next).toBeTruthy();
    const older = await msgs(omar, c.circle.id, `?before=${first.next}`);
    expect(older.items.map((m) => m.body)).toEqual(["created", "welcome", "m0", "m1", "m2", "m3", "m4"]);
    expect(older.next).toBeNull();
    const cursor = Buffer.from(`${first.items.at(-2)!.createdAt}|${first.items.at(-2)!.id}`).toString("base64url");
    expect((await msgs(omar, c.circle.id, `?after=${cursor}`)).items.map((m) => m.body)).toEqual(["m54"]);
  });

  it("answers @Mada about the circle's place, by rules when no model is set, and remembers where it's going", async () => {
    const omar = await person("Omar");
    const c = await makeCircle(omar, "Weekend crew");
    const r = await say(omar, c.circle.id, { body: "@Mada ideas" });
    expect(r.status).toBe(201);
    const [, ask] = SentMessages.parse(r.json).items;
    expect(ask!.mada).toMatchObject({ askWhere: true });
    expect(ask!.body).toContain("Where are you thinking?");
    // Answering the question back needs no @Mada.
    const r2 = SentMessages.parse((await say(omar, c.circle.id, { body: "Baku" })).json);
    expect(r2.items[1]!.body).toBe("Three ideas for Baku, for you:");
    expect(r2.items[1]!.mada!.list).toHaveLength(3);
    expect((await detail(omar, c.circle.id)).circle.dest).toBe("Baku");
    const visa = SentMessages.parse((await say(omar, c.circle.id, { body: "@mada do we need a visa?" })).json);
    expect(visa.items[1]!.body).toContain("e-visa");
    // A plain message gets no answer from Mada.
    expect(SentMessages.parse((await say(omar, c.circle.id, { body: "ok" })).json).items).toHaveLength(1);
  });

  it("shares a plan and pins it; read receipts move when someone reads", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const c = await makeCircle(omar, "Istanbul for Eid", [hessa]);
    await join(omar, c, hessa);
    const shared = SentMessages.parse((await say(omar, c.circle.id, { card: { kind: "plan", id: "istanbul3" }, pin: true })).json);
    expect(shared.items.map((m) => m.kind)).toEqual(["card", "sys"]);
    expect((await detail(omar, c.circle.id)).pinned).toMatchObject({ id: "istanbul3", by: omar.id });
    expect((await say(omar, c.circle.id, { card: { kind: "plan", id: "nope" } })).status).toBe(400);
    await call(withParams(circlePatch, { id: c.circle.id }), { method: "PATCH", ...auth(hessa), body: { read: true } });
    const reads = (await msgs(omar, c.circle.id)).reads;
    expect(reads.find((r) => r.userId === hessa.id)).toBeTruthy();
    const list = CirclesResponse.parse((await call(circlesGet, { method: "GET", ...auth(hessa) })).json);
    expect(list.circles[0]!.unread).toBe(0);
  });

  it("votes: one each, tap again to take it back, the starter closes it and Mada offers to book the winner", async () => {
    const omar = await person("Omar");
    const [hessa, noor] = [await person("Hessa"), await person("Noor")];
    const c = await makeCircle(omar, "Cruise night", [hessa, noor]);
    await join(omar, c, hessa, noor);
    const v = SentMessages.parse((await call(withParams(votePost, { id: c.circle.id }), { ...auth(hessa), body: { q: "Which evening for the cruise", kind: "dates", options: ["Wed 10 Mar", "Thu 11 Mar"] } })).json).items[0]!;
    expect(v.vote!.q).toBe("Which evening for the cruise?");
    const cast = (w: Who, option: string) => call(withParams(castPost, { id: c.circle.id, mid: v.id }), { ...auth(w), body: { option } });
    await cast(omar, "o0");
    await cast(noor, "o0");
    await cast(hessa, "o1");
    let state = SentMessages.parse((await cast(hessa, "o1")).json).items[0]!; // taken back
    expect(state.vote!.options.map((o) => o.votes.length)).toEqual([2, 0]);
    state = SentMessages.parse((await cast(hessa, "o0")).json).items[0]!;
    expect(state.vote!.options[0]!.votes).toHaveLength(3);
    expect((await call(withParams(closePost, { id: c.circle.id, mid: v.id }), auth(noor))).status).toBe(403);
    const closed = SentMessages.parse((await call(withParams(closePost, { id: c.circle.id, mid: v.id }), auth(hessa))).json).items;
    expect(closed[0]!.vote).toMatchObject({ closed: true, winner: "o0" });
    expect(closed[1]!.body).toBe("Wednesday it is. Want us to book it?");
    expect(closed[1]!.mada!.actions[0]).toMatchObject({ label: "Book it", ask: "Which evening for the cruise: Wed 10 Mar" });
    expect((await cast(omar, "o1")).status).toBe(400);
    const dismissed = await call(withParams(msgPatch, { id: c.circle.id, mid: closed[1]!.id }), { method: "PATCH", ...auth(noor), body: { done: true } });
    expect(dismissed.json.items[0].mada.done).toBe(true);
  });

  it("a tied vote asks to pick, and picking gives the result", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const c = await makeCircle(omar, "Tie break", [hessa]);
    await join(omar, c, hessa);
    const v = SentMessages.parse((await call(withParams(votePost, { id: c.circle.id }), { ...auth(omar), body: { q: "Where should we go?", kind: "places", options: ["Baku", "AlUla"] } })).json).items[0]!;
    expect((await call(withParams(closePost, { id: c.circle.id, mid: v.id }), auth(omar))).status).toBe(400); // nobody voted
    await call(withParams(castPost, { id: c.circle.id, mid: v.id }), { ...auth(omar), body: { option: "o0" } });
    await call(withParams(castPost, { id: c.circle.id, mid: v.id }), { ...auth(hessa), body: { option: "o1" } });
    const tie = SentMessages.parse((await call(withParams(closePost, { id: c.circle.id, mid: v.id }), auth(omar))).json).items[1]!;
    expect(tie.body).toBe("It’s a tie between Baku and AlUla. Pick one and we’ll take it from there.");
    const picked = SentMessages.parse((await call(withParams(pickPost, { id: c.circle.id, mid: v.id }), { ...auth(hessa), body: { option: "o1" } })).json).items;
    expect(picked[0]!.vote!.winner).toBe("o1");
    expect(picked[1]!.mada!.actions[0]!.ask).toBe("Plan a trip to AlUla for 2");
    expect((await call(withParams(votePost, { id: c.circle.id }), { ...auth(omar), body: { q: "Same?", kind: "any", options: ["Yes", "yes"] } })).status).toBe(400);
  });
});

describe("splits, to the halala", () => {
  async function circleOf(n: number) {
    const people = [await person("Omar")];
    for (let i = 1; i < n; i += 1) people.push(await person(["Hessa", "Abdullah", "Noor", "Faris"][i - 1]!));
    const c = await makeCircle(people[0]!, `Split ${Math.random()}`, people.slice(1));
    await join(people[0]!, c, ...people.slice(1));
    return { c, people };
  }
  const split = (w: Who, id: string, body: unknown) => call(withParams(splitPost, { id }), { ...auth(w), body });

  it("splits equally in whole riyals, and to the halala when the total has halalas; the payer's share is paid", async () => {
    const { c, people } = await circleOf(3);
    const [omar] = people;
    const r = await split(omar!, c.circle.id, { what: "Dinner", total: 100_000, paidBy: omar!.id, mode: "equal", between: people.map((p) => p.id) });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const s = SentMessages.parse(r.json).items[0]!.split!;
    expect(s.shares.map((x) => x.amount)).toEqual([33_400, 33_300, 33_300]);
    expect(s.shares.reduce((a, x) => a + x.amount, 0)).toBe(100_000);
    expect(s.shares.map((x) => x.paid)).toEqual([true, false, false]);
    const odd = SentMessages.parse((await split(omar!, c.circle.id, { what: "Tickets", total: 1_001, paidBy: omar!.id, mode: "equal", between: people.map((p) => p.id) })).json).items[0]!.split!;
    expect(odd.shares.map((x) => x.amount)).toEqual([334, 334, 333]);
    const audit = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_audit WHERE action = 'circle.split_created' AND actor_id = ${omar!.id}`);
    expect(audit[0]!.n).toBe(2);
  });

  it("splits by family when people are tagged as family, and custom amounts must add up", async () => {
    const { c, people } = await circleOf(4);
    const [omar, hessa, abdullah, noor] = people as [Who, Who, Who, Who];
    await befriend(omar, hessa);
    await call(withParams(friendPatch, { id: hessa.id }), { method: "PATCH", ...auth(omar), body: { tag: "family" } });
    await befriend(abdullah, noor);
    await call(withParams(friendPatch, { id: noor.id }), { method: "PATCH", ...auth(abdullah), body: { tag: "family" } });
    const fam = SentMessages.parse((await split(omar, c.circle.id, { what: "Bosphorus cruise", total: 114_000, paidBy: omar.id, mode: "family", between: people.map((p) => p.id) })).json).items[0]!.split!;
    expect(fam.shares.map((s) => [s.ids.length, s.amount, s.paid])).toEqual([[2, 57_000, true], [2, 57_000, false]]);
    expect(fam.shares[1]!.key).toBe(abdullah.id);
    const bad = await split(omar, c.circle.id, { what: "Hotel", total: 10_000, paidBy: omar.id, mode: "custom", between: [omar.id, hessa.id], custom: { [omar.id]: 6_000, [hessa.id]: 3_000 } });
    expect(bad.status).toBe(400);
    expect(bad.json.error.message).toBe("The shares don’t add up to the total.");
    const good = SentMessages.parse((await split(omar, c.circle.id, { what: "Hotel", total: 10_000, paidBy: hessa.id, mode: "custom", between: [omar.id, hessa.id], custom: { [omar.id]: 6_000, [hessa.id]: 4_000 } })).json).items[0]!.split!;
    expect(good.shares.map((s) => s.amount)).toEqual([6_000, 4_000]);
    const outsider = await person("Outsider");
    expect((await split(omar, c.circle.id, { what: "X", total: 100, paidBy: omar.id, mode: "equal", between: [omar.id, outsider.id] })).status).toBe(400);
  });

  it("marks shares paid (own share, or anyone's by the payer), settles, reminds once a day, and audits it", async () => {
    const { c, people } = await circleOf(3);
    const [omar, hessa, abdullah] = people as [Who, Who, Who];
    const s = SentMessages.parse((await split(omar, c.circle.id, { what: "Van", total: 30_000, paidBy: omar.id, mode: "equal", between: people.map((p) => p.id) })).json).items[0]!;
    const paid = (w: Who, key: string, via = "cash") => call(withParams(paidPost, { id: c.circle.id, mid: s.id }), { ...auth(w), body: { key, via } });
    expect((await paid(hessa, abdullah.id)).status).toBe(403); // not hers, and she didn't pay the bill
    const remind = await call(withParams(remindSplitPost, { id: c.circle.id, mid: s.id }), auth(omar));
    expect(remind.json.items[0].split.reminded).toBe(true);
    expect(remind.json.items[1].sys).toMatchObject({ event: "reminded", users: [hessa.id, abdullah.id] });
    expect((await call(withParams(remindSplitPost, { id: c.circle.id, mid: s.id }), auth(omar))).status).toBe(400);
    expect((await call(withParams(remindSplitPost, { id: c.circle.id, mid: s.id }), auth(hessa))).status).toBe(403);
    const n = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_notifications WHERE kind = 'circle.share_reminder' AND user_id = ${hessa.id}`);
    expect(n[0]!.n).toBe(1);
    const own = await paid(hessa, hessa.id, "card");
    expect(own.json.items[1].sys).toMatchObject({ event: "paid", actor: hessa.id, amount: 10_000 });
    const last = await paid(omar, abdullah.id);
    expect(last.json.items[0].split.settled).toBe(true);
    expect(last.json.items[1].sys).toMatchObject({ event: "markedPaid", users: [abdullah.id] });
    expect((await paid(omar, abdullah.id)).status).toBe(200); // already paid: nothing changes
    const audit = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_audit WHERE action = 'circle.share_paid' AND entity_id = ${s.id}`);
    expect(audit[0]!.n).toBe(2);
  });
});

describe("circle settings", () => {
  it("rename (admin only), mute (each person), hand over admin, remove someone", async () => {
    const omar = await person("Omar");
    const [hessa, khalid] = [await person("Hessa"), await person("Khalid")];
    const c = await makeCircle(omar, "Riyadh Season", [hessa, khalid]);
    await join(omar, c, hessa, khalid);
    const id = c.circle.id;
    expect((await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(hessa), body: { name: "Hers" } })).status).toBe(403);
    const renamed = CircleDetail.parse((await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(omar), body: { name: "Season nights" } })).json);
    expect(renamed.circle.name).toBe("Season nights");
    const muted = CircleDetail.parse((await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(hessa), body: { muted: true } })).json);
    expect(muted.circle.muted).toBe(true);
    expect((await detail(omar, id)).circle.muted).toBe(false);
    expect((await call(withParams(memberDelete, { id, uid: khalid.id }), { method: "DELETE", ...auth(hessa) })).status).toBe(403);
    expect((await call(withParams(memberDelete, { id, uid: khalid.id }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect((await call(withParams(circleGet, { id }), { method: "GET", ...auth(khalid) })).status).toBe(404);
    await call(withParams(memberPatch, { id, uid: hessa.id }), { method: "PATCH", ...auth(omar), body: { role: "admin" } });
    const d = await detail(omar, id);
    expect(d.members.find((m) => m.id === hessa.id)!.role).toBe("admin");
    expect(d.members.find((m) => m.id === omar.id)!.role).toBe("member");
  });

  it("leaving hands admin on; the last one out deletes it; delete for everyone is the admin's", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const c = await makeCircle(omar, "Leavers", [hessa]);
    await join(omar, c, hessa);
    expect((await call(withParams(circleDelete, { id: c.circle.id }), { method: "DELETE", ...auth(hessa) })).status).toBe(403);
    expect((await call(withParams(leavePost, { id: c.circle.id }), auth(omar))).json).toEqual({ deleted: false });
    const d = await detail(hessa, c.circle.id);
    expect(d.members.map((m) => [m.short, m.role])).toEqual([["Hessa", "admin"]]);
    expect((await call(withParams(leavePost, { id: c.circle.id }), auth(hessa))).json).toEqual({ deleted: true });
    const gone = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_messages WHERE thread_id = ${c.circle.id}`);
    expect(gone[0]!.n).toBe(0);

    const c2 = await makeCircle(omar, "Gone for all", [hessa]);
    await join(omar, c2, hessa);
    expect((await call(withParams(circleDelete, { id: c2.circle.id }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect((await call(withParams(circleGet, { id: c2.circle.id }), { method: "GET", ...auth(hessa) })).status).toBe(404);
  });

  it("invites: admin adds more, reminds once a day, cancels (the person isn't told); invitees can decline", async () => {
    const omar = await person("Omar");
    const [maha, yousef] = [await person("Maha"), await person("Yousef")];
    const c = await makeCircle(omar, "Invitees");
    const d = CircleDetail.parse((await call(withParams(circleInvitesPost, { id: c.circle.id }), { ...auth(omar), body: { userIds: [maha.id, yousef.id] } })).json);
    expect(d.invited.map((i) => i.person.short).sort()).toEqual(["Maha", "Yousef"]);
    const iv = d.invited.find((i) => i.person.id === maha.id)!;
    expect((await call(withParams(inviteRemind, { ref: iv.inviteId }), auth(omar))).status).toBe(200);
    expect((await call(withParams(inviteRemind, { ref: iv.inviteId }), auth(omar))).status).toBe(400);
    expect((await call(withParams(inviteDelete, { ref: iv.inviteId }), { method: "DELETE", ...auth(omar) })).status).toBe(200);
    expect((await call(withParams(acceptPost, { ref: iv.inviteId }), auth(maha))).status).toBe(404);
    const yv = d.invited.find((i) => i.person.id === yousef.id)!;
    expect((await call(withParams(declinePost, { ref: yv.inviteId }), auth(maha))).status).toBe(404); // not hers
    expect((await call(withParams(declinePost, { ref: yv.inviteId }), auth(yousef))).status).toBe(200);
    expect((await detail(omar, c.circle.id)).invited).toHaveLength(0);
  });
});

describe("invite links", () => {
  it("anyone can see the preview, signed in or not; joining by link lands you in the circle once", async () => {
    const abdullah = await person("Abdullah");
    const noor = await person("Noor");
    const c = await makeCircle(abdullah, "Istanbul for Eid", [noor], { cover: "istanbul" });
    await join(abdullah, c, noor);
    const link = (await call(withParams(linkPost, { id: c.circle.id }), auth(abdullah))).json;
    expect(link.url).toBe(`https://madatrips.sa/join/${link.code}`);
    expect((await call(withParams(linkPost, { id: c.circle.id }), auth(abdullah))).json.code).toBe(link.code); // same link again
    const pv = await call(withParams(invitePreview, { ref: link.code }), { method: "GET" });
    expect(pv.status).toBe(200);
    expect(pv.json).toMatchObject({ status: "open", kind: "circle", from: { short: "Abdullah" }, circle: { name: "Istanbul for Eid", memberCount: 2, cover: "istanbul" } });
    expect(JSON.stringify(pv.json)).not.toContain(abdullah.phone);
    const omar = await person("Omar");
    const r = await call(withParams(acceptPost, { ref: link.code }), auth(omar));
    expect(r.json).toEqual({ circleId: c.circle.id, friendId: null, already: false });
    expect((await call(withParams(acceptPost, { ref: link.code }), auth(omar))).json.already).toBe(true);
    const last = (await msgs(omar, c.circle.id)).items.at(-1)!;
    expect(last.sys).toMatchObject({ event: "joinedByLink", actor: omar.id, users: [abdullah.id] });
    expect(CirclesResponse.parse((await call(circlesGet, { method: "GET", ...auth(omar) })).json).circles[0]!.fresh).toBe(true);
  });

  it("refuses forged and unknown codes, and shows an expired link as expired (accepting it is refused)", async () => {
    const abdullah = await person("Abdullah");
    const c = await makeCircle(abdullah, "Summer in Baku");
    const link = (await call(withParams(linkPost, { id: c.circle.id }), auth(abdullah))).json;
    const forged = link.code.slice(0, 9) + (link.code.endsWith("a") ? "bbbbbb" : "aaaaaa");
    expect((await call(withParams(invitePreview, { ref: forged }), { method: "GET" })).status).toBe(404);
    expect((await call(withParams(invitePreview, { ref: "nonsense" }), { method: "GET" })).status).toBe(404);
    await db.execute(raw`UPDATE app_circle_invites SET expires_at = now() - interval '1 day' WHERE circle_id = ${c.circle.id}`);
    expect((await call(withParams(invitePreview, { ref: link.code }), { method: "GET" })).json.status).toBe("expired");
    const omar = await person("Omar");
    const r = await call(withParams(acceptPost, { ref: link.code }), auth(omar));
    expect(r.status).toBe(404);
    expect(r.json.error.message).toBe("This invite has expired.");
    expect((await call(withParams(acceptPost, { ref: link.code }), {})).status).toBe(401);
  });

  it("a blocked person can't use the link of the person who blocked them", async () => {
    const abdullah = await person("Abdullah");
    const pest = await person("Pest");
    const c = await makeCircle(abdullah, "No pests");
    const link = (await call(withParams(linkPost, { id: c.circle.id }), auth(abdullah))).json;
    await call(blocksPost, { ...auth(abdullah), body: { userId: pest.id } });
    expect((await call(withParams(invitePreview, { ref: link.code }), { method: "GET", ...auth(pest) })).status).toBe(404);
    expect((await call(withParams(acceptPost, { ref: link.code }), auth(pest))).status).toBe(404);
    expect((await call(circlesPost, { ...auth(pest), body: { name: "Hi", invite: [abdullah.id] } })).status).toBe(404);
  });
});

describe("direct messages", () => {
  it("opens one conversation per pair of friends, and a block stops it", async () => {
    const omar = await person("Omar");
    const noor = await person("Noor");
    expect((await call(dmPost, { ...auth(omar), body: { userId: noor.id } })).status).toBe(403); // not friends yet
    await befriend(omar, noor);
    const a = (await call(dmPost, { ...auth(omar), body: { userId: noor.id } })).json.circleId;
    const b = (await call(dmPost, { ...auth(noor), body: { userId: omar.id } })).json.circleId;
    expect(a).toBe(b);
    expect((await say(omar, a, { body: "Salam" })).status).toBe(201);
    const list = CirclesResponse.parse((await call(circlesGet, { method: "GET", ...auth(noor) })).json).circles;
    expect(list[0]).toMatchObject({ dm: true, name: "Omar", unread: 1 });
    await call(blocksPost, { ...auth(noor), body: { userId: omar.id } });
    expect((await say(omar, a, { body: "Hello?" })).status).toBe(403);
  });
});

describe("dates", () => {
  it("knows today", () => expect(addDays(todayIn(), 1) > todayIn()).toBe(true));
});
