import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatApi, StreamParams } from "./providers";
import { t, type AskChatEvent, type AskIntent, type ChatCard, type Person } from "@mada/shared";
import { askChatModel, costMicros, noUsage, type Usage } from "./config";
import { outgoingProblems, tidy, unbacked } from "./guard";
import { SYSTEM_PROMPT, TOOLS } from "./prompt";
import { runTool, statusFor, type ToolCtx } from "./tools";

/*
 * One turn of the conversation: the traveller's message (already redacted and screened) in, events out as they
 * happen, the new model messages back for the thread. A manual streaming tool loop on the Messages API:
 *   - claude-sonnet-5-5 at effort low, adaptive thinking (it skips thinking on most simple turns at low)
 *   - the frozen system prompt + tools cached (one breakpoint on the system block), and the conversation itself
 *     cached as it grows (top-level automatic cache_control)
 *   - strict tool schemas, run here as the traveller; tool inputs are small, so eager input streaming stays off and
 *     strict validation stays on
 *   - refusals end the turn with a fixed line; max_tokens with a tool call never runs the tool
 *   - refusal fallbacks on (server-side-fallback-2026-07-01, fallbacks: "default")
 * Words stream as they come, sentence by sentence where a number is involved: a sentence with a digit is held until
 * it ends and is shown only if every price and time in it came from a tool this turn (guard.ts unbacked).
 */

export const MAX_STEPS = 6;

// Who answers is behind one interface (providers.ts): Claude by default, another provider for comparing.
export { chatApi, setChatApi, type ChatApi } from "./providers";

/** Holds sentences with digits until they end, so an unbacked price never reaches the screen. */
export class SentenceGate {
  private buf = "";
  private shownUpTo = 0;
  /** Every sentence, and whether it was kept. */
  readonly kept: string[] = [];
  dropped = 0;
  /** Words of a dropped sentence were already on screen: the turn ends with a `replace`. */
  dirty = false;
  constructor(private readonly toolText: () => string, private readonly out: (s: string) => void) {}

  push(delta: string) {
    this.buf += tidy(delta);
    for (;;) {
      const m = /[.?؟](?=\s)|\n/.exec(this.buf);
      const end = m ? m.index + 1 : -1;
      if (end < 0) break;
      this.close(this.buf.slice(0, end));
      this.buf = this.buf.slice(end);
      this.shownUpTo = 0;
    }
    // No digit in the open sentence yet: show it as it comes.
    if (!/\d/.test(this.buf) && this.buf.length > this.shownUpTo) {
      this.out(this.buf.slice(this.shownUpTo));
      this.shownUpTo = this.buf.length;
    }
  }

  /** The end of a step: whatever is open is a sentence too. */
  flush() {
    if (this.buf.trim()) this.close(this.buf);
    else if (this.buf.length > this.shownUpTo) this.out(this.buf.slice(this.shownUpTo));
    this.buf = "";
    this.shownUpTo = 0;
  }

  private close(sentence: string) {
    const ok = !unbacked(sentence, this.toolText()).length && !outgoingProblems(sentence).length;
    if (ok) {
      this.kept.push(sentence);
      if (sentence.length > this.shownUpTo) this.out(sentence.slice(this.shownUpTo));
    } else {
      this.dropped += 1;
      // Words of it already shown (before its first digit) are taken back by a `replace` at the end of the turn.
      if (this.shownUpTo > 0) this.dirty = true;
    }
  }

  text() { return this.kept.join("").replace(/\s+/g, " ").trim(); }
}

export type TurnInput = {
  history: Anthropic.Beta.BetaMessageParam[];
  text: string;
  context: string;
  lang: "en" | "ar";
  tool: ToolCtx;
  signal?: AbortSignal;
  /** The evals put fixtures here; the app always runs the real tools. */
  runTool?: typeof runTool;
  /** The evals compare models; the app uses ASK_CHAT_MODEL. */
  model?: string;
};

export type TurnResult = {
  added: Anthropic.Beta.BetaMessageParam[];
  text: string;
  cards: ChatCard[];
  usage: Usage;
  costMicros: number;
  toolsUsed: string[];
  /** What the model wrote, before any check (for the evals and the log's counts; never stored or logged). */
  raw: string;
  /** Sentences held back: an unbacked price or time, or a banned word. */
  dropped: number;
  /** The tool results the model read this turn. */
  toolText: string;
  stop: "end_turn" | "refusal" | "max_tokens" | "steps" | "error";
};

const addUsage = (u: Usage, x: Anthropic.Beta.BetaUsage) => {
  u.input += x.input_tokens ?? 0;
  u.output += x.output_tokens ?? 0;
  u.cacheRead += x.cache_read_input_tokens ?? 0;
  u.cacheWrite += x.cache_creation_input_tokens ?? 0;
};

/** Run one turn. API errors are thrown (typed SDK errors); the route turns them into an `error` event and the app falls back. */
export async function runTurn(input: TurnInput, emit: (e: AskChatEvent) => void, api: ChatApi): Promise<TurnResult> {
  const model = input.model ?? askChatModel();
  const user: Anthropic.Beta.BetaMessageParam = {
    role: "user",
    // Context first, then the traveller's words, each its own block: Mada's systems speak in one, the traveller in the other.
    content: [{ type: "text", text: input.context }, { type: "text", text: input.text }],
  };
  const added: Anthropic.Beta.BetaMessageParam[] = [user];
  const usage = noUsage();
  let cost = 0;
  let toolText = "";
  const cards: ChatCard[] = [];
  const toolsUsed: string[] = [];
  let sep = false;
  let raw = "";
  const exec = input.runTool ?? runTool;
  const gate = new SentenceGate(() => toolText, (s) => { emit({ type: "text", delta: s }); sep = true; });
  let stop: TurnResult["stop"] = "steps";

  for (let step = 0; step < MAX_STEPS; step++) {
    const params = {
      model,
      max_tokens: 4096,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      thinking: { type: "adaptive" },
      output_config: { effort: "low" },
      cache_control: { type: "ephemeral" },
      system: [{ type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } }],
      tools: TOOLS,
      tool_choice: { type: "auto" },
      messages: [...input.history, ...added],
    } as unknown as StreamParams;
    const stream = api.stream(params, { signal: input.signal });
    if (sep) { gate.push(" "); raw += " "; }
    for await (const ev of stream) {
      if (ev.type === "content_block_delta" && ev.delta.type === "text_delta") { raw += ev.delta.text; gate.push(ev.delta.text); }
      // A tool call starts: what was said before it is a whole sentence (its status line follows with its input).
      else if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") gate.flush();
    }
    const msg = await stream.finalMessage();
    gate.flush();
    addUsage(usage, msg.usage);
    cost += costMicros(msg.model || model, { input: msg.usage.input_tokens ?? 0, output: msg.usage.output_tokens ?? 0, cacheRead: msg.usage.cache_read_input_tokens ?? 0, cacheWrite: msg.usage.cache_creation_input_tokens ?? 0 });
    // Kept exactly as returned (thinking blocks too), so the next request replays it unchanged.
    added.push({ role: "assistant", content: msg.content as Anthropic.Beta.BetaContentBlockParam[] });

    if (msg.stop_reason === "refusal") { stop = "refusal"; break; }
    const calls = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!calls.length) { stop = msg.stop_reason === "max_tokens" ? "max_tokens" : "end_turn"; break; }
    // A tool input cut off at max_tokens can still look whole: never run it. The turn ends with what was said.
    if (msg.stop_reason === "max_tokens") {
      added.push({ role: "user", content: calls.map((c) => ({ type: "tool_result" as const, tool_use_id: c.id, is_error: true, content: "Not run: the request was cut off." })) });
      stop = "max_tokens";
      break;
    }

    // Independent calls run together; all results go back in one message.
    const results = await Promise.all(calls.map(async (c) => {
      const inp = (c.input ?? {}) as Record<string, unknown>;
      emit({ type: "status", text: statusFor(c.name, inp, input.lang) });
      toolsUsed.push(c.name);
      const out = await exec(c.name, inp, input.tool);
      return { c, out };
    }));
    for (const { c, out } of results) {
      toolText += `\n${out.text}`;
      if (out.cards?.length) { cards.push(...out.cards); emit({ type: "cards", cards: out.cards }); }
      if (out.pay) emit({ type: "pay", pay: out.pay });
      if (out.handoff) emit({ type: "handoff", threadId: out.handoff.threadId, agent: out.handoff.agent });
      void c;
    }
    added.push({ role: "user", content: results.map(({ c, out }) => ({ type: "tool_result" as const, tool_use_id: c.id, content: out.text, ...(out.isError ? { is_error: true } : {}) })) });
  }

  let text = gate.text();
  if (stop === "refusal") {
    text = t("chat.refusal", undefined, input.lang);
    emit({ type: "replace", text });
  } else if (!text) {
    text = t(cards.length ? "chat.found" : "chat.cant", undefined, input.lang);
    emit({ type: "replace", text });
  } else if (gate.dirty) {
    emit({ type: "replace", text });
  }
  if (gate.dropped) console.warn(`[ask-chat] ${gate.dropped} sentence(s) held back (unbacked number or banned word)`);
  return { added, text, cards, usage, costMicros: cost, toolsUsed, raw: raw.trim(), dropped: gate.dropped, toolText, stop };
}

/** The context block for a turn: Mada's systems speaking, never the traveller. Changes every turn, so it sits in the turn. */
export function turnContext(o: { today: string; lang: "en" | "ar"; people: Person[]; trips: string[]; onScreen: string | null; slots: string; household: (p: Person) => string }): string {
  const weekday = new Date(`${o.today}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
  return [
    "[Context from Mada's systems for this message. Not written by the traveller.]",
    `Today: ${weekday} ${o.today}, Riyadh time. Eid al-Fitr 2027 is 9 to 15 March 2027.`,
    `Reply in: ${o.lang === "ar" ? "Arabic, spoken Saudi" : "English"}.`,
    `Household (id: name, relation, age):\n${o.people.map(o.household).join("\n") || "only the account holder"}`,
    `Trips: ${o.trips.length ? `\n${o.trips.join("\n")}` : "none upcoming"}`,
    o.onScreen ? `On screen: ${o.onScreen}` : null,
    `Read from the message: ${o.slots}`,
  ].filter(Boolean).join("\n");
}

export type { AskIntent };
