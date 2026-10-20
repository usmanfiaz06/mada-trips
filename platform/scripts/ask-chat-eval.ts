/*
 * The Ask conversation's evals against live models (docs/app/ASK-CHAT.md §5), one provider or several side by side.
 * No database (tools answer from fixtures), and the same redaction as the app: no provider sees more than first names.
 *
 *   npm run ask:eval                         the provider in the environment (ASK_CHAT_PROVIDER, default anthropic)
 *   npm run ask:eval -- visa-uk ar-esim      some cases only
 *   ASK_EVAL_PROFILES=profiles.json npm run ask:eval      compare several; the file (or inline JSON) is a list of
 *     { "label": "deepseek", "provider": "openai-compatible", "model": "deepseek-chat", "fastModel"?: "...",
 *       "baseUrl": "https://api.deepseek.com/v1", "apiKeyEnv": "DEEPSEEK_API_KEY", "price"?: [0.27, 1.10, 0.07] }
 *     (keys are read from the named environment variable, never from the file; anthropic uses ANTHROPIC_API_KEY)
 *
 * Prints every turn, then a table: pass rate and failures by check (prices, one question, language, tools, words),
 * Arabic dialect markers (spoken Saudi against MSA, with samples to read), median latency per turn, tokens and cost
 * per conversation. Exit code 1 when any profile fails a turn. Nothing the models say is stored.
 */
import { readFileSync, existsSync } from "node:fs";
import { apiFor, type ProviderConfig } from "../src/lib/app/ask-chat/providers";
import { askChatModel, askFastModel, chatProvider, parsePrice, type ChatProviderName, type Price } from "../src/lib/app/ask-chat/config";
import { EVAL_CASES, runEvals, summarise, type EvalSummary } from "../src/lib/app/ask-chat/evals";

type Profile = { label: string; provider: ChatProviderName; model: string; fastModel?: string; baseUrl?: string; apiKeyEnv?: string; price?: Price | null };

function profiles(): Profile[] {
  const raw = process.env.ASK_EVAL_PROFILES?.trim();
  if (raw) {
    const list = JSON.parse(existsSync(raw) ? readFileSync(raw, "utf8") : raw) as (Omit<Profile, "price"> & { price?: number[] })[];
    return list.map((p) => ({ ...p, price: p.price ? parsePrice(p.price.join(",")) : null }));
  }
  const provider = chatProvider();
  if (!provider) throw new Error("ASK_CHAT_PROVIDER names a provider without an adapter");
  return [{ label: provider, provider, model: askChatModel(), fastModel: askFastModel(), baseUrl: process.env.ASK_CHAT_BASE_URL, apiKeyEnv: provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ASK_CHAT_API_KEY", price: parsePrice(process.env.ASK_CHAT_PRICE) }];
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
const runs: { p: Profile; s: EvalSummary }[] = [];
let anyFailed = false;
for (const p of profiles()) {
  const key = process.env[p.apiKeyEnv ?? (p.provider === "anthropic" ? "ANTHROPIC_API_KEY" : "ASK_CHAT_API_KEY")]?.trim();
  if (!key || !p.model) { console.log(`${p.label}: skipped (no key in ${p.apiKeyEnv ?? "the environment"}, or no model)`); continue; }
  const cfg: ProviderConfig = { provider: p.provider, apiKey: key, baseUrl: p.baseUrl };
  const api = await apiFor(cfg);
  console.log(`\n=== ${p.label} · ${p.provider} · chat ${p.model} · slots ${p.fastModel ?? p.model} · ${only.length ? only.join(", ") : `${EVAL_CASES.length} conversations`}\n`);
  const verdicts = await runEvals(api, {
    only, model: p.model, fastModel: p.fastModel ?? p.model, price: p.price,
    log: (v) => {
      console.log(`${v.problems.length ? "FAIL" : "ok  "} ${v.case}#${v.turn}  tools=${v.tools.join(",") || "-"}  ${v.ms} ms  $${(v.costMicros / 1e6).toFixed(4)}`);
      console.log(`     > ${v.user}\n     < ${v.reply}`);
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
console.log(`\n${row(["Profile", "Model", "Pass", "Prices", "≤1 question", "Language", "Tools", "Words", "Arabic: spoken / MSA markers", "Median latency", "Tokens / conv", "$ / conv"])}`);
console.log(row(Array(12).fill("---")));
for (const { p, s } of runs) {
  const f = (k: string) => String(s.byCheck[k] ?? 0);
  console.log(row([p.label, p.model, `${s.passed}/${s.turns} (${Math.round((100 * s.passed) / s.turns)}%)`, f("prices"), f("one"), f("lang"), String((s.byCheck.tools ?? 0) + (s.byCheck["asked again"] ?? 0)), f("words"),
    `${s.dialect.spoken} / ${s.dialect.msa}`, `${(s.medianMs / 1000).toFixed(1)} s`, String(s.tokensPerConversation), `$${s.costPerConversation.toFixed(4)}`]));
}
console.log("\nArabic samples (read for dialect: spoken Riyadh per docs/app/ARABIC.md, not MSA):");
for (const { p, s } of runs) for (const a of s.arabicSamples) console.log(`  ${p.label}: ${a}`);
process.exit(anyFailed ? 1 : 0);
