import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { chatProvider, openAiSettings, type ChatProviderName } from "./config";

/*
 * Who the conversation talks to, behind one small interface: a streamed message with tool calls, and a plain one (for
 * the slots). The engine speaks the Messages API's shapes; each provider takes those in and gives those back, so the
 * engine, the guards, the tools, the threads and the evals are the same whoever answers. Redaction happens before any
 * of this (chat.ts), so no provider ever sees a passport, a card or a surname.
 *   anthropic          the Claude API through the official SDK (default; the production path)
 *   openai-compatible  any /chat/completions endpoint with streaming and function tools: DeepSeek, Qwen, Kimi, GLM,
 *                      vLLM or another self-hosted model (providers-openai.ts). For comparing in the evals first.
 *   groq, zai, gemini  openai-compatible with the base URL and key variable filled in (config.ts PRESETS).
 * Bedrock is not wired: it needs @anthropic-ai/bedrock-sdk and none of the betas this uses (docs/app/ASK-CHAT.md §6).
 */

export type StreamParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type ReqOpts = { signal?: AbortSignal; timeout?: number; maxRetries?: number };
export type ChatStream = AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent> & { finalMessage(): Promise<Anthropic.Beta.BetaMessage> };

/** The two calls the conversation makes. */
export interface ChatApi {
  stream(params: StreamParams, opts?: ReqOpts): ChatStream;
  create(params: StreamParams, opts?: ReqOpts): Promise<Anthropic.Beta.BetaMessage>;
}

export type ProviderConfig = { provider: ChatProviderName; apiKey?: string; baseUrl?: string; openapi?: boolean };

export function anthropicApi(apiKey = process.env.ANTHROPIC_API_KEY): ChatApi {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return {
    stream: (p, o) => client.beta.messages.stream(p, o),
    create: (p, o) => client.beta.messages.create(p, o) as Promise<Anthropic.Beta.BetaMessage>,
  };
}

/** A provider from explicit settings (the evals compare several in one run). */
export async function apiFor(cfg: ProviderConfig): Promise<ChatApi> {
  if (cfg.provider === "anthropic") return anthropicApi(cfg.apiKey);
  const { openAiCompatibleApi } = await import("./providers-openai");
  if (!cfg.baseUrl || !cfg.apiKey) throw new Error("openai-compatible needs a base URL and a key");
  return openAiCompatibleApi({ baseUrl: cfg.baseUrl, apiKey: cfg.apiKey, openapi: cfg.openapi });
}

let override: ChatApi | null = null;
let real: { key: string; api: ChatApi } | null = null;
/** Tests and evals: put a stand-in in front of the provider (null puts the real one back). */
export function setChatApi(api: ChatApi | null) { override = api; }

/** The configured provider (ASK_CHAT_PROVIDER), built once per configuration. */
export async function chatApi(): Promise<ChatApi> {
  if (override) return override;
  const provider = chatProvider();
  if (!provider) throw new Error("ASK_CHAT_PROVIDER names a provider without an adapter");
  const cfg: ProviderConfig = provider === "anthropic" ? { provider, apiKey: process.env.ANTHROPIC_API_KEY } : { provider, ...openAiSettings(provider) };
  const key = `${cfg.provider}|${cfg.baseUrl ?? ""}|${cfg.apiKey?.slice(-6) ?? ""}`;
  if (real?.key !== key) real = { key, api: await apiFor(cfg) };
  return real.api;
}
