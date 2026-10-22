import "server-only";

/*
 * The switches for Ask as a conversation (docs/app/ASK-CHAT.md), read from the environment on every call.
 *   ASK_CHAT                 on | off (default off). On only works when the provider has its key (ANTHROPIC_API_KEY,
 *                            or ASK_CHAT_BASE_URL + ASK_CHAT_API_KEY + ASK_CHAT_MODEL); GET /config says askChat: true
 *                            only then, so the app never tries a conversation that can't answer.
 *   ASK_CHAT_PROVIDER        anthropic (default) | bedrock (the same Claude, tools and caching through Amazon Bedrock,
 *                            billed to the AWS account: providers-bedrock.ts) | openai-compatible (DeepSeek, Qwen, Kimi,
 *                            a self-hosted model: any /chat/completions with streaming and tool calls; providers.ts) |
 *                            groq | zai | gemini (openai-compatible with the base URL, key variable and models filled
 *                            in: PRESETS below). Anything else is off.
 *   ASK_CHAT_MODEL           the conversation (default claude-sonnet-5-5: fast first words, strong tool use, $2/$10;
 *                            bedrock: anthropic.claude-haiku-5-5; required for openai-compatible)
 *   ASK_FAST_MODEL           reading the sentence into slots (default claude-haiku-5-5: about a second, $0.10/$0.50;
 *                            bedrock: anthropic.claude-haiku-5-5; openai-compatible: the chat model unless set).
 *                            On bedrock a model without the "anthropic." prefix gets it (bedrockModel).
 *   AWS_BEARER_TOKEN_BEDROCK bedrock: a Bedrock API key (console → API keys → long-term). Or AWS_ACCESS_KEY_ID +
 *                            AWS_SECRET_ACCESS_KEY (+ AWS_SESSION_TOKEN) for an IAM user. Either way with
 *   AWS_REGION               bedrock: the region the model is enabled in, e.g. us-east-1. Without a key and a region
 *                            bedrock is off.
 *   ASK_CHAT_BASE_URL        openai-compatible: the API root, e.g. https://api.deepseek.com/v1 (a preset's by default)
 *   ASK_CHAT_API_KEY         openai-compatible: its key (a preset reads GROQ_API_KEY, ZAI_API_KEY or GEMINI_API_KEY)
 *   ASK_CHAT_PROVIDERS       an ordered fallback chain instead of one provider, e.g. "bedrock,groq,gemini". Each reads
 *                            its preset's key (GROQ_API_KEY, GEMINI_API_KEY, ZAI_API_KEY, ANTHROPIC_API_KEY, bedrock's
 *                            AWS_BEARER_TOKEN_BEDROCK + AWS_REGION) and
 *                            uses its default model, or ASK_CHAT_MODEL_<NAME> (ASK_CHAT_MODEL_GEMINI…) and
 *                            ASK_FAST_MODEL_<NAME>. A provider that is rate limited, down or out of quota cools down
 *                            (its Retry-After, else 60 s) and the same call goes to the next one (providers.ts
 *                            chainApi). Providers without a key are left out; on while one is left. When set, it
 *                            replaces ASK_CHAT_PROVIDER, ASK_CHAT_MODEL and ASK_FAST_MODEL.
 *   ASK_CHAT_PRICE           US dollars per million tokens "input,output,cacheRead" for a model not in PRICES below
 *   ASK_CHAT_PER_MINUTE      turns per person per minute (default 8)
 *   ASK_CHAT_PER_DAY         turns per person per day (default 120)
 *   ASK_CHAT_USER_DAILY_USD  spend per person per day before the app's own flows take over (default 1)
 *   ASK_CHAT_DAILY_USD       spend for everyone per day (default 50)
 */

export type PresetName = "groq" | "zai" | "gemini";
export type ChatProviderName = "anthropic" | "bedrock" | "openai-compatible" | PresetName;
const env = (k: string) => process.env[k]?.trim() || "";

/**
 * OpenAI-compatible providers the owner has keys for, filled in. Models are the ones asked for (the evals run each);
 * Gemini's are read from GET /models at run time. `free`: no charge on the provider's free tier (priced 0 in the
 * evals). `openapi`: the provider reads tool schemas as the OpenAPI subset (schema.ts toOpenApiSchema).
 * Free tiers are for staging and test accounts only (docs/app/ASK-CHAT.md §6).
 */
export const PRESETS: Record<PresetName, { baseUrl: string; keyEnv: string; models: string[]; free?: string[]; openapi?: boolean; chainModel?: string }> = {
  groq: { baseUrl: "https://api.groq.com/openai/v1", keyEnv: "GROQ_API_KEY", models: ["openai/gpt-oss-120b", "llama-3.3-70b-versatile", "qwen/qwen3.8-27b"] },
  zai: { baseUrl: "https://api.z.ai/api/paas/v4", keyEnv: "ZAI_API_KEY", models: ["glm-4.7-flash", "glm-4.5-flash", "glm-5.3-flash"], free: ["glm-4.7-flash", "glm-4.5-flash"] },
  // In a chain Gemini needs a model without a lookup: its stable Flash (ASK_CHAT_MODEL_GEMINI for another).
  gemini: { baseUrl: "https://generativelanguage.googleapis.com/v1beta/openai", keyEnv: "GEMINI_API_KEY", models: [], openapi: true, chainModel: "gemini-2.5-flash" },
};
export const isPreset = (p: string): p is PresetName => p in PRESETS;

/** The provider named in the environment; null for a name we don't have an adapter for. */
export function chatProvider(): ChatProviderName | null {
  const v = env("ASK_CHAT_PROVIDER").toLowerCase() || "anthropic";
  return v === "anthropic" || v === "bedrock" || v === "openai-compatible" || isPreset(v) ? v : null;
}

/** Amazon Bedrock's region and credentials: a Bedrock API key, else an IAM access key. Null when either half is missing. */
export type BedrockSettings = { region: string; apiKey?: string; accessKeyId?: string; secretAccessKey?: string; sessionToken?: string };
export function bedrockSettings(): BedrockSettings | null {
  const region = env("AWS_REGION");
  if (!region) return null;
  const apiKey = env("AWS_BEARER_TOKEN_BEDROCK");
  if (apiKey) return { region, apiKey };
  const accessKeyId = env("AWS_ACCESS_KEY_ID");
  const secretAccessKey = env("AWS_SECRET_ACCESS_KEY");
  if (!accessKeyId || !secretAccessKey) return null;
  return { region, accessKeyId, secretAccessKey, ...(env("AWS_SESSION_TOKEN") ? { sessionToken: env("AWS_SESSION_TOKEN") } : {}) };
}

/** Bedrock names Claude models with an "anthropic." prefix (a cross-region "us.anthropic.…" is kept as it is). */
export const bedrockModel = (m: string) => (!m || /(^|\.)anthropic\./.test(m) ? m : `anthropic.${m}`);
export const BEDROCK_MODEL = "anthropic.claude-haiku-5-5";

/** Where an openai-compatible provider is, and its key: the environment's, or the preset's. */
export function openAiSettings(p = chatProvider()): { baseUrl: string; apiKey: string; openapi: boolean } | null {
  if (!p || p === "anthropic" || p === "bedrock") return null;
  const preset = isPreset(p) ? PRESETS[p] : null;
  const baseUrl = env("ASK_CHAT_BASE_URL") || preset?.baseUrl || "";
  const apiKey = env("ASK_CHAT_API_KEY") || (preset ? env(preset.keyEnv) : "");
  return baseUrl && apiKey ? { baseUrl, apiKey, openapi: !!preset?.openapi } : null;
}

/** One link of ASK_CHAT_PROVIDERS, with what it needs filled in. */
export type ChainLink = { name: "anthropic" | "bedrock" | PresetName | "openai-compatible"; model: string; fastModel: string; apiKey: string; baseUrl?: string; openapi?: boolean; /** bedrock: region and credentials (apiKey is then only the cache key's tail). */ bedrock?: BedrockSettings; /** Gemini with no model set: the newest Flash its key can use is found at start (providers.ts). */ auto?: boolean };

/** ASK_CHAT_PROVIDERS as links that have a key and a model, in order; null when it isn't set (one provider, as before). */
export function providerChain(): ChainLink[] | null {
  const raw = env("ASK_CHAT_PROVIDERS");
  if (!raw) return null;
  const out: ChainLink[] = [];
  for (const name of [...new Set(raw.toLowerCase().replace(/["'`]/g, "").split(/[,\s]+/).map((x) => x.trim()).filter(Boolean))]) {
    const up = name.replace(/[^a-z0-9]/g, "_").toUpperCase();
    const own = (k: string) => env(`${k}_${up}`);
    if (name === "anthropic") {
      const apiKey = env("ANTHROPIC_API_KEY");
      if (apiKey) out.push({ name, apiKey, model: own("ASK_CHAT_MODEL") || "claude-sonnet-5-5", fastModel: own("ASK_FAST_MODEL") || "claude-haiku-5-5" });
    } else if (name === "bedrock") {
      const b = bedrockSettings();
      if (b) out.push({ name, apiKey: b.apiKey ?? b.accessKeyId ?? "", bedrock: b, model: bedrockModel(own("ASK_CHAT_MODEL") || BEDROCK_MODEL), fastModel: bedrockModel(own("ASK_FAST_MODEL") || BEDROCK_MODEL) });
    } else if (name === "openai-compatible") {
      const s = { baseUrl: env("ASK_CHAT_BASE_URL"), apiKey: env("ASK_CHAT_API_KEY"), model: own("ASK_CHAT_MODEL") || env("ASK_CHAT_MODEL") };
      if (s.baseUrl && s.apiKey && s.model) out.push({ name, ...s, fastModel: own("ASK_FAST_MODEL") || s.model });
    } else if (isPreset(name)) {
      const pr = PRESETS[name];
      const apiKey = env(pr.keyEnv);
      const model = own("ASK_CHAT_MODEL") || pr.chainModel || pr.models[0] || "";
      if (apiKey && model) out.push({ name, apiKey, baseUrl: pr.baseUrl, openapi: !!pr.openapi, model, fastModel: own("ASK_FAST_MODEL") || model, auto: name === "gemini" && !own("ASK_CHAT_MODEL") && !own("ASK_FAST_MODEL") });
    }
  }
  return out;
}

export const askChatModel = () => {
  const chain = providerChain();
  if (chain) return chain[0]?.model ?? "";
  const p = chatProvider();
  if (p === "bedrock") return bedrockModel(env("ASK_CHAT_MODEL") || BEDROCK_MODEL);
  return env("ASK_CHAT_MODEL") || (p === "anthropic" ? "claude-sonnet-5-5" : p && isPreset(p) ? PRESETS[p].models[0] ?? "" : "");
};
export const askFastModel = () => {
  const chain = providerChain();
  if (chain) return chain[0]?.fastModel ?? "";
  if (chatProvider() === "bedrock") return bedrockModel(env("ASK_FAST_MODEL") || BEDROCK_MODEL);
  return env("ASK_FAST_MODEL") || (chatProvider() === "anthropic" ? "claude-haiku-5-5" : askChatModel());
};

/**
 * The first provider to answer is openai-compatible (a free tier, counted in tokens per minute): long threads fold
 * sooner (fold.ts). Each call still gets the words its provider reads (engine.ts `lean`).
 */
export function answersLean(): boolean {
  const chain = providerChain();
  if (chain) return !!chain[0] && chain[0].name !== "anthropic";
  const p = chatProvider();
  return !!p && p !== "anthropic";
}

/** On, and the provider has what it needs. */
export function askChatOn(): boolean {
  if (env("ASK_CHAT").toLowerCase() !== "on") return false;
  const chain = providerChain();
  if (chain) return chain.length > 0;
  const p = chatProvider();
  if (p === "anthropic") return !!env("ANTHROPIC_API_KEY");
  if (p === "bedrock") return !!bedrockSettings();
  return !!(p && openAiSettings(p) && askChatModel());
}

const num = (v: string | undefined, d: number) => {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : d;
};

export const askChatLimits = () => ({
  perMinute: num(process.env.ASK_CHAT_PER_MINUTE, 8),
  perDay: num(process.env.ASK_CHAT_PER_DAY, 120),
  userDailyMicros: Math.round(num(process.env.ASK_CHAT_USER_DAILY_USD, 1) * 1e6),
  dailyMicros: Math.round(num(process.env.ASK_CHAT_DAILY_USD, 50) * 1e6),
});

/**
 * US dollars per million tokens: input, output, cache read, cache write (5 minutes). Haiku 5.5's are for prompts up to
 * 100k tokens (a turn here is far below). Bedrock's "anthropic."-prefixed IDs are listed too, at the same prices.
 */
const BASE_PRICES: Record<string, [number, number, number, number]> = {
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
  "claude-opus-5-5": [4, 20, 0.2, 5],
};
const PRICES: Record<string, [number, number, number, number]> = {
  ...BASE_PRICES,
  ...Object.fromEntries(Object.entries(BASE_PRICES).map(([k, v]) => [`anthropic.${k}`, v])),
};
/** A model's price: its own, or a cross-region Bedrock ID's ("us.anthropic.claude-haiku-5-5") by its plain name. */
export const priceOf = (model: string): Price | null => PRICES[model] ?? PRICES[model.replace(/^(?:[a-z]+\.)?anthropic\./, "")] ?? null;

export type Usage = { input: number; output: number; cacheRead: number; cacheWrite: number };
export const noUsage = (): Usage => ({ input: 0, output: 0, cacheRead: 0, cacheWrite: 0 });

export type Price = [number, number, number, number];

/** "0.27,1.10,0.07": input, output, cache read (a cache write is priced as input). */
export function parsePrice(v: string | undefined): Price | null {
  const n = (v ?? "").split(",").map((x) => Number(x.trim()));
  return n.length >= 2 && n.every((x) => Number.isFinite(x) && x >= 0) ? [n[0]!, n[1]!, n[2] ?? n[0]!, n[0]!] : null;
}

/** Cost in US dollars × 1,000,000. An unknown model is priced as the dearest one, so the cap still holds. */
export function costMicros(model: string, u: Usage, price?: Price | null): number {
  const [i, o, r, w] = price ?? priceOf(model) ?? parsePrice(process.env.ASK_CHAT_PRICE) ?? PRICES["claude-opus-5-5"]!;
  return Math.ceil(u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * w);
}
