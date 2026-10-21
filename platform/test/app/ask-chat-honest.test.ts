import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { readSseFrames, type AskChatEvent } from "@mada/shared";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { GET as requestGet } from "@/app/api/app/v1/requests/[id]/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { SYSTEM_PROMPT, TOOLS, toolsFor } from "@/lib/app/ask-chat/prompt";
import { chainApi, cooldowns, resetCooldowns } from "@/lib/app/ask-chat/providers";
import { ProviderHttpError, toChatCompletion } from "@/lib/app/ask-chat/providers-openai";
import { askChatModel, askChatOn, providerChain } from "@/lib/app/ask-chat/config";
import { statusFor } from "@/lib/app/ask-chat/tools";
import { fakeApi, lastToolText } from "./ask-chat-fake";
import { call, freshIp } from "./helpers";
import { callP, signIn } from "./wallet-helpers";

/*
 * Ask as a conversation, honest about what is real (docs/app/ASK-CHAT.md): sample fares say so, flights by request
 * never show a price and end in a request with how to reach the traveller, closers never reach the screen, Arabic
 * status lines name the place in Arabic, fewer tokens for free tiers, and a chain of providers that falls over.
 */

const OUT = "2027-03-09";
const BACK = "2027-03-15";

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const res = await chatPost(req);
  const text = await res.text();
  if (!res.headers.get("content-type")?.startsWith("text/event-stream")) return { status: res.status, events: [] as AskChatEvent[] };
  return { status: res.status, events: readSseFrames(text).events };
}
const finalOf = (events: AskChatEvent[]) => { const d = events.find((e) => e.type === "done"); return d?.type === "done" ? d.text : ""; };
const nextOf = (events: AskChatEvent[]) => { const n = events.find((e) => e.type === "next"); return n?.type === "next" ? n.choices : []; };
const selfId = async (token: string) => (await call(peopleGet, { method: "GET", token })).json.people.find((p: { isSelf: boolean }) => p.isSelf).id as string;
const flights = (me: string) => ({ type: "tool_use" as const, name: "search_flights", input: { destination: "istanbul", from: null, depart: OUT, return: BACK, traveller_ids: [me], infants: 0, cabin: null } });

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; resetCooldowns(); });
afterEach(() => {
  setChatApi(null);
  for (const k of ["ASK_CHAT", "ANTHROPIC_API_KEY", "APP_FLIGHTS_MODE", "ASK_CHAT_PROVIDERS", "GROQ_API_KEY", "GEMINI_API_KEY", "ASK_CHAT_MODEL_GEMINI"]) delete process.env[k];
});

describe("sample fares", () => {
  it("are marked on every card and told to the model as demo: true", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    let seen = "";
    setChatApi(fakeApi((p, n) => {
      if (n === 0) return { blocks: [flights(me)] };
      seen = lastToolText(p);
      return { blocks: [{ type: "text", text: "These are sample fares for testing." }] };
    }));
    const r = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(seen.startsWith("demo: true")).toBe(true);
    const cards = r.events.find((e) => e.type === "cards");
    expect(cards?.type === "cards" && cards.cards[0]!.type === "flights" && cards.cards[0]!.options.every((o) => o.demo === true)).toBe(true);
    expect(SYSTEM_PROMPT).toMatch(/"demo: true" holds sample fares for testing/);
  });
});

describe("flights by request (APP_FLIGHTS_MODE=request)", () => {
  it("never returns a price, asks how to reach them, then makes the request with that and the promise", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    const { token } = await signIn();
    const me = await selfId(token);
    let first = "";
    setChatApi(fakeApi((p, n) => {
      if (n === 0) return { blocks: [flights(me)] };
      first = lastToolText(p);
      // The model forgets its choices: the app fills in how to reach them, never an open end.
      return { blocks: [{ type: "text", text: "Istanbul, 9 to 15 Mar, just you: the team at Mada finds the fares by hand and gets back within 2 hours. Let us know which you prefer." }] };
    }));
    const a = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(first).toMatch(/^\{"mode":"request"\}/);
    expect(first).not.toMatch(/SAR|\d\d:\d\d/);
    expect(a.events.some((e) => e.type === "cards")).toBe(false);
    expect(finalOf(a.events)).toBe("Istanbul, 9 to 15 Mar, just you: the team at Mada finds the fares by hand and gets back within 2 hours.");
    expect(nextOf(a.events)).toEqual(["WhatsApp", "Call me", "Here in the app"]);
    const threadId = (a.events.find((e) => e.type === "thread") as { threadId: string }).threadId;

    let said = "";
    setChatApi(fakeApi((p, n) => {
      if (n === 0) return { blocks: [{ type: "tool_use", name: "create_request", input: { kind: "flight", summary: "Istanbul for Eid, just me", traveller_ids: [me], destination_name: "Istanbul", depart: OUT, return: BACK, contact_preference: "call", contact_window: "evenings after 7" } }] };
      said = lastToolText(p);
      const by = /by (\d\d:\d\d)/.exec(said)![1];
      return { blocks: [{ type: "text", text: `We've noted it and the team will get back to you by ${by}.` }] };
    }));
    const b = await chat(token, { text: "Call me, evenings after 7", threadId });
    expect(finalOf(b.events)).toMatch(/^We've noted it and the team will get back to you by \d\d:\d\d\.$/);
    const card = (b.events.find((e) => e.type === "cards") as { cards: { type: string; requestId: string; promisedBy?: string; contact?: string; detail?: string }[] }).cards[0]!;
    expect(card).toMatchObject({ type: "request", contact: "call" });
    expect(card.promisedBy).toBeTruthy();
    const view = (await callP(requestGet, { id: card.requestId }, { method: "GET", token })).json.request;
    expect(view.contact).toEqual({ preference: "call", window: "evenings after 7" });
    expect(SYSTEM_PROMPT).toMatch(/WhatsApp \| Call me \| Here in the app/);
  });
});

describe("the closer seen live", () => {
  it("is dropped, and a closing clause after content is cut, in both languages", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    setChatApi(fakeApi((_p, n) => n === 0 ? { blocks: [flights(me)] } : { blocks: [{ type: "text", text: "Three ways for Eid. Let us know which you prefer or if you'd like other dates." }] }));
    expect(finalOf((await chat(token, { text: "Istanbul for Eid, just me" })).events)).toBe("Three ways for Eid.");
    setChatApi(fakeApi((_p, n) => n === 0 ? { blocks: [flights(me)] } : { blocks: [{ type: "text", text: "ثلاث خيارات للعيد، خبرنا أي واحد تبي. قول لنا إذا تبي تواريخ ثانية." }] }));
    expect(finalOf((await chat(token, { text: "إسطنبول في العيد لي بس" })).events)).toBe("ثلاث خيارات للعيد.");
  });
});

describe("status lines", () => {
  it("name the place in the reader's language", () => {
    expect(statusFor("search_flights", { destination: "istanbul" }, "ar")).toBe("نشوف الرحلات لـإسطنبول");
    expect(statusFor("search_stays", { destination: "dubai" }, "ar")).toBe("نشوف السكن في دبي");
    expect(statusFor("esim_plans", { where: "pakistan" }, "ar")).toBe("نشوف باقات النت لـباكستان");
    expect(statusFor("search_flights", { destination: "istanbul" }, "en")).toBe("Checking flights to Istanbul");
  });
});

describe("fewer tokens per turn", () => {
  it("sends an openai-compatible provider only the tools a known kind needs, and Claude every tool", async () => {
    expect(toolsFor(null)).toBeNull();
    expect(toolsFor("general")).toBeNull();
    const only = toolsFor("esim")!;
    expect(only).toEqual(["esim_plans", "get_trips", "price_quote_for_pay", "talk_to_human", "remember"]);
    const req = toChatCompletion({ model: "m", max_tokens: 10, system: "x", tools: TOOLS, only_tools: only, messages: [{ role: "user", content: "eSIM" }] } as never, true);
    expect(req.tools!.map((t) => t.function.name)).toEqual(only);
    const { token } = await signIn();
    const api = fakeApi(() => ({ blocks: [{ type: "text", text: "Here." }] }));
    setChatApi(api);
    await chat(token, { text: "eSIM for Pakistan for 10 days" });
    const sent = api.requests[0] as unknown as { tools: unknown[]; only_tools?: string[] };
    // The hint rides along; the list itself (Claude's cached prefix) never changes.
    expect(sent.tools.length).toBe(TOOLS.length);
    expect(sent.only_tools).toContain("esim_plans");
    expect(sent.only_tools).not.toContain("search_flights");
  });
});

describe("a chain of providers (ASK_CHAT_PROVIDERS)", () => {
  it("reads the chain from the environment: keys, default models, overrides", () => {
    delete process.env.ANTHROPIC_API_KEY;
    process.env.ASK_CHAT_PROVIDERS = "groq,gemini,anthropic";
    expect(askChatOn()).toBe(false);
    process.env.GEMINI_API_KEY = "m";
    expect(askChatOn()).toBe(true);
    expect(providerChain()!.map((l) => `${l.name}:${l.model}`)).toEqual(["gemini:gemini-2.5-flash"]);
    Object.assign(process.env, { GROQ_API_KEY: "g", ASK_CHAT_MODEL_GEMINI: "gemini-flash-test" });
    expect(providerChain()!.map((l) => `${l.name}:${l.model}`)).toEqual(["groq:openai/gpt-oss-120b", "gemini:gemini-flash-test"]);
    expect(askChatModel()).toBe("openai/gpt-oss-120b");
  });

  it("moves the same call to the next provider on a 429, comes back after the cooldown, and falls back only when all rest", async () => {
    const { token } = await signIn();
    const me = await selfId(token);
    let clock = 1_000_000;
    const lines: string[] = [];
    const reply = (who: string) => (_p: unknown, n: number) => (n % 2 === 0 ? { blocks: [flights(me)] } : { blocks: [{ type: "text" as const, text: `Answered by ${who}.` }] });
    // Groq is rate limited on its first call (Retry-After 7 s); Gemini answers that call and the rest of the turn.
    const groq = fakeApi(reply("groq") as never, { throwOn: 0, error: new ProviderHttpError(429, "slow down", 7) });
    const gemini = fakeApi(reply("gemini") as never);
    setChatApi(chainApi([{ name: "groq", model: "g-model", fastModel: "g-fast", api: groq }, { name: "gemini", model: "m-model", fastModel: "m-fast", api: gemini }], { now: () => clock, log: (l) => lines.push(l) }));
    const a = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(finalOf(a.events)).toBe("Answered by gemini.");
    expect(gemini.requests.map((r) => r.model)).toEqual(["m-model", "m-model"]);
    expect(lines.some((l) => /provider=groq resting 7s \(429\)/.test(l))).toBe(true);
    expect(lines.filter((l) => /provider=gemini model=m-model call=stream/.test(l)).length).toBe(2);
    expect(cooldowns(clock)).toEqual({ groq: 7 });

    // Still resting: straight to Gemini, Groq isn't asked.
    clock += 3_000;
    await chat(token, { text: "Istanbul for Eid, just me" });
    expect(groq.requests.length).toBe(1);
    // Rested: back to Groq, first in the chain.
    clock += 5_000;
    const c = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(finalOf(c.events)).toBe("Answered by groq.");

    // Both down: the app answers with its own flows.
    resetCooldowns();
    const down = (status: number) => fakeApi(() => ({ blocks: [] }), { throwOn: 0, error: new ProviderHttpError(status, "down") });
    setChatApi(chainApi([{ name: "groq", model: "g", fastModel: "g", api: down(429) }, { name: "gemini", model: "m", fastModel: "m", api: down(503) }], { now: () => clock, log: () => {} }));
    const d = await chat(token, { text: "Istanbul for Eid, just me" });
    expect(d.events.at(-1)).toEqual({ type: "error", code: "RATE_LIMITED", fallback: true });
  });

  it("turns Ask on in GET /config when one provider in the chain has its key", async () => {
    delete process.env.ANTHROPIC_API_KEY;
    Object.assign(process.env, { ASK_CHAT_PROVIDERS: "groq,gemini", GEMINI_API_KEY: "m" });
    expect((await call(configGet, { method: "GET" })).json.features.askChat).toBe(true);
  });
});
