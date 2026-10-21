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
