import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatApi, ChatStream, ReqOpts, StreamParams } from "./providers";
import { toOpenApiSchema } from "./schema";

/*
 * Any OpenAI-compatible /chat/completions endpoint (DeepSeek, Qwen, Kimi, GLM, vLLM…), behind the engine's
 * Messages-shaped interface. A thin translation, nothing more:
 *   in   system blocks → one system message; text blocks → content; tool_use → tool_calls; tool_result → role "tool";
 *        thinking blocks and Anthropic-only fields (betas, fallbacks, thinking, output_config, cache_control) dropped;
 *        tools → function tools with the same JSON schemas
 *   out  streamed content → text_delta events; a new tool call → a tool_use block start; finish_reason → stop_reason
 *        (tool_calls → tool_use, length → max_tokens, content_filter → refusal); usage → usage (cached prompt tokens
 *        as cache reads)
 * A turn whose kind is known sends only the tools it can need (`only_tools`, engine.ts / prompt.ts toolsFor): the
 * tool list is most of each request, and free tiers count tokens per minute.
 * Tool arguments are parsed once the stream ends; arguments that aren't JSON come back as {} and the tool answers
 * that its input is missing, like any bad input. Strict schemas aren't promised by these providers: the tools check
 * every field themselves (tools.ts).
 */

/** An HTTP failure from the provider, with its status (chat.ts maps it to the code the app sees). */
export class ProviderHttpError extends Error {
  /** quota: the provider said its quota or balance is used up (some answer 400, 402 or 403 for that, not 429). */
  constructor(readonly status: number, message: string, readonly retryAfter: number | null = null, readonly quota = false, /** the model is unknown to this key, or its free tier gives it nothing ("limit: 0") */ readonly noModel = false) { super(message); this.name = "ProviderHttpError"; }
}

/** How long a provider asks us to wait: Retry-After, or Gemini's "retryDelay": "37s" in the body. Seconds, or null. */
export function retryAfterOf(header: string | null, body: string): number | null {
  const h = Number(header);
  if (Number.isFinite(h) && h > 0) return h;
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body);
  return m ? Math.ceil(Number(m[1])) : null;
}
const QUOTA = /quota|rate.?limit|resource.?exhausted|insufficient|balance|exceeded|tokens per (?:minute|day)|too many requests/i;

type OaMessage =
  | { role: "system" | "user"; content: string }
  | { role: "assistant"; content: string | null; tool_calls?: { id: string; type: "function"; function: { name: string; arguments: string } }[] }
  | { role: "tool"; tool_call_id: string; content: string };

const textOf = (c: unknown): string => (typeof c === "string" ? c : Array.isArray(c) ? c.map((b) => (b && typeof b === "object" && "text" in b && typeof b.text === "string" ? b.text : "")).join("\n") : "");

/** The Messages-shaped request as a chat completion request. Exported for the tests. */
export function toChatCompletion(p: StreamParams, stream: boolean, openapi = false) {
  const messages: OaMessage[] = [];
  const system = typeof p.system === "string" ? p.system : (p.system ?? []).map((b) => b.text).join("\n\n");
  if (system) messages.push({ role: "system", content: system });
  for (const m of p.messages) {
    const blocks = typeof m.content === "string" ? [{ type: "text", text: m.content } as const] : m.content;
    if (m.role === "assistant") {
      const text = blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("");
      const calls = blocks.filter((b): b is Anthropic.Beta.BetaToolUseBlockParam => b.type === "tool_use")
        .map((b) => ({ id: b.id, type: "function" as const, function: { name: b.name, arguments: JSON.stringify(b.input ?? {}) } }));
      messages.push({ role: "assistant", content: text || null, ...(calls.length ? { tool_calls: calls } : {}) });
      continue;
    }
    // User turns: tool results first (each its own "tool" message), then any words.
    for (const b of blocks) if (b.type === "tool_result") messages.push({ role: "tool", tool_call_id: b.tool_use_id, content: `${b.is_error ? "[error] " : ""}${textOf(b.content)}` });
    const text = blocks.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join("\n\n");
    if (text) messages.push({ role: m.role === "system" ? "system" : "user", content: text });
  }
  const only = (p as { only_tools?: string[] }).only_tools;
  const tools = (p.tools ?? []).flatMap((t) => {
    if (!("input_schema" in t)) return [];
    if (only && !only.includes(t.name)) return [];
    const schema = t.input_schema as { properties?: Record<string, unknown> };
    // The OpenAPI subset (Gemini) has no null types and no empty parameter objects.
    const parameters = !openapi ? schema : Object.keys(schema.properties ?? {}).length ? toOpenApiSchema(schema as never) : undefined;
    return [{ type: "function", function: { name: t.name, description: t.description ?? "", ...(parameters ? { parameters } : {}) } }];
  });
  return {
    model: p.model,
    max_tokens: p.max_tokens,
    messages,
    ...(tools.length ? { tools, tool_choice: "auto" } : {}),
    stream,
    ...(stream ? { stream_options: { include_usage: true } } : {}),
  };
}

type Delta = { content?: string | null; tool_calls?: { index: number; id?: string; function?: { name?: string; arguments?: string } }[] };
type Chunk = { model?: string; x_groq?: { usage?: Chunk["usage"] }; choices?: { delta?: Delta; message?: { content?: string | null; tool_calls?: { id: string; function: { name: string; arguments: string } }[] }; finish_reason?: string | null }[]; usage?: { prompt_tokens?: number; completion_tokens?: number; prompt_tokens_details?: { cached_tokens?: number }; prompt_cache_hit_tokens?: number } };

const stopOf = (r: string | null | undefined): Anthropic.Beta.BetaStopReason => (r === "tool_calls" ? "tool_use" : r === "length" ? "max_tokens" : r === "content_filter" ? "refusal" : "end_turn");
const usageOf = (u: Chunk["usage"]): Anthropic.Beta.BetaUsage => {
  const cached = u?.prompt_tokens_details?.cached_tokens ?? u?.prompt_cache_hit_tokens ?? 0;
  return { input_tokens: Math.max(0, (u?.prompt_tokens ?? 0) - cached), output_tokens: u?.completion_tokens ?? 0, cache_read_input_tokens: cached, cache_creation_input_tokens: 0 } as Anthropic.Beta.BetaUsage;
};
const parseArgs = (s: string): Record<string, unknown> => {
  try { const v = JSON.parse(s || "{}"); return v && typeof v === "object" && !Array.isArray(v) ? v : {}; } catch { return {}; }
};

function message(model: string, text: string, calls: { id: string; name: string; args: string }[], stop: string | null | undefined, usage: Chunk["usage"]): Anthropic.Beta.BetaMessage {
  const content = [
    ...(text ? [{ type: "text", text, citations: null }] : []),
    ...calls.map((c) => ({ type: "tool_use", id: c.id, name: c.name, input: parseArgs(c.args) })),
  ];
  return { id: `oa_${Date.now().toString(36)}`, type: "message", role: "assistant", model, content, stop_reason: calls.length && stopOf(stop) === "end_turn" ? "tool_use" : stopOf(stop), stop_sequence: null, usage: usageOf(usage) } as unknown as Anthropic.Beta.BetaMessage;
}

export function openAiCompatibleApi(cfg: { baseUrl: string; apiKey: string; openapi?: boolean }): ChatApi {
  const url = `${cfg.baseUrl.replace(/\/+$/, "")}/chat/completions`;
  const post = async (body: unknown, opts?: ReqOpts) => {
    const timeout = AbortSignal.timeout(opts?.timeout ?? 60_000);
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${cfg.apiKey}`, Accept: "text/event-stream, application/json" },
      body: JSON.stringify(body),
      signal: opts?.signal ? AbortSignal.any([opts.signal, timeout]) : timeout,
    });
    if (!res.ok) {
      // The body only to read a wait or a quota word from; never logged.
      const body = (await res.text().catch(() => "")).slice(0, 2000);
      throw new ProviderHttpError(res.status, `provider answered ${res.status}`, retryAfterOf(res.headers.get("retry-after"), body), res.status !== 429 && res.status < 500 && QUOTA.test(body), res.status === 404 || (res.status === 429 && /limit:\s*0\b/.test(body)) || (res.status === 400 && /model/i.test(body) && /not (found|supported)|invalid/i.test(body)));
    }
    return res;
  };

  return {
    async create(p, opts) {
      const res = await post(toChatCompletion(p, false, cfg.openapi), opts);
      const j = (await res.json()) as Chunk;
      const m = j.choices?.[0]?.message;
      const calls = (m?.tool_calls ?? []).map((c) => ({ id: c.id, name: c.function.name, args: c.function.arguments }));
      return message(j.model ?? p.model, m?.content ?? "", calls, j.choices?.[0]?.finish_reason, j.usage);
    },

    stream(p, opts): ChatStream {
      let final: Anthropic.Beta.BetaMessage | null = null;
      let failed: unknown = null;
      let done: () => void = () => {};
      const ended = new Promise<void>((r) => { done = r; });
      async function* events(): AsyncGenerator<Anthropic.Beta.BetaRawMessageStreamEvent> {
        try {
          const res = await post(toChatCompletion(p, true, cfg.openapi), opts);
          const reader = res.body!.getReader();
          const decoder = new TextDecoder();
          let buf = "";
          let text = "";
          let stop: string | null | undefined = null;
          let usage: Chunk["usage"];
          let model = p.model;
          const calls: { id: string; name: string; args: string }[] = [];
          let textOpen = false;
          for (;;) {
            const { value, done: end } = await reader.read();
            if (end) break;
            buf += decoder.decode(value, { stream: true });
            const lines = buf.split("\n");
            buf = lines.pop() ?? "";
            for (const line of lines) {
              const data = line.startsWith("data:") ? line.slice(5).trim() : "";
              if (!data || data === "[DONE]") continue;
              let c: Chunk;
              try { c = JSON.parse(data) as Chunk; } catch { continue; }
              if (c.model) model = c.model;
              if (c.usage) usage = c.usage;
              else if (c.x_groq?.usage) usage = c.x_groq.usage;
              const ch = c.choices?.[0];
              if (!ch) continue;
              if (ch.finish_reason) stop = ch.finish_reason;
              const d = ch.delta ?? {};
              if (d.content) {
                if (!textOpen) { textOpen = true; yield { type: "content_block_start", index: 0, content_block: { type: "text", text: "", citations: null } } as Anthropic.Beta.BetaRawMessageStreamEvent; }
                text += d.content;
                yield { type: "content_block_delta", index: 0, delta: { type: "text_delta", text: d.content } } as Anthropic.Beta.BetaRawMessageStreamEvent;
              }
              for (const tc of d.tool_calls ?? []) {
                let call = calls[tc.index];
                if (!call) {
                  call = calls[tc.index] = { id: tc.id ?? `call_${tc.index}_${Date.now().toString(36)}`, name: tc.function?.name ?? "", args: "" };
                  yield { type: "content_block_start", index: tc.index + 1, content_block: { type: "tool_use", id: call.id, name: call.name, input: {} } } as unknown as Anthropic.Beta.BetaRawMessageStreamEvent;
                }
                if (tc.function?.name && !call.name) call.name = tc.function.name;
                if (tc.function?.arguments) call.args += tc.function.arguments;
              }
            }
          }
          final = message(model, text, calls.filter(Boolean), stop, usage);
        } catch (e) {
          failed = e;
          throw e;
        } finally {
          done();
        }
      }
      const it = events();
      return {
        [Symbol.asyncIterator]: () => it,
        async finalMessage() {
          // Read to the end if nobody iterated.
          if (!final && !failed) for await (const _ of it) { void _; }
          await ended;
          if (failed) throw failed;
          return final!;
        },
      };
    },
  };
}

/** The models a provider lists (GET /models), ids without Google's "models/" prefix. */
export async function listModels(cfg: { baseUrl: string; apiKey: string }): Promise<string[]> {
  const res = await fetch(`${cfg.baseUrl.replace(/\/+$/, "")}/models`, { headers: { Authorization: `Bearer ${cfg.apiKey}` }, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new ProviderHttpError(res.status, `models: provider answered ${res.status}`);
  const j = (await res.json()) as { data?: { id?: string }[] };
  return (j.data ?? []).map((m) => String(m.id ?? "").replace(/^models\//, "")).filter(Boolean);
}
