import Anthropic from "@anthropic-ai/sdk";
import { bannedIn } from "@mada/shared";
import type { AiSupplier, Intent } from "../types";
import { requireEnv } from "./not-configured";

/*
 * The concierge, on the Claude API. Two jobs at M0: understand a request (structured intent, never prices) and give a
 * short open answer under COPY.md rules. High-stakes messages never come from here: they are fixed templates.
 *   ANTHROPIC_API_KEY  required
 *   ANTHROPIC_MODEL    defaults to claude-opus-5-5
 * Server-side refusal fallbacks are on (beta server-side-fallback-2026-07-01, fallbacks: "default").
 */

const MODEL = () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
let client: Anthropic | null = null;
const api = () => {
  const env = requireEnv("ai (Claude)", ["ANTHROPIC_API_KEY"]);
  return (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 30_000, maxRetries: 2 }));
};

const STYLE = [
  "You write for Mada Trips, a Saudi travel agency. You speak as \"we\" (Mada), never \"I\".",
  "Answer first, in at most two short sentences. Numbers beat adjectives. No exclamation marks, no emoji.",
  "Never mention AI, assistants or bots. Never quote prices or invent availability.",
  "Reply in the language the traveller wrote in.",
].join(" ");

const INTENT_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "to", "from", "depart", "return", "travellers", "ask"],
  properties: {
    kind: { type: "string", enum: ["flight", "stay", "visa", "umrah", "car", "restaurant", "activity", "general"] },
    to: { type: ["string", "null"], description: "IATA airport code of the destination" },
    from: { type: ["string", "null"], description: "IATA airport code of the origin" },
    depart: { type: ["string", "null"], description: "YYYY-MM-DD" },
    return: { type: ["string", "null"], description: "YYYY-MM-DD" },
    travellers: { type: ["integer", "null"] },
    ask: { type: ["string", "null"], enum: ["where", "when", "who", null], description: "The single missing detail that changes the outcome" },
  },
} as const;

async function create(params: { system: string; user: string; format?: object; maxTokens: number }) {
  const res = await api().beta.messages.create({
    model: MODEL(),
    max_tokens: params.maxTokens,
    betas: ["server-side-fallback-2026-07-01"],
    fallbacks: "default",
    output_config: { effort: "low", ...(params.format ? { format: { type: "json_schema", schema: params.format } } : {}) },
    system: params.system,
    messages: [{ role: "user", content: params.user }],
  } as Parameters<Anthropic["beta"]["messages"]["create"]>[0]) as Anthropic.Beta.BetaMessage;
  if (res.stop_reason === "refusal") return null;
  return res.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("");
}

export const claudeAi: AiSupplier = {
  name: "claude",
  async parseIntent(text, ctx): Promise<Intent> {
    const out = await create({
      system: `Extract what a traveller is asking for. Today is ${ctx.today}; they live near ${ctx.home}. Use null for anything not stated.`,
      user: text.slice(0, 2000),
      format: INTENT_SCHEMA,
      maxTokens: 1024,
    });
    if (!out) return { kind: "general", to: null, from: null, depart: null, return: null, travellers: null, ask: null };
    return JSON.parse(out) as Intent;
  },
  async answer(question, ctx) {
    const out = await create({ system: `${STYLE} Today is ${ctx.today}.${ctx.city ? ` The traveller is planning ${ctx.city}.` : ""}`, user: question.slice(0, 2000), maxTokens: 1024 });
    // Every outgoing message passes the banned-word check; if it fails, a fixed line goes out instead (COPY.md §6.4).
    if (!out || bannedIn(out).length) return "Faisal can answer that one. Send it to him from Ask.";
    return out.trim();
  },
};
