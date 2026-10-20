/*
 * The Ask conversation's evals against the live model (docs/app/ASK-CHAT.md §Evals). Needs ANTHROPIC_API_KEY; no
 * database (tools answer from fixtures). Costs about $0.10 for the whole set on claude-sonnet-5-5.
 *   npm --prefix platform run ask:eval                 every case
 *   npm --prefix platform run ask:eval -- visa-uk ar-esim   some
 * Exit code 1 when any turn fails a check. A report goes to stdout; nothing the model says is stored.
 */
import { chatApi } from "../src/lib/app/ask-chat/engine";
import { askChatModel, askFastModel } from "../src/lib/app/ask-chat/config";
import { EVAL_CASES, runEvals } from "../src/lib/app/ask-chat/evals";

if (!process.env.ANTHROPIC_API_KEY?.trim()) {
  console.log("ask:eval skipped: ANTHROPIC_API_KEY is not set (the deterministic suite runs in vitest: test/app/ask-chat.test.ts).");
  process.exit(0);
}

const only = process.argv.slice(2).filter((a) => !a.startsWith("-"));
console.log(`Ask conversation evals · chat ${askChatModel()} · slots ${askFastModel()} · ${only.length ? only.join(", ") : `${EVAL_CASES.length} conversations`}\n`);
const verdicts = await runEvals(chatApi(), {
  only,
  log: (v) => {
    console.log(`${v.problems.length ? "FAIL" : "ok  "} ${v.case}#${v.turn}  tools=${v.tools.join(",") || "-"}  $${(v.costMicros / 1e6).toFixed(4)}`);
    console.log(`     > ${v.user}\n     < ${v.reply}`);
    for (const p of v.problems) console.log(`     ! ${p}`);
  },
});
const failed = verdicts.filter((v) => v.problems.length);
const cost = verdicts.reduce((s, v) => s + v.costMicros, 0) / 1e6;
const tokens = verdicts.reduce((s, v) => ({ i: s.i + v.inTokens, o: s.o + v.outTokens, r: s.r + v.cacheRead }), { i: 0, o: 0, r: 0 });
const byCheck = new Map<string, number>();
for (const v of failed) for (const p of v.problems) byCheck.set(p.split(":")[0]!, (byCheck.get(p.split(":")[0]!) ?? 0) + 1);
console.log(`\n${verdicts.length - failed.length}/${verdicts.length} turns pass · ${[...byCheck].map(([k, n]) => `${k} ${n}`).join(" · ") || "no failures"}`);
console.log(`tokens: ${tokens.i} in (uncached), ${tokens.r} cache read, ${tokens.o} out · $${cost.toFixed(4)} total, $${(cost / Math.max(1, verdicts.length)).toFixed(4)} a turn`);
process.exit(failed.length ? 1 : 0);
