import "server-only";

/*
 * The switches for Ask as a conversation (docs/app/ASK-CHAT.md), read from the environment on every call.
 *   ASK_CHAT                 on | off (default off). On only works when the provider has its key (ANTHROPIC_API_KEY,
 *                            or ASK_CHAT_BASE_URL + ASK_CHAT_API_KEY + ASK_CHAT_MODEL); GET /config says askChat: true
 *                            only then, so the app never tries a conversation that can't answer.
 *   ASK_CHAT_PROVIDER        anthropic (default) | openai-compatible (DeepSeek, Qwen, Kimi, GLM, a self-hosted model:
 *                            any /chat/completions with streaming and tool calls; providers.ts). Anything else is off.
 *   ASK_CHAT_MODEL           the conversation (default claude-sonnet-5-5: fast first words, strong tool use, $2/$10;
 *                            required for openai-compatible)
 *   ASK_FAST_MODEL           reading the sentence into slots (default claude-haiku-5-5: about a second, $0.10/$0.50;
 *                            openai-compatible: the chat model unless set)
 *   ASK_CHAT_BASE_URL        openai-compatible only: the API root, e.g. https://api.deepseek.com/v1
 *   ASK_CHAT_API_KEY         openai-compatible only: its key
 *   ASK_CHAT_PRICE           US dollars per million tokens "input,output,cacheRead" for a model not in PRICES below
 *   ASK_CHAT_PER_MINUTE      turns per person per minute (default 8)
 *   ASK_CHAT_PER_DAY         turns per person per day (default 120)
 *   ASK_CHAT_USER_DAILY_USD  spend per person per day before the app's own flows take over (default 1)
 *   ASK_CHAT_DAILY_USD       spend for everyone per day (default 50)
 */

export type ChatProviderName = "anthropic" | "openai-compatible";
const env = (k: string) => process.env[k]?.trim() || "";

/** The provider named in the environment; null for a name we don't have an adapter for. */
export function chatProvider(): ChatProviderName | null {
  const v = env("ASK_CHAT_PROVIDER").toLowerCase() || "anthropic";
  return v === "anthropic" || v === "openai-compatible" ? v : null;
}

export const askChatModel = () => env("ASK_CHAT_MODEL") || (chatProvider() === "anthropic" ? "claude-sonnet-5-5" : "");
export const askFastModel = () => env("ASK_FAST_MODEL") || (chatProvider() === "anthropic" ? "claude-haiku-5-5" : askChatModel());

/** On, and the provider has what it needs. */
export function askChatOn(): boolean {
  if (env("ASK_CHAT").toLowerCase() !== "on") return false;
  const p = chatProvider();
  if (p === "anthropic") return !!env("ANTHROPIC_API_KEY");
  if (p === "openai-compatible") return !!(env("ASK_CHAT_BASE_URL") && env("ASK_CHAT_API_KEY") && env("ASK_CHAT_MODEL"));
  return false;
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
