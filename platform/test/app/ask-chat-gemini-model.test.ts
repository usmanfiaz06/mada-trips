import { describe, expect, it } from "vitest";
import { autoModelApi, rankFlash, type ChatApi } from "@/lib/app/ask-chat/providers";
import { ProviderHttpError } from "@/lib/app/ask-chat/providers-openai";

// Gemini's model is found from the key's own list, and a model the key can't use is skipped (providers.ts).
describe("Gemini model from the key", () => {
  it("ranks the newest plain Flash first, never image, voice or Pro", () => {
    const ids = ["models/gemini-2.5-flash", "models/gemini-3.6-flash", "models/gemini-3.6-flash-lite", "models/gemini-3.6-flash-preview-09-2026", "models/gemini-3.6-pro", "models/gemini-3.6-flash-image", "models/gemini-2.5-flash-preview-tts", "models/embedding-001"];
    expect(rankFlash(ids)).toEqual(["gemini-3.6-flash", "gemini-3.6-flash-preview-09-2026", "gemini-3.6-flash-lite", "gemini-2.5-flash"]);
  });

  it("moves to the next model when the key has no allowance for one", async () => {
    const asked: string[] = [];
    const api: ChatApi = {
      async create(p) {
        asked.push(p.model);
        if (p.model === "a") throw new ProviderHttpError(429, "provider answered 429", null, false, true);
        return { model: p.model } as never;
      },
      stream: () => { throw new Error("unused"); },
    };
    const auto = autoModelApi(api, ["a", "b"]);
    await auto.create({ model: "x", max_tokens: 1, messages: [] });
    await auto.create({ model: "x", max_tokens: 1, messages: [] });
    expect(asked).toEqual(["a", "b", "b"]);
  });

  it("a plain rate limit is not a wrong model: the chain rests the provider instead", async () => {
    const api: ChatApi = { create: async () => { throw new ProviderHttpError(429, "provider answered 429"); }, stream: () => { throw new Error("unused"); } };
    await expect(autoModelApi(api, ["a", "b"]).create({ model: "x", max_tokens: 1, messages: [] })).rejects.toThrow("429");
  });
});

describe("Gemini warm-up", () => {
  it("uses the first model that answers when a newer one hangs", async () => {
    const asked: string[] = [];
    const api: ChatApi = {
      async create(p, o) {
        asked.push(p.model);
        if (p.model === "new") return new Promise((_, rej) => setTimeout(() => rej(Object.assign(new Error("timeout"), { name: "TimeoutError" })), o?.timeout === 9_000 ? 50 : 10_000));
        return { model: p.model } as never;
      },
      stream: () => { throw new Error("unused"); },
    };
    const auto = autoModelApi(api, ["new", "old"], { warm: true });
    const r = await auto.create({ model: "x", max_tokens: 1, messages: [] });
    expect((r as { model: string }).model).toBe("old");
  });
});

describe("Gemini's stream", () => {
  it("keeps tool calls that come without an index", async () => {
    const { openAiCompatibleApi } = await import("@/lib/app/ask-chat/providers-openai");
    const sse = [
      { choices: [{ delta: { role: "assistant", tool_calls: [{ id: "a1", type: "function", function: { name: "search_stays", arguments: "{\"city\":\"Baku\"}" } }, { id: "a2", type: "function", function: { name: "entry_rules", arguments: "{}" } }] } }] },
      { choices: [{ delta: {}, finish_reason: "stop" }], usage: { prompt_tokens: 10, completion_tokens: 5 } },
    ].map((c) => `data: ${JSON.stringify(c)}\n\n`).join("") + "data: [DONE]\n\n";
    const realFetch = globalThis.fetch;
    globalThis.fetch = (async () => new Response(sse, { status: 200, headers: { "content-type": "text/event-stream" } })) as typeof fetch;
    try {
      const s = openAiCompatibleApi({ baseUrl: "https://x", apiKey: "k", openapi: true }).stream({ model: "m", max_tokens: 10, messages: [{ role: "user", content: "hi" }] });
      for await (const _ of s) { void _; }
      const m = await s.finalMessage();
      expect(m.content.filter((b) => b.type === "tool_use").map((b) => (b as { name: string }).name)).toEqual(["search_stays", "entry_rules"]);
    } finally { globalThis.fetch = realFetch; }
  });
});
