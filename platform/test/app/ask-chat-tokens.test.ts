import { afterEach, describe, expect, it } from "vitest";
import type Anthropic from "@anthropic-ai/sdk";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { EVAL_CASES, EVAL_PEOPLE, runEvals } from "@/lib/app/ask-chat/evals";
import { COMPACT_SYSTEM_PROMPT, LEAN_TOOLS, SYSTEM_PROMPT, TOOLS, leanToolsFor, toolsFor } from "@/lib/app/ask-chat/prompt";
import { PERSONA_COMPACT } from "@/lib/app/ask-chat/persona";
import { toChatCompletion } from "@/lib/app/ask-chat/providers-openai";
import { leanHistory } from "@/lib/app/ask-chat/fold";
import { MEMORY_HEAD } from "@/lib/app/ask-chat/memory";
import { schemaProblems, withNulls } from "@/lib/app/ask-chat/schema";
import { fakeApi } from "./ask-chat-fake";

/*
 * What one model call costs an openai-compatible provider (free tiers count tokens per minute; docs/app/ASK-CHAT.md
 * §6): every eval conversation run through the real engine on a stand-in that calls the turn's tool and then answers,
 * each request measured as the provider receives it (toChatCompletion), about 4 characters a token.
 */

type Schema = { type?: string | string[]; enum?: unknown[]; properties?: Record<string, Schema> };
/** A valid input for a tool: null where it may be, else the first enum value or a plain value. */
const inputFor = (name: string): Record<string, unknown> => {
  const props = (TOOLS.find((t) => t.name === name)!.input_schema as Schema).properties ?? {};
  return Object.fromEntries(Object.entries(props).map(([k, s]) => {
    const types = Array.isArray(s.type) ? s.type : [s.type];
    if (types.includes("null")) return [k, null];
    if (s.enum) return [k, s.enum[0]];
    if (types.includes("array")) return [k, [EVAL_PEOPLE[0]!.id]];
    if (types.includes("integer")) return [k, 3];
    if (types.includes("boolean")) return [k, false];
    return [k, /depart|check_in/.test(k) ? "2026-11-12" : "Istanbul for Eid"];
  }));
};
const est = (body: unknown) => Math.ceil(JSON.stringify(body).length / 4);

export async function measure() {
  const calls: { kind: string; step: number; tokens: number }[] = [];
  const toolFor = new Map(EVAL_CASES.flatMap((c) => c.turns.map((t) => [t.user, t.toolsAnyOf?.[0] ?? null] as const)));
  const api = fakeApi((p, _n) => {
    const msgs = p.messages;
    const last = msgs[msgs.length - 1]!;
    const step = Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result") ? 1 : 0;
    const said = Array.isArray(last.content) ? last.content.map((b) => ("text" in b ? b.text : "")).join("\n") : String(last.content);
    const ctx = /kind=(\w+)/.exec(said);
    const userWords = [...msgs].reverse().find((m) => m.role === "user" && Array.isArray(m.content) && m.content.some((b) => b.type === "text"));
    const words = userWords && Array.isArray(userWords.content) ? (userWords.content.at(-1) as { text: string }).text : "";
    const kind = ctx?.[1] ?? calls.at(-1)?.kind ?? "?";
    calls.push({ kind, step, tokens: est(toChatCompletion(p as Anthropic.Beta.MessageCreateParamsNonStreaming, true)) });
    const tool = toolFor.get(words);
    if (step === 0 && tool) return { blocks: [{ type: "tool_use", name: tool, input: inputFor(tool) }] };
    return { blocks: [{ type: "text", text: "Three ways for the five of you. <next>Book the first | Change dates</next>" }] };
  });
  await runEvals(api);
  return calls;
}

export function table(calls: { kind: string; step: number; tokens: number }[]) {
  const by = new Map<string, number[]>();
  for (const c of calls) for (const k of [c.kind, "all", `step ${c.step + 1}`]) by.set(k, [...(by.get(k) ?? []), c.tokens]);
  return [...by].map(([kind, t]) => ({ kind, calls: t.length, mean: Math.round(t.reduce((a, b) => a + b, 0) / t.length), max: Math.max(...t) }));
}

describe("ask chat: tokens per call for openai-compatible providers", () => {
  afterEach(() => setChatApi(null));

  it("every call of the eval set fits a free tier's minute (was about 4,400 a call)", async () => {
    const calls = await measure();
    const rows = table(calls);
    // ASK_TOKENS_TABLE=/path/rows.json writes the table by kind and step (docs/app/ASK-CHAT.md §6).
    if (process.env.ASK_TOKENS_TABLE) (await import("node:fs")).writeFileSync(process.env.ASK_TOKENS_TABLE, JSON.stringify(rows, null, 1));
    expect(calls.length).toBeGreaterThan(60);
    expect(rows.find((r) => r.kind === "all")!.mean).toBeLessThan(2600);
    expect(Math.max(...calls.map((c) => c.tokens))).toBeLessThan(3200);
  });

  it("reads the compact prompt, the shorter tool words and the lighter history; Claude's params stay whole", () => {
    expect(COMPACT_SYSTEM_PROMPT.startsWith(PERSONA_COMPACT)).toBe(true);
    expect(COMPACT_SYSTEM_PROMPT.length).toBeLessThan(SYSTEM_PROMPT.length * 0.6);
    for (const must of ['"demo: true" holds sample fares for testing', "<next>WhatsApp | Call me | Here in the app</next>", "<next>Book the Saudia", '{"mode":"request"}', "create_request", "contact_preference", "price_quote_for_pay", "talk_to_human", "plan_car_now", "Nusuk", "GACA", "911", "istanbul"]) expect(COMPACT_SYSTEM_PROMPT, must).toContain(must);
    expect(COMPACT_SYSTEM_PROMPT).not.toMatch(/\b20\d\d-\d\d-\d\d\b/);
    // Same names and fields as the strict tools, fewer words.
    expect(LEAN_TOOLS.map((t) => t.name)).toEqual(TOOLS.map((t) => t.name));
    for (const [i, t] of LEAN_TOOLS.entries()) {
      expect(Object.keys((t.input_schema as Schema).properties ?? {})).toEqual(Object.keys((TOOLS[i]!.input_schema as Schema).properties ?? {}));
      expect(JSON.stringify(t).length).toBeLessThan(JSON.stringify(TOOLS[i]).length);
    }
    // As the engine builds it: the earlier turns lightened, this turn's message as it is.
    const now = [{ role: "user", content: [{ type: "text", text: "[Context from Mada's systems for this message.]\nToday: x" }, { type: "text", text: "Dubai" }] }] as Anthropic.Beta.BetaMessageParam[];
    const p = { model: "m", max_tokens: 9, system: SYSTEM_PROMPT, tools: TOOLS, only_tools: ["search_flights"], lean: { system: COMPACT_SYSTEM_PROMPT, tools: LEAN_TOOLS, messages: [...leanHistory([]), ...now] }, messages: now };
    const req = toChatCompletion(p as never, true) as { messages: { role: string; content: string }[]; tools: { function: { name: string; description: string } }[] };
    expect(req.messages[0]!.content).toBe(COMPACT_SYSTEM_PROMPT);
    expect(req.tools.map((t) => t.function.name)).toEqual(["search_flights"]);
    expect(req.tools[0]!.function.description).toBe(LEAN_TOOLS[0]!.description);
    // The latest message keeps its context: today, the household, the trips.
    expect(req.messages[1]!.content).toMatch(/Today: x/);
    // Without the hint (another caller), the request is as it was.
    expect((toChatCompletion({ ...p, lean: undefined } as never, true) as typeof req).messages[0]!.content).toBe(SYSTEM_PROMPT);
  });

  it("lighter history: old context down to memory and the desk note, old tool results to their gist, the last turn whole", () => {
    // As chat.ts writes it: memory before the slots line, the desk's hand-back note after it.
    const ctx = (memory: string, desk: string) => ({ type: "text" as const, text: `[Context from Mada's systems for this message. Not written by the traveller.]\nToday: Tuesday\nHousehold (id: name, relation, age):\nid1: Omar\n${memory}Read from the message: kind=flight${desk}` });
    const long = `Flights RUH → istanbul:\n${"1. id=f-1 · best · Saudia SV263 · RUH 09:40 → 13:10 · SAR 2,025 all in\n".repeat(8)}`;
    const turn = (n: number, extra = "", tail = ""): Anthropic.Beta.BetaMessageParam[] => [
      { role: "user", content: [ctx(extra, tail), { type: "text", text: `turn ${n}` }] },
      { role: "assistant", content: [{ type: "thinking", thinking: "hm", signature: "s" }, { type: "tool_use", id: `t${n}`, name: "search_flights", input: {} }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: `t${n}`, content: long }] },
      { role: "assistant", content: [{ type: "text", text: `Three ways ${n}.` }] },
    ];
    const history = [...turn(1, `${MEMORY_HEAD} (from earlier chats):\n- seat: Aisle\n`), ...turn(2, "", "\n[Mada's systems: Noura, a person on the Mada team, had this conversation for a while and has handed it back to you.\nWhat was said meanwhile:\nNoura: Noura said the hotel is booked]"), ...turn(3)];
    const lean = leanHistory(history);
    const flat = JSON.stringify(lean);
    expect(lean).toHaveLength(history.length);
    expect(flat).not.toMatch(/Today: Tuesday|thinking/);
    expect(flat).toContain("- seat: Aisle");
    expect(flat).toContain("Noura said the hotel is booked");
    const results = lean.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((b) => b.type === "tool_result") as { content: string; tool_use_id: string }[];
    expect(results.map((r) => r.tool_use_id)).toEqual(["t1", "t2", "t3"]);
    expect(results[0]!.content.length).toBeLessThanOrEqual(300);
    expect(results[2]!.content).toBe(long);
    // The stored thread is untouched.
    expect(JSON.stringify(history)).toContain("Today: Tuesday");
  });

  it("sends only the tools a turn can need, and the pay sheet once a search has run", () => {
    expect(leanToolsFor("esim")).toEqual(["esim_plans", "get_trips", "talk_to_human", "remember"]);
    expect(leanToolsFor("esim", ["esim_plans"])).toContain("price_quote_for_pay");
    expect(leanToolsFor(null)).toEqual(leanToolsFor("general"));
    expect(leanToolsFor(null)).toEqual(expect.arrayContaining(["search_flights", "get_trips", "create_request", "talk_to_human"]));
    expect(leanToolsFor(null, ["search_stays"])).toEqual(expect.arrayContaining(["price_quote_for_pay", "get_hotel"]));
    expect(leanToolsFor("food", ["plan_car_now"])).toContain("plan_car_now");
    expect(toolsFor(null)).toBeNull();
  });

  it("a left-out field that may be null counts as null; one that can't still needs saying", () => {
    const flights = TOOLS.find((t) => t.name === "search_flights")!.input_schema as never;
    const said = { destination: "dubai", depart: "2026-11-12", traveller_ids: [EVAL_PEOPLE[0]!.id], infants: 0 };
    expect(schemaProblems(flights, withNulls(flights, said))).toEqual([]);
    expect(withNulls(flights, said)).toMatchObject({ from: null, return: null, cabin: null });
    expect(schemaProblems(flights, withNulls(flights, { ...said, infants: undefined }))).not.toEqual([]);
  });
});
