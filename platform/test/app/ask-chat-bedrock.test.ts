import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The SDK's Mantle client, stood in for: what it was built with, and what each call sent. No network.
const built: Record<string, unknown>[] = [];
const sent: Record<string, unknown>[] = [];
vi.mock("@anthropic-ai/bedrock-sdk", () => ({
  AnthropicBedrockMantle: class {
    beta = {
      messages: {
        create: async (p: Record<string, unknown>) => { sent.push(p); return { model: p.model, content: [], usage: {} }; },
        stream: (p: Record<string, unknown>) => { sent.push(p); return { async *[Symbol.asyncIterator]() {}, finalMessage: async () => ({}) }; },
      },
    };
    constructor(opts: Record<string, unknown>) { built.push(opts); }
  },
}));

import { askChatModel, askChatOn, askFastModel, bedrockModel, chatProvider, costMicros, priceOf, providerChain } from "@/lib/app/ask-chat/config";
import { apiFor, probeChain, setChatApi, chatApi } from "@/lib/app/ask-chat/providers";
import { forBedrock } from "@/lib/app/ask-chat/providers-bedrock";

const KEYS = ["ASK_CHAT", "ASK_CHAT_PROVIDER", "ASK_CHAT_PROVIDERS", "ASK_CHAT_MODEL", "ASK_FAST_MODEL", "ASK_CHAT_MODEL_BEDROCK", "ASK_FAST_MODEL_BEDROCK", "AWS_BEARER_TOKEN_BEDROCK", "AWS_REGION", "AWS_ACCESS_KEY_ID", "AWS_SECRET_ACCESS_KEY", "AWS_SESSION_TOKEN", "GROQ_API_KEY", "GEMINI_API_KEY", "ANTHROPIC_API_KEY"];
let saved: Record<string, string | undefined> = {};
beforeEach(() => {
  saved = Object.fromEntries(KEYS.map((k) => [k, process.env[k]]));
  for (const k of KEYS) delete process.env[k];
  built.length = 0;
  sent.length = 0;
  setChatApi(null);
});
afterEach(() => {
  for (const k of KEYS) if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k];
});

describe("Ask on Amazon Bedrock: configuration", () => {
  it("prefixes Claude model IDs with anthropic., once", () => {
    expect(bedrockModel("claude-haiku-5-5")).toBe("anthropic.claude-haiku-5-5");
    expect(bedrockModel("anthropic.claude-sonnet-5-5")).toBe("anthropic.claude-sonnet-5-5");
    expect(bedrockModel("us.anthropic.claude-haiku-5-5")).toBe("us.anthropic.claude-haiku-5-5");
  });

  it("is a chain link only with a key and a region", () => {
    process.env.ASK_CHAT_PROVIDERS = "bedrock,groq,gemini";
    process.env.GROQ_API_KEY = "gsk-test";
    process.env.AWS_BEARER_TOKEN_BEDROCK = "bedrock-test-key";
    expect(providerChain()!.map((l) => l.name)).toEqual(["groq"]);
    process.env.AWS_REGION = "us-east-1";
    const chain = providerChain()!;
    expect(chain.map((l) => l.name)).toEqual(["bedrock", "groq"]);
    expect(chain[0]).toMatchObject({ model: "anthropic.claude-haiku-5-5", fastModel: "anthropic.claude-haiku-5-5", bedrock: { region: "us-east-1", apiKey: "bedrock-test-key" } });
  });

  it("takes an IAM access key instead of a Bedrock API key", () => {
    process.env.ASK_CHAT_PROVIDERS = "bedrock";
    process.env.AWS_REGION = "eu-west-1";
    process.env.AWS_ACCESS_KEY_ID = "AKIATEST";
    expect(providerChain()).toEqual([]);
    process.env.AWS_SECRET_ACCESS_KEY = "secret-test";
    expect(providerChain()![0]!.bedrock).toEqual({ region: "eu-west-1", accessKeyId: "AKIATEST", secretAccessKey: "secret-test" });
  });

  it("reads its own models from ASK_CHAT_MODEL_BEDROCK / ASK_FAST_MODEL_BEDROCK, prefixed", () => {
    Object.assign(process.env, { ASK_CHAT_PROVIDERS: "bedrock", AWS_REGION: "us-east-1", AWS_BEARER_TOKEN_BEDROCK: "k", ASK_CHAT_MODEL_BEDROCK: "claude-sonnet-5-5", ASK_FAST_MODEL_BEDROCK: "anthropic.claude-haiku-5-5" });
    expect(providerChain()![0]).toMatchObject({ model: "anthropic.claude-sonnet-5-5", fastModel: "anthropic.claude-haiku-5-5" });
  });

  it("works as the one provider (ASK_CHAT_PROVIDER=bedrock)", () => {
    Object.assign(process.env, { ASK_CHAT: "on", ASK_CHAT_PROVIDER: "bedrock" });
    expect(chatProvider()).toBe("bedrock");
    expect(askChatOn()).toBe(false);
    Object.assign(process.env, { AWS_REGION: "us-east-1", AWS_BEARER_TOKEN_BEDROCK: "k" });
    expect(askChatOn()).toBe(true);
    expect([askChatModel(), askFastModel()]).toEqual(["anthropic.claude-haiku-5-5", "anthropic.claude-haiku-5-5"]);
    process.env.ASK_CHAT_MODEL = "claude-sonnet-5-5";
    expect(askChatModel()).toBe("anthropic.claude-sonnet-5-5");
  });

  it("prices Haiku 5.5 and Sonnet 5.5 under both names, so the spend caps hold", () => {
    const u = { input: 1_000_000, output: 1_000_000, cacheRead: 1_000_000, cacheWrite: 0 };
    expect(priceOf("claude-haiku-5-5")?.slice(0, 3)).toEqual([0.1, 0.5, 0.01]);
    expect(priceOf("anthropic.claude-haiku-5-5")?.slice(0, 3)).toEqual([0.1, 0.5, 0.01]);
    expect(priceOf("us.anthropic.claude-haiku-5-5")?.slice(0, 3)).toEqual([0.1, 0.5, 0.01]);
    expect(priceOf("anthropic.claude-sonnet-5-5")?.slice(0, 3)).toEqual([2, 10, 0.2]);
    expect(costMicros("anthropic.claude-haiku-5-5", u)).toBe(costMicros("claude-haiku-5-5", u));
    expect(costMicros("anthropic.claude-haiku-5-5", u)).toBe(610_000);
    expect(costMicros("anthropic.claude-sonnet-5-5", u)).toBe(12_200_000);
  });
});

describe("Ask on Amazon Bedrock: the client", () => {
  it("builds the Mantle client with the region and the Bedrock API key", async () => {
    const api = await apiFor({ provider: "bedrock", bedrock: { region: "us-east-1", apiKey: "bedrock-test-key" } });
    expect(built).toHaveLength(1);
    expect(built[0]).toMatchObject({ awsRegion: "us-east-1", apiKey: "bedrock-test-key" });
    await api.create({ model: "claude-haiku-5-5", max_tokens: 8, messages: [] });
    expect(sent[0]!.model).toBe("anthropic.claude-haiku-5-5");
  });

  it("builds it with SigV4 credentials when there is no API key", async () => {
    await apiFor({ provider: "bedrock", bedrock: { region: "eu-west-1", accessKeyId: "AKIATEST", secretAccessKey: "s" } });
    expect(built[0]).toMatchObject({ awsRegion: "eu-west-1", awsAccessKey: "AKIATEST", awsSecretAccessKey: "s" });
    expect(built[0]).not.toHaveProperty("apiKey");
  });

  it("the configured provider is Bedrock when ASK_CHAT_PROVIDER=bedrock", async () => {
    Object.assign(process.env, { ASK_CHAT_PROVIDER: "bedrock", AWS_REGION: "ap-south-1", AWS_BEARER_TOKEN_BEDROCK: "k2" });
    await chatApi();
    expect(built.at(-1)).toMatchObject({ awsRegion: "ap-south-1", apiKey: "k2" });
  });

  it("leaves out server-side fallbacks and the engine's tool hint; keeps effort, thinking, tool_choice auto (request-level caching dropped)", () => {
    const p = forBedrock({ model: "anthropic.claude-haiku-5-5", max_tokens: 4096, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", only_tools: ["x"], thinking: { type: "adaptive" }, output_config: { effort: "low" }, cache_control: { type: "ephemeral" }, tool_choice: { type: "auto" }, messages: [] } as never) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("fallbacks");
    expect(p).not.toHaveProperty("betas");
    expect(p).not.toHaveProperty("only_tools");
    expect(p).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "low" }, tool_choice: { type: "auto" } });
    expect(p.cache_control).toBeUndefined();
    for (const k of ["temperature", "top_p", "top_k"]) expect(p).not.toHaveProperty(k);
  });

  it("the staging check probes Bedrock, in a chain and alone", async () => {
    Object.assign(process.env, { ASK_CHAT_PROVIDERS: "bedrock", AWS_REGION: "us-east-1", AWS_BEARER_TOKEN_BEDROCK: "k" });
    expect(await probeChain()).toMatchObject([{ name: "bedrock", model: "anthropic.claude-haiku-5-5", ok: true }]);
    delete process.env.ASK_CHAT_PROVIDERS;
    process.env.ASK_CHAT_PROVIDER = "bedrock";
    expect(await probeChain()).toMatchObject([{ name: "bedrock", model: "anthropic.claude-haiku-5-5", ok: true }]);
  });
});

describe("bedrock: an inference profile and an older Claude", () => {
  it("prices Haiku 4.5's global profile, sends it to bedrock-runtime, and drops adaptive thinking and effort", async () => {
    const { priceOf } = await import("@/lib/app/ask-chat/config");
    const { forBedrock, onRuntime, olderClaude } = await import("@/lib/app/ask-chat/providers-bedrock");
    const id = "global.anthropic.claude-haiku-4-5-20251001-v1:0";
    expect(priceOf(id)?.slice(0, 2)).toEqual([1, 5]);
    expect(onRuntime(id)).toBe(true);
    expect(olderClaude(id)).toBe(true);
    expect(olderClaude("anthropic.claude-haiku-5-5")).toBe(false);
    expect(onRuntime("anthropic.claude-haiku-5-5")).toBe(false);
    const out = forBedrock({ model: id, max_tokens: 9, messages: [], thinking: { type: "adaptive" }, output_config: { effort: "low" } } as never) as unknown as Record<string, unknown>;
    expect(out.model).toBe(id);
    expect(out.thinking).toBeUndefined();
    expect(out.output_config).toBeUndefined();
    const keep = forBedrock({ model: "claude-haiku-5-5", max_tokens: 9, messages: [], thinking: { type: "adaptive" }, output_config: { effort: "low" } } as never) as unknown as Record<string, unknown>;
    expect(keep.model).toBe("anthropic.claude-haiku-5-5");
    expect(keep.thinking).toEqual({ type: "adaptive" });
  });
});

describe("bedrock: older Claude schemas", () => {
  it("turns an enum on a nullable type into anyOf, values or null", async () => {
    const { forBedrock } = await import("@/lib/app/ask-chat/providers-bedrock");
    const schema = { type: "object", properties: { from: { type: ["string", "null"], enum: ["RUH", "JED", null], description: "d" }, kind: { type: "string", enum: ["a"] } } };
    const out = forBedrock({ model: "global.anthropic.claude-haiku-4-5-20251001-v1:0", max_tokens: 9, messages: [], tools: [{ name: "t", input_schema: schema }] } as never) as unknown as { tools: { input_schema: { properties: Record<string, unknown> } }[] };
    expect(out.tools[0]!.input_schema.properties.from).toEqual({ description: "d", anyOf: [{ type: "string", enum: ["RUH", "JED"] }, { type: "null" }] });
    expect(out.tools[0]!.input_schema.properties.kind).toEqual({ type: "string", enum: ["a"] });
    const newer = forBedrock({ model: "claude-haiku-5-5", max_tokens: 9, messages: [], tools: [{ name: "t", input_schema: schema }] } as never) as unknown as { tools: { input_schema: unknown }[] };
    expect(newer.tools[0]!.input_schema).toEqual(schema);
  });
});

describe("chain: a provider that refuses the request", () => {
  it("moves on to the next provider on a schema 400 or a missing model, not on any 400", async () => {
    const { worthAnother } = await import("@/lib/app/ask-chat/providers");
    const err = (status: number, message: string) => Object.assign(new Error(message), { status });
    expect(worthAnother(err(400, "400 tools.0.custom: Invalid schema: Enum value 'RUH' does not match declared type"))).toBe(true);
    expect(worthAnother(err(404, "model not found"))).toBe(true);
    expect(worthAnother(err(400, "messages: text content blocks must be non-empty"))).toBe(false);
  });
});

describe("bedrock: a thread another provider answered", () => {
  it("takes Gemini's extra_content off earlier tool calls", async () => {
    const { forBedrock } = await import("@/lib/app/ask-chat/providers-bedrock");
    const messages = [
      { role: "user", content: "hotel" },
      { role: "assistant", content: [{ type: "tool_use", id: "t1", name: "search_stays", input: {}, extra_content: { google: { thought_signature: "x" } } }] },
      { role: "user", content: [{ type: "tool_result", tool_use_id: "t1", content: "ok" }] },
    ];
    const out = forBedrock({ model: "global.anthropic.claude-haiku-4-5-20251001-v1:0", max_tokens: 9, messages } as never) as unknown as { messages: { content: unknown }[] };
    expect(JSON.stringify(out.messages)).not.toContain("extra_content");
    expect(JSON.stringify(out.messages)).toContain("search_stays");
  });
});

describe("chain: a quick helper call that runs out of time", () => {
  it("passes that call on but keeps the first provider for the turn's answer", async () => {
    const { chainApi, cooldowns, resetCooldowns, ranOutOfOwnTime } = await import("@/lib/app/ask-chat/providers");
    resetCooldowns();
    const { default: Anthropic } = await import("@anthropic-ai/sdk");
    const timedOut = new Anthropic.APIConnectionTimeoutError();
    expect(ranOutOfOwnTime(timedOut, 6_000)).toBe(true);
    expect(ranOutOfOwnTime(timedOut, 60_000)).toBe(false);
    const slow = { create: async () => { throw timedOut; }, stream: () => { throw new Error("unused"); } };
    const ok = { create: async () => ({ id: "m", content: [] }), stream: () => { throw new Error("unused"); } };
    const api = chainApi([{ name: "first", model: "a", fastModel: "a", api: slow as never }, { name: "second", model: "b", fastModel: "b", api: ok as never }], { log: () => {} });
    await api.create({ model: "x", max_tokens: 9, messages: [] } as never, { timeout: 6_000, maxRetries: 0 });
    expect(cooldowns().first).toBeUndefined();
    await expect(api.create({ model: "x", max_tokens: 9, messages: [] } as never, { timeout: 60_000 })).resolves.toBeTruthy();
    expect(cooldowns().first).toBeGreaterThan(0);
    resetCooldowns();
  });
});

describe("bedrock: request-level caching", () => {
  it("drops the top-level cache_control Bedrock rejects, keeps the system prompt's breakpoint", async () => {
    const { forBedrock } = await import("@/lib/app/ask-chat/providers-bedrock");
    const out = forBedrock({ model: "global.anthropic.claude-haiku-4-5-20251001-v1:0", max_tokens: 9, messages: [], cache_control: { type: "ephemeral" }, system: [{ type: "text", text: "s", cache_control: { type: "ephemeral" } }] } as never) as unknown as Record<string, unknown>;
    expect(out.cache_control).toBeUndefined();
    expect(JSON.stringify(out.system)).toContain("ephemeral");
  });
});

describe("claude: strict tools", () => {
  it("sends no strict tools to Claude (its compiler refuses Ask's set)", async () => {
    const { forBedrock } = await import("@/lib/app/ask-chat/providers-bedrock");
    const tools = Array.from({ length: 27 }, (_, i) => ({ name: `t${i}`, strict: true, input_schema: { type: "object", properties: {} } }));
    const out = forBedrock({ model: "anthropic.claude-haiku-5-5", max_tokens: 9, messages: [], tools } as never) as unknown as { tools: { strict?: boolean }[] };
    expect(out.tools.some((t) => "strict" in t)).toBe(false);
    expect(out.tools).toHaveLength(27);
  });
});

describe("pure Saudi Arabic", () => {
  it("swaps other dialects' words for Riyadh ones, whole words only", async () => {
    const { saudiWords } = await import("@/lib/app/ask-chat/guard");
    expect(saudiWords("وش تبغى؟ عندنا فندق حلو كده وايد")).toBe("وش تبي؟ عندنا فندق حلو كذا مرّة");
    expect(saudiWords("إيش رأيك؟ مش بعيد، وتبغى فطور؟")).toBe("وش رأيك؟ مو بعيد، وتبي فطور؟");
    expect(saudiWords("مشي خمس دقايق")).toBe("مشي خمس دقايق");
    expect(saudiWords("Hotels in Dubai")).toBe("Hotels in Dubai");
  });
  it("swaps in the stream too, never showing half a word", async () => {
    const { SentenceGate } = await import("@/lib/app/ask-chat/engine");
    let shown = "";
    const g = new SentenceGate(() => "", (x) => { shown += x; });
    for (const d of ["هذي فنادق ", "في دبي، تبغ", "ى وحدة قري", "بة من البحر؟ وكده"]) g.push(d);
    g.flush();
    expect(shown).toBe("هذي فنادق في دبي، تبي وحدة قريبة من البحر؟ وكذا");
  });
});
