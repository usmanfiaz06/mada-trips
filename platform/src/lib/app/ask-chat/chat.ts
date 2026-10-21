import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { languageOfText, t, todayIn, type AskChatEvent, type AskChatRequest, type AskIntent } from "@mada/shared";
import { AppError } from "../http";
import { householdOf } from "../booking/common";
import { hit } from "../circles/limits";
import { overview } from "../trips/overview";
import { askChatLimits, askChatModel, askChatOn, askFastModel, costMicros, noUsage } from "./config";
import { ToolInputError, chatApi, runTurn, turnContext, type ChatApi } from "./engine";
import { redact, screen } from "./guard";
import { ProviderHttpError } from "./providers-openai";
import { nextFromState } from "./next";
import { readSlots, slotsLine } from "./slots";
import { appendTurn, addSpend, attachTrip, loadThread, newThread, primaryThreadOf, saveFold, spentToday, tripOfEnded, type Thread } from "./store";
import { askAttach, ownTrip, tripFor, tripTitleOf } from "./attach";
import { nextTitle, titleFrom } from "./titles";
import { foldThread, historyOf, needsFold } from "./fold";
import { MEMORY_HEAD, consentOf, memoryBlock } from "./memory";
import { personLine, type ToolCtx } from "./tools";
import { markPlanSeen, planContext, planTitleFor } from "./tools-plan";
import { kindFor } from "./prompt";
import { keepForAgent } from "./takeover";
import { attachmentsContext } from "./attachments";

/*
 * POST /ask/chat, before and after the model: the switch, limits and the daily spend cap (all checked before a
 * stream opens, so the app falls back to its own flows on a plain error), then moderation and redaction of what was
 * typed, the thread, the context (today, household, trips, the slots read from the sentence), the turn, and the log:
 * tokens and cost per thread, never message bodies.
 */

export type ChatAuth = { userId: string; ipHash: string | null };

/** The checks that answer with a plain error before any stream opens. */
export async function preflight(auth: ChatAuth): Promise<void> {
  if (!askChatOn()) throw new AppError("NOT_CONFIGURED");
  const lim = askChatLimits();
  await hit(`askchat:min:${auth.userId}`, lim.perMinute, 60);
  await hit(`askchat:day:${auth.userId}`, lim.perDay, 86_400);
  const spent = await spentToday(auth.userId);
  if (spent.mine >= lim.userDailyMicros || spent.all >= lim.dailyMicros) throw new AppError("RATE_LIMITED", { retryAfter: 3600, details: { budget: true } });
}

export async function chatTurn(auth: ChatAuth, req: AskChatRequest, emit: (e: AskChatEvent) => void, signal?: AbortSignal, given?: ChatApi): Promise<void> {
  const typed = String(req.text ?? "").trim();
  const lang = languageOfText(typed) ?? "en";
  const today = todayIn();
  let thread = await loadThread(auth.userId, req.threadId);
  // Which chat this goes in (ASK-INTEGRATED.md §2.2): the one asked for; from the trip page, that trip's own chat (or a
  // new one about it); after "Yes, that trip", the trip's chat; a full chat's trip carries over to the new one.
  const onTrip = req.tripId ? await ownTrip(auth.userId, req.tripId) : null;
  let moved = false;
  let early: Awaited<ReturnType<typeof readSlots>> | null = null;
  let api: ChatApi | null = given ?? null;
  if (!thread) {
    const primary = onTrip && req.attach !== "new" ? await primaryThreadOf(auth.userId, onTrip.id) : null;
    if (primary) { thread = primary; moved = req.attach === "trip"; }
    else if (!onTrip && !req.attach && screen(typed).ok) {
      // A first message about a place they already have a trip to: asked once, never attached silently.
      api ??= await chatApi();
      early = await readSlots(api, redact(typed).text, await householdOf(auth.userId), today);
      const match = await tripFor(auth.userId, early.intent, today);
      if (match) return askAttach(auth.userId, match, early, lang, emit);
    }
    thread ??= await newThread(auth.userId, lang, onTrip?.id ?? (await tripOfEnded(auth.userId, req.threadId)));
  } else if (onTrip && !thread.tripId && thread.turns === 0) {
    await attachTrip(auth.userId, thread.id, onTrip.id);
    thread.tripId = onTrip.id;
  }
  emit({ type: "thread", threadId: thread.id, lang, tripId: thread.tripId, ...(moved ? { moved: true } : {}) });
  // A person on the desk has this thread (takeover.ts): the message is theirs to answer, the model stays out.
  if (thread.mode === "agent") return keepForAgent(auth.userId, thread, typed, emit);
  api ??= await chatApi();
  // A long thread: the older turns folded into a summary first, so every turn stays cheap (fold.ts).
  let foldCost = 0;
  if (needsFold(thread)) {
    const f = await foldThread(api, thread, askFastModel());
    await saveFold(auth.userId, thread.id, f);
    Object.assign(thread, { messages: f.messages, summary: f.summary, foldedTurns: thread.foldedTurns + f.folded });
    if (f.usage) foldCost = costMicros(askFastModel(), { input: f.usage.input_tokens ?? 0, output: f.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 });
    console.info(`[ask-chat] thread=${thread.id} folded=${f.folded} by=${f.by} kept=${f.messages.length}`);
  }

  // Abuse and scams get a fixed calm line and never reach the model.
  const screened = screen(typed);
  if (!screened.ok) {
    const line = t("chat.abuse", undefined, lang);
    emit({ type: "replace", text: line });
    // Even here the reply ends with a next step (docs/app/ASSISTANT.md).
    emit({ type: "next", choices: nextFromState({ cards: [], pay: false, handoff: false, lang }) });
    emit({ type: "done", text: line });
    await appendTurn(auth.userId, thread.id, { messages: [], transcript: [{ who: "mada", text: line, held: screened.reason }], usage: noUsage(), costMicros: 0, lang });
    console.info(`[ask-chat] thread=${thread.id} held=${screened.reason}`);
    return;
  }

  const { text: clean, redacted } = redact(typed);
  const [people, trips] = await Promise.all([householdOf(auth.userId), overview(auth.userId, null).catch(() => null)]);
  const slots = early ?? (await readSlots(api, clean, people, today));
  emit({ type: "intent", intent: slots.intent });
  const tripLines = (trips?.upcoming ?? []).slice(0, 5).map((tr) => `id=${tr.id} · ${tr.city} · ${tr.startDate}${tr.endDate ? ` to ${tr.endDate}` : ""} · ${tr.travellerNames.join(", ")}`);
  const onScreen = req.tripId ? tripLines.find((l) => l.startsWith(`id=${req.tripId}`)) ?? null : null;

  const history = historyOf(thread.messages, thread.summary);
  // What Mada knows from before: once per thread (the history carries it after that), and again after a fold.
  const known = JSON.stringify(thread.messages).includes(MEMORY_HEAD);
  const taken = (trips?.past ?? []).filter((tr) => tr.status !== "cancelled").map((tr) => `${tr.city} ${tr.startDate.slice(0, 7)}`);
  const memory = known ? null : await memoryBlock(auth.userId, { kind: slots.intent.kind, taken });
  // A chat about a trip with a plan: its id and version, and what the traveller or the desk changed meanwhile (§3.6).
  const planned = await planContext(auth.userId, thread.tripId).catch(() => ({ lines: [] as string[], seen: [] as string[] }));
  const tool: ToolCtx = { ownerId: auth.userId, people, today, lang, ipHash: auth.ipHash, demo: new Set(), consent: consentOf(history, clean), threadId: thread.id, tripId: thread.tripId };

  const r = await runTurn({
    history,
    text: clean,
    // After the desk's Hand back, what was said meanwhile rides in this turn's context once (takeover.ts handBackNote).
    // Documents sent in this chat, as their cards say them (attachments.ts): never a number or a line of the MRZ.
    context: [turnContext({ today, lang, people, trips: tripLines, onScreen, slots: slotsLine(slots.intent), household: (p) => personLine(p, today), memory }), ...planned.lines, thread.deskNote, await attachmentsContext(auth.userId, thread.id)].filter(Boolean).join("\n"),
    lang,
    tool,
    intent: kindFor(clean, slots.intent.kind, planned.lines.length > 0),
    signal,
  }, emit, api);

  const fastCost = slots.usage ? costMicros(askFastModel(), { input: slots.usage.input_tokens ?? 0, output: slots.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }) : 0;
  const total = r.costMicros + fastCost + foldCost;
  await markPlanSeen(auth.userId, thread.tripId, planned.seen).catch(() => {});
  // A plan made this turn attached the chat to its trip (tools-plan.ts): the title follows the plan from now on.
  if (tool.tripId && tool.tripId !== thread.tripId) thread.tripId = tool.tripId;
  await appendTurn(auth.userId, thread.id, {
    messages: r.added,
    transcript: [{ who: "me", text: clean }, { who: "mada", text: r.text, cards: r.cards.map((c) => c.type), next: r.next }],
    usage: r.usage, costMicros: total, lang, handedOff: r.toolsUsed.includes("talk_to_human"),
    title: await titleAfter(auth.userId, thread, slots.intent, clean, lang),
  });
  await addSpend(auth.userId, total);
  // Tokens and cost only: no words from either side.
  console.info(`[ask-chat] thread=${thread.id} turn=${thread.turns + 1} model=${askChatModel()} in=${r.usage.input} out=${r.usage.output} cache_read=${r.usage.cacheRead} cache_write=${r.usage.cacheWrite} usd=${(total / 1e6).toFixed(5)} tools=${r.toolsUsed.join(",") || "-"} stop=${r.stop} next=${r.nextFrom}${redacted ? ` redacted=${redacted}` : ""}`);
  emit({ type: "done", text: r.text });
}

/** The title after this turn (titles.ts), or null to keep the one it has. */
async function titleAfter(ownerId: string, thread: Thread, intent: AskIntent, words: string, lang: string) {
  // "Riyadh → Singapore → Penang · 12–18 Dec": a trip with a plan is titled by its route, start first (§2.3).
  const planned = await planTitleFor(ownerId, thread.tripId, lang === "ar" ? "ar" : "en").catch(() => null);
  if (planned) return nextTitle({ title: thread.title, by: thread.titledBy }, { title: planned, by: "trip" });
  const trip = thread.tripId ? await tripTitleOf(ownerId, thread.tripId) : null;
  return nextTitle({ title: thread.title, by: thread.titledBy }, titleFrom({ intent, trip, words, lang: lang === "ar" ? "ar" : "en" }));
}

/** An SDK error as the code the app sees. Every one of them means: answer with the app's own flows. */
export function errorCode(e: unknown): string {
  if (e instanceof Anthropic.RateLimitError) return "RATE_LIMITED";
  if (e instanceof Anthropic.AuthenticationError || e instanceof Anthropic.PermissionDeniedError) return "NOT_CONFIGURED";
  if (e instanceof Anthropic.APIConnectionTimeoutError) return "TIMEOUT";
  if (e instanceof Anthropic.APIConnectionError) return "SUPPLIER_UNAVAILABLE";
  if (e instanceof Anthropic.InternalServerError) return "SUPPLIER_DOWN";
  if (e instanceof Anthropic.BadRequestError) return "INTERNAL";
  if (e instanceof Anthropic.APIError) return "SUPPLIER_UNAVAILABLE";
  if (e instanceof ProviderHttpError) return e.status === 429 ? "RATE_LIMITED" : e.status === 401 || e.status === 403 ? "NOT_CONFIGURED" : "SUPPLIER_UNAVAILABLE";
  if (e instanceof ToolInputError) return "TOOL_INPUT";
  if (e instanceof AppError) return e.code;
  return "INTERNAL";
}
