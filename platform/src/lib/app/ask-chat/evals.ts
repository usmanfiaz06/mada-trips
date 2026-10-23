import { languageOfText, type ChatCard, type Person } from "@mada/shared";
import { ToolInputError, type ChatApi, runTurn, turnContext } from "./engine";
import { ProviderHttpError } from "./providers-openai";
import { costMicros, type Price } from "./config";
import { firstSentence, openEndedIn, outgoingProblems, questionsIn, redact, unbacked } from "./guard";
import { readSlots, slotsLine } from "./slots";
import { kindFor } from "./prompt";
import { personLine, requestModeText, type ToolCtx, type ToolOut } from "./tools";
import type Anthropic from "@anthropic-ai/sdk";

/*
 * The conversation's eval set (docs/app/ASK-CHAT.md §Evals): 51 conversations in English and spoken Saudi Arabic,
 * run turn by turn through the real engine (the same prompt, tools, gate and slots) with fixed tool results, so the
 * checks are about the model and nothing else. Each turn is held to:
 *   prices   the model wrote no price or time that no tool returned (checked on its raw words, before the gate)
 *   one      at most one question
 *   lang     the reply's language is the traveller's
 *   tools    the tools it should reach for (any of a list), and none it must not
 *   words    no banned words
 *   next     it ends with a concrete next step: its own <next> choices (2 or 3), or choices said in its last sentence
 *            (docs/app/ASSISTANT.md "Always resolve"; the app fills chips in when it forgets, but that is a fail here)
 *   open     no open-ended closer ("Anything else?", "How can I help", "Let me know", «أي خدمة ثانية»)
 *   reach    found by hand (flights by request, a cruise, a train, a group): it asks how to reach them (WhatsApp, a
 *            call, the app) as its own choices, then makes the request with that preference
 *   first    the answer first: no preamble, and the first sentence is not a question unless the whole turn may be
 *            one needed question
 *   never-no never "we don't do that" alone (docs/app/ASK-INTEGRATED.md §8.2): a reply that says we don't offer it, it
 *            isn't available, «ما نقدر», «ما عندنا», also does it (a tool), sends it to the team (a request, or asks how
 *            to reach them for one), or opens it in the app
 * scripts/ask-chat-eval.ts runs it against the live model when ANTHROPIC_API_KEY is set; the tests run it on a stand-in.
 */

const SELF = "11111111-1111-4111-8111-111111111111";
const WIFE = "22222222-2222-4222-8222-222222222222";
const SARA = "33333333-3333-4333-8333-333333333333";
const AHMED = "44444444-4444-4444-8444-444444444444";
const p = (id: string, firstName: string, relation: Person["relation"], dob: string, isSelf = false): Person =>
  ({ id, isSelf, givenNames: firstName, surname: "Alharbi", firstName, relation, dateOfBirth: dob, sex: null, nationality: "SAU", passport: null, createdAt: "2026-01-01T00:00:00Z" });
export const EVAL_PEOPLE: Person[] = [p(SELF, "Omar", "self", "1987-02-11", true), p(WIFE, "Hessa", "spouse", "1989-07-24"), p(SARA, "Sara", "child", "2013-05-12"), p(AHMED, "Ahmed", "child", "2016-09-03")];
export const EVAL_TODAY = "2026-10-20";
const TRIPS = ["id=55555555-5555-4555-8555-555555555555 · Cairo · 2026-10-20 to 2026-10-24 · Omar"];

/** Tool results as the real tools write them (tools.ts), for fixed inputs. */
export async function fixtureTool(name: string, input: unknown, flights: "live" | "request" = "live"): Promise<ToolOut> {
  const a = (input ?? {}) as Record<string, unknown>;
  const n = Array.isArray(a.traveller_ids) && a.traveller_ids.length ? a.traveller_ids.length : 1;
  const each = 2025;
  const fmt = (x: number) => `SAR ${x.toLocaleString("en-US")}`;
  switch (name) {
    case "search_flights": {
      const dest = String(a.destination);
      if (flights === "request") return { text: requestModeText(dest, String(a.depart), typeof a.return === "string" ? a.return : null), mode: "request" };
      if (a.cabin === "business") return { text: `Flights RUH → ${dest}, ${a.depart}, checked 9, for ${n} people:\n1. id=f-biz-1 · best · Saudia SV263 · RUH 09:40 → 13:10 (4h30m) · direct · refundable · ${fmt(7900 * n)} all in` };
      return { text: `Flights RUH → ${dest}, ${a.depart}${a.return ? ` to ${a.return}` : " one way"}, checked 14, for ${n} people:\n1. id=f-1 · best · Saudia SV263 · RUH 09:40 → 13:10 (4h30m) · direct · not refundable · ${fmt(each * n)} all in\n2. id=f-2 · lowest · flynas XY125 · RUH 02:15 → 08:05 (6h50m) · One stop in Kuwait · not refundable · ${fmt(1610 * n)} all in\n3. id=f-3 · fastest · Turkish Airlines TK145 · RUH 14:20 → 18:15 (4h55m) · direct · refundable · ${fmt(2390 * n)} all in` };
    }
    case "search_stays":
      if (typeof a.hotel_name === "string" && /four season/i.test(a.hotel_name)) return { text: `The hotel they named ("${a.hotel_name}"): only these hotels by that name were searched; say it is the one they asked for.\nStays in London, ${a.nights} nights from ${a.check_in}, for ${n} people:\n1. id=s-fs1 · hotel_code=9101 · Four Seasons Hotel London at Park Lane · Mayfair · 5 stars · ${fmt(38400)} all in · free cancellation until ${a.check_in} · has spa, gym` };
      return { text: `Stays in ${a.destination ?? a.place}, ${a.nights} nights from ${a.check_in}, for ${n} people:\n1. id=s-1 · hotel_code=9001 · Rove Downtown · Downtown · 3 stars · ${fmt(1840)} all in · free cancellation until ${a.check_in} · has pool, wifi\n2. id=s-2 · hotel_code=9002 · Address Sky View · Downtown · 5 stars · ${fmt(5260)} all in · not refundable · has pool, gym, spa` };
    case "esim_plans":
      return { text: `eSIM plans for Pakistan, ${a.days ?? 7} days:\n1. id=pk-10-5 · 5 GB · 10 days · Pakistan · SAR 39 each eSIM · lasts the trip\n2. id=pk-10-10 · 10 GB · 15 days · Pakistan · SAR 59 each eSIM · lasts the trip\n3. id=pk-30-20 · 20 GB · 30 days · Pakistan · SAR 89 each eSIM · lasts the trip` };
    case "entry_rules":
      return { text: `United Kingdom for Saudi passports, checked ${EVAL_TODAY}.\n- Omar: eta (UK ETA), needed before travel: Saudi passports need a UK ETA, not a visa. Online, GBP 16, usually 3 working days. · Mada can arrange it (uk_eta)\n- Hessa: eta (UK ETA), needed before travel: Saudi passports need a UK ETA, not a visa. Online, GBP 16, usually 3 working days. · Mada can arrange it (uk_eta)` };
    case "plan_car_now":
      return { text: `Car card shown: ${a.when}${a.city ? `, in ${a.city}` : ""}${a.from ? `, from ${a.from}` : ""}${a.to ? `, to ${a.to}` : ""}. The traveller confirms the meeting point in the app; no price or driver yet.` };
    case "get_trips":
      return { text: `Upcoming: \n${TRIPS[0]} · SV309 2026-10-20 06:00 · Steigenberger Tahrir\nPast: none` };
    case "get_trip":
      return { text: `{"city":"Cairo","startDate":"2026-10-20","segments":[{"flight":"SV309","from":"RUH","to":"CAI","depart":"06:00","status":"cancelled"}]}` };
    case "get_household":
      return { text: EVAL_PEOPLE.map((x) => personLine(x, EVAL_TODAY)).join("\n") };
    case "get_hotel":
      return { text: `{"name":"Rove Downtown","facilities":["Outdoor pool","Gym","Wi-Fi"],"address":"Sheikh Mohammed bin Rashid Blvd"}` };
    case "create_request":
      return { text: `Request r-1 noted for the team at Mada: ${String(a.kind)} (${String(a.summary).slice(0, 80)}). The team gets back to the traveller ${a.contact_preference === "call" ? "by a call" : a.contact_preference === "whatsapp" ? "on WhatsApp" : "here in the app"} by 18:00. Say it in one line: "We've noted it and the team will get back to you by 18:00".`, cards: [{ type: "request", requestId: SELF, kind: String(a.kind), title: String(a.summary).slice(0, 60) }] };
    case "price_quote_for_pay":
      return { text: `Pay sheet opened in the app: Riyadh → Istanbul, ${fmt(each * n)} all in. Free to cancel within 24 hours. Nothing is charged until the traveller slides to pay.`, pay: { draft: { kind: "trip", flightOfferId: SELF, bundle: false, travellerIds: [SELF] }, title: "Riyadh → Istanbul" } };
    case "create_plan": case "get_plan": case "update_plan": case "set_origin": case "find_for_item": case "open_in_app":
      return planFixture(name, a);
    case "talk_to_human":
      return { text: "Handed to the desk: Noura is on duty and has the summary. Say that Noura at Mada can take it from here, in one sentence.", handoff: { threadId: SELF, agent: "Noura" } };
    default:
      return { text: `There is no tool called ${name}.`, isError: true };
  }
}

/*
 * The living plan as the plan tools write it (tools-plan.ts planGist), for fixed inputs: a road trip from Singapore with
 * drive legs and no drive times measured, the AlUla weekend from Riyadh, and the same from Jeddah after set_origin.
 */
const PLAN_ID = "66666666-6666-4666-8666-666666666666";
const TRIP_ID = "77777777-7777-4777-8777-777777777777";
const planRow = (kind: "leg" | "stay" | "activity", title: string, o: Partial<{ mode: "flight" | "drive"; from: string; to: string; place: string; nights: number }> = {}) =>
  ({ kind, mode: o.mode ?? null, title, place: o.place ?? null, from: o.from ?? null, to: o.to ?? null, status: "idea" as const, nights: o.nights ?? null, at: null, km: null, minutes: null, borders: [], booking: null });
export function planFixture(name: string, a: Record<string, unknown>): ToolOut {
  const stops = Array.isArray(a.stops) ? a.stops.map((x) => String((x as { place?: unknown })?.place ?? "")).filter(Boolean) : [];
  const alula = name === "set_origin" || stops.some((x) => /ula/i.test(x)) || /ula/i.test(String(a.template_id ?? ""));
  const from = name === "set_origin" ? "Jeddah" : "Riyadh";
  if (name === "open_in_app") return { text: `A button to ${String(a.screen)} is shown. Say in one line what they'll find there.`, cards: [{ type: "link", screen: (a.screen as "trip") ?? "trip", id: null }] };
  if (name === "find_for_item") return { text: "Not sold live in the app: the team at Mada arranges it. Confirm in one line (Singapore, 2026-12-12, 2026-12-17, 2 travellers), ask how to reach them (<next>WhatsApp | Call me | Here in the app</next>), then create_request kind car with destination_name Singapore and depart 2026-12-12 and return 2026-12-17." };
  if (alula) {
    const text = `plan_id=${PLAN_ID} version=${name === "set_origin" ? 2 : 1} · "${from} → AlUla" · 2026-11-19 to 2026-11-20, 2 days (D1 is the first; n = nights) · Omar, Hessa\nStarts from ${from} (${name === "set_origin" ? "as they said" : "their remembered home airport"}).\nD1: [a1b2c3d4] flight ${from}→AlUla; [b2c3d4e5] stay AlUla 1n; [c3d4e5f6] activity Old Town\nD2: [d4e5f6a7] activity Hegra guided tour 09:00; [e5f6a7b8] flight AlUla→${from}\nTo do: Car: needed days 1–2; Stays: night 1 has no stay yet.`;
    const card: ChatCard = name === "set_origin"
      ? { type: "plan_diff", planId: PLAN_ID, tripId: TRIP_ID, title: `${from} → AlUla`, from: 1, to: 2, changes: [{ op: "origin", day: null, row: planRow("leg", from, { place: from }) }, { op: "update", day: 0, row: planRow("leg", `${from} → AlUla`, { mode: "flight", from, to: "AlUla" }) }], untouched: [] }
      : { type: "plan", planId: PLAN_ID, tripId: TRIP_ID, version: 1, title: `${from} → AlUla`, start: "2026-11-19", end: "2026-11-20", origin: { name: from, code: "RUH", source: "memory" }, originNeeded: false, travellers: [{ name: "Omar", self: true }, { name: "Hessa", self: false }], days: [{ day: 0, items: [planRow("leg", `${from} → AlUla`, { mode: "flight", from, to: "AlUla" })] }], more: 0, todo: [] };
    return { text: `${name === "set_origin" ? "Start changed and shown as a card." : "Plan made and shown as a card."} ${text}\nSay it in one sentence.`, cards: [card] };
  }
  const text = `plan_id=${PLAN_ID} version=1 · "Riyadh → Singapore → Penang" · 2026-12-10 to 2026-12-16, 7 days (D1 is the first; n = nights) · Omar\nStarts from Riyadh (their remembered home airport).\nD1: [a1b2c3d4] flight Riyadh→Singapore; [b2c3d4e5] stay Singapore 2n\nD3: [c3d4e5f6] drive Singapore→Melaka; [d4e5f6a7] stay Melaka 1n\nD4: [e5f6a7b8] drive Melaka→Kuala Lumpur; [f6a7b8c9] stay Kuala Lumpur 2n\nD6: [a7b8c9d0] drive Kuala Lumpur→Penang; [b8c9d0e1] stay Penang 1n\nD7: [c9d0e1f2] flight Penang→Riyadh\nTo do: Car: needed days 3–6; Stays: nothing booked yet. Drive km and times only as written here; none written: never say one.`;
  const card: ChatCard = { type: "plan", planId: PLAN_ID, tripId: TRIP_ID, version: 1, title: "Riyadh → Singapore → Penang", start: "2026-12-10", end: "2026-12-16", origin: { name: "Riyadh", code: "RUH", source: "memory" }, originNeeded: false, travellers: [{ name: "Omar", self: true }], days: [{ day: 2, items: [planRow("leg", "Singapore → Melaka", { mode: "drive", from: "Singapore", to: "Melaka" })] }], more: 0, todo: [{ key: "car", state: "todo", days: [2, 3, 4, 5] }] };
  if (name === "update_plan") return { text: `Changed and shown as a card. ${text}\nSay what changed in a few words.`, cards: [{ type: "plan_diff", planId: PLAN_ID, tripId: TRIP_ID, title: "Riyadh → Singapore → Penang", from: 1, to: 2, changes: [{ op: "move", day: 1, row: planRow("activity", "Hegra guided tour") }], untouched: [] }] };
  if (name === "get_plan") return { text };
  return { text: `Plan made and shown as a card. ${text}\nSay it in one sentence (the places in order, and "Review it"). Say where it starts in a few words ("Starting from Riyadh.") so they can change it.`, cards: [card] };
}

export type EvalTurn = {
  user: string;
  /** Any one of these must be called this turn. */
  toolsAnyOf?: string[];
  /** ...unless asking one question instead is fine (a missing day, say). */
  orAsk?: boolean;
  /** None of these may be called. */
  notTools?: string[];
  /** No tools at all. */
  noTools?: boolean;
  /** A question it must not ask (already answered). */
  notAsk?: RegExp;
  /** Found by hand: it must ask how to reach them, as its own choices (WhatsApp, a call, here in the app). */
  reachChips?: boolean;
  /** It must make the request with how they asked to be reached. */
  requestWithContact?: boolean;
  /** A tool it must call with this field matching (a named hotel goes in hotel_name). */
  inputHas?: { tool: string; field: string; match: RegExp };
};
/** flights: how search_flights answers in this case (APP_FLIGHTS_MODE). */
export type EvalCase = { id: string; lang: "en" | "ar"; turns: EvalTurn[]; flights?: "live" | "request" };

const FLIGHT = ["search_flights"];
export const EVAL_CASES: EvalCase[] = [
  { id: "family-eid", lang: "en", turns: [{ user: "Istanbul for Eid, all of us", toolsAnyOf: FLIGHT }] },
  { id: "family-eid-correction", lang: "en", turns: [{ user: "Istanbul for Eid, all of us", toolsAnyOf: FLIGHT }, { user: "Actually only me and Hessa", toolsAnyOf: FLIGHT, notAsk: /who/i }] },
  { id: "umrah-permit", lang: "en", turns: [{ user: "Umrah in Ramadan for me and Hessa, I have a Nusuk permit", toolsAnyOf: ["search_stays", "create_request"], orAsk: true, notAsk: /permit/i }] },
  { id: "car-now", lang: "en", turns: [{ user: "I just landed at Istanbul airport, I need a car right now to Taksim", toolsAnyOf: ["plan_car_now"], notAsk: /when|which city/i }] },
  { id: "esim-pakistan", lang: "en", turns: [{ user: "eSIM for Pakistan for 10 days", toolsAnyOf: ["esim_plans"] }] },
  { id: "visa-uk", lang: "en", turns: [{ user: "UK visa for me and my wife in December", toolsAnyOf: ["entry_rules"], orAsk: true, notAsk: /who/i }] },
  { id: "price-no-dates", lang: "en", turns: [{ user: "How much is a flight to Dubai?", toolsAnyOf: FLIGHT, orAsk: true }] },
  { id: "stay-pool", lang: "en", turns: [{ user: "A hotel in Dubai next weekend with a pool, just me", toolsAnyOf: ["search_stays"] }] },
  { id: "open-baku", lang: "en", turns: [{ user: "Is Baku nice in June?", notTools: ["search_flights", "create_request"] }] },
  { id: "off-topic", lang: "en", turns: [{ user: "Can you help me with my maths homework?", noTools: true }] },
  { id: "rude", lang: "en", turns: [{ user: "you are useless, stupid app", noTools: true }] },
  { id: "book-cheapest", lang: "en", turns: [{ user: "Flights to Istanbul for Eid, just me", toolsAnyOf: FLIGHT }, { user: "Book the cheapest one", toolsAnyOf: ["price_quote_for_pay"] }] },
  { id: "person", lang: "en", turns: [{ user: "I want to talk to a person please", toolsAnyOf: ["talk_to_human"] }] },
  { id: "stranded", lang: "en", turns: [{ user: "My flight to Cairo this morning was cancelled and I'm stuck at the airport", toolsAnyOf: ["talk_to_human", "get_trips", "get_trip"] }] },
  { id: "my-trips", lang: "en", turns: [{ user: "What trips do I have coming up?", toolsAnyOf: ["get_trips"] }] },
  { id: "tbilisi", lang: "en", turns: [{ user: "Flights to Tbilisi 3 to 10 December, just me", toolsAnyOf: FLIGHT }] },
  { id: "tbilisi-business", lang: "en", turns: [{ user: "Flights to Tbilisi 3 to 10 December, just me", toolsAnyOf: FLIGHT }, { user: "Make it business class", toolsAnyOf: FLIGHT, notAsk: /when|where/i }] },
  { id: "muscat-by-hand", lang: "en", turns: [{ user: "Flights to Muscat on 12 March for me", toolsAnyOf: ["create_request"], orAsk: true, notTools: FLIGHT }] },
  { id: "table", lang: "en", turns: [{ user: "A table for 4 somewhere good in Riyadh tonight", toolsAnyOf: ["create_request"], orAsk: true }] },
  { id: "baby-london", lang: "en", turns: [{ user: "Can my baby fly to London with us?", notTools: ["price_quote_for_pay"] }] },
  { id: "ar-family-eid", lang: "ar", turns: [{ user: "إسطنبول في العيد مع العائلة", toolsAnyOf: FLIGHT }] },
  { id: "ar-umrah-permit", lang: "ar", turns: [{ user: "عمرة في رمضان لي ولزوجتي عندي تصريح", toolsAnyOf: ["search_stays", "create_request"], orAsk: true, notAsk: /تصريح/ }] },
  { id: "ar-car-now", lang: "ar", turns: [{ user: "وصلت مطار إسطنبول أبغى سيارة الحين لتقسيم", toolsAnyOf: ["plan_car_now"] }] },
  { id: "ar-esim", lang: "ar", turns: [{ user: "شريحة نت لباكستان ١٠ أيام", toolsAnyOf: ["esim_plans"] }] },
  { id: "ar-visa-uk", lang: "ar", turns: [{ user: "أبغى فيزا بريطانيا لي ولزوجتي في ديسمبر", toolsAnyOf: ["entry_rules"], orAsk: true, notAsk: /مين/ }] },
  { id: "ar-stay-pool", lang: "ar", turns: [{ user: "فندق في دبي الويكند الجاي فيه مسبح لي بس", toolsAnyOf: ["search_stays"] }] },
  { id: "ar-person", lang: "ar", turns: [{ user: "أبي أكلم موظف", toolsAnyOf: ["talk_to_human"] }] },
  { id: "ar-correction", lang: "ar", turns: [{ user: "طيران لدبي الأسبوع الجاي لي بس", toolsAnyOf: FLIGHT }, { user: "لا، خلها لندن", toolsAnyOf: FLIGHT, notAsk: /متى/ }] },
  { id: "ar-off-topic", lang: "ar", turns: [{ user: "وش رأيك في الدوري السعودي؟", noTools: true }] },
  { id: "ar-rude", lang: "ar", turns: [{ user: "انتم فاشلين وما تفهمون", noTools: true }] },
  // Never open-ended, answer first, a default instead of a question (docs/app/ASSISTANT.md).
  { id: "thanks-close", lang: "en", turns: [{ user: "Thanks, that's all for now", noTools: true }] },
  { id: "default-dates", lang: "en", turns: [{ user: "Dubai in November, all of us", toolsAnyOf: ["search_flights", "search_stays"], notAsk: /when|date|who|how many/i }] },
  { id: "refund-where", lang: "en", turns: [{ user: "Where is my refund for the Cairo trip?", toolsAnyOf: ["get_trips", "get_trip", "talk_to_human", "create_request"], notTools: ["price_quote_for_pay"] }] },
  { id: "delay-rights", lang: "en", turns: [{ user: "My Cairo flight today is delayed 4 hours, what are my rights?", toolsAnyOf: ["get_trips", "get_trip", "talk_to_human"] }] },
  { id: "ar-thanks-close", lang: "ar", turns: [{ user: "مشكورين، كذا تمام", noTools: true }] },
  { id: "ar-default-dates", lang: "ar", turns: [{ user: "دبي في نوفمبر لنا كلنا", toolsAnyOf: ["search_flights", "search_stays"], notAsk: /متى|تاريخ|كم شخص|مين/ }] },
  // A hotel by name, any week of a month (staging: the generic London list came back instead of the Four Seasons).
  { id: "named-hotel", lang: "en", turns: [{ user: "Four season london, I need rates for one week anytime in November for me and Hessa", toolsAnyOf: ["search_stays"], inputHas: { tool: "search_stays", field: "hotel_name", match: /four season/i }, notAsk: /when|which dates|what dates/i }] },
  { id: "ar-named-hotel", lang: "ar", turns: [{ user: "فورسيزونز لندن أبي أسعار أسبوع أي وقت في نوفمبر لي ولزوجتي", toolsAnyOf: ["search_stays"], inputHas: { tool: "search_stays", field: "hotel_name", match: /four season/i }, notAsk: /متى|تاريخ|أي أسبوع/ }] },
  // Hotels anywhere in the world are searched instantly (a place without a key goes in `place`), never handed to the team first.
  { id: "stay-lahore", lang: "en", turns: [{ user: "Hotel in Lahore next weekend for 2", toolsAnyOf: ["search_stays"], notTools: ["create_request"], inputHas: { tool: "search_stays", field: "place", match: /lahore/i }, notAsk: /when|where/i }] },
  { id: "ar-stay-lahore", lang: "ar", turns: [{ user: "فندق في لاهور الويكند الجاي لشخصين", toolsAnyOf: ["search_stays"], notTools: ["create_request"], inputHas: { tool: "search_stays", field: "place", match: /lahore/i }, notAsk: /متى|وين/ }] },
  // Found by hand (docs/app/ASK-CHAT.md §Found by hand): what the team needs, confirmed, how to reach them, then the request.
  { id: "flights-by-request", lang: "en", flights: "request", turns: [
    { user: "Flights to Istanbul 3 to 10 December, just me", toolsAnyOf: FLIGHT, notTools: ["create_request", "price_quote_for_pay"], reachChips: true },
    { user: "WhatsApp", toolsAnyOf: ["create_request"], requestWithContact: true }] },
  { id: "ar-flights-by-request", lang: "ar", flights: "request", turns: [
    { user: "طيران لإسطنبول من ٣ إلى ١٠ ديسمبر لي بس", toolsAnyOf: FLIGHT, notTools: ["create_request"], reachChips: true },
    { user: "واتساب", toolsAnyOf: ["create_request"], requestWithContact: true }] },
  { id: "cruise", lang: "en", turns: [
    { user: "A Red Sea cruise for the four of us, 10 to 17 January", notTools: [...FLIGHT, "search_stays", "create_request"], reachChips: true },
    { user: "Call me, evenings after 7", toolsAnyOf: ["create_request"], requestWithContact: true }] },
  { id: "train-dammam", lang: "en", turns: [
    { user: "Train from Riyadh to Dammam next Thursday for me and Hessa", notTools: [...FLIGHT, "create_request"], reachChips: true },
    { user: "Here in the app", toolsAnyOf: ["create_request"], requestWithContact: true }] },
  { id: "company-group", lang: "en", turns: [
    { user: "A company trip to Dubai for 25 people, 3 to 6 February, with a meeting room", notTools: ["price_quote_for_pay", "create_request"], reachChips: true },
    { user: "WhatsApp", toolsAnyOf: ["create_request"], requestWithContact: true }] },
  // The living plan (docs/app/ASK-INTEGRATED.md §12) and "never say we don't do it" (§8.2).
  { id: "road-trip-sg-my", lang: "en", turns: [{ user: "7-day road trip from Singapore to Malaysia with Hessa", toolsAnyOf: ["create_plan"], notAsk: /where|when|how many days/i }] },
  { id: "start-jeddah", lang: "en", turns: [
    { user: "Plan a weekend in AlUla for me and Hessa", toolsAnyOf: ["create_plan"] },
    { user: "Start from Jeddah instead", toolsAnyOf: ["set_origin"], notTools: ["create_plan"], notAsk: /where/i }] },
  { id: "ar-road-trip", lang: "ar", turns: [{ user: "رحلة برية ٧ أيام من سنغافورة لماليزيا لي ولزوجتي", toolsAnyOf: ["create_plan"] }] },
  { id: "plan-car", lang: "en", turns: [
    { user: "7-day road trip from Singapore to Malaysia with Hessa", toolsAnyOf: ["create_plan"] },
    { user: "Book a car for the drives", toolsAnyOf: ["find_for_item", "create_request"], orAsk: true, notTools: ["price_quote_for_pay"], reachChips: true }] },
  { id: "rent-car-langkawi", lang: "en", turns: [{ user: "Rent a car in Langkawi for 3 days from 12 December", notTools: ["price_quote_for_pay", "create_request"], reachChips: true }] },
  { id: "driver-alula", lang: "en", turns: [{ user: "A driver for the day in AlUla on 20 November", notTools: ["price_quote_for_pay", "create_request"], reachChips: true }] },
  { id: "train-kl-penang", lang: "en", turns: [{ user: "Train from KL to Penang on 15 December for me and Hessa", notTools: ["search_flights", "create_request"], reachChips: true }] },
  { id: "ar-car-permit", lang: "ar", turns: [{ user: "أبي أدخل سنغافورة بسيارة مستأجرة من ماليزيا، وش أحتاج تصريح؟", notTools: ["price_quote_for_pay"], reachChips: true }] },
];

/** The cases for the living plan and "never no" (ASK-INTEGRATED.md §8.2): eight conversations. */
export const PLAN_EVAL_IDS = ["road-trip-sg-my", "start-jeddah", "ar-road-trip", "plan-car", "rent-car-langkawi", "driver-alula", "train-kl-penang", "ar-car-permit"];

/** "We don't do that" in a reply, in English or spoken Arabic. */
const SAYS_NO = /\b(?:we|mada) (?:don'?t|do not|can'?t|cannot) (?:offer|do|sell|arrange|book|provide|rent|have)\b|\b(?:is|are)n'?t (?:available|offered|possible)\b|\bnot (?:available|offered|possible)\b|ما نقدر|ما عندنا|ما نوفر|مو متوفر|غير متوفر|ما نسوي/i;
const DOES_IT = ["create_request", "open_in_app", "search_flights", "search_stays", "esim_plans", "create_plan", "update_plan", "find_for_item", "plan_car_now", "entry_rules", "talk_to_human"];

/** Choices said in the reply's last sentence ("…the Saudia at 09:40, or the flynas for less?"). */
const saysChoices = (text: string) => {
  const last = text.trim().split(/(?<=[.?؟])\s/).at(-1) ?? "";
  return /\bor\b|(?:^|\s)(?:ولا|أو)(?:\s|$)/i.test(last);
};

export type TurnVerdict = { case: string; lang: "en" | "ar"; turn: number; user: string; reply: string; next: string[]; nextFrom: "model" | "app"; tools: string[]; problems: string[]; costMicros: number; inTokens: number; outTokens: number; cacheRead: number; ms: number };

/** Words that mark spoken Saudi against Modern Standard Arabic, for a first read of a provider's dialect (a person reads the samples). */
const SPOKEN = ["وش", "الحين", "وين", "بس", "عشان", "مو", "تبي", "أبشر", "ابشر", "زين", "كذا", "لين", "حق", "شي", "يبي", "نبي", "بكرة", "ودك", "حيّاك", "حياك"];
const MSA = ["ماذا", "الآن", "أين", "لماذا", "سوف", "هل", "لكن", "حسناً", "حسنا", "يرجى", "نرجو", "بإمكانك", "تريد", "ليس", "لدينا", "الذي", "التي", "سيكون", "يمكنني", "أود"];
export function dialectOf(replies: string[]): { spoken: number; msa: number } {
  const words = replies.join(" ").replace(/[؟،.?!]/g, " ").split(/\s+/).map((w) => w.replace(/^(و|ف)(?=..)/, ""));
  return { spoken: words.filter((w) => SPOKEN.includes(w)).length, msa: words.filter((w) => MSA.includes(w)).length };
}

/** The checks for one turn. Pure. */
export function checkTurn(t: EvalTurn, lang: "en" | "ar", r: { raw: string; text: string; toolsUsed: string[]; toolText: string; dropped: number; modelChoices: string[]; closers: number; calls?: { name: string; input: Record<string, unknown> }[] }): string[] {
  const out: string[] = [];
  const invented = unbacked(r.raw, r.toolText);
  if (invented.length || r.dropped) out.push(`prices: ${invented.join(", ") || `${r.dropped} sentence(s) held back`}`);
  const q = questionsIn(r.text);
  if (q > 1) out.push(`one: ${q} questions`);
  const said = languageOfText(r.text);
  if (said && said !== lang) out.push(`lang: replied in ${said}`);
  const banned = outgoingProblems(r.raw);
  if (banned.length) out.push(`words: ${banned.join(", ")}`);
  if (t.noTools && r.toolsUsed.length) out.push(`tools: used ${r.toolsUsed.join(", ")}, wanted none`);
  if (t.toolsAnyOf && !t.toolsAnyOf.some((x) => r.toolsUsed.includes(x)) && !(t.orAsk && q === 1)) out.push(`tools: wanted one of ${t.toolsAnyOf.join("/")}, used ${r.toolsUsed.join(", ") || "none"}`);
  const bad = (t.notTools ?? []).filter((x) => r.toolsUsed.includes(x));
  if (bad.length) out.push(`tools: must not use ${bad.join(", ")}`);
  if (r.modelChoices.length < 2 && !saysChoices(r.text)) out.push(`next: no next step${r.modelChoices.length ? ` (only ${r.modelChoices.length} choice)` : ""}, the app filled chips in`);
  if (t.reachChips) {
    const c = r.modelChoices.join(" | ");
    if (!/whatsapp|واتساب/i.test(c) || !/call|اتصل/i.test(c)) out.push(`reach: didn't ask how to reach them (WhatsApp, a call, the app); chips: ${c || "none"}`);
  }
  if (t.requestWithContact) {
    const req = (r.calls ?? []).find((x) => x.name === "create_request");
    if (!req || !req.input.contact_preference) out.push(`reach: create_request without contact_preference`);
  }
  if (t.inputHas) {
    const want = t.inputHas;
    if (!(r.calls ?? []).some((x) => x.name === want.tool && want.match.test(String(x.input[want.field] ?? "")))) out.push(`input: ${want.tool} without ${want.field} ${want.match}`);
  }
  if (!t.noTools && SAYS_NO.test(r.raw) && !r.toolsUsed.some((x) => DOES_IT.includes(x)) && !/whatsapp|واتساب/i.test(r.modelChoices.join(" "))) out.push(`never-no: said we don't do it without a way it gets done`);
  const open = openEndedIn(r.raw);
  if (open.length || r.closers) out.push(`open: ${open.join(", ") || `${r.closers} closer(s) dropped`}`);
  const first = firstSentence(r.text);
  if (first.preamble) out.push(`first: starts with a preamble ("${first.text}")`);
  else if (first.question && !(t.orAsk && q === 1)) out.push(`first: starts with a question ("${first.text}")`);
  if (t.notAsk && q && t.notAsk.test(r.text.split(/(?<=[.?؟])\s/).filter((s) => /[?؟]/.test(s)).join(" "))) out.push(`asked again: ${t.notAsk}`);
  return out;
}

/** Run every case (or some) through the engine with fixture tools. */
export async function runEvals(api: ChatApi, opts: { only?: string[]; log?: (v: TurnVerdict) => void; model?: string; fastModel?: string; price?: Price | null } = {}): Promise<TurnVerdict[]> {
  const verdicts: TurnVerdict[] = [];
  const ctx: ToolCtx = { ownerId: SELF, people: EVAL_PEOPLE, today: EVAL_TODAY, lang: "en", ipHash: null, demo: new Set() };
  for (const c of EVAL_CASES.filter((x) => !opts.only?.length || opts.only.includes(x.id))) {
    const history: Anthropic.Beta.BetaMessageParam[] = [];
    for (const [i, turn] of c.turns.entries()) {
      const clean = redact(turn.user).text;
      let v: TurnVerdict | null = null;
      // A provider's rate limit waits and tries again (up to 3 times); in the app the same 429 means its own flows answer.
      for (let attempt = 0; !v; attempt++) {
        const started = Date.now();
        try {
          const slots = await readSlots(api, clean, EVAL_PEOPLE, EVAL_TODAY, opts.fastModel);
          const r = await runTurn({
            model: opts.model,
            intent: kindFor(clean, slots.intent.kind, history.some((m) => JSON.stringify(m.content).includes("create_plan"))),
            history: [...history], text: clean, lang: c.lang, tool: { ...ctx, lang: c.lang }, runTool: (name, input) => fixtureTool(name, input, c.flights),
            context: turnContext({ today: EVAL_TODAY, lang: c.lang, people: EVAL_PEOPLE, trips: TRIPS, onScreen: null, slots: slotsLine(slots.intent), household: (x) => personLine(x, EVAL_TODAY), text: clean }),
          }, () => {}, api);
          const ms = Date.now() - started;
          history.push(...r.added);
          const cost = opts.price ? costMicros("", r.usage, opts.price) + (slots.usage ? costMicros("", { input: slots.usage.input_tokens ?? 0, output: slots.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }, opts.price) : 0) : r.costMicros;
          v = { case: c.id, lang: c.lang, turn: i + 1, user: turn.user, reply: r.text, next: r.next, nextFrom: r.nextFrom, tools: r.toolsUsed, problems: checkTurn(turn, c.lang, r), costMicros: cost, inTokens: r.usage.input, outTokens: r.usage.output, cacheRead: r.usage.cacheRead, ms };
        } catch (e) {
          const limited = (e instanceof ProviderHttpError && e.status === 429) || (e instanceof Error && "status" in e && (e as { status?: number }).status === 429);
          if (limited && attempt < 3) {
            const wait = e instanceof ProviderHttpError && e.retryAfter ? e.retryAfter * 1000 : 5000 * 2 ** attempt;
            await new Promise((res) => setTimeout(res, Math.min(wait, 60_000)));
            continue;
          }
          // The app would fall back here: counted as a failed turn, and the conversation goes on.
          const why = e instanceof ToolInputError ? "tools: arguments still invalid after one repair (the app falls back)" : limited ? "rate: still rate limited after 3 waits" : `error: ${e instanceof Error ? e.message : String(e)}`;
          v = { case: c.id, lang: c.lang, turn: i + 1, user: turn.user, reply: "", next: [], nextFrom: "app", tools: [], problems: [why], costMicros: 0, inTokens: 0, outTokens: 0, cacheRead: 0, ms: Date.now() - started };
        }
      }
      verdicts.push(v);
      opts.log?.(v);
    }
  }
  return verdicts;
}

export type EvalSummary = {
  turns: number; passed: number; byCheck: Record<string, number>; conversations: number;
  medianMs: number; tokensPerConversation: number; costPerConversation: number; dialect: { spoken: number; msa: number }; arabicSamples: string[];
};

/** One provider's results, as a row of the comparison. */
export function summarise(v: TurnVerdict[]): EvalSummary {
  const byCheck: Record<string, number> = {};
  for (const x of v) for (const p of x.problems) { const k = p.split(":")[0]!; byCheck[k] = (byCheck[k] ?? 0) + 1; }
  const ms = v.map((x) => x.ms).sort((a, b) => a - b);
  const convs = new Set(v.map((x) => x.case)).size || 1;
  const ar = v.filter((x) => x.lang === "ar").map((x) => x.reply);
  return {
    turns: v.length, passed: v.filter((x) => !x.problems.length).length, byCheck, conversations: convs,
    medianMs: ms.length ? ms[Math.floor(ms.length / 2)]! : 0,
    tokensPerConversation: Math.round(v.reduce((s, x) => s + x.inTokens + x.cacheRead + x.outTokens, 0) / convs),
    costPerConversation: v.reduce((s, x) => s + x.costMicros, 0) / 1e6 / convs,
    dialect: dialectOf(ar), arabicSamples: ar.slice(0, 3),
  };
}
