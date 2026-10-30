import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { askChatModel, askFastModel, bedrockSettings, chatProvider, openAiSettings, providerChain, type BedrockSettings, type ChainLink, type ChatProviderName } from "./config";

/*
 * Who the conversation talks to, behind one small interface: a streamed message with tool calls, and a plain one (for
 * the slots). The engine speaks the Messages API's shapes; each provider takes those in and gives those back, so the
 * engine, the guards, the tools, the threads and the evals are the same whoever answers. Redaction happens before any
 * of this (chat.ts), so no provider ever sees a passport, a card or a surname.
 *   anthropic          the Claude API through the official SDK (default; the production path)
 *   bedrock            the same Claude through Amazon Bedrock, billed to the AWS account (providers-bedrock.ts: the
 *                      SDK's Mantle client, "anthropic."-prefixed model IDs, no server-side refusal fallbacks)
 *   openai-compatible  any /chat/completions endpoint with streaming and function tools: DeepSeek, Qwen, Kimi, GLM,
 *                      vLLM or another self-hosted model (providers-openai.ts). For comparing in the evals first.
 *   groq, zai, gemini  openai-compatible with the base URL and key variable filled in (config.ts PRESETS).
 *   ASK_CHAT_PROVIDERS a chain of the above (chainApi below): the same call moves to the next provider when one is
 *                      rate limited, down or out of quota. Every provider reads and writes the same Messages-shaped
 *                      thread, so a switch mid-conversation (even mid-turn, after a tool ran) needs nothing else.
 */

export type StreamParams = Anthropic.Beta.MessageCreateParamsNonStreaming;
export type ReqOpts = { signal?: AbortSignal; timeout?: number; maxRetries?: number };
export type ChatStream = AsyncIterable<Anthropic.Beta.BetaRawMessageStreamEvent> & { finalMessage(): Promise<Anthropic.Beta.BetaMessage> };

/** The two calls the conversation makes. */
export interface ChatApi {
  stream(params: StreamParams, opts?: ReqOpts): ChatStream;
  create(params: StreamParams, opts?: ReqOpts): Promise<Anthropic.Beta.BetaMessage>;
}

export type ProviderConfig = { provider: ChatProviderName; apiKey?: string; baseUrl?: string; openapi?: boolean; bedrock?: BedrockSettings | null };

/**
 * The engine's hints for providers that pay per token (`only_tools`, `lean`: the compact prompt, tool words and
 * history) are not API fields: Claude gets the full prompt, every tool and the whole thread, cached.
 */
export const forClaude = (p: StreamParams): StreamParams => {
  const { only_tools: _drop, lean: _lean, ...rest } = p as StreamParams & { only_tools?: unknown; lean?: unknown };
  void _drop; void _lean;
  // A thread Gemini answered earlier carries its tool-call signatures (extra_content), which Claude doesn't take.
  const messages = rest.messages.map((m) => (typeof m.content === "string" || !m.content.some((b) => "extra_content" in b) ? m
    : { ...m, content: m.content.map((b) => { if (!("extra_content" in b)) return b; const { extra_content: _x, ...keep } = b as typeof b & { extra_content?: unknown }; void _x; return keep as typeof b; }) }));
  // No strict tools for Claude: its grammar compiler refuses Ask's set (more than 20 strict tools, too many nullable
  // parameters, then "schema too complex", after half a minute). Claude keeps to the schemas without it, and every
  // tool's handler checks its arguments.
  const tools = (rest as { tools?: Array<Record<string, unknown>> }).tools;
  const capped = tools?.map((t) => { if (!("strict" in t)) return t; const { strict: _s, ...k } = t; void _s; return k; });
  return { ...rest, messages, ...(capped ? { tools: capped } : {}) } as StreamParams;
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
  if (cfg.provider === "bedrock") {
    if (!cfg.bedrock) throw new Error("bedrock needs AWS_REGION and AWS_BEARER_TOKEN_BEDROCK (or an IAM access key)");
    const { bedrockApi } = await import("./providers-bedrock");
    return bedrockApi(cfg.bedrock);
  }
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
    const key = `chain|${chain.map((l) => `${l.name}:${l.model}:${l.fastModel}:${l.bedrock?.region ?? ""}:${l.apiKey.slice(-6)}`).join(",")}`;
    if (real?.key !== key) real = { key, api: chainApi(await Promise.all(chain.map(async (l) => {
      const api = await apiFor(linkConfig(l));
      return { name: l.name, model: l.model, fastModel: l.fastModel, api: l.auto ? autoModelApi(api, await flashModels(l), { warm: true }) : api };
    }))) };
    return real.api;
  }
  const provider = chatProvider();
  if (!provider) throw new Error("ASK_CHAT_PROVIDER names a provider without an adapter");
  const b = provider === "bedrock" ? bedrockSettings() : null;
  const cfg: ProviderConfig = provider === "anthropic" ? { provider, apiKey: process.env.ANTHROPIC_API_KEY }
    : provider === "bedrock" ? { provider, bedrock: b, apiKey: b?.apiKey ?? b?.accessKeyId }
    : { provider, ...openAiSettings(provider) };
  const key = `${cfg.provider}|${cfg.baseUrl ?? ""}|${cfg.bedrock?.region ?? ""}|${cfg.apiKey?.slice(-6) ?? ""}`;
  if (real?.key !== key) real = { key, api: await apiFor(cfg) };
  return real.api;
}

const linkConfig = (l: ChainLink): ProviderConfig =>
  l.name === "anthropic" ? { provider: "anthropic", apiKey: l.apiKey }
    : l.name === "bedrock" ? { provider: "bedrock", apiKey: l.apiKey, bedrock: l.bedrock }
    : { provider: l.name, apiKey: l.apiKey, baseUrl: l.baseUrl, openapi: l.openapi };

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
export function autoModelApi(api: ChatApi, models: string[], opts: { warm?: boolean } = {}): ChatApi {
  let i = 0;
  // Some listed models never answer on a free key (they hang): the first time it is used, one tiny call to each of the
  // top few at once, and the first to answer is the one used, so a traveller never waits on a hanging model.
  let ready: Promise<void> | null = null;
  const warmUp = () => (ready ??= opts.warm && models.length > 1 ? new Promise<void>((resolve) => {
    // The best-ranked model that answers wins; after the first answer, better-ranked ones get 2 s more to answer.
    const top = models.slice(0, 3); // free tiers count requests per minute; three is enough to step past a hanging one
    const answered = new Set<number>();
    let left = top.length;
    let grace: ReturnType<typeof setTimeout> | null = null;
    const finish = () => {
      if (grace) clearTimeout(grace);
      const k = Math.min(...answered);
      if (Number.isFinite(k)) { if (k !== i) console.info(`[ask-chat] model=${models[k]} answers; using it`); i = k; }
      resolve();
    };
    top.forEach((m, k) => {
      api.create({ model: m, max_tokens: 64, messages: [{ role: "user", content: "Say ok." }] }, { timeout: 9_000, maxRetries: 0 })
        .then(() => {
          answered.add(k);
          if (k === 0 || [...Array(k).keys()].every((j) => !pending.has(j))) return finish();
          grace ??= setTimeout(finish, 2_000);
        }, () => {})
        .finally(() => { pending.delete(k); if (--left === 0) finish(); });
    });
    const pending = new Set(top.keys());
  }) : Promise.resolve());
  const pick = () => models[Math.min(i, models.length - 1)];
  const skip = (e: unknown) => {
    if (!wrongModel(e) || i >= models.length - 1) return false;
    console.info(`[ask-chat] model=${pick()} not usable with this key (${statusOf(e)}), trying ${models[i + 1]}`);
    i++;
    return true;
  };
  return {
    async create(p, o) {
      await warmUp();
      for (;;) {
        try { return await api.create({ ...p, model: pick() }, o); } catch (e) { if (!skip(e)) throw e; }
      }
    },
    stream(p, o) {
      let current: ChatStream | null = null;
      let failed: unknown = null;
      async function* events(): AsyncGenerator<Anthropic.Beta.BetaRawMessageStreamEvent> {
        await warmUp();
        current = api.stream({ ...p, model: pick() }, o);
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
          return current!.finalMessage();
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
/** Why each provider is resting (status and the start of its own error), for the staging debug line only. */
const whyResting = new Map<string, string>();
export const COOL_MS = 60_000;
/** The longest a turn waits for a provider that is back within seconds, instead of failing. */
const SHORT_WAIT_MS = 6_000;
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
  if (st !== null) return st === 429 || st === 408 || st === 413 || st >= 500 || (e as { quota?: boolean }).quota === true || refusesRequest(e);
  if (e instanceof Error && (e.name === "TimeoutError" || e.name === "AbortError" || (e.name === "TypeError" && /fetch|network/i.test(e.message)))) return true;
  return false;
}

/**
 * A provider that can't take this request at all (its model gone, or a tool schema or field it doesn't support): the
 * next one can, so the call moves on and this one rests longer. A 400 about the traveller's own words isn't one.
 */
export function refusesRequest(e: unknown): boolean {
  const st = statusOf(e);
  if (st === 404) return true;
  if (st !== 400) return false;
  const msg = `${e instanceof Error ? e.message : ""} ${e && typeof e === "object" && "detail" in e ? String((e as { detail?: unknown }).detail ?? "") : ""}`;
  return /invalid schema|schemas? (?:is|contains) too|too complex|too many|tools?\.\d+|not supported|unsupported|does not support|extra inputs|unknown (?:field|parameter)|model/i.test(msg);
}

/** A timeout on a call given under 15 s: the caller's short budget, not the provider being down. */
export function ranOutOfOwnTime(e: unknown, timeout: number | undefined): boolean {
  if (!timeout || timeout >= 15_000) return false;
  return e instanceof Anthropic.APIConnectionTimeoutError || (e instanceof Error && (e.name === "TimeoutError" || /timed out|timeout/i.test(e.message)));
}

/** How long to rest a provider after this error: its own Retry-After when it gave one, else a minute. */
const restMs = (e: unknown): number => {
  const ra = e && typeof e === "object" && "retryAfter" in e ? Number((e as { retryAfter: unknown }).retryAfter) : NaN;
  const hdr = e instanceof Anthropic.APIError ? Number(e.headers?.get?.("retry-after")) : NaN;
  const s = Number.isFinite(ra) && ra > 0 ? ra : Number.isFinite(hdr) && hdr > 0 ? hdr : 0;
  return s ? Math.min(s * 1000, 15 * 60_000) : refusesRequest(e) ? 10 * 60_000 : COOL_MS;
};

/** Every provider is resting: the app answers with its own flows (chat.ts errorCode → RATE_LIMITED). */
async function allResting(now: number): Promise<never> {
  const { ProviderHttpError } = await import("./providers-openai");
  const next = Math.min(...[...cooling.values()].filter((u) => u > now));
  const err = new ProviderHttpError(429, "every provider in ASK_CHAT_PROVIDERS is cooling down", Number.isFinite(next) ? Math.ceil((next - now) / 1000) : COOL_MS / 1000);
  throw Object.assign(err, { detail: [...whyResting].map(([k, v]) => `${k}: ${v}`).join(" | ") });
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
  // Everyone resting but someone is back within seconds (Groq's per-minute cap often asks for under one): wait once.
  const backSoon = async (signal?: AbortSignal): Promise<boolean> => {
    const until = Math.min(...members.map((m) => cooling.get(m.name) ?? 0));
    const wait = until - now();
    if (!Number.isFinite(wait) || wait > SHORT_WAIT_MS || signal?.aborted) return false;
    await new Promise((r) => setTimeout(r, Math.max(0, wait) + 50));
    return true;
  };
  const rest = (m: ChainMember, e: unknown) => {
    cooling.set(m.name, now() + restMs(e));
    const detail = e && typeof e === "object" && "detail" in e ? String((e as { detail?: unknown }).detail ?? "") : "";
    whyResting.set(m.name, `${statusOf(e) ?? (e instanceof Error ? e.name : "error")} ${(/"message"\s*:\s*"([^"]{0,220})/.exec(detail)?.[1] ?? (detail || (e instanceof Error ? e.message : ""))).slice(0, 220)}`.trim());
    log(`[ask-chat] provider=${m.name} resting ${Math.round(restMs(e) / 1000)}s (${statusOf(e) ?? (e instanceof Error ? e.name : "error")})`);
  };
  return {
    async create(p, o) {
      const tried = new Set<string>();
      let skipped: string[] = [];
      let waited = false;
      for (;;) {
        const m = order(tried)[0];
        if (!m) {
          if (!waited && (await backSoon(o?.signal))) { waited = true; tried.clear(); continue; }
          return allResting(now());
        }
        tried.add(m.name);
        try {
          const res = await m.api.create({ ...p, model: m.fastModel }, o);
          log(`[ask-chat] provider=${m.name} model=${m.fastModel} call=create${skipped.length ? ` after=${skipped.join(",")}` : ""}`);
          return res;
        } catch (e) {
          if (!worthAnother(e, o?.signal)) throw e;
          // A quick helper call (reading the sentence, a few seconds' budget) that ran out of time says nothing about
          // the provider: the next one takes this call, but the turn's answer still goes to the first.
          if (!ranOutOfOwnTime(e, o?.timeout)) rest(m, e);
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
        let waited = false;
        try {
          for (;;) {
            const m = order(tried)[0];
            if (!m) {
              if (!waited && (await backSoon(o?.signal))) { waited = true; tried.clear(); continue; }
              await allResting(now());
            }
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

/** One provider (ASK_CHAT_PROVIDER) as a chain link, so the staging check probes it too: bedrock or anthropic with a key. */
function singleLink(): ChainLink[] {
  const p = chatProvider();
  const b = p === "bedrock" ? bedrockSettings() : null;
  if (b) return [{ name: "bedrock", apiKey: b.apiKey ?? b.accessKeyId ?? "", bedrock: b, model: askChatModel(), fastModel: askFastModel() }];
  const key = process.env.ANTHROPIC_API_KEY?.trim();
  if (p === "anthropic" && key) return [{ name: "anthropic", apiKey: key, model: askChatModel(), fastModel: askFastModel() }];
  return [];
}

/**
 * Staging check (GET /ask/providers): one tiny plain call to each provider in the chain (or the one provider), so "is Gemini answering?" has
 * a yes or a reason. Name, model, status and the provider's own short error only; never a key or a thread.
 */
export async function probeChain(): Promise<{ name: string; model: string; ok: boolean; ms: number; status: number | null; error: string | null; restingFor: number | null; why?: string | null }[]> {
  const set = process.env.ASK_CHAT_PROVIDERS?.trim();
  const chain = providerChain() ?? singleLink();
  const resting = cooldowns();
  // Nothing usable: say why, by name only (unset, or listed providers without keys).
  if (!chain.length) return [{ name: set ? `ASK_CHAT_PROVIDERS="${set.slice(0, 60)}" has no provider with a key` : `ASK_CHAT_PROVIDERS not set; one provider: ${process.env.ASK_CHAT_PROVIDER?.trim() || "none"}`, model: "", ok: false, ms: 0, status: null, error: null, restingFor: null }];
  const one = async (l: ChainLink, model: string, timeout: number) => {
    const t0 = Date.now();
    try {
      const api = await apiFor(linkConfig(l));
      await api.create({ model, max_tokens: 64, messages: [{ role: "user", content: "Say ok." }] }, { timeout, maxRetries: 0 });
      return { name: l.name, model, ok: true, ms: Date.now() - t0, status: 200, error: null, restingFor: resting[l.name] ?? null, why: resting[l.name] ? whyResting.get(l.name) ?? null : null };
    } catch (e) {
      const detail = e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : "";
      const msg = `${e instanceof Error ? e.message : "error"}${detail ? ` · ${detail}` : ""}`.replace(/\s+/g, " ").slice(0, 400);
      return { name: l.name, model, ok: false, ms: Date.now() - t0, status: statusOf(e), error: msg, restingFor: resting[l.name] ?? null, why: resting[l.name] ? whyResting.get(l.name) ?? null : null };
    }
  };
  // A provider that finds its own model: each candidate in turn, a few seconds each, so the answer names the one that works.
  const rows = await Promise.all(chain.map(async (l) => {
    if (!l.auto) return [await one(l, l.fastModel, 20_000)];
    const out = [];
    for (const m of (await flashModels(l)).slice(0, 5)) {
      const r = await one(l, m, 9_000);
      out.push(r);
      if (r.ok) break;
    }
    return out;
  }));
  return rows.flat();
}

/**
 * Staging check, deep (GET /ask/providers?deep=1): one real hotel turn through each provider in the chain with the
 * real system prompt and tools, reporting how it ended, which blocks came back and the start of any text.
 */
export async function probeTurn(): Promise<{ name: string; model: string; ok: boolean; ms: number; stop: string | null; blocks: string[]; text: string; error: string | null }[]> {
  const { SYSTEM_PROMPT, activeTools } = await import("./prompt");
  const TOOLS = activeTools();
  const chain = providerChain() ?? [];
  return Promise.all(chain.map(async (l) => {
    const t0 = Date.now();
    const models = l.auto ? await flashModels(l) : [l.model];
    const api = l.auto ? autoModelApi(await apiFor(linkConfig(l)), models, { warm: true }) : await apiFor(linkConfig(l));
    try {
      const first: Anthropic.Beta.BetaMessageParam = { role: "user", content: "Hotel in Baku 2 nights from 20 November 2026, 2 adults" };
      const s = api.stream({ model: l.model, max_tokens: 4096, system: SYSTEM_PROMPT, tools: TOOLS, messages: [first] }, { timeout: 40_000, maxRetries: 0 });
      for await (const _ of s) { void _; }
      let m = await s.finalMessage();
      // The second step, as a turn makes it: each tool call answered, then the model again.
      const uses = m.content.filter((b) => b.type === "tool_use") as Anthropic.Beta.BetaToolUseBlock[];
      if (uses.length) {
        const s2 = api.stream({ model: l.model, max_tokens: 4096, system: SYSTEM_PROMPT, tools: TOOLS, messages: [first, { role: "assistant", content: m.content as Anthropic.Beta.BetaContentBlockParam[] }, { role: "user", content: uses.map((u) => ({ type: "tool_result" as const, tool_use_id: u.id, content: "Household: Test (self, 34). No other travellers." })) }] }, { timeout: 40_000, maxRetries: 0 });
        for await (const _ of s2) { void _; }
        m = await s2.finalMessage();
      }
      const text = m.content.filter((b) => b.type === "text").map((b) => (b as { text: string }).text).join(" ");
      return { name: l.name, model: m.model ?? l.model, ok: true, ms: Date.now() - t0, stop: m.stop_reason ?? null, blocks: m.content.map((b) => b.type === "tool_use" ? `tool_use:${(b as { name: string }).name}` : b.type), text: text.slice(0, 300), error: null };
    } catch (e) {
      const detail = e && typeof e === "object" && "detail" in e ? String((e as { detail: unknown }).detail) : "";
      return { name: l.name, model: l.model, ok: false, ms: Date.now() - t0, stop: null, blocks: [], text: "", error: `${e instanceof Error ? e.message : "error"}${detail ? ` · ${detail}` : ""}`.slice(0, 400) };
    }
  }));
}
