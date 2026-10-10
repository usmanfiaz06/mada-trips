import Anthropic from "@anthropic-ai/sdk";
import type { AskParser, AskParserContext, ModelIntent } from "../booking-types";
import { requireEnv } from "./not-configured";

/*
 * Ask on the Claude API: what the traveller typed → a structured intent, through one strict tool (the arguments always
 * match the schema). Structure only: the schema has no field for a price, and nothing here is ever shown as one
 * (SCOPE.md §6: prices are never written by the model). The server checks every person id against the household.
 *   ANTHROPIC_API_KEY  required
 *   ANTHROPIC_MODEL    defaults to claude-opus-5-5
 * Claude Opus 5.5 refuses forced tool_choice, so the call uses "auto" with the instruction to call the tool, plus
 * strict: true; refusal fallbacks are on (server-side-fallback-2026-07-01, fallbacks: "default").
 */

const MODEL = () => process.env.ANTHROPIC_MODEL ?? "claude-opus-5-5";
let client: Anthropic | null = null;
const api = () => {
  const env = requireEnv("ask (Claude)", ["ANTHROPIC_API_KEY"]);
  return (client ??= new Anthropic({ apiKey: env.ANTHROPIC_API_KEY, timeout: 20_000, maxRetries: 2 }));
};

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });

/** Every property required, nothing extra: what strict tool use needs. */
export const ASK_TOOL_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["kind", "destination", "destinationName", "from", "depart", "return", "tripType", "monthOnly", "cabin", "travellerIds", "travellerCount", "infants", "ask"],
  properties: {
    kind: { type: "string", enum: ["flight", "stay", "plan", "esim", "visa", "umrah", "car", "food", "todo", "general"], description: "What they want. plan = a ready-made itinerary; todo = tours and tickets; food = a restaurant table; general = anything else Mada does by hand." },
    destination: nullable("string", { description: "One of the destination keys given in the instructions, 'other' for another city, or null." }),
    destinationName: nullable("string", { description: "The city as written when destination is 'other'." }),
    from: { type: ["string", "null"], enum: ["RUH", "JED", "DMM", null], description: "Departure airport if they said it." },
    depart: nullable("string", { description: "YYYY-MM-DD, only if a day is clear." }),
    return: nullable("string", { description: "YYYY-MM-DD, only if a return day is clear." }),
    tripType: { type: ["string", "null"], enum: ["return", "oneway", null] },
    monthOnly: {
      type: ["object", "null"], additionalProperties: false, required: ["month", "year", "label"],
      properties: { month: { type: "integer" }, year: { type: "integer" }, label: nullable("string") },
      description: "When only a month or season is given.",
    },
    cabin: { type: ["string", "null"], enum: ["economy", "premium", "business", null] },
    travellerIds: { type: ["array", "null"], items: { type: "string" }, description: "Ids from the household list for the people going, when clear." },
    travellerCount: nullable("integer", { description: "A head count if they gave one." }),
    infants: { type: "integer", description: "Babies on a lap; 0 if none mentioned." },
    ask: { type: ["string", "null"], enum: ["where", "when", "return", "who", null], description: "The single missing detail that changes the outcome." },
  },
} as const;

export const claudeAsk: AskParser = {
  name: "claude",
  async parse(text: string, ctx: AskParserContext): Promise<ModelIntent | null> {
    const household = ctx.people.map((p) => `${p.id}: ${p.firstName || (p.isSelf ? "the account holder" : "unnamed")} (${p.relation}${p.dateOfBirth ? `, born ${p.dateOfBirth.slice(0, 4)}` : ""})`).join("\n");
    const system = [
      "You read travel requests for Mada Trips, a Saudi travel agency, and record them with the record_intent tool.",
      "Always call record_intent exactly once. Use null for anything not stated. Never invent dates, people or places.",
      `Today is ${ctx.today} (Riyadh). Eid al-Fitr 2027 is 9 to 15 March 2027. Saudi weekends run Thursday to Saturday.`,
      `Destination keys: ${ctx.destinations.join(", ")}.`,
      `The household (id: name):\n${household}`,
    ].join("\n");
    const res = (await api().beta.messages.create({
      model: MODEL(),
      max_tokens: 2048,
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      output_config: { effort: "low" },
      system,
      tools: [{ name: "record_intent", description: "Record what the traveller asked for.", input_schema: ASK_TOOL_SCHEMA, strict: true }],
      tool_choice: { type: "auto" },
      messages: [{ role: "user", content: text.slice(0, 500) }],
    } as unknown as Parameters<Anthropic["beta"]["messages"]["create"]>[0])) as Anthropic.Beta.BetaMessage;
    if (res.stop_reason === "refusal") return null;
    const call = res.content.find((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use" && b.name === "record_intent");
    return call ? (call.input as ModelIntent) : null;
  },
};
