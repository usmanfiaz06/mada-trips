import "server-only";

/*
 * The switches for Ask as a conversation (docs/app/ASK-CHAT.md), read from the environment on every call.
 *   ASK_CHAT                 on | off (default off). On only works when the provider has its key (ANTHROPIC_API_KEY,
 *                            or ASK_CHAT_BASE_URL + ASK_CHAT_API_KEY + ASK_CHAT_MODEL); GET /config says askChat: true
 *                            only then, so the app never tries a conversation that can't answer.
 *   ASK_CHAT_PROVIDER        anthropic (default) | openai-compatible (DeepSeek, Qwen, Kimi, a self-hosted model: any
 *                            /chat/completions with streaming and tool calls; providers.ts) | groq | zai | gemini
 *                            (openai-compatible with the base URL, key variable and models filled in: PRESETS below).
 *                            Anything else is off.
 *   ASK_CHAT_MODEL           the conversation (default claude-sonnet-5-5: fast first words, strong tool use, $2/$10;
 *                            required for openai-compatible)
 *   ASK_FAST_MODEL           reading the sentence into slots (default claude-haiku-5-5: about a second, $0.10/$0.50;
 *                            openai-compatible: the chat model unless set)
 *   ASK_CHAT_BASE_URL        openai-compatible: the API root, e.g. https://api.deepseek.com/v1 (a preset's by default)
 *   ASK_CHAT_API_KEY         openai-compatible: its key (a preset reads GROQ_API_KEY, ZAI_API_KEY or GEMINI_API_KEY)
 *   ASK_CHAT_PROVIDERS       an ordered fallback chain instead of one provider, e.g. "groq,gemini,zai,anthropic". Each
 *                            reads its preset's key (GROQ_API_KEY, GEMINI_API_KEY, ZAI_API_KEY, ANTHROPIC_API_KEY) and
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
export type ChatProviderName = "anthropic" | "openai-compatible" | PresetName;
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
  return v === "anthropic" || v === "openai-compatible" || isPreset(v) ? v : null;
}

/** Where an openai-compatible provider is, and its key: the environment's, or the preset's. */
export function openAiSettings(p = chatProvider()): { baseUrl: string; apiKey: string; openapi: boolean } | null {
  if (!p || p === "anthropic") return null;
  const preset = isPreset(p) ? PRESETS[p] : null;
  const baseUrl = env("ASK_CHAT_BASE_URL") || preset?.baseUrl || "";
  const apiKey = env("ASK_CHAT_API_KEY") || (preset ? env(preset.keyEnv) : "");
  return baseUrl && apiKey ? { baseUrl, apiKey, openapi: !!preset?.openapi } : null;
}

/** One link of ASK_CHAT_PROVIDERS, with what it needs filled in. */
export type ChainLink = { name: "anthropic" | PresetName | "openai-compatible"; model: string; fastModel: string; apiKey: string; baseUrl?: string; openapi?: boolean };

/** ASK_CHAT_PROVIDERS as links that have a key and a model, in order; null when it isn't set (one provider, as before). */
export function providerChain(): ChainLink[] | null {
  const raw = env("ASK_CHAT_PROVIDERS");
  if (!raw) return null;
  const out: ChainLink[] = [];
  for (const name of [...new Set(raw.toLowerCase().split(",").map((x) => x.trim()).filter(Boolean))]) {
    const up = name.replace(/[^a-z0-9]/g, "_").toUpperCase();
    const own = (k: string) => env(`${k}_${up}`);
    if (name === "anthropic") {
      const apiKey = env("ANTHROPIC_API_KEY");
      if (apiKey) out.push({ name, apiKey, model: own("ASK_CHAT_MODEL") || "claude-sonnet-5-5", fastModel: own("ASK_FAST_MODEL") || "claude-haiku-5-5" });
    } else if (name === "openai-compatible") {
      const s = { baseUrl: env("ASK_CHAT_BASE_URL"), apiKey: env("ASK_CHAT_API_KEY"), model: own("ASK_CHAT_MODEL") || env("ASK_CHAT_MODEL") };
      if (s.baseUrl && s.apiKey && s.model) out.push({ name, ...s, fastModel: own("ASK_FAST_MODEL") || s.model });
    } else if (isPreset(name)) {
      const pr = PRESETS[name];
      const apiKey = env(pr.keyEnv);
      const model = own("ASK_CHAT_MODEL") || pr.chainModel || pr.models[0] || "";
      if (apiKey && model) out.push({ name, apiKey, baseUrl: pr.baseUrl, openapi: !!pr.openapi, model, fastModel: own("ASK_FAST_MODEL") || model });
    }
  }
  return out;
}

export const askChatModel = () => {
  const chain = providerChain();
  if (chain) return chain[0]?.model ?? "";
  const p = chatProvider();
  return env("ASK_CHAT_MODEL") || (p === "anthropic" ? "claude-sonnet-5-5" : p && isPreset(p) ? PRESETS[p].models[0] ?? "" : "");
};
export const askFastModel = () => {
  const chain = providerChain();
  if (chain) return chain[0]?.fastModel ?? "";
  return env("ASK_FAST_MODEL") || (chatProvider() === "anthropic" ? "claude-haiku-5-5" : askChatModel());
};

/** On, and the provider has what it needs. */
export function askChatOn(): boolean {
  if (env("ASK_CHAT").toLowerCase() !== "on") return false;
  const chain = providerChain();
  if (chain) return chain.length > 0;
  const p = chatProvider();
  if (p === "anthropic") return !!env("ANTHROPIC_API_KEY");
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

/** US dollars per million tokens: input, output, cache read, cache write (5 minutes). */
const PRICES: Record<string, [number, number, number, number]> = {
  "claude-sonnet-5-5": [2, 10, 0.2, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
  "claude-opus-5-5": [4, 20, 0.2, 5],
};

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
  const [i, o, r, w] = price ?? PRICES[model] ?? parsePrice(process.env.ASK_CHAT_PRICE) ?? PRICES["claude-opus-5-5"]!;
  return Math.ceil(u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * w);
}
