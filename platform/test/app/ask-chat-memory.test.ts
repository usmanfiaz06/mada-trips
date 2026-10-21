import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { sql as rawSql } from "drizzle-orm";
import { MemoryResponse, readSseFrames, type AskChatEvent, type MemoryFact } from "@mada/shared";
import { db } from "@/db";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { DELETE as memoryDeleteAll, GET as memoryGet } from "@/app/api/app/v1/ask/memory/route";
import { DELETE as memoryDelete } from "@/app/api/app/v1/ask/memory/[id]/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { anonymiseAccount } from "@/lib/app/account/privacy";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { KEEP_TURNS, estimateTokens, foldThread, gist, historyOf, lightenTurn, needsFold, splitTurns } from "@/lib/app/ask-chat/fold";
import { MEMORY_CHARS, MEMORY_HEAD, composeMemory, consentOf, isSensitive, rankFacts, saveFact, unkeepable } from "@/lib/app/ask-chat/memory";
import { fakeApi, lastToolText, type Fake, type Script } from "./ask-chat-fake";
import { call, freshIp } from "./helpers";
import { signIn } from "./wallet-helpers";

/* What Mada remembers across conversations, and long threads folded into a summary (docs/app/ASK-CHAT.md §7). */

type Msg = Anthropic.Beta.BetaMessageParam;
type Params = Anthropic.Beta.MessageCreateParamsNonStreaming;

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const res = await chatPost(req);
  const events = readSseFrames(await res.text()).events;
  const done = events.find((e): e is Extract<AskChatEvent, { type: "done" }> => e.type === "done");
  const thread = events.find((e): e is Extract<AskChatEvent, { type: "thread" }> => e.type === "thread");
  return { events, text: done?.text ?? "", threadId: thread?.threadId ?? null, streamed: events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join("") };
}
const facts = async (token: string) => MemoryResponse.parse((await call(memoryGet, { method: "GET", token })).json).facts;
const selfId = async (token: string) => (await call(peopleGet, { method: "GET", token })).json.people.find((p: { isSelf: boolean }) => p.isSelf).id as string;

/** The traveller's words in the last message from them (the block after the context). */
const said = (p: Params) => {
  const m = [...p.messages].reverse().find((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((b) => b.type === "text"));
  const blocks = (m?.content ?? []) as { type: string; text?: string }[];
  return blocks.filter((b) => b.type === "text").at(-1)?.text ?? "";
};
/** The context block of the last message from the traveller. */
const context = (p: Params) => {
  const m = [...p.messages].reverse().find((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((b) => b.type === "text"));
  return ((m?.content ?? []) as { type: string; text?: string }[]).filter((b) => b.type === "text").map((b) => b.text).find((t) => t?.startsWith("[Context")) ?? "";
};
const remembered = (p: Params) => p.messages.at(-1)?.role === "user" && /Saved for next time|Not saved/.test(lastToolText(p));

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; delete process.env.ASK_CHAT_HISTORY_TOKENS; });

describe("the remember tool", () => {
  it("keeps a lasting preference, says so once, and shows it in What Mada remembers", async () => {
    const { token } = await signIn();
    const api = fakeApi((p) => {
      if (remembered(p)) return { blocks: [{ type: "text", text: "Aisle it is." }] };
      return { blocks: [{ type: "tool_use", name: "remember", input: { kind: "seat", text: "Aisle seat", sensitive: false } }] };
    });
    setChatApi(api);
    const r = await chat(token, { text: "I always sit on the aisle" });
    expect(r.text).toBe("Aisle it is. We’ll remember that for next time.");
    expect(r.streamed).toContain("We’ll remember that for next time.");
    expect(r.events.some((e) => e.type === "status" && e.text === "Noting that for next time")).toBe(true);
    const list = await facts(token);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ kind: "seat", text: "Aisle seat", source: "chat" });

    // A kind with one value: the new seat replaces the old one.
    setChatApi(fakeApi((p) => (remembered(p) ? { blocks: [{ type: "text", text: "Window from now on. We'll remember that." }] } : { blocks: [{ type: "tool_use", name: "remember", input: { kind: "seat", text: "Window seat", sensitive: false } }] })));
    const again = await chat(token, { text: "Actually I prefer the window now" });
    // The model already said it: the line isn't added twice.
    expect(again.text).toBe("Window from now on. We'll remember that.");
    expect((await facts(token)).map((f) => f.text)).toEqual(["Window seat"]);
  });

  it("asks before keeping a mobility need, and keeps it only after a yes", async () => {
    const { token } = await signIn();
    const script: Script = (p) => {
      if (remembered(p)) {
        return /Not saved yet/.test(lastToolText(p))
          ? { blocks: [{ type: "text", text: "Rooms closest to the Haram, with lifts. Shall we remember that for next time?" }] }
          : { blocks: [{ type: "text", text: "Done." }] };
      }
      return { blocks: [{ type: "tool_use", name: "remember", input: { kind: "mobility", text: "Mother uses a wheelchair", sensitive: true } }] };
    };
    setChatApi(fakeApi(script));
    const first = await chat(token, { text: "Umrah for me and my mother, she uses a wheelchair" });
    expect(first.text).toContain("Shall we remember that for next time?");
    expect(first.text).not.toContain("We’ll remember");
    expect(await facts(token)).toHaveLength(0);

    // The model may claim sensitive: false, the words still need a yes.
    setChatApi(fakeApi((p) => (remembered(p) ? { blocks: [{ type: "text", text: "Okay." }] } : { blocks: [{ type: "tool_use", name: "remember", input: { kind: "other", text: "Mother uses a wheelchair", sensitive: false } }] })));
    const sneaky = await chat(token, { text: "Hotels in Makkah please", threadId: first.threadId });
    expect(sneaky.text).toBe("Okay.");
    expect(await facts(token)).toHaveLength(0);

    // Mada asks, the traveller says yes in the next message: kept.
    setChatApi(fakeApi(script));
    const asked = await chat(token, { text: "She uses a wheelchair", threadId: first.threadId });
    expect(asked.text).toContain("Shall we remember");
    const yes = await chat(token, { text: "Yes please", threadId: first.threadId });
    expect(yes.text).toBe("Done. We’ll remember that for next time.");
    expect((await facts(token))[0]).toMatchObject({ kind: "mobility", text: "Mother uses a wheelchair" });
  });

  it("never keeps a passport, card, phone or email", async () => {
    const { token } = await signIn();
    for (const text of ["Passport A12345678", "Card 4111 1111 1111 1111", "Call me on 0501234567", "omar@example.com"]) {
      setChatApi(fakeApi((p) => (remembered(p) ? { blocks: [{ type: "text", text: "Noted for this trip." }] } : { blocks: [{ type: "tool_use", name: "remember", input: { kind: "other", text, sensitive: false } }] })));
      const r = await chat(token, { text: "remember this" });
      expect(r.text).toBe("Noted for this trip.");
    }
    expect(await facts(token)).toHaveLength(0);
    expect(unkeepable("Prefers WhatsApp")).toBeNull();
    expect(unkeepable("Aisle seat, halal meals")).toBeNull();
  });

  it("reads consent from the thread: a question about remembering, then a yes", () => {
    const asked: Msg[] = [{ role: "assistant", content: [{ type: "text", text: "Wheelchair at the Haram too. Shall we remember that for next time?" }] }];
    expect(consentOf(asked, "Yes please")).toEqual({ asked: true, yes: true });
    expect(consentOf(asked, "ايه تذكرها")).toEqual({ asked: true, yes: true });
    expect(consentOf(asked, "No thanks")).toEqual({ asked: true, yes: false });
    expect(consentOf([{ role: "assistant", content: [{ type: "text", text: "Three hotels near the Haram." }] }], "yes")).toEqual({ asked: false, yes: false });
    expect(isSensitive("other", "My mother uses a wheelchair")).toBe(true);
    expect(isSensitive("food", "Halal food")).toBe(false);
    expect(isSensitive("other", "أمي على كرسي متحرك")).toBe(true);
  });
});

describe("what Mada knows, in the turn's context", () => {
  it("puts the facts and the recent searches in a new thread, once, needs first", async () => {
    const { token, user } = await signIn();
    const me = await selfId(token);
    await saveFact(user.id, "seat", "Aisle seat");
    await saveFact(user.id, "home_airport", "Flies from Jeddah");
    await saveFact(user.id, "mobility", "Mother uses a wheelchair");
    // A search in one conversation…
    setChatApi(fakeApi((p, n) => (n === 0 ? { blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "istanbul", from: null, depart: "2027-03-09", return: "2027-03-15", traveller_ids: [me], infants: 0, cabin: null } }] } : { blocks: [{ type: "text", text: "Three ways." }] })));
    await chat(token, { text: "Istanbul for Eid" });
    // …is known in the next one.
    const api = fakeApi(() => ({ blocks: [{ type: "text", text: "Aisle again for you." }] }));
    setChatApi(api);
    const r = await chat(token, { text: "Flights to Dubai next month" });
    const ctx = context(api.requests[0]!);
    expect(ctx).toContain(MEMORY_HEAD);
    const block = ctx.slice(ctx.indexOf(MEMORY_HEAD)).split("\nRead from the message")[0]!;
    expect(block.length).toBeLessThanOrEqual(MEMORY_CHARS);
    // For a flight the home airport leads, then the needs and the seat; the derived signals come after the facts.
    expect(block.split("\n").slice(1, 4)).toEqual(["- home airport: Flies from Jeddah", "- mobility: Mother uses a wheelchair", "- seat: Aisle seat"]);
    expect(block).toContain("- Recent searches: flight Istanbul 03-09 to 03-15, 1 person");
    // The second turn of the same thread doesn't send it again (the history has it).
    await chat(token, { text: "Make it business", threadId: r.threadId });
    expect(context(api.requests[1]!)).not.toContain(MEMORY_HEAD);
    const used = await facts(token);
    expect(used.every((f) => f.lastUsedAt)).toBe(true);
  });

  it("composes at most 600 characters of whole lines, the most relevant first", () => {
    const at = new Date().toISOString();
    const f = (id: number, kind: MemoryFact["kind"], text: string): MemoryFact => ({ id: `00000000-0000-4000-8000-00000000000${id}`, kind, text, source: "chat", createdAt: at, lastUsedAt: null });
    const list = [f(1, "other", "Likes quiet hotels"), f(2, "seat", "Aisle seat"), f(3, "food", "Halal food only"), f(4, "health", "Diabetic, needs a fridge")];
    expect(rankFacts(list, "flight").map((x) => x.kind)).toEqual(["seat", "health", "food", "other"]);
    expect(rankFacts(list, "stay").map((x) => x.kind)).toEqual(["food", "health", "seat", "other"]);
    const many = Array.from({ length: 9 }, (_, i) => f(i, "other", `A long fact number ${i} about how this traveller likes to travel with the family`));
    const { text, used } = composeMemory(many, { searches: ["flight Istanbul 03-09 to 03-15, 4 people"], saved: ["Tbilisi"], taken: ["Dubai 2026-03"] }, null);
    expect(text!.length).toBeLessThanOrEqual(MEMORY_CHARS);
    expect(text!.split("\n").every((l) => !l.endsWith("…"))).toBe(true);
    expect(used.length).toBeLessThan(9);
    expect(composeMemory([], { searches: [], saved: [], taken: [] }, null).text).toBeNull();
  });
});

describe("long conversations fold into a summary", () => {
  const turn = (i: number, withTool = true): Msg[] => [
    { role: "user", content: [{ type: "text", text: `[Context from Mada's systems for this message. Not written by the traveller.]\nToday: x` }, { type: "text", text: `Message ${i}` }] },
    ...(withTool ? [
      { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "s" }, { type: "tool_use", id: `t${i}`, name: "search_flights", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${i}`, content: `Flights to Istanbul ${i}. ${"x".repeat(1500)}` }] },
    ] as Msg[] : []),
    { role: "assistant", content: [{ type: "text", text: `Reply ${i}.\n<next>A | B</next>` }] },
  ];

  it("splits turns, lightens old tool results to their gist and keeps ids paired", () => {
    const msgs = [1, 2, 3].flatMap((i) => turn(i));
    expect(splitTurns(msgs)).toHaveLength(3);
    const light = lightenTurn(turn(1));
    const result = (light[2]!.content as { type: string; content: string }[])[0]!;
    expect(result.content.length).toBeLessThanOrEqual(200);
    expect(result.content.startsWith("Flights to Istanbul 1.")).toBe(true);
    expect(JSON.stringify(light)).not.toContain("thinking");
    expect(JSON.stringify(light)).not.toContain("[Context");
    expect((light[1]!.content as { id?: string }[])[0]!.id).toBe("t1");
    expect(gist("One. Two.", 4)).toBe("One…");
  });

  it("folds only past the budget and with more than 6 turns; the fast model writes the summary", async () => {
    const msgs = Array.from({ length: 9 }, (_, i) => turn(i + 1)).flat();
    expect(needsFold({ messages: msgs.slice(0, 4 * KEEP_TURNS), summary: null, turns: 6 }, 100)).toBe(false); // 6 turns: never
    expect(needsFold({ messages: msgs, summary: null, turns: 9 }, 1_000_000)).toBe(false); // under budget
    expect(needsFold({ messages: msgs, summary: null, turns: 9 }, 2000)).toBe(true);
    const api = fakeApi(() => ({ blocks: [] }));
    let asked = "";
    api.create = async (p) => {
      asked = JSON.stringify(p.messages);
      return { id: "m", type: "message", role: "assistant", model: "fast", content: [{ type: "text", text: "Istanbul for Eid, 4 people; they chose option 2." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 300, output_tokens: 30 } } as unknown as Anthropic.Beta.BetaMessage;
    };
    const f = await foldThread(api, { messages: msgs, summary: null, turns: 9 }, "fast");
    expect(f).toMatchObject({ folded: 3, by: "model", summary: "Istanbul for Eid, 4 people; they chose option 2." });
    expect(asked).toContain("Traveller: Message 1");
    expect(asked).toContain("Found: Flights to Istanbul 1.");
    expect(asked).not.toContain("[Context");
    expect(splitTurns(f.messages)).toHaveLength(KEEP_TURNS);
    expect(estimateTokens(f.messages)).toBeLessThan(estimateTokens(msgs) / 2);
    // The last two turns are word for word.
    expect(f.messages.slice(-8)).toEqual(msgs.slice(-8));
    // The model reads the summary in front of the first kept message.
    const h = historyOf(f.messages, f.summary);
    expect((h[0]!.content as { text: string }[])[0]!.text).toBe("[Earlier in this conversation, summarised by Mada's systems: Istanbul for Eid, 4 people; they chose option 2.]");
  });

  it("falls back to the gists when the fast model doesn't answer", async () => {
    const api = fakeApi(() => ({ blocks: [] }));
    api.create = async () => { throw new Error("timeout"); };
    const f = await foldThread(api, { messages: Array.from({ length: 8 }, (_, i) => turn(i + 1)).flat(), summary: "Earlier: Dubai.", turns: 8 }, "fast");
    expect(f.by).toBe("gists");
    expect(f.summary.startsWith("Earlier: Dubai. · Traveller: Message 1")).toBe(true);
    expect(f.summary.length).toBeLessThanOrEqual(900);
  });

  it("folds a real thread through the route and stores the summary on it", async () => {
    process.env.ASK_CHAT_HISTORY_TOKENS = "1500";
    const { token } = await signIn();
    const me = await selfId(token);
    let summaries = 0;
    const api: Fake = fakeApi((p) => {
      if (lastToolText(p).trim()) return { blocks: [{ type: "text", text: `Here they are for ${said(p).slice(0, 20)}.` }] };
      return { blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "istanbul", from: null, depart: "2027-03-09", return: "2027-03-15", traveller_ids: [me], infants: 0, cabin: null } }] };
    });
    const fast = api.create.bind(api);
    api.create = async (p, o) => {
      if (String(p.system).includes("summarise")) {
        summaries += 1;
        return { id: "m", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "Istanbul for Eid, just them, still choosing." }], stop_reason: "end_turn", stop_sequence: null, usage: { input_tokens: 400, output_tokens: 20 } } as unknown as Anthropic.Beta.BetaMessage;
      }
      return fast(p, o);
    };
    setChatApi(api);
    let threadId: string | null = null;
    for (let i = 1; i <= KEEP_TURNS + 2; i++) threadId = (await chat(token, { text: `Istanbul for Eid, try ${i}`, threadId })).threadId;
    expect(summaries).toBeGreaterThanOrEqual(1);
    const [row] = await db.execute<{ summary: string | null; folded_turns: number; turns: number }>(rawSql`SELECT summary, folded_turns, turns FROM app_ask_threads WHERE id = ${threadId}`);
    expect(row!.summary).toBe("Istanbul for Eid, just them, still choosing.");
    expect(row!.folded_turns).toBeGreaterThanOrEqual(1);
    expect(row!.turns).toBe(KEEP_TURNS + 2);
    // The last request read the summary first and at most KEEP_TURNS turns of history plus this one.
    const last = api.requests.at(-1)!;
    expect(JSON.stringify(last.messages[0])).toContain("[Earlier in this conversation, summarised by Mada's systems: Istanbul for Eid");
    expect(splitTurns(last.messages as Msg[]).length).toBeLessThanOrEqual(KEEP_TURNS + 1);
  });
});

describe("visible and deletable", () => {
  it("removes one, then everything; only the owner's", async () => {
    const a = await signIn();
    const b = await signIn();
    const one = await saveFact(a.user.id, "seat", "Aisle seat");
    await saveFact(a.user.id, "food", "Halal food");
    const del = (token: string, id: string) => memoryDelete(new Request(`http://localhost/api/app/v1/ask/memory/${id}`, { method: "DELETE", headers: { authorization: `Bearer ${token}`, "user-agent": "vitest", "x-forwarded-for": freshIp() } }), { params: Promise.resolve({ id }) });
    expect((await del(b.token, one.id)).status).toBe(404);
    expect((await del(a.token, "not-a-uuid")).status).toBe(404);
    const r = await del(a.token, one.id);
    expect(r.status).toBe(200);
    expect(MemoryResponse.parse(await r.json()).facts.map((f) => f.text)).toEqual(["Halal food"]);
    expect((await call(memoryDeleteAll, { method: "DELETE", token: a.token })).json).toEqual({ facts: [] });
    expect(await facts(a.token)).toEqual([]);
    expect((await call(memoryGet, { method: "GET" })).status).toBe(401);
  });

  it("goes with the account, threads too", async () => {
    const { token, user } = await signIn();
    await saveFact(user.id, "home_airport", "Flies from Jeddah");
    setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "Hello." }] })));
    await chat(token, { text: "hi" });
    await anonymiseAccount(user.id);
    for (const table of ["app_ask_memory", "app_ask_threads"]) {
      const [c] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM ${rawSql.raw(table)} WHERE owner_id = ${user.id}`);
      expect(c!.n, table).toBe(0);
    }
  });
});
