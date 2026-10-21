import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { MONTHS_LONG, addDays, readSseFrames, todayIn, type AskChatEvent, type AskIntent } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as listGet } from "@/app/api/app/v1/ask/threads/route";
import { DELETE as threadDelete, GET as threadGet, PATCH as threadPatch } from "@/app/api/app/v1/ask/threads/[id]/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { nextTitle, titleFrom } from "@/lib/app/ask-chat/titles";
import { tripStatusOf } from "@/lib/app/ask-chat/threads";
import { fakeApi } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { callP, signIn } from "./wallet-helpers";

/*
 * The conversations list (docs/app/ASK-INTEGRATED.md §2, U1): one chat per trip or topic, each with its own turns,
 * titled on the server, found by title, archived and deleted without touching trips; the "About your X trip?" question
 * once, and silent attach only from the trip page.
 */

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const events = readSseFrames(await (await chatPost(req)).text()).events;
  const thread = events.find((e): e is Extract<AskChatEvent, { type: "thread" }> => e.type === "thread") ?? null;
  const cards = events.flatMap((e) => (e.type === "cards" ? e.cards : []));
  const done = events.find((e): e is Extract<AskChatEvent, { type: "done" }> => e.type === "done");
  return { events, thread, threadId: thread?.threadId ?? null, cards, text: done?.text ?? null };
}
const list = (token: string, query = "") => callP(listGet, {}, { token, query });
const open = (token: string, id: string) => callP(threadGet, { id }, { token });

async function tripFor(userId: string, city: string, start: string, end: string, status = "booked") {
  const [t] = await db.insert(appTrips).values({ ownerId: userId, city, startDate: start, endDate: end, status }).returning();
  return t!;
}

beforeEach(() => {
  process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "Happy to help with that." }] })));
});
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; });

describe("two chats, two places", () => {
  it("stay separate, each titled, and each opens with its own turns on another device", async () => {
    const me = await signIn();
    const a = await chat(me.token, { text: "Flights to Istanbul in December" });
    const a2 = await chat(me.token, { text: "Something with a morning departure", threadId: a.threadId });
    expect(a2.threadId).toBe(a.threadId);
    const b = await chat(me.token, { text: "A hotel in London" });
    expect(b.threadId).not.toBe(a.threadId);

    const l = await list(me.token);
    expect(l.status).toBe(200);
    expect(l.json.threads.map((t: { id: string }) => t.id)).toEqual([b.threadId, a.threadId]);
    const [tb, ta] = l.json.threads;
    expect(ta.title).toMatch(/Istanbul/);
    expect(tb.title).toBe("A stay in London");
    expect(ta.preview).toBe("Happy to help with that.");
    expect(ta.tripId).toBeNull();

    // A second device: nothing kept on the phone, everything from the server.
    const oa = await open(me.token, a.threadId!);
    expect(oa.json.lines.filter((x: { who: string }) => x.who === "me").map((x: { text: string }) => x.text)).toEqual(["Flights to Istanbul in December", "Something with a morning departure"]);
    const ob = await open(me.token, b.threadId!);
    expect(ob.json.lines.map((x: { text: string }) => x.text)).toEqual(["A hotel in London", "Happy to help with that."]);
  });

  it("search finds by title, never by the words inside; another account sees none of it", async () => {
    const me = await signIn();
    const a = await chat(me.token, { text: "Flights to Istanbul in December" });
    await chat(me.token, { text: "A hotel in London" });
    await chat(me.token, { text: "Its morning departure please", threadId: a.threadId });
    const hit = await list(me.token, "?q=istanbul");
    expect(hit.json.threads.map((t: { id: string }) => t.id)).toEqual([a.threadId]);
    expect((await list(me.token, "?q=departure")).json.threads).toHaveLength(0);

    const other = await signIn();
    expect((await list(other.token)).json.threads).toHaveLength(0);
    expect((await open(other.token, a.threadId!)).status).toBe(404);
    expect((await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: other.token, body: { archived: true } })).status).toBe(404);
    expect((await callP(threadDelete, { id: a.threadId! }, { method: "DELETE", token: other.token })).status).toBe(404);
  });

  it("archive hides a chat, archived=1 lists it, and writing to it brings it back", async () => {
    const me = await signIn();
    const a = await chat(me.token, { text: "Flights to Istanbul in December" });
    const p = await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: me.token, body: { archived: true } });
    expect(p.status).toBe(200);
    expect(p.json.thread.archived).toBe(true);
    const l = await list(me.token);
    expect(l.json.threads).toHaveLength(0);
    expect(l.json.archivedCount).toBe(1);
    expect((await list(me.token, "?archived=1")).json.threads[0].id).toBe(a.threadId);
    // Unarchive by hand…
    await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: me.token, body: { archived: false } });
    expect((await list(me.token)).json.threads).toHaveLength(1);
    // …or by writing to it.
    await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: me.token, body: { archived: true } });
    await chat(me.token, { text: "And hotels near Taksim", threadId: a.threadId });
    expect((await list(me.token)).json.threads[0]).toMatchObject({ id: a.threadId, archived: false });
  });

  it("a rename sticks; an empty title goes back to the automatic one", async () => {
    const me = await signIn();
    const a = await chat(me.token, { text: "A hotel in London" });
    await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: me.token, body: { title: "Lahore wedding" } });
    await chat(me.token, { text: "Flights to Istanbul in December", threadId: a.threadId });
    const [row] = await db.select().from(appAskThreads).where(eq(appAskThreads.id, a.threadId!));
    expect(row).toMatchObject({ title: "Lahore wedding", titledBy: "traveller" });
    await callP(threadPatch, { id: a.threadId! }, { method: "PATCH", token: me.token, body: { title: "" } });
    await chat(me.token, { text: "A hotel in London please", threadId: a.threadId });
    expect((await open(me.token, a.threadId!)).json.thread.title).toBe("A stay in London");
  });

  it("delete removes the chat and never its trip", async () => {
    const me = await signIn();
    const trip = await tripFor(me.user.id, "Dubai", addDays(todayIn(), 20), addDays(todayIn(), 24));
    const a = await chat(me.token, { text: "What should we pack?", tripId: trip.id });
    expect(a.thread?.tripId).toBe(trip.id);
    const d = await callP(threadDelete, { id: a.threadId! }, { method: "DELETE", token: me.token });
    expect(d.status).toBe(200);
    expect((await open(me.token, a.threadId!)).status).toBe(404);
    expect(await db.select().from(appTrips).where(eq(appTrips.id, trip.id))).toHaveLength(1);
  });
});

describe("new chat or continue (§2.2)", () => {
  it("asks once about a matching trip: no chat exists until the answer; yes joins the trip's chat, new starts its own", async () => {
    const me = await signIn();
    const trip = await tripFor(me.user.id, "Dubai", addDays(todayIn(), 20), addDays(todayIn(), 24));
    const before = (await list(me.token)).json.threads.length;

    const q = await chat(me.token, { text: "Hotels in Dubai" });
    expect(q.threadId).toBeNull();
    expect(q.cards).toEqual([expect.objectContaining({ type: "attach", tripId: trip.id, place: "Dubai" })]);
    expect(q.text).toMatch(/^About your Dubai trip, .+\?$/);
    expect((await list(me.token)).json.threads.length).toBe(before);

    // Yes, the first time: a chat about the trip is made.
    const yes = await chat(me.token, { text: "Hotels in Dubai", attach: "trip", tripId: trip.id });
    expect(yes.thread).toMatchObject({ tripId: trip.id });
    expect(yes.thread?.moved).toBeUndefined();
    // Yes again later: the message moves into that same chat.
    const again = await chat(me.token, { text: "Hotels in Dubai", attach: "trip", tripId: trip.id });
    expect(again.thread).toMatchObject({ threadId: yes.threadId, moved: true, tripId: trip.id });
    // Something new: its own chat, about no trip.
    const fresh = await chat(me.token, { text: "Hotels in Dubai", attach: "new" });
    expect(fresh.threadId).not.toBe(yes.threadId);
    expect(fresh.thread?.tripId).toBeNull();

    const rows = (await list(me.token)).json.threads;
    const attached = rows.find((r: { id: string }) => r.id === yes.threadId);
    expect(attached).toMatchObject({ tripId: trip.id, tripStatus: "booked" });
    expect(attached.title).toMatch(/^Dubai · /);
    expect((await list(me.token, `?tripId=${trip.id}`)).json.threads.map((r: { id: string }) => r.id)).toEqual([yes.threadId]);
  });

  it("never asks about a past trip or other dates; the trip page attaches silently to the trip's own chat", async () => {
    const me = await signIn();
    await tripFor(me.user.id, "Istanbul", addDays(todayIn(), -40), addDays(todayIn(), -33), "completed");
    const past = await chat(me.token, { text: "Flights to Istanbul in December" });
    expect(past.threadId).not.toBeNull();
    expect(past.cards.some((c) => c.type === "attach")).toBe(false);

    const trip = await tripFor(me.user.id, "Dubai", addDays(todayIn(), 20), addDays(todayIn(), 24));
    const later = MONTHS_LONG[Number(addDays(todayIn(), 120).slice(5, 7)) - 1];
    const other = await chat(me.token, { text: `Hotels in Dubai in ${later}` });
    expect(other.cards.some((c) => c.type === "attach")).toBe(false);

    const fromPage = await chat(me.token, { text: "Is breakfast included?", tripId: trip.id });
    expect(fromPage.cards.some((c) => c.type === "attach")).toBe(false);
    expect(fromPage.thread?.tripId).toBe(trip.id);
    const second = await chat(me.token, { text: "And a late checkout?", tripId: trip.id });
    expect(second.threadId).toBe(fromPage.threadId);
    // Someone else's trip id is ignored.
    const stranger = await signIn();
    const theirs = await chat(stranger.token, { text: "Is breakfast included?", tripId: trip.id });
    expect(theirs.thread?.tripId).toBeNull();
  });
});

describe("titles", () => {
  const base: AskIntent = { kind: "flight", destination: null, destinationName: null, from: null, depart: null, return: null, tripType: null, monthOnly: null, cabin: null, cabinNote: null, travellerIds: null, travellerCount: null, infants: 0, needs: {}, needsMentioned: [], answers: {}, ask: null, source: "rules" };
  it("a route with dates in English and Arabic, else the kind and place, else the first words", () => {
    const i = { ...base, kind: "plan" as const, destination: "alula", from: "RUH" as const, depart: "2026-11-20", return: "2026-11-22" };
    expect(titleFrom({ intent: i, trip: null, words: "", lang: "en" })).toEqual({ title: "Riyadh → AlUla · 20–22 Nov", by: "route" });
    expect(titleFrom({ intent: i, trip: null, words: "", lang: "ar" })?.title).toBe("الرياض ← العُلا · 20–22 نوفمبر");
    expect(titleFrom({ intent: { ...base, kind: "esim", destinationName: "Pakistan" }, trip: null, words: "", lang: "en" })?.title).toBe("eSIM for Pakistan");
    expect(titleFrom({ intent: { ...base, kind: "general" }, trip: null, words: "how much is a visa for my mother please thanks", lang: "en" })).toEqual({ title: "how much is a visa for…", by: "words" });
    expect(titleFrom({ intent: null, trip: { city: "AlUla", startDate: "2026-11-28", endDate: "2026-12-03" }, words: "", lang: "en" })?.title).toBe("AlUla · 28 Nov – 3 Dec");
  });
  it("only ever gets stronger, and never over a rename", () => {
    expect(nextTitle({ title: "eSIM for Pakistan", by: "place" }, { title: "how much", by: "words" })).toBeNull();
    expect(nextTitle({ title: "eSIM for Pakistan", by: "place" }, { title: "Flights to Dubai", by: "place" })).toBeNull();
    expect(nextTitle({ title: "how much", by: "words" }, { title: "Flights to Dubai", by: "place" })).toEqual({ title: "Flights to Dubai", by: "place" });
    expect(nextTitle({ title: "Mine", by: "traveller" }, { title: "Dubai · 1–3 Dec", by: "trip" })).toBeNull();
  });
  it("trip status for the chip", () => {
    expect(tripStatusOf("planning", "2026-11-20", "2026-11-22", "2026-10-21")).toBe("planning");
    expect(tripStatusOf("booked", "2026-11-20", "2026-11-22", "2026-10-21")).toBe("booked");
    expect(tripStatusOf("booked", "2026-10-20", "2026-10-22", "2026-10-21")).toBe("today");
    expect(tripStatusOf("booked", "2026-10-01", "2026-10-02", "2026-10-21")).toBe("done");
  });
});
