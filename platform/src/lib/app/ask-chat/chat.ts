import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import { languageOfText, t, todayIn, type AskChatEvent, type AskChatRequest } from "@mada/shared";
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
import { appendTurn, addSpend, loadThread, newThread, spentToday } from "./store";
import { personLine } from "./tools";

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
  const api = given ?? (await chatApi());
  const typed = String(req.text ?? "").trim();
  const lang = languageOfText(typed) ?? "en";
  const today = todayIn();
  const thread = (await loadThread(auth.userId, req.threadId)) ?? (await newThread(auth.userId, lang));
  emit({ type: "thread", threadId: thread.id, lang });

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
  const slots = await readSlots(api, clean, people, today);
  emit({ type: "intent", intent: slots.intent });
  const tripLines = (trips?.upcoming ?? []).slice(0, 5).map((tr) => `id=${tr.id} · ${tr.city} · ${tr.startDate}${tr.endDate ? ` to ${tr.endDate}` : ""} · ${tr.travellerNames.join(", ")}`);
  const onScreen = req.tripId ? tripLines.find((l) => l.startsWith(`id=${req.tripId}`)) ?? null : null;

  const r = await runTurn({
    history: thread.messages as Anthropic.Beta.BetaMessageParam[],
    text: clean,
    context: turnContext({ today, lang, people, trips: tripLines, onScreen, slots: slotsLine(slots.intent), household: (p) => personLine(p, today) }),
    lang,
    tool: { ownerId: auth.userId, people, today, lang, ipHash: auth.ipHash, demo: new Set() },
    signal,
  }, emit, api);

  const fastCost = slots.usage ? costMicros(askFastModel(), { input: slots.usage.input_tokens ?? 0, output: slots.usage.output_tokens ?? 0, cacheRead: 0, cacheWrite: 0 }) : 0;
  const total = r.costMicros + fastCost;
  await appendTurn(auth.userId, thread.id, {
    messages: r.added,
    transcript: [{ who: "me", text: clean }, { who: "mada", text: r.text, cards: r.cards.map((c) => c.type), next: r.next }],
    usage: r.usage, costMicros: total, lang,
  });
  await addSpend(auth.userId, total);
  // Tokens and cost only: no words from either side.
  console.info(`[ask-chat] thread=${thread.id} turn=${thread.turns + 1} model=${askChatModel()} in=${r.usage.input} out=${r.usage.output} cache_read=${r.usage.cacheRead} cache_write=${r.usage.cacheWrite} usd=${(total / 1e6).toFixed(5)} tools=${r.toolsUsed.join(",") || "-"} stop=${r.stop} next=${r.nextFrom}${redacted ? ` redacted=${redacted}` : ""}`);
  emit({ type: "done", text: r.text });
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
