import "server-only";
import { AnthropicBedrock, AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
import type Anthropic from "@anthropic-ai/sdk";
import { bedrockModel, type BedrockSettings } from "./config";
import type { ChatApi, StreamParams } from "./providers";

/*
 * Claude through Amazon Bedrock, billed to the AWS account: the same Messages API (tools, streaming, adaptive thinking,
 * effort, prompt caching) through the official SDK's Mantle client, so the engine, the guards and the error mapping
 * (chat.ts errorCode: its errors are the Anthropic SDK's own classes) are unchanged. Two differences from anthropic:
 *   - model IDs carry the "anthropic." prefix (config.ts bedrockModel), added here too in case a caller passes a plain one
 *   - server-side refusal fallbacks are not on Bedrock: `fallbacks` and its beta are left out
 * Auth: a Bedrock API key (AWS_BEARER_TOKEN_BEDROCK, sent as a bearer token) or an IAM access key (SigV4).
 * An inference profile ("global.anthropic.claude-haiku-4-5-…", what the console's playground runs) or a Claude older
 * than 4.6 goes through bedrock-runtime (the SDK's AnthropicBedrock client) instead of Mantle, and a Claude older than
 * 4.6 gets no adaptive thinking or effort (it rejects both).
 */

const FALLBACK_BETA = /^server-side-fallback-/;
/** "global.", "us.", "eu.", "apac." …: a cross-region inference profile, served by bedrock-runtime. */
const PROFILE = /^(?:global|us|eu|apac|jp|au|ca)\./;
/** Claude 3.x and 4.0–4.5: no adaptive thinking, no effort. */
export const olderClaude = (m: string) => /claude-(?:3|(?:haiku|sonnet|opus)-4(?:-[0-5])?)(?![\d.])/.test(m) || /claude-3-/.test(m);
export const onRuntime = (m: string) => PROFILE.test(m) || olderClaude(m);

/** The request as Bedrock takes it: the engine's `only_tools` hint and server-side fallbacks dropped, the model prefixed. */
export function forBedrock(p: StreamParams): StreamParams {
  const { only_tools: _tools, fallbacks: _fallbacks, betas, ...rest } = p as StreamParams & { only_tools?: unknown; fallbacks?: unknown };
  void _tools; void _fallbacks;
  const kept = (betas ?? []).filter((b) => !FALLBACK_BETA.test(String(b)));
  const model = bedrockModel(String(p.model));
  const out = { ...rest, model, ...(kept.length ? { betas: kept } : {}) } as StreamParams & { thinking?: unknown; output_config?: { effort?: unknown } };
  if (olderClaude(model)) {
    delete out.thinking;
    if (out.output_config) { const { effort: _e, ...oc } = out.output_config; void _e; out.output_config = Object.keys(oc).length ? oc : undefined; if (!out.output_config) delete out.output_config; }
  }
  return out as StreamParams;
}

export function bedrockApi(s: BedrockSettings): ChatApi {
  const mantle = new AnthropicBedrockMantle({
    awsRegion: s.region,
    ...(s.apiKey ? { apiKey: s.apiKey } : { awsAccessKey: s.accessKeyId, awsSecretAccessKey: s.secretAccessKey, awsSessionToken: s.sessionToken ?? null }),
    timeout: 60_000,
    maxRetries: 2,
  });
  let runtime: AnthropicBedrock | null = null;
  const makeRuntime = () => s.apiKey
    ? new AnthropicBedrock({ awsRegion: s.region, apiKey: s.apiKey, timeout: 60_000, maxRetries: 2 })
    : new AnthropicBedrock({ awsRegion: s.region, awsAccessKey: s.accessKeyId ?? "", awsSecretKey: s.secretAccessKey ?? "", awsSessionToken: s.sessionToken ?? null, timeout: 60_000, maxRetries: 2 });
  const clientFor = (model: string) => (onRuntime(bedrockModel(model)) ? (runtime ??= makeRuntime()) : mantle);
  return {
    stream: (p, o) => clientFor(String(p.model)).beta.messages.stream(forBedrock(p), o),
    create: (p, o) => clientFor(String(p.model)).beta.messages.create(forBedrock(p), o) as Promise<Anthropic.Beta.BetaMessage>,
  };
}
