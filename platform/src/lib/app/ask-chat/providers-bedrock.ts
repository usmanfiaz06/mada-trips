import "server-only";
import { AnthropicBedrockMantle } from "@anthropic-ai/bedrock-sdk";
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
 */

const FALLBACK_BETA = /^server-side-fallback-/;

/** The request as Bedrock takes it: the engine's `only_tools` hint and server-side fallbacks dropped, the model prefixed. */
export function forBedrock(p: StreamParams): StreamParams {
  const { only_tools: _tools, fallbacks: _fallbacks, betas, ...rest } = p as StreamParams & { only_tools?: unknown; fallbacks?: unknown };
  void _tools; void _fallbacks;
  const kept = (betas ?? []).filter((b) => !FALLBACK_BETA.test(String(b)));
  return { ...rest, model: bedrockModel(String(p.model)), ...(kept.length ? { betas: kept } : {}) } as StreamParams;
}

export function bedrockApi(s: BedrockSettings): ChatApi {
  const client = new AnthropicBedrockMantle({
    awsRegion: s.region,
    ...(s.apiKey ? { apiKey: s.apiKey } : { awsAccessKey: s.accessKeyId, awsSecretAccessKey: s.secretAccessKey, awsSessionToken: s.sessionToken ?? null }),
    timeout: 60_000,
    maxRetries: 2,
  });
  return {
    stream: (p, o) => client.beta.messages.stream(forBedrock(p), o),
    create: (p, o) => client.beta.messages.create(forBedrock(p), o) as Promise<Anthropic.Beta.BetaMessage>,
  };
}
