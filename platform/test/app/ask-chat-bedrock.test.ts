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

  it("leaves out server-side fallbacks and the engine's tool hint; keeps effort, thinking, caching, tool_choice auto", () => {
    const p = forBedrock({ model: "anthropic.claude-haiku-5-5", max_tokens: 4096, betas: ["server-side-fallback-2026-07-01"], fallbacks: "default", only_tools: ["x"], thinking: { type: "adaptive" }, output_config: { effort: "low" }, cache_control: { type: "ephemeral" }, tool_choice: { type: "auto" }, messages: [] } as never) as unknown as Record<string, unknown>;
    expect(p).not.toHaveProperty("fallbacks");
    expect(p).not.toHaveProperty("betas");
    expect(p).not.toHaveProperty("only_tools");
    expect(p).toMatchObject({ thinking: { type: "adaptive" }, output_config: { effort: "low" }, cache_control: { type: "ephemeral" }, tool_choice: { type: "auto" } });
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
