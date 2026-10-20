import "server-only";

/*
 * The switches for Ask as a conversation (docs/app/ASK-CHAT.md), read from the environment on every call.
 *   ASK_CHAT                 on | off (default off). On only works with ANTHROPIC_API_KEY set; GET /config says
 *                            askChat: true only when both are there, so the app never tries a conversation that can't
 *                            answer.
 *   ASK_CHAT_MODEL           the conversation (default claude-sonnet-5-5: fast first words, strong tool use, $2/$10)
 *   ASK_FAST_MODEL           reading the sentence into slots (default claude-haiku-5-5: about a second, $0.10/$0.50)
 *   ASK_CHAT_PER_MINUTE      turns per person per minute (default 8)
 *   ASK_CHAT_PER_DAY         turns per person per day (default 120)
 *   ASK_CHAT_USER_DAILY_USD  spend per person per day before the app's own flows take over (default 1)
 *   ASK_CHAT_DAILY_USD       spend for everyone per day (default 50)
 */

export const askChatModel = () => process.env.ASK_CHAT_MODEL?.trim() || "claude-sonnet-5-5";
export const askFastModel = () => process.env.ASK_FAST_MODEL?.trim() || "claude-haiku-5-5";

export function askChatOn(): boolean {
  return process.env.ASK_CHAT?.trim().toLowerCase() === "on" && !!process.env.ANTHROPIC_API_KEY?.trim();
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

/** Cost in US dollars × 1,000,000. An unknown model is priced as the dearest one, so the cap still holds. */
export function costMicros(model: string, u: Usage): number {
  const [i, o, r, w] = PRICES[model] ?? PRICES["claude-opus-5-5"]!;
  return Math.ceil(u.input * i + u.output * o + u.cacheRead * r + u.cacheWrite * w);
}
