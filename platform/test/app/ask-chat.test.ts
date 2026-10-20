import { afterEach, beforeEach, describe, expect, it } from "vitest";
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
    expect(unbacked("Saudia at SAR 2,025, leaves 09:40.", "SV263 RUH 09:40 → IST · SAR 2,025 all in")).toEqual([]);
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
      return { blocks: [{ type: "text", text: `Pakistan for 10 days: we'd take the 5 GB at ${/SAR \d+/.exec(lastToolText(p))![0]}.` }] };
    });
    const [ok] = await runEvals(good, { only: ["esim-pakistan"] });
    expect(ok!.problems).toEqual([]);
    const bad = fakeApi(() => ({ blocks: [{ type: "text", text: "Usually about SAR 50. Which country? For how long?" }] }));
    const [no] = await runEvals(bad, { only: ["esim-pakistan"] });
    expect(no!.problems.join(" | ")).toMatch(/prices: .*one: 2 questions.*tools: wanted one of esim_plans/);
  });
});
