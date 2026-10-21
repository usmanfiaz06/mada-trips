import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { chatProvider, openAiSettings, providerChain, type ChainLink, type ChatProviderName } from "./config";

/*
 * Who the conversation talks to, behind one small interface: a streamed message with tool calls, and a plain one (for
 * the slots). The engine speaks the Messages API's shapes; each provider takes those in and gives those back, so the
 * engine, the guards, the tools, the threads and the evals are the same whoever answers. Redaction happens before any
 * of this (chat.ts), so no provider ever sees a passport, a card or a surname.
 *   anthropic          the Claude API through the official SDK (default; the production path)
 *   openai-compatible  any /chat/completions endpoint with streaming and function tools: DeepSeek, Qwen, Kimi, GLM,
 *                      vLLM or another self-hosted model (providers-openai.ts). For comparing in the evals first.
 *   groq, zai, gemini  openai-compatible with the base URL and key variable filled in (config.ts PRESETS).
 *   ASK_CHAT_PROVIDERS a chain of the above (chainApi below): the same call moves to the next provider when one is
 *                      rate limited, down or out of quota. Every provider reads and writes the same Messages-shaped
 *                      thread, so a switch mid-conversation (even mid-turn, after a tool ran) needs nothing else.
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

/** The engine's hint for providers that pay per tool (`only_tools`) is not an API field: Claude gets every tool, cached. */
const forClaude = (p: StreamParams): StreamParams => {
  if (!("only_tools" in p)) return p;
  const { only_tools: _drop, ...rest } = p as StreamParams & { only_tools?: unknown };
  void _drop;
  return rest as StreamParams;
};

export function anthropicApi(apiKey = process.env.ANTHROPIC_API_KEY): ChatApi {
  const client = new Anthropic({ apiKey, timeout: 60_000, maxRetries: 2 });
  return {
    stream: (p, o) => client.beta.messages.stream(forClaude(p), o),
    create: (p, o) => client.beta.messages.create(forClaude(p), o) as Promise<Anthropic.Beta.BetaMessage>,
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

/** The configured provider (ASK_CHAT_PROVIDERS, else ASK_CHAT_PROVIDER), built once per configuration. */
export async function chatApi(): Promise<ChatApi> {
  if (override) return override;
  const chain = providerChain();
  if (chain) {
    const key = `chain|${chain.map((l) => `${l.name}:${l.model}:${l.fastModel}:${l.apiKey.slice(-6)}`).join(",")}`;
    if (real?.key !== key) real = { key, api: chainApi(await Promise.all(chain.map(async (l) => {
      const api = await apiFor(linkConfig(l));
      return { name: l.name, model: l.model, fastModel: l.fastModel, api: l.auto ? autoModelApi(api, await flashModels(l)) : api };
    }))) };
    return real.api;
  }
  const provider = chatProvider();
  if (!provider) throw new Error("ASK_CHAT_PROVIDER names a provider without an adapter");
  const cfg: ProviderConfig = provider === "anthropic" ? { provider, apiKey: process.env.ANTHROPIC_API_KEY } : { provider, ...openAiSettings(provider) };
  const key = `${cfg.provider}|${cfg.baseUrl ?? ""}|${cfg.apiKey?.slice(-6) ?? ""}`;
  if (real?.key !== key) real = { key, api: await apiFor(cfg) };
  return real.api;
}

const linkConfig = (l: ChainLink): ProviderConfig =>
  l.name === "anthropic" ? { provider: "anthropic", apiKey: l.apiKey } : { provider: l.name, apiKey: l.apiKey, baseUrl: l.baseUrl, openapi: l.openapi };

/* ───────────── Gemini's model, found from its key ───────────── */

/**
 * Gemini Flash models newest first, from the key's own model list (GET {base}/models), so nobody has to know the exact
 * name: the plain Flash before Flash-Lite, a stable name before a preview; never image, voice or live models. Falls back
 * to the preset's model when the list can't be read.
 */
export function rankFlash(ids: string[]): string[] {
  const rows = ids.map((raw) => raw.replace(/^models\//, "")).filter((id) => !/tts|image|audio|live|thinking|embed/i.test(id)).flatMap((id) => {
    const m = /^gemini-(\d+(?:\.\d+)?)-flash(-lite)?(?:-(latest|preview(?:-[\w-]+)?|\d{3}))?$/.exec(id);
    return m ? [{ id, v: Number(m[1]), lite: !!m[2], preview: (m[3] ?? "").startsWith("preview") }] : [];
  });
  rows.sort((a, b) => b.v - a.v || Number(a.lite) - Number(b.lite) || Number(a.preview) - Number(b.preview) || a.id.localeCompare(b.id));
  return [...new Set(rows.map((r) => r.id))];
}

export async function flashModels(l: ChainLink): Promise<string[]> {
  try {
    const { listModels } = await import("./providers-openai");
    const ids = await listModels({ baseUrl: l.baseUrl ?? "", apiKey: l.apiKey });
    const found = rankFlash(ids);
    console.info(`[ask-chat] provider=${l.name} models=${found.slice(0, 4).join(",") || "none"}`);
    return found.length ? found : [l.model];
  } catch (e) {
    console.info(`[ask-chat] provider=${l.name} model list unreadable (${e instanceof Error ? e.message : "error"}), using ${l.model}`);
    return [l.model];
  }
}

/** A model this key can't use: not found, or a free tier with no allowance for it (providers-openai.ts noModel). */
const wrongModel = (e: unknown): boolean => statusOf(e) === 404 || (!!e && typeof e === "object" && (e as { noModel?: unknown }).noModel === true);

/** Calls go to the first model that works; one the key can't use is skipped for good on this instance. */
export function autoModelApi(api: ChatApi, models: string[]): ChatApi {
  let i = 0;
  const pick = () => models[Math.min(i, models.length - 1)];
  const skip = (e: unknown) => {
    if (!wrongModel(e) || i >= models.length - 1) return false;
    console.info(`[ask-chat] model=${pick()} not usable with this key (${statusOf(e)}), trying ${models[i + 1]}`);
    i++;
    return true;
  };
  return {
    async create(p, o) {
      for (;;) {
        try { return await api.create({ ...p, model: pick() }, o); } catch (e) { if (!skip(e)) throw e; }
      }
    },
    stream(p, o) {
      let current = api.stream({ ...p, model: pick() }, o);
      let failed: unknown = null;
      async function* events(): AsyncGenerator<Anthropic.Beta.BetaRawMessageStreamEvent> {
        for (;;) {
          let started = false;
          try {
            for await (const ev of current) { started = true; yield ev; }
            return;
          } catch (e) {
            if (started || !skip(e)) { failed = e; throw e; }
            current = api.stream({ ...p, model: pick() }, o);
          }
        }
      }
      const it = events();
      return {
        [Symbol.asyncIterator]: () => it,
        async finalMessage() {
          for await (const _ of it) { void _; }
          if (failed) throw failed;
          return current.finalMessage();
        },
      };
    },
  };
}

/* ───────────── the fallback chain (ASK_CHAT_PROVIDERS) ───────────── */

/** One provider in a chain: who, its models (the chain sets them on each call), and its API. */
export type ChainMember = { name: string; model: string; fastModel: string; api: ChatApi };

/** Until when each provider rests, per server instance (ms since epoch). A restart forgets it, which only costs one retry. */
const cooling = new Map<string, number>();
export const COOL_MS = 60_000;
/** Tests: forget every cooldown. */
export function resetCooldowns() { cooling.clear(); }
/** Who is resting and for how many more seconds (GET /health-style checks and tests). */
export function cooldowns(now = Date.now()): Record<string, number> {
  return Object.fromEntries([...cooling].filter(([, until]) => until > now).map(([k, until]) => [k, Math.ceil((until - now) / 1000)]));
}

const statusOf = (e: unknown): number | null => (e && typeof e === "object" && "status" in e && typeof (e as { status: unknown }).status === "number" ? (e as { status: number }).status : null);

/**
 * Whether another provider should take the same call: rate limited (429, Groq's 413 for tokens per minute), down
 * (5xx, 529), timed out or unreachable, or out of quota. Never when the traveller went away (their abort).
 */
export function worthAnother(e: unknown, signal?: AbortSignal): boolean {
  if (signal?.aborted) return false;
  if (e instanceof Anthropic.APIConnectionError) return true; // timeouts too
  const st = statusOf(e);
  if (st !== null) return st === 429 || st === 408 || st === 413 || st >= 500 || (e as { quota?: boolean }).quota === true;
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || (e.name === "TypeError" && /fetch|network/i.test(e.message)))) return true;
  return false;
}

/** How long to rest a provider after this error: its own Retry-After when it gave one, else a minute. */
const restMs = (e: unknown): number => {
  const ra = e && typeof e === "object" && "retryAfter" in e ? Number((e as { retryAfter: unknown }).retryAfter) : NaN;
  const hdr = e instanceof Anthropic.APIError ? Number(e.headers?.get?.("retry-after")) : NaN;
  const s = Number.isFinite(ra) && ra > 0 ? ra : Number.isFinite(hdr) && hdr > 0 ? hdr : 0;
  return s ? Math.min(s * 1000, 15 * 60_000) : COOL_MS;
};

/** Every provider is resting: the app answers with its own flows (chat.ts errorCode → RATE_LIMITED). */
async function allResting(now: number): Promise<never> {
  const { ProviderHttpError } = await import("./providers-openai");
  const next = Math.min(...[...cooling.values()].filter((u) => u > now));
  throw new ProviderHttpError(429, "every provider in ASK_CHAT_PROVIDERS is cooling down", Number.isFinite(next) ? Math.ceil((next - now) / 1000) : COOL_MS / 1000);
}

/**
 * Providers in order: each call goes to the first one not resting, with that provider's model (the chat model for a
 * stream, the fast one for a plain call). A failure worth another provider (worthAnother) before any word arrived
 * rests that one and sends the same call to the next; after words arrived it is the turn's error, as with one provider.
 * Which provider answered is logged per call; never what was said.
 */
export function chainApi(members: ChainMember[], opts: { now?: () => number; log?: (line: string) => void } = {}): ChatApi {
  const now = opts.now ?? Date.now;
  const log = opts.log ?? ((l: string) => console.info(l));
  const order = (tried: Set<string>) => members.filter((m) => !tried.has(m.name) && (cooling.get(m.name) ?? 0) <= now());
  const rest = (m: ChainMember, e: unknown) => {
    cooling.set(m.name, now() + restMs(e));
    log(`[ask-chat] provider=${m.name} resting ${Math.round(restMs(e) / 1000)}s (${statusOf(e) ?? (e instanceof Error ? e.name : "error")})`);
  };
  return {
    async create(p, o) {
      const tried = new Set<string>();
      let skipped: string[] = [];
      for (;;) {
        const m = order(tried)[0];
        if (!m) return allResting(now());
        tried.add(m.name);
        try {
          const res = await m.api.create({ ...p, model: m.fastModel }, o);
          log(`[ask-chat] provider=${m.name} model=${m.fastModel} call=create${skipped.length ? ` after=${skipped.join(",")}` : ""}`);
          return res;
        } catch (e) {
          if (!worthAnother(e, o?.signal)) throw e;
          rest(m, e);
          skipped = [...skipped, m.name];
        }
      }
    },
    stream(p, o) {
      let answered: ReturnType<ChatApi["stream"]> | null = null;
      let failed: unknown = null;
      let finished = false;
      async function* events(): AsyncGenerator<Anthropic.Beta.BetaRawMessageStreamEvent> {
        const tried = new Set<string>();
        const skipped: string[] = [];
        try {
          for (;;) {
            const m = order(tried)[0];
            if (!m) await allResting(now());
            const link = m!;
            tried.add(link.name);
            const s = link.api.stream({ ...p, model: link.model }, o);
            let started = false;
            try {
              for await (const ev of s) { started = true; yield ev; }
              answered = s;
              log(`[ask-chat] provider=${link.name} model=${link.model} call=stream${skipped.length ? ` after=${skipped.join(",")}` : ""}`);
              return;
            } catch (e) {
              if (started || !worthAnother(e, o?.signal)) throw e;
              rest(link, e);
              skipped.push(link.name);
            }
          }
        } catch (e) {
          failed = e;
          throw e;
        } finally {
          finished = true;
        }
      }
      const it = events();
      return {
        [Symbol.asyncIterator]: () => it,
        async finalMessage() {
          if (!finished) for await (const _ of it) { void _; }
          if (failed) throw failed;
          return answered!.finalMessage();
        },
      };
    },
  };
}

/**
 * Staging check (GET /ask/providers): one tiny plain call to each provider in the chain, so "is Gemini answering?" has
 * a yes or a reason. Name, model, status and the provider's own short error only; never a key or a thread.
 */
export async function probeChain(): Promise<{ name: string; model: string; ok: boolean; ms: number; status: number | null; error: string | null; restingFor: number | null }[]> {
  const set = process.env.ASK_CHAT_PROVIDERS?.trim();
  const chain = providerChain() ?? [];
  const resting = cooldowns();
  // Nothing usable: say why, by name only (unset, or listed providers without keys).
  if (!chain.length) return [{ name: set ? `ASK_CHAT_PROVIDERS="${set.slice(0, 60)}" has no provider with a key` : `ASK_CHAT_PROVIDERS not set; one provider: ${process.env.ASK_CHAT_PROVIDER?.trim() || "none"}`, model: "", ok: false, ms: 0, status: null, error: null, restingFor: null }];
  return Promise.all(chain.map(async (l) => {
    const t0 = Date.now();
    try {
      const models = l.auto ? await flashModels(l) : [l.fastModel];
      const api = l.auto ? autoModelApi(await apiFor(linkConfig(l)), models) : await apiFor(linkConfig(l));
      await api.create({ model: l.fastModel, max_tokens: 8, messages: [{ role: "user", content: "Say ok." }] }, { timeout: 40_000, maxRetries: 0 });
      return { name: l.name, model: l.auto ? models.join(" > ") : l.fastModel, ok: true, ms: Date.now() - t0, status: 200, error: null, restingFor: resting[l.name] ?? null };
    } catch (e) {
      const detail = e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : "";
      const msg = `${e instanceof Error ? e.message : "error"}${detail ? ` · ${detail}` : ""}`.replace(/\s+/g, " ").slice(0, 400);
      return { name: l.name, model: l.auto ? (await flashModels(l)).join(" > ") : l.fastModel, ok: false, ms: Date.now() - t0, status: statusOf(e), error: msg, restingFor: resting[l.name] ?? null };
    }
  }));
}
