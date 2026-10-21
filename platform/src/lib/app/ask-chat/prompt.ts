import type Anthropic from "@anthropic-ai/sdk";
import { DESTINATIONS, type AskKind } from "@mada/shared";
import { PERSONA } from "./persona";

/*
 * The conversation's frozen prefix: the system prompt and the tool list never change between requests or people, so
 * the API caches them (tools → system, one breakpoint on the system block). Everything that changes (today, the
 * household, the trips, what the sentence was read as) goes in a mid-conversation system message after each
 * traveller message instead (engine.ts turnContext), which keeps the cache and preserved thinking valid.
 */

const KEYS = Object.keys(DESTINATIONS).sort();

/*
 * One frozen block, the same for every provider: Mada's persona word for word from docs/app/ASSISTANT.md §1
 * (persona.ts), then how this app works (writing mechanics, the next-step line, the tools).
 */
export const SYSTEM_PROMPT = `${PERSONA}

How you write here
- Reply in the language of the traveller's latest message.
- At most 3 short sentences, then the cards do the rest. One idea per sentence. Numbers beat adjectives.
- Never write: AI, assistant, bot, smart, magic, "I'd be happy to", "Certainly", "Great question", journey, adventure, seamless, tailored, curated, unforgettable, hassle-free, kindly, dear customer, "something went wrong", error, failed, invalid, user, soon, shortly. No exclamation marks, no emoji, no em dashes, no markdown, no lists.
- Use first names. Dates as "Thu 14 Mar". Money as "SAR 8,640" in English and "8,640 ر.س" in Arabic. Times as 24-hour "09:40".

The next step
- End every reply with one last line of 2 or 3 choices, in the traveller's language, exactly like this:
<next>Book the Saudia at 09:40 | Hotels near Taksim | Change dates</next>
- The app shows them as buttons and never shows that line; tapping one sends its words as the traveller's next message. So each choice is something the traveller would say, at most 6 words, specific to this reply (an option on the cards, the obvious next thing for the trip, a change). Prices and times in a choice follow the same rule as your words.

Truth
- You know only what Mada's tools return this turn (our flights, stays, eSIM plans, cars, trips, household, entry rules); there is no web search. Never name a price, time, schedule, availability, flight number, airline, hotel, rating, rule or fee no tool returned.
- You cannot charge, book, ticket or cancel anything. To pay, call price_quote_for_pay: the app shows its own pay sheet, and the traveller decides there.
- A tool result that starts with "demo: true" holds sample fares for testing. Say so in your first sentence ("These are sample fares for testing"); never call them real, live or available.

Found by hand
- Flights when search_flights answers {"mode":"request"}, and anything no tool sells (a cruise, a train, a visa we don't handle, a group or company trip, a city not sold live): get only what the team needs (where, when, who, must-haves), one question at a time, defaults where you can.
- Confirm it back in one line, say the team at Mada gets back within 2 hours, and ask how to reach them: <next>WhatsApp | Call me | Here in the app</next>. A call with no time given: ask the best time once.
- Then call create_request with the details and contact_preference, and say "We've noted it and the team will get back to you by" the time it returns.

Acting
- Use the tools. Prefer one search with assumptions (from Riyadh, the household travelling, economy) over a question. Call several tools at once when they are independent (flights and entry rules for the same trip).
- Destinations Mada sells live (use these keys): ${KEYS.join(", ")}. Anything else is a city we search by hand (Found by hand, kind flight or stay).
- Umrah: Makkah stays go by distance to the Haram; a Nusuk permit is needed, and a permit already mentioned counts as yes. Use create_request kind umrah when it needs the team.
- A car right now: call plan_car_now with what they said; the app confirms the meeting point. Never promise a driver.
- Visas: entry_rules with the destination and who goes. eSIM: esim_plans with the place and the days.
- Corrections ("we are 5", "make it December", "no, Dubai") change only what they name: search again with the rest kept, and say what changed in a few words.
- A person at Mada: call talk_to_human only when they ask for a person, when it is urgent (hurt, stranded, a flight today going wrong), or when the tools cannot do what they need. Never offer it otherwise.

Once you have answered something, treat that answer as done. On later turns your thinking goes to what the traveller is asking now; do not go back over an earlier answer unless they ask about it or point out a problem with it.`;

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const ids = { type: "array", items: { type: "string" }, description: "Person ids from the household list in the context. The account holder when unsaid." };
const day = (what: string) => ({ type: "string", description: `${what}, YYYY-MM-DD.` });
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });

/** Strict schemas: every property required (null when unknown), nothing extra. Order is fixed, so the cache holds. */
export const TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "search_flights",
    description: "Search live flights with all-in prices from a home airport to a destination Mada sells live. Returns up to 3 options; the app shows them as cards.",
    strict: true,
    input_schema: obj({
      destination: { type: "string", enum: KEYS },
      from: { type: ["string", "null"], enum: ["RUH", "JED", "DMM", null], description: "Null means Riyadh." },
      depart: day("Leaving"),
      return: nullable("string", { description: "Coming back, YYYY-MM-DD; null for one way." }),
      traveller_ids: ids,
      infants: { type: "integer", description: "Babies under 2 on a lap; 0 if none." },
      cabin: { type: ["string", "null"], enum: ["economy", "premium", "business", null] },
    }),
  },
  {
    name: "search_stays",
    description: "Search live hotels for a stay, ranked for who is going. Wishes (a pool, sea view, near a landmark, breakfast, free cancellation) filter and sort the results. Returns up to 3; the app shows them as cards.",
    strict: true,
    input_schema: obj({
      destination: { type: "string", enum: KEYS },
      check_in: day("Check-in"),
      nights: { type: "integer", description: "1 to 60." },
      traveller_ids: ids,
      wishes: nullable("string", { description: "What they asked for, in their words, e.g. 'with a pool, close to Sultanahmet'." }),
    }),
  },
  {
    name: "get_hotel",
    description: "Facts about one hotel from a stay card: address, facilities, description.",
    strict: true,
    input_schema: obj({ hotel_code: { type: "integer", description: "The hotel code from a search_stays result." } }),
  },
  {
    name: "esim_plans",
    description: "eSIM data plans for a country, city or region and a number of days, with all-in prices per eSIM.",
    strict: true,
    input_schema: obj({
      where: { type: "string", description: "A destination key, a country or a city, in English (e.g. 'pakistan')." },
      days: nullable("integer", { description: "Days of data needed; null for 7." }),
      trip_id: nullable("string", { description: "A trip id from the context, when it is for that trip." }),
    }),
  },
  {
    name: "plan_car_now",
    description: "Set up a car right now or in 15 minutes. The app then confirms the meeting point and requests the car; nothing is booked by this call.",
    strict: true,
    input_schema: obj({
      city: nullable("string"),
      from: nullable("string", { description: "Where to be picked up, as said (an airport, a hotel)." }),
      to: nullable("string", { description: "Where to, as said." }),
      when: { type: "string", enum: ["now", "in15"] },
    }),
  },
  {
    name: "get_trips",
    description: "The traveller's upcoming and past trips with Mada.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "get_trip",
    description: "One trip in full: flights, stay, travellers, documents still needed.",
    strict: true,
    input_schema: obj({ trip_id: { type: "string" } }),
  },
  {
    name: "get_household",
    description: "The people the traveller books for, with relation and age.",
    strict: true,
    input_schema: obj({}),
  },
  {
    name: "entry_rules",
    description: "Visa, ETA and passport rules for these people going to a destination on these days, from each passport's nationality.",
    strict: true,
    input_schema: obj({
      destination: { type: "string", enum: KEYS },
      traveller_ids: ids,
      depart: day("Arriving"),
      return: nullable("string", { description: "Leaving, YYYY-MM-DD, or null." }),
    }),
  },
  {
    name: "create_request",
    description: "Hand something to the team at Mada to arrange by hand and quote in the app: flights while they go by request, a visa, Umrah, a city not sold live, a cruise, a train, a group, a restaurant, anything a tool can't answer. Only after the traveller has said how to reach them. Returns the time the team answers by.",
    strict: true,
    input_schema: obj({
      kind: { type: "string", enum: ["visa", "umrah", "car", "food", "todo", "flight", "stay", "general"] },
      summary: { type: "string", description: "What they want, in one or two plain sentences, in their language." },
      traveller_ids: ids,
      destination_name: nullable("string"),
      depart: nullable("string", { description: "YYYY-MM-DD or null." }),
      return: nullable("string", { description: "YYYY-MM-DD or null." }),
      contact_preference: { type: ["string", "null"], enum: ["call", "whatsapp", "in_app", null], description: "How they asked to be reached." },
      contact_window: nullable("string", { description: "With a call: the best time, in their words; else null." }),
    }),
  },
  {
    name: "price_quote_for_pay",
    description: "When the traveller wants to book a flight, stay or eSIM from a card: prices it again and opens the app's pay sheet. Never charges.",
    strict: true,
    input_schema: obj({
      kind: { type: "string", enum: ["flight", "stay", "esim"] },
      offer_id: nullable("string", { description: "The flight or stay option id from a search result this conversation." }),
      package_id: nullable("string", { description: "The eSIM plan id." }),
      traveller_ids: ids,
    }),
  },
  {
    name: "talk_to_human",
    description: "Pass the conversation to a person at the Mada desk, with a summary they read first.",
    strict: true,
    input_schema: obj({
      summary: { type: "string", description: "What the traveller needs and what has been done, in their language." },
      urgent: { type: "boolean" },
    }),
  },
];

/**
 * The tools a turn can need once the sentence is read (slots.ts), in the fixed order of TOOLS; null (send them all)
 * when the kind is unknown or open. Only openai-compatible providers are sent the shorter list (providers-openai.ts):
 * free tiers count tokens per minute, and the tool list is the biggest part of every request. Claude gets every tool,
 * cached, so the list never changes there.
 */
const BY_KIND: Partial<Record<AskKind, string[]>> = {
  flight: ["search_flights", "search_stays", "entry_rules", "create_request", "price_quote_for_pay", "get_trips", "get_trip", "talk_to_human"],
  stay: ["search_stays", "get_hotel", "entry_rules", "create_request", "price_quote_for_pay", "get_household", "talk_to_human"],
  esim: ["esim_plans", "get_trips", "price_quote_for_pay", "talk_to_human"],
  visa: ["entry_rules", "get_household", "create_request", "talk_to_human"],
  umrah: ["search_stays", "get_hotel", "entry_rules", "create_request", "price_quote_for_pay", "talk_to_human"],
  car: ["plan_car_now", "create_request", "get_trips", "talk_to_human"],
  food: ["create_request", "get_trips", "talk_to_human"],
};
export function toolsFor(kind: AskKind | null): string[] | null {
  const want = kind ? BY_KIND[kind] : undefined;
  return want ? TOOLS.map((t) => t.name).filter((n) => want.includes(n)) : null;
}
