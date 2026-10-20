import { languageOfText, type Person } from "@mada/shared";
import { type ChatApi, runTurn, turnContext } from "./engine";
import { outgoingProblems, questionsIn, redact, unbacked } from "./guard";
import { readSlots, slotsLine } from "./slots";
import { personLine, type ToolCtx, type ToolOut } from "./tools";
import type Anthropic from "@anthropic-ai/sdk";

/*
 * The conversation's eval set (docs/app/ASK-CHAT.md §Evals): 30 conversations in English and spoken Saudi Arabic,
 * run turn by turn through the real engine (the same prompt, tools, gate and slots) with fixed tool results, so the
 * checks are about the model and nothing else. Each turn is held to:
 *   prices   the model wrote no price or time that no tool returned (checked on its raw words, before the gate)
 *   one      at most one question
 *   lang     the reply's language is the traveller's
 *   tools    the tools it should reach for (any of a list), and none it must not
 *   words    no banned words
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
export async function fixtureTool(name: string, input: unknown): Promise<ToolOut> {
  const a = (input ?? {}) as Record<string, unknown>;
  const n = Array.isArray(a.traveller_ids) && a.traveller_ids.length ? a.traveller_ids.length : 1;
  const each = 2025;
  const fmt = (x: number) => `SAR ${x.toLocaleString("en-US")}`;
  switch (name) {
    case "search_flights": {
      const dest = String(a.destination);
      if (a.cabin === "business") return { text: `Flights RUH → ${dest}, ${a.depart}, checked 9, for ${n} people:\n1. id=f-biz-1 · best · Saudia · out SV263 RUH 09:40 → IST 13:10 on ${a.depart} (4h30m) · direct · bags 2 x 32 kg · refundable · ${fmt(7900 * n)} all in for ${n} (${fmt(7900)} each adult) · why: Direct. Flat bed.` };
      return { text: `Flights RUH → ${dest}, ${a.depart}${a.return ? ` to ${a.return}` : " one way"}, checked 14, for ${n} people:\n1. id=f-1 · best · Saudia · out SV263 RUH 09:40 → ${dest.slice(0, 3).toUpperCase()} 13:10 on ${a.depart} (4h30m) · direct · bags 2 x 23 kg · not refundable · ${fmt(each * n)} all in for ${n} (${fmt(each)} each adult) · why: Direct. Lands before check-in.\n2. id=f-2 · lowest · flynas · out XY125 RUH 02:15 → ${dest.slice(0, 3).toUpperCase()} 08:05 on ${a.depart} (6h50m) · One stop in Kuwait · bags 1 x 20 kg · not refundable · ${fmt(1610 * n)} all in for ${n} (${fmt(1610)} each adult) · why: One stop. SAR ${(415 * n).toLocaleString("en-US")} less.\n3. id=f-3 · fastest · Turkish Airlines · out TK145 RUH 14:20 → ${dest.slice(0, 3).toUpperCase()} 18:15 on ${a.depart} (4h55m) · direct · bags 2 x 23 kg · refundable · ${fmt(2390 * n)} all in for ${n} (${fmt(2390)} each adult) · why: Refundable.` };
    }
    case "search_stays":
      return { text: `Stays in ${a.destination}, ${a.nights} nights from ${a.check_in}, for ${n} people:\n1. id=s-1 · hotel_code=9001 · Rove Downtown · Downtown · 3 stars · 1 room for ${n} · ${a.nights} nights from ${a.check_in} · ${fmt(1840)} all in · free cancellation until ${a.check_in} · has pool, wifi\n2. id=s-2 · hotel_code=9002 · Address Sky View · Downtown · 5 stars · 1 room for ${n} · ${fmt(5260)} all in · not refundable · has pool, gym, spa` };
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
      return { text: `Request r-1 sent to the desk: ${String(a.kind)} (${String(a.summary).slice(0, 80)}). Mada answers by 2026-10-20T18:00:00+03:00.` };
    case "price_quote_for_pay":
      return { text: `Pay sheet opened in the app: Riyadh → Istanbul, ${fmt(each * n)} all in. Free to cancel within 24 hours. Nothing is charged until the traveller slides to pay.`, pay: { draft: { kind: "trip", flightOfferId: SELF, bundle: false, travellerIds: [SELF] }, title: "Riyadh → Istanbul" } };
    case "talk_to_human":
      return { text: "Handed to the desk: Noura is on duty and has the summary. Say that Noura at Mada can take it from here, in one sentence.", handoff: { threadId: SELF, agent: "Noura" } };
    default:
      return { text: `There is no tool called ${name}.`, isError: true };
  }
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
};
export type EvalCase = { id: string; lang: "en" | "ar"; turns: EvalTurn[] };

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
];

export type TurnVerdict = { case: string; turn: number; user: string; reply: string; tools: string[]; problems: string[]; costMicros: number; inTokens: number; outTokens: number; cacheRead: number };

/** The checks for one turn. Pure. */
export function checkTurn(t: EvalTurn, lang: "en" | "ar", r: { raw: string; text: string; toolsUsed: string[]; toolText: string; dropped: number }): string[] {
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
  if (t.notAsk && q && t.notAsk.test(r.text.split(/(?<=[.?؟])\s/).filter((s) => /[?؟]/.test(s)).join(" "))) out.push(`asked again: ${t.notAsk}`);
  return out;
}

/** Run every case (or some) through the engine with fixture tools. */
export async function runEvals(api: ChatApi, opts: { only?: string[]; log?: (v: TurnVerdict) => void } = {}): Promise<TurnVerdict[]> {
  const verdicts: TurnVerdict[] = [];
  const ctx: ToolCtx = { ownerId: SELF, people: EVAL_PEOPLE, today: EVAL_TODAY, lang: "en", ipHash: null, demo: new Set() };
  for (const c of EVAL_CASES.filter((x) => !opts.only?.length || opts.only.includes(x.id))) {
    const history: Anthropic.Beta.BetaMessageParam[] = [];
    for (const [i, turn] of c.turns.entries()) {
      const clean = redact(turn.user).text;
      const slots = await readSlots(api, clean, EVAL_PEOPLE, EVAL_TODAY);
      const r = await runTurn({
        history: [...history], text: clean, lang: c.lang, tool: { ...ctx, lang: c.lang }, runTool: (name, input) => fixtureTool(name, input),
        context: turnContext({ today: EVAL_TODAY, lang: c.lang, people: EVAL_PEOPLE, trips: TRIPS, onScreen: null, slots: slotsLine(slots.intent), household: (x) => personLine(x, EVAL_TODAY) }),
      }, () => {}, api);
      history.push(...r.added);
      const v: TurnVerdict = { case: c.id, turn: i + 1, user: turn.user, reply: r.text, tools: r.toolsUsed, problems: checkTurn(turn, c.lang, r), costMicros: r.costMicros, inTokens: r.usage.input, outTokens: r.usage.output, cacheRead: r.usage.cacheRead };
      verdicts.push(v);
      opts.log?.(v);
    }
  }
  return verdicts;
}
