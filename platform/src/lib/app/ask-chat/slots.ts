import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { AskIntent, DESTINATIONS, weekendLine, askIntentOfRules, parseAskRules, type Person } from "@mada/shared";
import { mergeModel, rulesComplete } from "../booking/ask";
import { ASK_TOOL_SCHEMA } from "../suppliers/live/ask-claude";
import { askFastModel } from "./config";
import type { ChatApi } from "./engine";
import { personLine } from "./tools";

/*
 * The sentence read into slots before the conversation answers: the deterministic rules first, then the fast model
 * (ASK_FAST_MODEL, Haiku) only when the rules leave something open, with a short timeout. What comes back goes to the
 * conversation as context (so it doesn't ask what was said) and to the app as `intent` (its own flows take over with
 * it if the conversation stops). Structure only: nothing here is ever a price.
 */

export async function readSlots(api: ChatApi | null, text: string, people: Person[], today: string, model = askFastModel()): Promise<{ intent: AskIntent; usage: Anthropic.Beta.BetaUsage | null }> {
  const fromRules = AskIntent.parse(askIntentOfRules(parseAskRules(text, { today, people })));
  if (!api || rulesComplete(fromRules)) return { intent: fromRules, usage: null };
  try {
    const res = await api.create({
      model,
      max_tokens: 1024,
      output_config: { effort: "low" },
      system: [
        "You read travel requests for Mada Trips, a Saudi travel agency, and record them with the record_intent tool.",
        "Always call record_intent exactly once. Use null for anything not stated. Never invent dates, people or places.",
        `Today is ${today} (Riyadh). Eid al-Fitr 2027 is 9 to 15 March 2027.`,
        weekendLine(today),
        `Destination keys: ${Object.keys(DESTINATIONS).join(", ")}.`,
        `The household:\n${people.map((p) => personLine(p, today)).join("\n")}`,
      ].join("\n"),
      tools: [{ name: "record_intent", description: "Record what the traveller asked for.", input_schema: ASK_TOOL_SCHEMA as unknown as Anthropic.Beta.BetaTool.InputSchema, strict: true }],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text.slice(0, 500) }],
    }, { timeout: 6_000, maxRetries: 0 });
    if (res.stop_reason === "refusal") return { intent: fromRules, usage: res.usage };
    const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "record_intent");
    if (!call) return { intent: fromRules, usage: res.usage };
    return { intent: AskIntent.parse(mergeModel(fromRules, call.input as Parameters<typeof mergeModel>[1], people, today)), usage: res.usage };
  } catch (e) {
    console.warn("[ask-chat] slots: the fast model didn't answer; using the rules", e instanceof Error ? e.name : "");
    return { intent: fromRules, usage: null };
  }
}

/** The slots as one line of context for the conversation. */
export function slotsLine(i: AskIntent): string {
  const parts = [
    `kind=${i.kind}`,
    i.destination ? `destination=${i.destination}${i.destinationName ? ` (${i.destinationName})` : ""}` : null,
    i.from ? `from=${i.from}` : null,
    i.depart ? `depart=${i.depart}` : null,
    i.return ? `return=${i.return}` : null,
    i.tripType ? `trip=${i.tripType}` : null,
    i.monthOnly ? `month=${i.monthOnly.year}-${String(i.monthOnly.month).padStart(2, "0")}` : null,
    i.cabin ? `cabin=${i.cabin}` : null,
    i.travellerIds?.length ? `who=${i.travellerIds.join(",")}` : null,
    i.travellerCount ? `count=${i.travellerCount}` : null,
    i.party ? `party=${JSON.stringify(i.party)}` : null,
    i.infants ? `infants=${i.infants}` : null,
    Object.keys(i.answers).length ? `answers=${JSON.stringify(i.answers)}` : null,
    i.ask ? `still open=${i.ask}` : null,
  ];
  return parts.filter(Boolean).join(" · ");
}
