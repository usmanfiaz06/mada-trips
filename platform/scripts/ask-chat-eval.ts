/*
 * The Ask conversation's evals against live models (docs/app/ASK-CHAT.md §5), one provider or several side by side.
 * No database (tools answer from fixtures), and the same redaction as the app: no provider sees more than first names.
 *
 *   npm run ask:eval                         the provider in the environment (ASK_CHAT_PROVIDER, default anthropic)
 *   npm run ask:eval -- visa-uk ar-esim      some cases only
 *   npm run ask:eval -- --plan               the eight living-plan conversations (road trip, start from Jeddah, cars…)
 *   npm run ask:eval -- --provider anthropic,groq,zai,gemini [--model a,b] [--price 0.15,0.6,0.075]
 *     presets read GROQ_API_KEY, ZAI_API_KEY, GEMINI_API_KEY; without --model each runs its preset's models
 *     (groq: gpt-oss-120b, llama-3.3-70b, qwen3.8-27b; zai: glm-4.7-flash, glm-4.5-flash, glm-5.3-flash;
 *     gemini: the Flash models its GET /models lists, at most 4). A provider without a key is skipped.
 *   ASK_EVAL_PROFILES=profiles.json npm run ask:eval      compare several; the file (or inline JSON) is a list of
 *     { "label": "deepseek", "provider": "openai-compatible", "model": "deepseek-chat", "fastModel"?: "...",
 *       "baseUrl": "https://api.deepseek.com/v1", "apiKeyEnv": "DEEPSEEK_API_KEY", "price"?: [0.27, 1.10, 0.07] }
 *     (keys are read from the named environment variable, never from the file; anthropic uses ANTHROPIC_API_KEY)
 *
 * Prints every turn, then a table: pass rate and failures by check (prices, one question, language, tools, words, next step, open-ended, answer first),
 * Arabic dialect markers (spoken Saudi against MSA, with samples to read), median latency per turn, tokens and cost
 * per conversation. Exit code 1 when any profile fails a turn. Nothing the models say is stored.
 */
import { readFileSync, existsSync } from "node:fs";
import { apiFor, type ProviderConfig } from "../src/lib/app/ask-chat/providers";
import { PRESETS, askChatModel, askFastModel, bedrockModel, bedrockSettings, chatProvider, isPreset, parsePrice, type ChatProviderName, type Price } from "../src/lib/app/ask-chat/config";
import { listModels } from "../src/lib/app/ask-chat/providers-openai";
import { EVAL_CASES, PLAN_EVAL_IDS, runEvals, summarise, type EvalSummary } from "../src/lib/app/ask-chat/evals";

type Profile = { label: string; provider: ChatProviderName; model: string; fastModel?: string; baseUrl?: string; apiKeyEnv?: string; price?: Price | null; openapi?: boolean };

const args = process.argv.slice(2);
const flag = (name: string) => args.flatMap((a, i) => (a === `--${name}` ? [args[i + 1] ?? ""] : a.startsWith(`--${name}=`) ? [a.slice(name.length + 3)] : [])).join(",").split(",").map((x) => x.trim()).filter(Boolean);
const FREE: Price = [0, 0, 0, 0];

/** --provider / --model: each provider's models, from the flag, the preset, or (Gemini) its own list. */
async function fromFlags(providers: string[]): Promise<Profile[]> {
  const models = flag("model");
  const price = parsePrice(flag("price").join(","));
  const out: Profile[] = [];
  for (const p of providers) {
    if (p === "anthropic") {
      for (const m of models.length ? models : [askChatModel() || "claude-sonnet-5-5"]) out.push({ label: `anthropic/${m}`, provider: "anthropic", model: m, fastModel: m.startsWith("claude-") ? askFastModel() || "claude-haiku-5-5" : m, apiKeyEnv: "ANTHROPIC_API_KEY", price });
      continue;
    }
    if (p === "bedrock") {
      for (const m of (models.length ? models : ["claude-haiku-5-5"]).map(bedrockModel)) out.push({ label: `bedrock/${m}`, provider: "bedrock", model: m, fastModel: bedrockModel("claude-haiku-5-5"), apiKeyEnv: "AWS_BEARER_TOKEN_BEDROCK", price });
      continue;
    }
    if (p === "openai-compatible") {
      for (const m of models.length ? models : [process.env.ASK_CHAT_MODEL ?? ""]) out.push({ label: `openai-compatible/${m}`, provider: p, model: m, baseUrl: process.env.ASK_CHAT_BASE_URL, apiKeyEnv: "ASK_CHAT_API_KEY", price: price ?? parsePrice(process.env.ASK_CHAT_PRICE) });
      continue;
    }
    if (!isPreset(p)) { console.log(`${p}: no such provider (anthropic, bedrock, openai-compatible, ${Object.keys(PRESETS).join(", ")})`); continue; }
    const preset = PRESETS[p];
    const key = process.env[preset.keyEnv]?.trim();
    let list = models.length ? models : preset.models;
    if (!list.length && key) {
      // Gemini: whatever Flash models this key can use today, newest names first.
      list = (await listModels({ baseUrl: preset.baseUrl, apiKey: key }).catch((e) => { console.log(`${p}: couldn't list models (${e instanceof Error ? e.message : e})`); return [] as string[]; }))
        .filter((id) => /flash/i.test(id) && !/image|tts|audio|live|embed|vision|exp/i.test(id)).sort().reverse().slice(0, 4);
      console.log(`${p}: models from GET /models: ${list.join(", ") || "none"}`);
    }
    if (!list.length && !key) list = ["(listed at run time)"];
    for (const m of list) out.push({ label: `${p}/${m}`, provider: p, model: m, baseUrl: preset.baseUrl, apiKeyEnv: preset.keyEnv, openapi: preset.openapi, price: price ?? (preset.free?.includes(m) ? FREE : null) });
  }
  return out;
}

async function profiles(): Promise<Profile[]> {
  const raw = process.env.ASK_EVAL_PROFILES?.trim();
  if (raw) {
    const list = JSON.parse(existsSync(raw) ? readFileSync(raw, "utf8") : raw) as (Omit<Profile, "price"> & { price?: number[] })[];
    return list.map((p) => ({ ...p, price: p.price ? parsePrice(p.price.join(",")) : null }));
  }
  const wanted = flag("provider");
  if (wanted.length) return fromFlags(wanted);
  const provider = chatProvider();
  if (!provider) throw new Error("ASK_CHAT_PROVIDER names a provider without an adapter");
  if (isPreset(provider) || provider === "bedrock") return fromFlags([provider]);
  return [{ label: provider, provider, model: askChatModel(), fastModel: askFastModel(), baseUrl: process.env.ASK_CHAT_BASE_URL, apiKeyEnv: provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ASK_CHAT_API_KEY", price: parsePrice(process.env.ASK_CHAT_PRICE) }];
}

// --plan: the eight living-plan conversations (ASK-INTEGRATED.md §11 U3) on their own.
const only = [...args.filter((a, i) => !a.startsWith("-") && !/^--(provider|model|price)$/.test(args[i - 1] ?? "")), ...(args.includes("--plan") ? PLAN_EVAL_IDS : [])];
const runs: { p: Profile; s: EvalSummary }[] = [];
let anyFailed = false;
for (const p of await profiles()) {
  const bedrock = p.provider === "bedrock" ? bedrockSettings() : null;
  const key = bedrock ? bedrock.apiKey ?? bedrock.accessKeyId : process.env[p.apiKeyEnv ?? (p.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ASK_CHAT_API_KEY")]?.trim();
  if (!key || !p.model) { console.log(`${p.label}: skipped (no key in ${p.apiKeyEnv ?? "the environment"}, or no model)`); continue; }
  const cfg: ProviderConfig = { provider: p.provider, apiKey: key, baseUrl: p.baseUrl, openapi: p.openapi, bedrock };
  const api = await apiFor(cfg);
  console.log(`\n=== ${p.label} · ${p.provider} · chat ${p.model} · slots ${p.fastModel ?? p.model} · ${only.length ? only.join(", ") : `${EVAL_CASES.length} conversations`}\n`);
  const verdicts = await runEvals(api, {
    only, model: p.model, fastModel: p.fastModel ?? p.model, price: p.price,
    log: (v) => {
      console.log(`${v.problems.length ? "FAIL" : "ok  "} ${v.case}#${v.turn}  tools=${v.tools.join(",") || "-"}  ${v.ms} ms  $${(v.costMicros / 1e6).toFixed(4)}`);
      console.log(`     > ${v.user}\n     < ${v.reply}\n     [${v.next.join(" · ")}]${v.nextFrom === "app" ? " (filled in by the app)" : ""}`);
      for (const x of v.problems) console.log(`     ! ${x}`);
    },
  }).catch((e) => { console.log(`${p.label}: stopped: ${e instanceof Error ? e.message : String(e)}`); return []; });
  if (!verdicts.length) { anyFailed = true; continue; }
  const s = summarise(verdicts);
  if (s.passed < s.turns) anyFailed = true;
  runs.push({ p, s });
}

if (!runs.length) {
  console.log("ask:eval: nothing ran. Set ANTHROPIC_API_KEY (or ASK_EVAL_PROFILES with keys). The deterministic suite runs in vitest: test/app/ask-chat.test.ts.");
  process.exit(0);
}

const row = (cells: string[]) => `| ${cells.join(" | ")} |`;
console.log(`\n${row(["Profile", "Model", "Pass", "Prices", "≤1 question", "Language", "Tools", "Words", "Next step", "Open-ended", "Answer first", "Errors / rate limits", "Arabic: spoken / MSA markers", "Median latency", "Tokens / conv", "$ / conv"])}`);
console.log(row(Array(16).fill("---")));
for (const { p, s } of runs) {
  const f = (k: string) => String(s.byCheck[k] ?? 0);
  console.log(row([p.label, p.model, `${s.passed}/${s.turns} (${Math.round((100 * s.passed) / s.turns)}%)`, f("prices"), f("one"), f("lang"), String((s.byCheck.tools ?? 0) + (s.byCheck["asked again"] ?? 0)), f("words"), f("next"), f("open"), f("first"), `${f("error")} / ${f("rate")}`,
    `${s.dialect.spoken} / ${s.dialect.msa}`, `${(s.medianMs / 1000).toFixed(1)} s`, String(s.tokensPerConversation),
    p.provider !== "anthropic" && p.provider !== "bedrock" && !p.price ? "n/a (no price; --price)" : p.price === FREE ? "free tier" : `$${s.costPerConversation.toFixed(4)}`]));
}
console.log("\nArabic samples (read for dialect: spoken Riyadh per docs/app/ARABIC.md, not MSA):");
for (const { p, s } of runs) for (const a of s.arabicSamples) console.log(`  ${p.label}: ${a}`);
process.exit(anyFailed ? 1 : 0);
