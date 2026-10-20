import type Anthropic from "@anthropic-ai/sdk";
import type { ChatApi } from "@/lib/app/ask-chat/engine";

/*
 * A stand-in for the Messages API: each request is answered by a script that sees the request (so it can read the
 * tool results it was sent) and returns the blocks of the reply. Streams them the way the SDK does: start, deltas in
 * small pieces, stop, then finalMessage().
 */

export type Block = { type: "text"; text: string } | { type: "tool_use"; name: string; input: Record<string, unknown> };
export type Reply = { blocks: Block[]; stop?: Anthropic.Beta.BetaStopReason };
export type Script = (params: Anthropic.Beta.MessageCreateParamsNonStreaming, n: number) => Reply;

export type Fake = ChatApi & { requests: Anthropic.Beta.MessageCreateParamsNonStreaming[]; creates: number };

const usage = (o: number) => ({ input_tokens: 1200, output_tokens: o, cache_read_input_tokens: 3000, cache_creation_input_tokens: 0 }) as Anthropic.Beta.BetaUsage;

export function fakeApi(script: Script, opts: { throwOn?: number; error?: Error } = {}): Fake {
  const requests: Anthropic.Beta.MessageCreateParamsNonStreaming[] = [];
  let ids = 0;
  const api: Fake = {
    requests,
    creates: 0,
    async create() {
      api.creates += 1;
      // The fast model: answers with no tool call, so the rules' reading stands.
      return { id: "msg_fast", type: "message", role: "assistant", model: "claude-haiku-5-5", content: [{ type: "text", text: "" }], stop_reason: "end_turn", stop_sequence: null, usage: usage(5) } as unknown as Anthropic.Beta.BetaMessage;
    },
    stream(params) {
      const n = requests.length;
      requests.push(structuredClone(params));
      if (opts.throwOn === n) {
        const err = opts.error ?? new Error("down");
        return { async *[Symbol.asyncIterator]() { throw err; }, finalMessage: () => Promise.reject(err) } as ReturnType<ChatApi["stream"]>;
      }
      const reply = script(params, n);
      const content = reply.blocks.map((b) => (b.type === "text" ? { type: "text", text: b.text, citations: null } : { type: "tool_use", id: `toolu_${++ids}`, name: b.name, input: b.input }));
      const stop = reply.stop ?? (content.some((b) => b.type === "tool_use") ? "tool_use" : "end_turn");
      const message = { id: `msg_${n}`, type: "message", role: "assistant", model: "claude-sonnet-5-5", content, stop_reason: stop, stop_sequence: null, usage: usage(60) } as unknown as Anthropic.Beta.BetaMessage;
      return {
        async *[Symbol.asyncIterator]() {
          for (const [index, b] of content.entries()) {
            if (b.type === "text") {
              yield { type: "content_block_start", index, content_block: { type: "text", text: "" } } as Anthropic.Beta.BetaRawMessageStreamEvent;
              const t = (b as { text: string }).text;
              for (let i = 0; i < t.length; i += 7) yield { type: "content_block_delta", index, delta: { type: "text_delta", text: t.slice(i, i + 7) } } as Anthropic.Beta.BetaRawMessageStreamEvent;
            } else {
              yield { type: "content_block_start", index, content_block: { ...b, input: {} } } as unknown as Anthropic.Beta.BetaRawMessageStreamEvent;
            }
            yield { type: "content_block_stop", index } as Anthropic.Beta.BetaRawMessageStreamEvent;
          }
        },
        finalMessage: async () => message,
      };
    },
  };
  return api;
}

/** The text of the tool results in the last message of a request. */
export function lastToolText(params: Anthropic.Beta.MessageCreateParamsNonStreaming): string {
  const last = params.messages[params.messages.length - 1];
  if (!last || !Array.isArray(last.content)) return "";
  return last.content.map((b) => (b.type === "tool_result" ? (typeof b.content === "string" ? b.content : "") : "")).join("\n");
}

/** Everything the model was sent as user text, for checking what reached it. */
export function userText(params: Anthropic.Beta.MessageCreateParamsNonStreaming): string {
  return params.messages.filter((m) => m.role === "user").map((m) => (typeof m.content === "string" ? m.content : m.content.map((b) => ("text" in b && typeof b.text === "string" ? b.text : b.type === "tool_result" && typeof b.content === "string" ? b.content : "")).join("\n"))).join("\n");
}
