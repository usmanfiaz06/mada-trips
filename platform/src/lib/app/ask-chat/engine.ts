import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import type { ChatApi, StreamParams } from "./providers";
import { t, type AskChatEvent, type AskIntent, type AskKind, type ChatCard, type Person } from "@mada/shared";
import { askChatModel, costMicros, noUsage, type Usage } from "./config";
import { isCloser, outgoingProblems, tidy, trimCloser, unbacked } from "./guard";
import { NEXT_CLOSE, NEXT_OPEN, parseNext, resolveNext } from "./next";
import { SYSTEM_PROMPT, TOOLS, toolsFor } from "./prompt";
import { runTool, statusFor, type ToolCtx, type ToolOut } from "./tools";
import { schemaProblems, toolNameFor } from "./schema";

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
const TOOL_LIST = TOOLS as { name: string; input_schema: unknown }[];

/** A provider's tool call was still wrong after one repair: the app answers with its own flows. */
export class ToolInputError extends Error {
  constructor(tools: string) { super(`tool input still invalid after a repair: ${tools}`); this.name = "ToolInputError"; }
}

// Who answers is behind one interface (providers.ts): Claude by default, another provider for comparing.
export { chatApi, setChatApi, type ChatApi } from "./providers";

/** How much of the end of `s` could be the start of the `<next>` line (held back until it is clear). */
const partialTag = (s: string) => {
  for (let k = Math.min(NEXT_OPEN.length - 1, s.length); k > 0; k--) if (NEXT_OPEN.startsWith(s.slice(-k))) return k;
  return 0;
};

/**
 * Holds sentences with digits until they end, so an unbacked price never reaches the screen. Also keeps the closing
 * `<next>…</next>` line off the screen (its choices become the turn's chips) and drops closers ("Anything else?").
 */
export class SentenceGate {
  private buf = "";
  private shownUpTo = 0;
  /** The `<next>` line while it arrives. */
  private tag: string | null = null;
  /** Every sentence, and whether it was kept. */
  readonly kept: string[] = [];
  dropped = 0;
  /** Closers dropped (not counted as `dropped`: nothing wrong was said, the chips take their place). */
  closers = 0;
  /** The choices from the last `<next>` line, checked. */
  choices: string[] = [];
  /** Words of a dropped sentence were already on screen: the turn ends with a `replace`. */
  dirty = false;
  constructor(private readonly toolText: () => string, private readonly out: (s: string) => void) {}

  push(delta: string) {
    if (this.tag !== null) {
      this.tag += delta;
      const close = this.tag.indexOf(NEXT_CLOSE);
      if (close < 0) return;
      const rest = this.tag.slice(close + NEXT_CLOSE.length);
      this.readTag(this.tag.slice(0, close));
      if (rest.trim()) this.push(rest);
      return;
    }
    this.buf += tidy(delta);
    const at = this.buf.indexOf(NEXT_OPEN);
    if (at >= 0) { this.tag = this.buf.slice(at); this.buf = this.buf.slice(0, at); }
    for (;;) {
      const m = /[.?؟](?=\s)|\n/.exec(this.buf);
      const end = m ? m.index + 1 : -1;
      if (end < 0) break;
      this.close(this.buf.slice(0, end));
      this.buf = this.buf.slice(end);
      this.shownUpTo = 0;
    }
    // No digit in the open sentence yet: show it as it comes (all but what could be the start of `<next>`). A sentence
    // that could still turn out to be a closer waits for its end.
    const upTo = this.buf.length - partialTag(this.buf);
    if (!/\d/.test(this.buf) && !this.maybeCloser() && upTo > this.shownUpTo) {
      this.out(this.buf.slice(this.shownUpTo, upTo));
      this.shownUpTo = upTo;
    }
  }

  /** The end of a step: whatever is open is a sentence too, and a `<next>` line is read. */
  flush() {
    if (this.buf.trim()) this.close(this.buf);
    else if (this.buf.length > this.shownUpTo) this.out(this.buf.slice(this.shownUpTo));
    if (this.tag !== null) this.readTag(this.tag);
    this.buf = "";
    this.shownUpTo = 0;
  }

  private readTag(line: string) {
    const c = parseNext(line, this.toolText());
    if (c.length) this.choices = c;
    this.tag = null;
  }

  /** The open sentence is short and starts like a closer: hold it until it ends (it is dropped if it is one). */
  private maybeCloser() {
    const s = this.buf.trimStart();
    return s.length < 120 && /^(?:and |so |or )?(?:any|is there|how (?:can|else)|let (?:me|us)|tell (?:me|us)|just|say the|if you|should you|whenever|we'?re here|feel|hope|don|هل|فيه? |أي |تبي|تبغى|تأمر|لا تت|و?خب|و?قو?ل لنا|و?علّ?منا|و?بلّ?غنا|و?إذا|و?اذا|و?لو )/i.test(s);
  }

  private close(whole: string) {
    if (isCloser(whole)) { this.closers += 1; if (this.shownUpTo > 0) this.dirty = true; return; }
    // "Three ways for Eid, let us know which you prefer.": the closing clause goes, the content stays.
    const sentence = trimCloser(whole);
    if (sentence !== whole) { this.closers += 1; if (this.shownUpTo > 0) this.dirty = true; }
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
  /**
   * What the sentence was read as (slots.ts). When known, an openai-compatible provider is sent only the tools such a
   * turn can need (prompt.ts toolsFor), which saves tokens on free tiers; Claude always gets the full cached list.
   */
  intent?: AskKind | null;
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
  /** The next step shown as chips (docs/app/ASSISTANT.md): Mada's own, or filled from the turn. */
  next: string[];
  nextFrom: "model" | "app";
  /** The choices the model wrote itself, after the checks (for the evals). */
  modelChoices: string[];
  /** Closing lines dropped ("Anything else?"). */
  closers: number;
  /** The tool calls that ran, with their inputs (for the evals; never logged). */
  calls: { name: string; input: Record<string, unknown> }[];
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
  const calls: TurnResult["calls"] = [];
  let sep = false;
  let raw = "";
  const exec = input.runTool ?? runTool;
  let repairs = 0;
  const gate = new SentenceGate(() => toolText, (s) => { emit({ type: "text", delta: s }); sep = true; });
  let stop: TurnResult["stop"] = "steps";
  let paid = false;
  let handedOff = false;
  let flightRequest = false;
  // Only a hint: providers that cache the tool list (Claude) ignore it and get every tool (providers.ts).
  const onlyTools = toolsFor(input.intent ?? null);

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
      ...(onlyTools ? { only_tools: onlyTools } : {}),
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

    // Arguments checked against the strict schemas (a provider without strict tool use can get them wrong): a bad
    // call is answered with what is wrong, once per turn; wrong again and the app's own flows take over.
    const checked = calls.map((c) => {
      const name = toolNameFor(c.name, TOOL_LIST.map((x) => x.name));
      const schema = TOOL_LIST.find((x) => x.name === name)?.input_schema;
      const problems = !name ? [`there is no tool called ${c.name}; the tools are ${TOOL_LIST.map((x) => x.name).join(", ")}`] : schemaProblems(schema as never, c.input);
      return { c, name: name ?? c.name, problems };
    });
    const bad = checked.filter((x) => x.problems.length);
    if (bad.length) {
      if (repairs >= 1) throw new ToolInputError(bad.map((x) => x.name).join(","));
      repairs += 1;
      console.warn(`[ask-chat] tool input repaired: ${bad.map((x) => x.name).join(",")}`);
    }

    // Independent calls run together; all results go back in one message.
    const results = await Promise.all(checked.map(async ({ c, name, problems }) => {
      if (problems.length) return { c, out: { text: `Not run. The arguments don't match the schema: ${problems.join("; ")}. Call it again with arguments that match exactly.`, isError: true } as ToolOut };
      const inp = (c.input ?? {}) as Record<string, unknown>;
      emit({ type: "status", text: statusFor(name, inp, input.lang) });
      toolsUsed.push(name);
      calls.push({ name, input: inp });
      const out = await exec(name, inp, input.tool);
      return { c, out };
    }));
    for (const { c, out } of results) {
      toolText += `\n${out.text}`;
      if (out.cards?.length) { cards.push(...out.cards); emit({ type: "cards", cards: out.cards }); }
      if (out.pay) { paid = true; emit({ type: "pay", pay: out.pay }); }
      if (out.handoff) handedOff = true;
      if (out.mode === "request") flightRequest = true;
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
  // Never open-ended: Mada's own choices when it gave at least 2 good ones, otherwise the turn's (next.ts).
  const modelChoices = stop === "refusal" ? [] : gate.choices;
  const next = resolveNext(modelChoices, { cards, pay: paid, handoff: handedOff, flightRequest, lang: input.lang });
  if (next.choices.length) emit({ type: "next", choices: next.choices });
  return { added, text, cards, usage, costMicros: cost, toolsUsed, raw: raw.trim(), dropped: gate.dropped, toolText, stop, next: next.choices, nextFrom: next.from, modelChoices, closers: gate.closers, calls };
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
