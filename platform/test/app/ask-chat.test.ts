import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Anthropic from "@anthropic-ai/sdk";
import { readSseFrames, type AskChatEvent } from "@mada/shared";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { outgoingProblems, redact, unbacked } from "@/lib/app/ask-chat/guard";
import { TOOLS } from "@/lib/app/ask-chat/prompt";
import { TOOL_NAMES } from "@/lib/app/ask-chat/tools";
import { fakeApi, lastToolText, userText, type Script } from "./ask-chat-fake";
import { call, freshIp } from "./helpers";
import { signIn } from "./wallet-helpers";

/* Ask as a conversation (docs/app/ASK-CHAT.md), against a stand-in for the Messages API: no key, no network. */

const EID_OUT = "2027-03-09";
const EID_BACK = "2027-03-15";

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const res = await chatPost(req);
  const text = await res.text();
  if (!res.headers.get("content-type")?.startsWith("text/event-stream")) return { status: res.status, events: [] as AskChatEvent[], json: JSON.parse(text) };
  return { status: res.status, events: readSseFrames(text).events, json: null };
}
const said = (events: AskChatEvent[]) => {
  const replaced = [...events].reverse().find((e) => e.type === "replace");
  const done = events.find((e) => e.type === "done");
  return { streamed: events.filter((e) => e.type === "text").map((e) => (e as { delta: string }).delta).join(""), final: done?.type === "done" ? done.text : replaced?.type === "replace" ? replaced.text : "" };
};
const selfId = async (token: string) => (await call(peopleGet, { method: "GET", token })).json.people.find((p: { isSelf: boolean }) => p.isSelf).id as string;

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; delete process.env.ASK_CHAT_USER_DAILY_USD; });

describe("the switch", () => {
  it("is off by default, and off without the key, and says so in GET /config", async () => {
    delete process.env.ASK_CHAT;
    const { token } = await signIn();
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(false);
    expect((await chat(token, { text: "hi" })).status).toBe(501);
    process.env.ASK_CHAT = "on";
    delete process.env.ANTHROPIC_API_KEY;
    expect((await chat(token, { text: "hi" })).status).toBe(501);
    process.env.ANTHROPIC_API_KEY = "x";
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(true);
  });

  it("needs sign-in", async () => {
    const req = new Request("http://localhost/api/app/v1/ask/chat", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text: "hi" }) });
    expect((await chatPost(req)).status).toBe(401);
  });
});

describe("a conversation", () => {
  it("searches with a tool, streams the words, then the cards, and only says prices the tool returned", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    const script: Script = (p, n) => {
      if (n === 0) return { blocks: [{ type: "text", text: "Checking Eid for you." }, { type: "tool_use", name: "search_flights", input: { destination: "istanbul", from: null, depart: EID_OUT, return: EID_BACK, traveller_ids: [me], infants: 0, cabin: null } }] };
      const price = /SAR [\d,]+ all in/.exec(lastToolText(p))![0].replace(" all in", "");
      return { blocks: [{ type: "text", text: `Three ways to get there. The first is ${price} all in.` }] };
    };
    const api = fakeApi(script);
    setChatApi(api);
    const r = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(r.status).toBe(200);
    const types = r.events.map((e) => e.type);
    expect(types[0]).toBe("thread");
    expect(types).toContain("intent");
    expect(types).toContain("status");
    expect(types.indexOf("cards")).toBeLessThan(types.lastIndexOf("text"));
    const cards = r.events.find((e) => e.type === "cards");
    expect(cards?.type === "cards" && cards.cards[0]!.type).toBe("flights");
    const { final } = said(r.events);
    expect(final).toMatch(/^Checking Eid for you\. Three ways to get there\. The first is SAR [\d,]+ all in\.$/);
    // The frozen prefix: the system prompt is cached, the tools are strict and in a fixed order.
    const sent = api.requests[0]!;
    expect(sent.model).toBe("claude-sonnet-5-5");
    expect((sent as unknown as { output_config: { effort: string } }).output_config.effort).toBe("low");
    expect((sent.system as { cache_control?: unknown }[])[0]!.cache_control).toEqual({ type: "ephemeral" });
    expect(sent.tools!.map((t) => (t as { name: string }).name)).toEqual(TOOL_NAMES);
    expect(sent.tools!.every((t) => (t as { strict?: boolean }).strict)).toBe(true);
    // The second request replays the first reply unchanged, with the tool result after it.
    expect(api.requests[1]!.messages.length).toBe(sent.messages.length + 2);
  });

  it("ends with Mada's own next-step chips and never shows the line they came in", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    setChatApi(fakeApi((p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "istanbul", from: null, depart: EID_OUT, return: EID_BACK, traveller_ids: [me], infants: 0, cabin: null } }] };
      const dep = /RUH (\d\d:\d\d)/.exec(lastToolText(p))![1];
      return { blocks: [{ type: "text", text: `Three ways for Eid; the first is the one we'd take.\n<next>Book the first at ${dep} | Hotels near Taksim | Book it for SAR 777 | Change dates</next>` }] };
    }));
    const r = await chat(token, { text: "Istanbul for Eid, just me" });
    const { streamed, final } = said(r.events);
    expect(streamed).not.toContain("<");
    expect(final).toBe("Three ways for Eid; the first is the one we'd take.");
    const next = r.events.find((e) => e.type === "next");
    // The unbacked price chip is dropped; the rest are kept in order.
    expect(next).toEqual({ type: "next", choices: [expect.stringMatching(/^Book the first at \d\d:\d\d$/), "Hotels near Taksim", "Change dates"] });
    expect(r.events.findIndex((e) => e.type === "next")).toBeLessThan(r.events.findIndex((e) => e.type === "done"));
  });

  it("drops an open-ended closer and fills the chips from the turn when the model forgets", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    setChatApi(fakeApi((_p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "istanbul", from: null, depart: EID_OUT, return: EID_BACK, traveller_ids: [me], infants: 0, cabin: null } }] };
      return { blocks: [{ type: "text", text: "Three ways for Eid. Anything else? Let us know if you need help." }] };
    }));
    const r = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(said(r.events).final).toBe("Three ways for Eid.");
    const next = r.events.find((e) => e.type === "next");
    expect(next?.type === "next" && next.choices.length).toBeGreaterThanOrEqual(2);
    expect(next?.type === "next" && next.choices[0]).toMatch(/^Book the .+ at \d\d:\d\d$/);
    expect(next?.type === "next" && next.choices).toContain("Other dates");
  });

  it("gives chips even with a fixed line (abuse, refusal), in the traveller's language", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [], stop: "refusal" })));
    const r = await chat(token, { text: "وش السالفة" });
    const next = r.events.find((e) => e.type === "next");
    expect(next).toEqual({ type: "next", choices: ["دوّر طيران", "دوّر فندق", "شريحة نت"] });
    const abuse = await chat(token, { text: "you are a fucking idiot" });
    expect(abuse.events.find((e) => e.type === "next")).toEqual({ type: "next", choices: ["Find flights", "Find a hotel", "Get an eSIM"] });
  });

  it("never shows a price no tool returned", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "Dubai is lovely in March. Flights start at SAR 999 return." }] })));
    const r = await chat(token, { text: "how much is Dubai?" });
    const { streamed, final } = said(r.events);
    expect(streamed).not.toContain("999");
    expect(final).toBe("Dubai is lovely in March.");
  });

  it("remembers the thread, and keeps one question at a time in the transcript it stores", async () => {
    const { token } = await signIn();
    const api = fakeApi((_p, n) => ({ blocks: [{ type: "text", text: n === 0 ? "When would you like to go?" : "Noted, December." }] }));
    setChatApi(api);
    const first = await chat(token, { text: "A trip to Baku" });
    const threadId = (first.events[0] as { threadId: string }).threadId;
    const second = await chat(token, { text: "December", threadId });
    expect((second.events[0] as { threadId: string }).threadId).toBe(threadId);
    const replay = api.requests[1]!.messages;
    expect(userText({ ...api.requests[1]!, messages: replay })).toContain("A trip to Baku");
    expect(replay.some((m) => m.role === "assistant" && JSON.stringify(m.content).includes("When would you like to go?"))).toBe(true);
    // Another person can't continue it: they get a new thread.
    const other = await signIn();
    const theirs = await chat(other.token, { text: "December", threadId });
    expect((theirs.events[0] as { threadId: string }).threadId).not.toBe(threadId);
  });

  it("answers in Arabic when the traveller writes Arabic", async () => {
    const { token } = await signIn();
    const api = fakeApi(() => ({ blocks: [{ type: "text", text: "أبشر، متى تبي تسافر؟" }] }));
    setChatApi(api);
    const r = await chat(token, { text: "أبي أسافر باكو" });
    expect(r.events[0]).toMatchObject({ type: "thread", lang: "ar" });
    expect(userText(api.requests[0]!)).toContain("Reply in: Arabic");
  });

  it("never sends a passport or card number to the model", async () => {
    const { token } = await signIn();
    const api = fakeApi(() => ({ blocks: [{ type: "text", text: "Thanks, we have it." }] }));
    setChatApi(api);
    await chat(token, { text: "My passport is A12345678 and my card is 4242 4242 4242 4242" });
    const sent = userText(api.requests[0]!);
    expect(sent).not.toContain("A12345678");
    expect(sent).not.toContain("4242 4242");
    expect(sent).toContain("[passport number removed]");
  });

  it("answers abuse with a fixed calm line and never sends it on", async () => {
    const { token } = await signIn();
    const api = fakeApi(() => ({ blocks: [{ type: "text", text: "x" }] }));
    setChatApi(api);
    const r = await chat(token, { text: "you are a fucking idiot" });
    expect(said(r.events).final).toBe("We’re here to help with your travel. Tell us where you’d like to go.");
    expect(api.requests.length).toBe(0);
  });

  it("ends a refusal with a fixed line", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [], stop: "refusal" })));
    const r = await chat(token, { text: "something odd" });
    expect(said(r.events).final).toContain("We can’t help with that one.");
  });

  it("asks the app to fall back when the API is down", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [] }), { throwOn: 0, error: new Anthropic.APIConnectionError({ message: "down" }) }));
    const r = await chat(token, { text: "Istanbul for Eid" });
    expect(r.events.at(-1)).toEqual({ type: "error", code: "SUPPLIER_UNAVAILABLE", fallback: true });
    expect(r.events.some((e) => e.type === "intent")).toBe(true);
  });

  it("hands a booking to the app's pay sheet and a person to the desk", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    let offer = "";
    const api = fakeApi((p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "dubai", from: "RUH", depart: EID_OUT, return: null, traveller_ids: [me], infants: 0, cabin: "economy" } }] };
      if (n === 1) { offer = /id=([0-9a-f-]{36})/.exec(lastToolText(p))![1]!; return { blocks: [{ type: "tool_use", name: "price_quote_for_pay", input: { kind: "flight", offer_id: offer, package_id: null, traveller_ids: [me] } }] }; }
      if (n === 2) return { blocks: [{ type: "text", text: "The pay sheet is open." }, { type: "tool_use", name: "talk_to_human", input: { summary: "Wants Dubai one way at Eid.", urgent: false } }] };
      return { blocks: [{ type: "text", text: "The team at Mada can take it from here." }] };
    });
    setChatApi(api);
    const r = await chat(token, { text: "Book the cheapest to Dubai at Eid" });
    const pay = r.events.find((e) => e.type === "pay");
    expect(pay).toMatchObject({ type: "pay", pay: { draft: { kind: "trip", flightOfferId: offer } } });
    expect(r.events.some((e) => e.type === "handoff")).toBe(true);
  });

  it("stops at the daily spend cap with a plain error the app falls back on", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [{ type: "text", text: "Hello." }] })));
    process.env.ASK_CHAT_USER_DAILY_USD = "0.000001";
    expect((await chat(token, { text: "hi" })).status).toBe(200);
    const capped = await chat(token, { text: "hi again" });
    expect(capped.status).toBe(429);
    expect(capped.json.error.details).toEqual({ budget: true });
  });
});

describe("the guards", () => {
  it("find prices and times no tool returned", () => {
    expect(unbacked("Saudia at SAR 2,025, leaves 09:40.", "Saudia SV263 RUH 09:40 → IST · SAR 2,025 all in")).toEqual([]);
    // Answers come only from the tools: flight numbers, ratings, airlines and hotels no tool returned are held back too.
    const tool = "Saudia SV263 · RUH 09:40 → 13:10 · SAR 2,025 all in\n1. id=s-1 · Rove Downtown · Downtown · 3 stars · SAR 1,840 all in";
    expect(unbacked("The Saudia SV 263 is direct, and the Rove Downtown has 3 stars.", tool)).toEqual([]);
    expect(unbacked("Take SV 1123 instead.", tool)).toEqual(["SV 1123"]);
    expect(unbacked("Emirates flies at night too.", tool)).toEqual(["Emirates"]);
    expect(unbacked("The Hilton Garden Inn is closer.", tool)).toEqual(expect.arrayContaining(["Hilton"]));
    expect(unbacked("The Grand Plaza Hotel is rated 9.1.", tool)).toEqual(expect.arrayContaining(["rated 9.1", "The Grand Plaza Hotel"]));
    expect(unbacked("It is a 5-star place.", tool)).toEqual(["5-star"]);
    expect(unbacked("The United Arab Emirates needs no visa, and 5 GB lasts 10 days.", tool)).toEqual([]);
    expect(unbacked("About SAR 1,500 each.", "SAR 2,025 all in")).toEqual(["SAR 1,500"]);
    expect(unbacked("يطلع 21:15 بـ 900 ر.س", "SV 09:40 · SAR 900")).toEqual(["21:15"]);
    expect(unbacked("A UK ETA costs £16.", "UK ETA, GBP 16")).toEqual([]);
    expect(unbacked("Three ways for 9–15 Mar.", "")).toEqual([]);
  });
  it("redact documents and cards but keep phone numbers and dates", () => {
    expect(redact("passport A12345678, call 0551234567 on 2027-03-09").text).toBe("passport [passport number removed], call 0551234567 on 2027-03-09");
    expect(redact("card 4111111111111111 cvv 123").redacted).toBe(2);
  });
  it("catch banned words in both languages", () => {
    expect(outgoingProblems("As an AI assistant I'd be happy to help")).not.toEqual([]);
    expect(outgoingProblems("حدث خطأ ما")).not.toEqual([]);
    expect(outgoingProblems("Three ways to get there.")).toEqual([]);
  });
});

describe("the eval harness", () => {
  it("passes a reply that only says what the tools said, and catches one that invents a price or asks twice", async () => {
    const { runEvals } = await import("@/lib/app/ask-chat/evals");
    const good = fakeApi((p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "esim_plans", input: { where: "pakistan", days: 10, trip_id: null } }] };
      return { blocks: [{ type: "text", text: `Pakistan for 10 days: we'd take the 5 GB at ${/SAR \d+/.exec(lastToolText(p))![0]}.\n<next>Get the 5 GB plan | A bigger plan | One for Hessa too</next>` }] };
    });
    const [ok] = await runEvals(good, { only: ["esim-pakistan"] });
    expect(ok!.problems).toEqual([]);
    const bad = fakeApi(() => ({ blocks: [{ type: "text", text: "Usually about SAR 50. Which country? For how long?" }] }));
    const [no] = await runEvals(bad, { only: ["esim-pakistan"] });
    expect(no!.problems.join(" | ")).toMatch(/prices: .*one: 2 questions.*tools: wanted one of esim_plans.*next: no next step/);
  });
});

describe("another provider (openai-compatible)", () => {
  const chunk = (o: unknown) => `data: ${JSON.stringify(o)}\n\n`;
  const sseOf = (parts: string[]) => new Response(new ReadableStream({ start(c) { for (const p of parts) c.enqueue(new TextEncoder().encode(p)); c.close(); } }), { headers: { "content-type": "text/event-stream" } });
  afterEach(() => { vi.unstubAllGlobals(); for (const k of ["ASK_CHAT_PROVIDER", "ASK_CHAT_BASE_URL", "ASK_CHAT_API_KEY", "ASK_CHAT_MODEL", "ASK_CHAT_PRICE"]) delete process.env[k]; });

  it("translates the conversation: system, words, tool calls and results; thinking and Claude-only fields dropped", async () => {
    const { toChatCompletion } = await import("@/lib/app/ask-chat/providers-openai");
    const req = toChatCompletion({
      model: "deepseek-chat", max_tokens: 100, system: [{ type: "text", text: "Be Mada." }], tools: TOOLS,
      messages: [
        { role: "user", content: [{ type: "text", text: "[Context]" }, { type: "text", text: "Dubai" }] },
        { role: "assistant", content: [{ type: "thinking", thinking: "", signature: "x" }, { type: "text", text: "Checking." }, { type: "tool_use", id: "t1", name: "get_trips", input: {} }] },
        { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "none", is_error: true }] },
      ],
    } as never, true);
    expect(req.messages.map((m) => m.role)).toEqual(["system", "user", "assistant", "tool"]);
    expect(req.messages[2]).toMatchObject({ content: "Checking.", tool_calls: [{ id: "t1", function: { name: "get_trips", arguments: "{}" } }] });
    expect(req.messages[3]).toMatchObject({ tool_call_id: "t1", content: "[error] none" });
    expect(req.tools!.length).toBe(TOOLS.length);
    expect(JSON.stringify(req)).not.toMatch(/betas|fallbacks|cache_control|thinking/);
  });

  it("runs a whole turn through the route: tool call streamed in pieces, then words, priced from ASK_CHAT_PRICE", async () => {
    const { token } = await signIn();
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "openai-compatible", ASK_CHAT_BASE_URL: "https://llm.example.test/v1", ASK_CHAT_API_KEY: "k", ASK_CHAT_MODEL: "open-model", ASK_CHAT_PRICE: "0.3,1.2,0.03" });
    delete process.env.ANTHROPIC_API_KEY;
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(true);
    const sent: { url: string; body: { model: string; messages: { role: string; content: string | null }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => {
      const body = JSON.parse(String(init.body));
      sent.push({ url, body });
      if (!body.stream) return new Response(JSON.stringify({ choices: [{ message: { content: "" }, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 1 } }), { headers: { "content-type": "application/json" } });
      if (body.messages.some((m: { role: string }) => m.role === "tool")) {
        return sseOf([chunk({ choices: [{ delta: { content: "You have " } }] }), chunk({ choices: [{ delta: { content: "no trips yet." }, finish_reason: "stop" }] }), chunk({ choices: [], usage: { prompt_tokens: 900, completion_tokens: 8, prompt_tokens_details: { cached_tokens: 600 } } }), "data: [DONE]\n\n"]);
      }
      return sseOf([chunk({ choices: [{ delta: { tool_calls: [{ index: 0, id: "c1", function: { name: "get_trips", arguments: "" } }] } }] }), chunk({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: "{}" } }] }, finish_reason: "tool_calls" }] }), "data: [DONE]\n\n"]);
    }));
    const r = await chat(token, { text: "What trips do I have?" });
    expect(said(r.events).final).toBe("You have no trips yet.");
    expect(sent.filter((s) => s.url === "https://llm.example.test/v1/chat/completions").length).toBeGreaterThanOrEqual(2);
    expect(sent.every((s) => s.body.model === "open-model")).toBe(true);
    // The household line is first names only, whoever the provider is.
    expect(JSON.stringify(sent.map((s) => s.body.messages))).not.toMatch(/Alharbi|surname/);
  });

  it("counts an HTTP failure as a stop the app falls back on", async () => {
    const { token } = await signIn();
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "openai-compatible", ASK_CHAT_BASE_URL: "https://llm.example.test/v1", ASK_CHAT_API_KEY: "k", ASK_CHAT_MODEL: "open-model" });
    vi.stubGlobal("fetch", vi.fn(async () => new Response("busy", { status: 429 })));
    const r = await chat(token, { text: "Istanbul for Eid" });
    expect(r.events.at(-1)).toEqual({ type: "error", code: "RATE_LIMITED", fallback: true });
  });

  it("summarises a run for the comparison table, Arabic dialect markers included", async () => {
    const { dialectOf, summarise } = await import("@/lib/app/ask-chat/evals");
    expect(dialectOf(["وش تبي الحين؟", "ماذا تريد الآن؟"])).toEqual({ spoken: 3, msa: 3 });
    const s = summarise([
      { case: "a", lang: "ar", turn: 1, user: "", reply: "أبشر", next: [], nextFrom: "app" as const, tools: [], problems: [], costMicros: 2000, inTokens: 10, outTokens: 5, cacheRead: 100, ms: 900 },
      { case: "b", lang: "en", turn: 1, user: "", reply: "x", next: [], nextFrom: "app" as const, tools: [], problems: ["one: 2 questions"], costMicros: 4000, inTokens: 10, outTokens: 5, cacheRead: 100, ms: 1500 },
    ]);
    expect(s).toMatchObject({ turns: 2, passed: 1, byCheck: { one: 1 }, medianMs: 1500, costPerConversation: 0.003, dialect: { spoken: 1, msa: 0 } });
  });
});

describe("weaker tool calling and the presets", () => {
  afterEach(() => { vi.unstubAllGlobals(); for (const k of ["ASK_CHAT_PROVIDER", "GROQ_API_KEY", "ZAI_API_KEY", "GEMINI_API_KEY"]) delete process.env[k]; });

  it("checks arguments against the strict schemas and matches names loosely", async () => {
    const { schemaProblems, toolNameFor, toOpenApiSchema } = await import("@/lib/app/ask-chat/schema");
    const flights = TOOLS.find((t) => t.name === "search_flights")!.input_schema as never;
    expect(schemaProblems(flights, { destination: "dubai", from: null, depart: "2027-03-09", return: null, traveller_ids: [], infants: 0, cabin: null })).toEqual([]);
    expect(schemaProblems(flights, { destination: "dubai", depart: "x", extra: 1 }).join(" | ")).toMatch(/from is required.*extra is not a field/);
    expect(schemaProblems(flights, { destination: "mars", from: "RUH", depart: 5, return: null, traveller_ids: [1], infants: 0, cabin: null })).toEqual(["input.destination must be one of " + (flights as { properties: { destination: { enum: string[] } } }).properties.destination.enum.map((e) => JSON.stringify(e)).join(", "), "input.depart must be string", "input.traveller_ids[0] must be string"]);
    expect(toolNameFor("Search-Flights", TOOL_NAMES)).toBe("search_flights");
    expect(toolNameFor("book_it", TOOL_NAMES)).toBeNull();
    expect(JSON.stringify(toOpenApiSchema(flights))).not.toMatch(/"null"|additionalProperties/);
    expect(toOpenApiSchema(flights)).toMatchObject({ properties: { from: { type: "string", nullable: true, enum: ["RUH", "JED", "DMM"] } } });
  });

  it("answers a bad call with what is wrong once, then runs the repaired one", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi((_p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "Get_Trips", input: { all: true } }] };
      if (n === 1) return { blocks: [{ type: "tool_use", name: "get_trips", input: {} }] };
      return { blocks: [{ type: "text", text: "Nothing booked yet." }] };
    }));
    const r = await chat(token, { text: "my trips?" });
    expect(said(r.events).final).toBe("Nothing booked yet.");
  });

  it("falls back when the arguments are still wrong after the repair", async () => {
    const { token } = await signIn();
    setChatApi(fakeApi(() => ({ blocks: [{ type: "tool_use", name: "search_flights", input: { destination: "dubai" } }] })));
    const r = await chat(token, { text: "Dubai" });
    expect(r.events.at(-1)).toEqual({ type: "error", code: "TOOL_INPUT", fallback: true });
  });

  it("groq, zai and gemini fill in the base URL, key and model; a 429 falls back; Gemini gets OpenAPI schemas", async () => {
    const { token } = await signIn();
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "groq", GROQ_API_KEY: "g" });
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(true);
    const seen: { url: string; body: { model: string; tools?: { function: { parameters?: unknown } }[] } }[] = [];
    vi.stubGlobal("fetch", vi.fn(async (url: string, init: RequestInit) => { seen.push({ url, body: JSON.parse(String(init.body)) }); return new Response("slow down", { status: 429, headers: { "retry-after": "7" } }); }));
    const r = await chat(token, { text: "Istanbul for Eid" });
    expect(r.events.at(-1)).toEqual({ type: "error", code: "RATE_LIMITED", fallback: true });
    expect(seen.at(-1)).toMatchObject({ url: "https://api.groq.com/openai/v1/chat/completions", body: { model: "openai/gpt-oss-120b" } });
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "zai", ZAI_API_KEY: "z" });
    await chat(token, { text: "Istanbul for Eid" });
    expect(seen.at(-1)).toMatchObject({ url: "https://api.z.ai/api/paas/v4/chat/completions", body: { model: "glm-4.7-flash" } });
    // Gemini has no default model (its ids are read at run time): off until ASK_CHAT_MODEL names one.
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "gemini", GEMINI_API_KEY: "m" });
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(false);
    process.env.ASK_CHAT_MODEL = "gemini-flash-test";
    await chat(token, { text: "Istanbul for Eid" });
    const g = seen.at(-1)!;
    expect(g.url).toBe("https://generativelanguage.googleapis.com/v1beta/openai/chat/completions");
    expect(JSON.stringify(g.body.tools)).not.toMatch(/"null"|additionalProperties/);
    delete process.env.ASK_CHAT_MODEL;
  });
});
