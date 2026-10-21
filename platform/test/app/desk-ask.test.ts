import { afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import { AskDeskResponse, readSseFrames, type AskChatEvent } from "@mada/shared";
import { db, schema } from "@/db";
import { appNotifications, appUsers } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as deskGet } from "@/app/api/app/v1/ask/chat/desk/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { handBackNote, joinedText, type AskLine } from "@/lib/app/ask-chat/takeover";
import type { DeskActor } from "@/lib/app/desk/core";
import { saveAgent } from "@/lib/app/desk/agents";
import { deskLines, handBackAsk, listAskThreads, readAsk, replyOnAsk, takeOverAsk } from "@/lib/app/desk/ask";
import { createTicket, ticketsFor } from "@/lib/app/desk/tickets";
import { fakeApi, type Fake, type Script } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { callP, signIn } from "./wallet-helpers";

/*
 * Ask threads on the desk (DESK-PLAN.md U5): read with the §7 access rule and an audit row per read, take over (the
 * model stops answering, the traveller's messages are kept for the desk, the app reads "Noura from Mada joined" and
 * her replies), and hand back (the model answers again, knowing what was said meanwhile).
 */

type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const res = await chatPost(req);
  const events = readSseFrames(await res.text()).events;
  const done = events.find((e): e is Extract<AskChatEvent, { type: "done" }> => e.type === "done");
  const thread = events.find((e): e is Extract<AskChatEvent, { type: "thread" }> => e.type === "thread");
  return { events, text: done?.text ?? null, threadId: thread?.threadId ?? null };
}
const updates = async (token: string, threadId: string, after = -1) =>
  callP(deskGet, {}, { method: "GET", token, query: `?threadId=${threadId}&after=${after}` });

/** The text of every user-side block of a request: the context rides there. */
const userText = (p: Params) => p.messages.filter((m) => m.role === "user").flatMap((m) => (typeof m.content === "string" ? [m.content] : (m.content as { type: string; text?: string }[]).map((b) => b.text ?? ""))).join("\n");

// A person when asked for, otherwise a plain answer.
const script: Script = (p) => {
  const last = p.messages.at(-1)!;
  const toolResult = Array.isArray(last.content) && (last.content as { type: string }[]).some((b) => b.type === "tool_result");
  const words = Array.isArray(last.content) ? (last.content as { type: string; text?: string }[]).filter((b) => b.type === "text").at(-1)?.text ?? "" : String(last.content);
  if (!toolResult && /a person/i.test(words)) return { blocks: [{ type: "tool_use", name: "talk_to_human", input: { summary: "Wants a person about a refund.", urgent: false } }] };
  return { blocks: [{ type: "text", text: toolResult ? "The team at Mada can take it from here." : "Happy to help with that." }] };
};

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `ask_test_${Date.now()}_${seq}`, name: `Ask ${seq}`, nameAr: "اسأل", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `ask${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}
const reads = (threadId: string) => db.select().from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "desk.ask.read"), eq(schema.auditEvents.entityId, threadId)));
const row = async (id: string) => (await db.select().from(appAskThreads).where(eq(appAskThreads.id, id)))[0]!;

let lead: DeskActor, agent: DeskActor, other: DeskActor, noAsk: DeskActor, noProfile: DeskActor;
let fake: Fake;

beforeAll(async () => {
  lead = await opsUser("Bader Lead", ["desk.view", "desk.act", "desk.admin", "desk.tickets.manage", "desk.ask.read"]);
  agent = await opsUser("Noura Alharbi", ["desk.view", "desk.act", "desk.ask.read"]);
  other = await opsUser("Majed Agent", ["desk.view", "desk.act", "desk.ask.read"]);
  noAsk = await opsUser("No Ask", ["desk.view", "desk.act"]);
  noProfile = await opsUser("No Profile", ["desk.view", "desk.act", "desk.ask.read"]);
  await saveAgent(lead, { opsUserId: agent.id, displayName: "Noura", displayNameAr: "نورة", languages: ["ar", "en"], pronoun: "she", replyMinutes: 2 });
  await saveAgent(lead, { opsUserId: other.id, displayName: "Majed", languages: ["ar", "en"], pronoun: "he", replyMinutes: 2 });
});
beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; fake = fakeApi(script); setChatApi(fake); });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; });

describe("take over and hand back", () => {
  it("a taken-over thread gets no AI turn; the traveller's words reach the desk and the agent's replies reach the app", async () => {
    const me = await signIn();
    const first = await chat(me.token, { text: "Can I talk to a person please" });
    expect(first.events.some((e) => e.type === "handoff")).toBe(true);
    const id = first.threadId!;
    expect((await row(id)).handedOffAt).not.toBeNull();

    // Read, take over: a ticket is linked, the joined line is in the thread.
    const read = await readAsk(agent, id);
    expect(read.why).toBe("handoff");
    expect(read.mine).toBe(false);
    const { ticket } = await takeOverAsk(agent, id);
    expect((await ticketsFor("ask_thread", id)).map((t) => t.id)).toEqual([ticket.id]);
    expect(ticket.customerId).toBe(me.user.id);
    expect(await row(id)).toMatchObject({ mode: "agent", takenBy: agent.id });
    // Taking over again is a no-op for the same person and keeps the one ticket.
    await takeOverAsk(agent, id);
    expect((await ticketsFor("ask_thread", id)).length).toBe(1);
    await expect(takeOverAsk(other, id)).rejects.toThrow(/Someone else/);

    // The traveller writes: kept for the desk, the model never runs, the stream says who has it.
    const calls = fake.requests.length;
    const turns = (await row(id)).turns;
    const held = await chat(me.token, { text: "Hello? Is anyone there", threadId: id });
    expect(fake.requests.length).toBe(calls);
    expect(held.threadId).toBe(id);
    expect(held.events.find((e) => e.type === "agent")).toEqual({ type: "agent", name: "Noura" });
    expect(held.text).toBe("");
    expect(held.events.some((e) => e.type === "text" || e.type === "cards")).toBe(false);
    const after = await row(id);
    expect(after.turns).toBe(turns);
    expect((after.transcript as AskLine[]).at(-1)).toMatchObject({ who: "me", text: "Hello? Is anyone there" });
    expect((await readAsk(agent, id)).lines.at(-1)).toMatchObject({ who: "me", text: "Hello? Is anyone there" });

    // Only the person who has it replies; the traveller is notified and the app reads joined + the reply.
    await expect(replyOnAsk(other, id, "Hi")).rejects.toThrow(/Take the conversation over/);
    await replyOnAsk(agent, id, "Hi, Noura here. I can see your refund.");
    const n = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, me.user.id), eq(appNotifications.kind, "agent_reply")));
    expect(n.at(-1)).toMatchObject({ href: "/ask" });
    const u = AskDeskResponse.parse((await updates(me.token, id)).json);
    expect(u.mode).toBe("agent");
    expect(u.agent).toBe("Noura");
    expect(u.lines.map((l) => [l.kind, l.by, l.text])).toEqual([
      ["joined", "Noura", "Noura from Mada joined"],
      ["agent", "Noura", "Hi, Noura here. I can see your refund."],
    ]);
    expect(AskDeskResponse.parse((await updates(me.token, id, u.last)).json).lines).toEqual([]);
    // In Arabic: her Arabic name, and the verb agrees with her.
    await db.update(appUsers).set({ locale: "ar" }).where(eq(appUsers.id, me.user.id));
    const ar = AskDeskResponse.parse((await updates(me.token, id)).json);
    expect(ar.lines[0]).toMatchObject({ kind: "joined", by: "نورة", text: "انضمّت نورة من مادا" });
    await db.update(appUsers).set({ locale: "en" }).where(eq(appUsers.id, me.user.id));
    // Someone else's thread is not there at all.
    const stranger = await signIn();
    expect((await updates(stranger.token, id)).status).toBe(404);

    // Hand back: only the holder or a lead; then the model answers again and reads what was said meanwhile, once.
    await expect(handBackAsk(other, id)).rejects.toThrow(/Only the person who has it/);
    await handBackAsk(agent, id);
    const back = await row(id);
    expect(back).toMatchObject({ mode: "ai", takenBy: null });
    expect(back.deskNote).toContain("Hi, Noura here");
    expect(back.deskNote).toContain("Hello? Is anyone there");
    expect((back.transcript as AskLine[]).at(-1)).toMatchObject({ who: "system", event: "handed_back", by: "Noura" });
    expect(AskDeskResponse.parse((await updates(me.token, id)).json)).toMatchObject({ mode: "ai", agent: null });

    const again = await chat(me.token, { text: "Thanks, and what about my hotel", threadId: id });
    expect(again.text).toBe("Happy to help with that.");
    expect(fake.requests.length).toBeGreaterThan(calls);
    const sent = userText(fake.requests.at(-1)!);
    expect(sent).toContain("Noura, a person on the Mada team, had this conversation");
    expect(sent).toContain("Hi, Noura here. I can see your refund.");
    expect((await row(id)).deskNote).toBeNull();
    // The next turn doesn't read it again (it's in the history now, not a second time in the context).
    await chat(me.token, { text: "And the weather there", threadId: id });
    expect(userText(fake.requests.at(-1)!).split("had this conversation").length).toBe(2);

    // Every step is in the Ops activity log.
    const acts = await db.select({ action: schema.auditEvents.action }).from(schema.auditEvents).where(eq(schema.auditEvents.entityId, id));
    expect(acts.map((a) => a.action)).toEqual(expect.arrayContaining(["desk.ask.read", "desk.ask.taken_over", "desk.ask.replied", "desk.ask.handed_back"]));
  });

  it("a lead hands back someone else's thread; nobody without a named profile takes one over", async () => {
    const me = await signIn();
    const id = (await chat(me.token, { text: "I need a person" })).threadId!;
    await expect(takeOverAsk(noProfile, id)).rejects.toThrow(/agent profile/);
    await takeOverAsk(other, id);
    await handBackAsk(lead, id);
    expect((await row(id)).mode).toBe("ai");
  });
});

describe("who reads Ask transcripts (§7 default 5)", () => {
  it("agents read handed-off threads or a customer's with an open ticket; leads read any; every read is audited", async () => {
    const me = await signIn();
    const id = (await chat(me.token, { text: "Hotels in Baku in March" })).threadId!;
    expect((await row(id)).handedOffAt).toBeNull();

    await expect(readAsk(agent, id)).rejects.toThrow(/handed over/);
    await expect(readAsk(noAsk, id)).rejects.toThrow(/handed over/);
    expect(await reads(id)).toHaveLength(0);
    await expect(takeOverAsk(agent, id)).rejects.toThrow(/handed over/);

    const asLead = await readAsk(lead, id);
    expect(asLead.why).toBe("lead");
    expect(asLead.lines.map((l) => l.who)).toEqual(["me", "mada"]);
    expect(await reads(id)).toHaveLength(1);

    await createTicket(lead, { subject: "Refund question", customerId: me.user.id });
    expect((await readAsk(agent, id)).why).toBe("open_item");
    const audit = await reads(id);
    expect(audit).toHaveLength(2);
    expect(audit.map((a) => a.actorId)).toEqual(expect.arrayContaining([lead.id, agent.id]));
    // Without desk.ask.read an open ticket doesn't open it.
    await expect(readAsk(noAsk, id)).rejects.toThrow(/handed over/);
  });

  it("the list: tabs, language, search; never the words; only for people who may read Ask", async () => {
    const me = await signIn();
    await db.update(appUsers).set({ name: "Hessa Alotaibi" }).where(eq(appUsers.id, me.user.id));
    const id = (await chat(me.token, { text: "Please get me a person" })).threadId!;
    await expect(listAskThreads(noAsk)).rejects.toThrow(/access/);
    const all = await listAskThreads(agent, { q: "Hessa" });
    expect(all.rows.map((r) => r.id)).toEqual([id]);
    expect(all.rows[0]).toMatchObject({ customer: "Hessa A.", handed: true, open: true, mode: "ai" });
    expect(JSON.stringify(all.rows)).not.toContain("person");
    expect((await listAskThreads(agent, { q: me.phone.slice(-7) })).rows.map((r) => r.id)).toContain(id);
    expect((await listAskThreads(agent, { tab: "handed", q: "Hessa" })).total).toBe(1);
    expect((await listAskThreads(agent, { tab: "taken", q: "Hessa" })).total).toBe(0);
    expect((await listAskThreads(agent, { q: "Hessa", lang: "ar" })).total).toBe(0);
    await takeOverAsk(agent, id);
    const taken = await listAskThreads(agent, { tab: "taken", q: "Hessa" });
    expect(taken.rows[0]).toMatchObject({ id, mode: "agent", takenByName: "Noura", openTicket: true });
    expect(taken.counts).toMatchObject({ all: 1, handed: 1, taken: 1, ticket: 1 });
  });
});

describe("pieces", () => {
  it("the joined line, in both languages", () => {
    expect(joinedText("Noura", "she", "en")).toBe("Noura from Mada joined");
    expect(joinedText("نورة", "she", "ar")).toBe("انضمّت نورة من مادا");
    expect(joinedText("خالد", "he", "ar")).toBe("انضمّ خالد من مادا");
  });

  it("the hand-back note covers only what was said while a person had it, redacted", () => {
    const lines: AskLine[] = [
      { who: "me", text: "before" }, { who: "mada", text: "answer" },
      { who: "system", event: "joined", by: "Noura", at: "2026-10-21T09:00:00.000Z" },
      { who: "me", text: "my card is 4111 1111 1111 1111", at: "2026-10-21T09:01:00.000Z" },
      { who: "agent", text: "Got it", by: "Noura", byAr: null, agentId: "a", opsUserId: "o", at: "2026-10-21T09:02:00.000Z" },
    ];
    const note = handBackNote(lines, new Date("2026-10-21T09:00:00.000Z"), "Noura");
    expect(note).toContain("Noura: Got it");
    expect(note).not.toContain("before");
    expect(note).not.toContain("4111 1111");
    expect(handBackNote([], null, "Noura")).toContain("Nothing was said meanwhile");
  });

  it("the desk shows words and card names only", () => {
    const l = deskLines([{ who: "mada", text: "Two options", cards: ["flights", { secret: 1 }], next: ["x"] }, { who: "tool", text: "raw" }, null, { who: "me", text: "hi", held: "abuse" }]);
    expect(l).toEqual([
      { who: "mada", text: "Two options", cards: ["flights"], held: null, by: null, event: null, at: null },
      { who: "me", text: "hi", cards: [], held: "abuse", by: null, event: null, at: null },
    ]);
  });
});
