import { afterEach, describe, expect, it, vi } from "vitest";
import { sql as raw } from "drizzle-orm";
import { CircleDetail, CircleEventsResponse, CircleLiveEvent, MessagesPage, SentMessages } from "@mada/shared";
import { db, sql as pg } from "@/db";
import { POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { PATCH as circlePatch } from "@/app/api/app/v1/circles/[id]/route";
import { GET as msgsGet, POST as msgsPost } from "@/app/api/app/v1/circles/[id]/messages/route";
import { POST as reactPost } from "@/app/api/app/v1/circles/[id]/messages/[mid]/reactions/route";
import { POST as votePost } from "@/app/api/app/v1/circles/[id]/votes/route";
import { POST as castPost } from "@/app/api/app/v1/circles/[id]/votes/[mid]/route";
import { POST as splitPost } from "@/app/api/app/v1/circles/[id]/splits/route";
import { POST as paidPost } from "@/app/api/app/v1/circles/[id]/splits/[mid]/paid/route";
import { DELETE as memberDelete } from "@/app/api/app/v1/circles/[id]/members/[uid]/route";
import { POST as circleInvitesPost } from "@/app/api/app/v1/circles/[id]/invites/route";
import { POST as typingPost } from "@/app/api/app/v1/circles/[id]/typing/route";
import { POST as acceptPost } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { GET as eventsGet } from "@/app/api/app/v1/circles/events/route";
import { GET as liveGet } from "@/app/api/app/v1/circles/live/route";
import { call, person, withParams, type Who } from "./circles-helpers";

/* Circles, live: the events feed the triggers write, what each person may see of it, the SSE stream and its polling
 * twin, typing, reactions and read receipts. */

const auth = (w: Who) => ({ token: w.token });
async function circleWith(owner: Who, name: string, members: Who[]) {
  const d = CircleDetail.parse((await call(circlesPost, { ...auth(owner), body: { name, invite: members.map((m) => m.id) } })).json);
  for (const m of members) {
    const iv = d.invited.find((i) => i.person.id === m.id)!;
    expect((await call(withParams(acceptPost, { ref: iv.inviteId }), auth(m))).status).toBe(200);
  }
  return d.circle.id;
}
const events = async (w: Who, after: number) => {
  const r = await call(eventsGet, { method: "GET", path: `/api/app/v1/circles/events?after=${after}`, ...auth(w) });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return CircleEventsResponse.parse(r.json);
};
const head = async (w: Who) => CircleEventsResponse.parse((await call(eventsGet, { method: "GET", path: "/api/app/v1/circles/events", ...auth(w) })).json).cursor;
const kinds = (r: CircleEventsResponse, circleId?: string) => r.events.filter((e) => !circleId || e.circleId === circleId).map((e) => e.kind);
const say = async (w: Who, id: string, body: string) => SentMessages.parse((await call(withParams(msgsPost, { id }), { ...auth(w), body: { body } })).json).items[0]!;

describe("the events feed", () => {
  it("a message, a vote, a reaction and a paid share each show up for members, as what changed and never what was said", async () => {
    const [omar, noor] = [await person("Omar"), await person("Noor")];
    const id = await circleWith(omar, "Live crew", [noor]);
    const start = await head(omar);
    const m = await say(noor, id, "Secret plan for Eid");
    let r = await events(omar, start);
    const msg = r.events.find((e) => e.kind === "message")!;
    expect(msg).toMatchObject({ circleId: id, ref: m.id, actor: noor.id });
    expect(JSON.stringify(r)).not.toContain("Secret");

    const vote = SentMessages.parse((await call(withParams(votePost, { id }), { ...auth(omar), body: { q: "Which hotel?", kind: "any", options: ["Pera", "Galata"] } })).json).items[0]!;
    const c1 = r.cursor;
    await call(withParams(castPost, { id, mid: vote.id }), { ...auth(noor), body: { option: vote.vote!.options[0]!.id } });
    r = await events(omar, c1);
    expect(kinds(r, id)).toEqual(expect.arrayContaining(["message", "vote"]));
    expect(r.events.find((e) => e.kind === "vote")).toMatchObject({ ref: vote.id, actor: noor.id });

    const c2 = r.cursor;
    const rx = await call(withParams(reactPost, { id, mid: m.id }), { ...auth(omar), body: { emoji: "❤️" } });
    expect(rx.status).toBe(200);
    expect(SentMessages.parse(rx.json).items[0]!.reactions).toEqual([{ emoji: "❤️", ids: [omar.id] }]);
    r = await events(noor, c2);
    expect(r.events.find((e) => e.kind === "reaction")).toMatchObject({ ref: m.id, actor: omar.id });

    const split = SentMessages.parse((await call(withParams(splitPost, { id }), { ...auth(omar), body: { what: "Dinner", total: 20_000, paidBy: omar.id, mode: "equal", between: [omar.id, noor.id] } })).json).items[0]!;
    const c3 = (await events(noor, c2)).cursor;
    await call(withParams(paidPost, { id, mid: split.id }), { ...auth(noor), body: { key: noor.id } });
    r = await events(omar, c3);
    expect(kinds(r, id)).toContain("split");
  });

  it("someone outside the circle sees nothing of it", async () => {
    const [omar, noor, stranger] = [await person("Omar"), await person("Noor"), await person("Stranger")];
    const id = await circleWith(omar, "Private live", [noor]);
    const start = await head(stranger);
    await say(noor, id, "Hello");
    await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(omar), body: { name: "Renamed live" } });
    const r = await events(stranger, start);
    expect(r.events.filter((e) => e.circleId === id)).toEqual([]);
    expect(r.cursor).toBeGreaterThanOrEqual(start);
  });

  it("members joining, being removed and invites: the person concerned hears it even when not (or no longer) a member", async () => {
    const [omar, noor, sara] = [await person("Omar"), await person("Noor"), await person("Sara")];
    const id = await circleWith(omar, "Comings and goings", [noor]);
    const start = await head(sara);
    await call(withParams(circleInvitesPost, { id }), { ...auth(omar), body: { userIds: [sara.id] } });
    let r = await events(sara, start);
    expect(r.events.find((e) => e.kind === "invite" && e.circleId === id)).toBeTruthy();

    const before = await head(noor);
    await call(withParams(memberDelete, { id, uid: noor.id }), { method: "DELETE", ...auth(omar) });
    r = await events(noor, before);
    expect(r.events.find((e) => e.kind === "member" && e.ref === noor.id)).toBeTruthy();
    // After that, Noor hears nothing more from the circle.
    const after = await head(noor);
    await say(omar, id, "Still here");
    expect((await events(noor, after)).events.filter((e) => e.circleId === id)).toEqual([]);
  });

  it("a read receipt moves only when someone reads past another person's message", async () => {
    const [omar, noor] = [await person("Omar"), await person("Noor")];
    const id = await circleWith(omar, "Receipts", [noor]);
    await say(omar, id, "Are you coming?");
    const start = await head(omar);
    await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(noor), body: { read: true } });
    let r = await events(omar, start);
    expect(r.events.filter((e) => e.kind === "read")).toEqual([expect.objectContaining({ actor: noor.id, circleId: id })]);
    // Reading again with nothing new: no new receipt.
    const c = r.cursor;
    await call(withParams(circlePatch, { id }), { method: "PATCH", ...auth(noor), body: { read: true } });
    r = await events(omar, c);
    expect(r.events.filter((e) => e.kind === "read")).toEqual([]);
  });

  it("typing: members see it, at most one every 3 seconds per person", async () => {
    const [omar, noor, stranger] = [await person("Omar"), await person("Noor"), await person("Stranger")];
    const id = await circleWith(omar, "Typing", [noor]);
    const start = await head(omar);
    expect((await call(withParams(typingPost, { id }), auth(noor))).status).toBe(200);
    expect((await call(withParams(typingPost, { id }), auth(noor))).status).toBe(200);
    expect((await call(withParams(typingPost, { id }), auth(stranger))).status).toBe(404);
    const r = await events(omar, start);
    expect(r.events.filter((e) => e.kind === "typing")).toEqual([expect.objectContaining({ actor: noor.id })]);
  });

  it("the cursor waits for a transaction still writing, then moves past it once it lands", async () => {
    const [omar, noor] = [await person("Omar"), await person("Noor")];
    const id = await circleWith(omar, "Gaps", [noor]);
    const start = await head(omar);
    // A slow writer takes an id and holds it; a quick one after it commits first.
    let release!: () => void;
    const held = new Promise<void>((res) => { release = res; });
    let slowStarted!: () => void;
    const started = new Promise<void>((res) => { slowStarted = res; });
    const slow = pg.begin(async (tx) => {
      await tx`INSERT INTO app_circle_events (circle_id, kind, actor_id) VALUES (${id}, 'typing', ${noor.id})`;
      slowStarted();
      await held;
    });
    await started;
    await say(noor, id, "After the slow one");
    const r1 = await events(omar, start);
    expect(r1.events.some((e) => e.kind === "message")).toBe(true);
    const gapAt = r1.cursor;
    release();
    await slow;
    const r2 = await events(omar, gapAt);
    expect(r2.events.some((e) => e.kind === "typing" && e.actor === noor.id)).toBe(true);
    expect(r2.cursor).toBeGreaterThan(gapAt);
  });
});

describe("GET /circles/live (Server-Sent Events)", () => {
  afterEach(() => { vi.unstubAllEnvs(); });

  it("needs a session", async () => {
    expect((await call(liveGet, { method: "GET" })).status).toBe(401);
    expect((await call(eventsGet, { method: "GET" })).status).toBe(401);
  });

  it("streams hello, then each change as an event with its id, then bye; resumes from ?after=", async () => {
    vi.stubEnv("CIRCLES_LIVE_STREAM_MS", "1500");
    vi.stubEnv("CIRCLES_LIVE_POLL_MS", "100");
    const [omar, noor] = [await person("Omar"), await person("Noor")];
    const id = await circleWith(omar, "Streaming", [noor]);
    const res = await liveGet(new Request("http://localhost/api/app/v1/circles/live", { headers: { authorization: `Bearer ${omar.token}`, "x-forwarded-for": "10.9.9.9" } }));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    expect(res.headers.get("cache-control")).toContain("no-cache");
    setTimeout(() => { void say(noor, id, "Live hello"); }, 300);
    const text = await res.text();
    expect(text).toMatch(/^retry: \d+\nevent: hello\ndata: \{"cursor":\d+\}/);
    const frames = [...text.matchAll(/id: (\d+)\nevent: circle\ndata: (.+)\n/g)].map((m) => ({ id: Number(m[1]), e: CircleLiveEvent.parse(JSON.parse(m[2]!)) }));
    const msg = frames.find((f) => f.e.kind === "message" && f.e.circleId === id);
    expect(msg?.e.actor).toBe(noor.id);
    expect(msg!.id).toBe(msg!.e.id);
    expect(text).toContain("event: bye");

    // Reconnecting from before that message gets it again; from after it, not.
    const again = await liveGet(new Request(`http://localhost/api/app/v1/circles/live?after=${msg!.id - 1}`, { headers: { authorization: `Bearer ${omar.token}` } }));
    expect(await again.text()).toContain(`id: ${msg!.id}\n`);
    const later = await liveGet(new Request("http://localhost/api/app/v1/circles/live", { headers: { authorization: `Bearer ${omar.token}`, "last-event-id": String(msg!.id) } }));
    expect(await later.text()).not.toContain(`id: ${msg!.id}\n`);
  });

  it("a cursor from the future is clamped, so nothing is skipped", async () => {
    const omar = await person("Omar");
    const r = await call(eventsGet, { method: "GET", path: "/api/app/v1/circles/events?after=999999999999", ...auth(omar) });
    expect(r.json.cursor).toBeLessThan(999999999999);
  });
});

describe("reactions", () => {
  it("one of each per person; take it back; not on system lines; members only", async () => {
    const [omar, noor, stranger] = [await person("Omar"), await person("Noor"), await person("Stranger")];
    const id = await circleWith(omar, "Reacting", [noor]);
    const m = await say(noor, id, "Flights are booked");
    const react = (w: Who, body: unknown, mid = m.id) => call(withParams(reactPost, { id, mid }), { ...auth(w), body });
    await react(omar, { emoji: "👍" });
    await react(omar, { emoji: "👍" });
    await react(noor, { emoji: "👍" });
    const r = SentMessages.parse((await react(noor, { emoji: "🔥" })).json).items[0]!;
    expect(r.reactions).toEqual([{ emoji: "👍", ids: [omar.id, noor.id] }, { emoji: "🔥", ids: [noor.id] }]);
    const off = SentMessages.parse((await react(omar, { emoji: "👍", on: false })).json).items[0]!;
    expect(off.reactions).toEqual([{ emoji: "👍", ids: [noor.id] }, { emoji: "🔥", ids: [noor.id] }]);
    expect((await react(omar, { emoji: "🍕" })).status).toBe(400);
    expect((await react(stranger, { emoji: "👍" })).status).toBe(404);
    const page = MessagesPage.parse((await call(withParams(msgsGet, { id }), { method: "GET", ...auth(omar) })).json);
    const sys = page.items.find((x) => x.kind === "sys")!;
    expect((await react(omar, { emoji: "👍" }, sys.id)).status).toBe(400);
    expect(page.items.find((x) => x.id === m.id)!.reactions).toHaveLength(2);
  });
});

describe("retention", () => {
  it("events older than 3 days can be swept without touching newer ones", async () => {
    const omar = await person("Omar");
    const id = await circleWith(omar, "Old news", []);
    await db.execute(raw`INSERT INTO app_circle_events (circle_id, kind, created_at) VALUES (${id}, 'message', now() - interval '4 days')`);
    await db.execute(raw`DELETE FROM app_circle_events WHERE created_at < now() - make_interval(days => 3)`);
    const [left] = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_circle_events WHERE circle_id = ${id}`);
    expect(Number(left!.n)).toBeGreaterThan(0);
    const [old] = await db.execute<{ n: number }>(raw`SELECT count(*)::int AS n FROM app_circle_events WHERE circle_id = ${id} AND created_at < now() - interval '3 days'`);
    expect(Number(old!.n)).toBe(0);
  });
});

