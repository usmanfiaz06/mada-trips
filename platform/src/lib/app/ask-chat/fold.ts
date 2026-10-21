import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatApi } from "./providers";

/*
 * Long conversations stay cheap (docs/app/ASK-CHAT.md §7). Every turn replays the thread, and free tiers count tokens
 * per minute, so once a thread passes its budget (ASK_CHAT_HISTORY_TOKENS, default 6,000 estimated tokens) the turns
 * before the last KEEP_TURNS are folded into a few lines by the fast model, stored on the thread (summary), and read
 * in front of the turns kept word for word. In the kept turns, all but the last two lose their tool results' detail
 * (the gist stays), their thinking and their old context block. Folding happens at most once per budget crossing, so
 * between folds the replayed history never changes and the prompt cache holds. If the fast model doesn't answer in
 * time, a plain summary made from the gists takes its place: a fold never fails a turn.
 */

type Msg = Anthropic.Beta.BetaMessageParam;

export const KEEP_TURNS = 6;
/** Kept turns that stay exactly as they were (tool results and all). */
export const FULL_TURNS = 2;
export const SUMMARY_CHARS = 900;
export const GIST_CHARS = 200;

export const historyBudget = () => Number(process.env.ASK_CHAT_HISTORY_TOKENS) || 6000;

/** A cheap estimate: about 4 characters a token, the same rule the evals use. */
export const estimateTokens = (v: unknown) => Math.ceil(JSON.stringify(v ?? "").length / 4);

const isToolResults = (m: Msg) => Array.isArray(m.content) && m.content.length > 0 && m.content.every((b) => b.type === "tool_result");

/** The thread in turns: a turn starts with a message from the traveller (not a message of tool results). */
export function splitTurns(messages: Msg[]): Msg[][] {
  const turns: Msg[][] = [];
  for (const m of messages) {
    if (m.role === "user" && !isToolResults(m)) turns.push([m]);
    else if (turns.length) turns[turns.length - 1]!.push(m);
    else turns.push([m]);
  }
  return turns;
}

/** The first sentence or line of a text, at most `max` characters. */
export function gist(text: string, max = GIST_CHARS): string {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= max) return flat;
  return `${flat.slice(0, max - 1).trimEnd()}…`;
}

const CONTEXT = /^\[Context from Mada's systems/;
const EARLIER = /^\[Earlier in this conversation/;
const textOf = (c: Msg["content"]) => (typeof c === "string" ? c : c.map((b) => (b.type === "text" ? b.text : "")).filter(Boolean).join(" "));
const resultText = (b: { content?: unknown }) => (typeof b.content === "string" ? b.content : Array.isArray(b.content) ? b.content.map((x: { text?: string }) => x.text ?? "").join(" ") : "");

/** One older kept turn made lighter: tool results to their gist, no thinking, no old context block. Ids stay paired. */
export function lightenTurn(turn: Msg[]): Msg[] {
  return turn.map((m) => {
    if (typeof m.content === "string") return m;
    const content = m.content
      .filter((b) => b.type !== "thinking" && b.type !== "redacted_thinking")
      .filter((b) => !(m.role === "user" && b.type === "text" && (CONTEXT.test(b.text) || EARLIER.test(b.text))))
      .map((b) => (b.type === "tool_result" ? { ...b, content: gist(resultText(b)) } : b));
    return { ...m, content: content.length ? content : [{ type: "text" as const, text: "…" }] };
  });
}

/** Older turns as short lines for the summary: what the traveller said, what Mada said, what the tools found. */
export function gistLines(turns: Msg[][]): string[] {
  const lines: string[] = [];
  for (const turn of turns) {
    for (const m of turn) {
      if (typeof m.content !== "string" && m.content.some((b) => b.type === "tool_result")) {
        for (const b of m.content) if (b.type === "tool_result") lines.push(`Found: ${gist(resultText(b), 160)}`);
        continue;
      }
      const words = typeof m.content === "string" ? m.content : m.content.filter((b) => !(b.type === "text" && (CONTEXT.test(b.text) || EARLIER.test(b.text)))).map((b) => (b.type === "text" ? b.text : "")).join(" ");
      const said = gist(words.replace(/<next>[\s\S]*?<\/next>/g, ""), 220);
      if (said) lines.push(`${m.role === "user" ? "Traveller" : "Mada"}: ${said}`);
    }
  }
  return lines;
}

export type ThreadForFold = { messages: unknown[]; summary: string | null; turns: number };

/** Past the budget, with more turns than are kept. */
export function needsFold(t: ThreadForFold, budget = historyBudget()): boolean {
  const messages = t.messages as Msg[];
  return splitTurns(messages).length > KEEP_TURNS && estimateTokens(messages) + estimateTokens(t.summary) > budget;
}

export type Folded = { messages: Msg[]; summary: string; folded: number; usage: Anthropic.Beta.BetaUsage | null; by: "model" | "gists" };

/** Fold the older turns. The fast model writes the summary (4 s); the gists stand in when it doesn't. */
export async function foldThread(api: ChatApi | null, t: ThreadForFold, model: string): Promise<Folded> {
  const turns = splitTurns(t.messages as Msg[]);
  const old = turns.slice(0, -KEEP_TURNS);
  const keep = turns.slice(-KEEP_TURNS).map((turn, i, all) => (i < all.length - FULL_TURNS ? lightenTurn(turn) : turn));
  const lines = gistLines(old);
  const plain = gist([t.summary, ...lines].filter(Boolean).join(" · "), SUMMARY_CHARS);
  let summary = plain;
  let usage: Anthropic.Beta.BetaUsage | null = null;
  let by: Folded["by"] = "gists";
  if (api) {
    try {
      const res = await api.create({
        model,
        max_tokens: 400,
        output_config: { effort: "low" },
        system: [
          "You summarise the earlier part of a conversation between a traveller and Mada, a Saudi travel agency, so it can continue without it.",
          "Write at most 90 words, plain sentences, in the conversation's language. Keep: where, when and who; what they chose or turned down; option and request ids still in play; anything promised; the open question.",
          "Never add prices, times or facts that are not in the text. Never include passport, card or phone numbers.",
        ].join("\n"),
        messages: [{ role: "user", content: `${t.summary ? `Summary so far: ${t.summary}\n` : ""}Then:\n${lines.join("\n").slice(0, 6000)}` }],
      } as never, { timeout: 4_000, maxRetries: 0 });
      usage = res.usage;
      const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join(" ").trim();
      if (text && res.stop_reason !== "refusal") { summary = gist(text, SUMMARY_CHARS); by = "model"; }
    } catch (e) {
      console.warn("[ask-chat] fold: the fast model didn't answer; the gists stand in", e instanceof Error ? e.name : "");
    }
  }
  return { messages: keep.flat(), summary, folded: old.length, usage, by };
}

/** The history the model reads: the summary, when there is one, in front of the first kept message. */
export function historyOf(messages: unknown[], summary: string | null): Msg[] {
  const list = messages as Msg[];
  if (!summary || !list.length) return list;
  const [first, ...rest] = list;
  const note = { type: "text" as const, text: `[Earlier in this conversation, summarised by Mada's systems: ${summary}]` };
  const content = typeof first!.content === "string" ? [note, { type: "text" as const, text: first!.content }] : [note, ...first!.content];
  return [{ ...first!, content }, ...rest];
}
