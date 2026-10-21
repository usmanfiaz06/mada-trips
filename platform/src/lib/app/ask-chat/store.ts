import "server-only";
import { and, asc, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { appAskSpend, appAskThreads } from "@/db/app-schema-ask";
import { todayIn } from "@mada/shared";
import type { Usage } from "./config";
import { previewOf, type TitleBy } from "./titles";

/*
 * Threads and spend. A thread is the model's own history, append-only between folds, so a later turn replays every
 * earlier block byte for byte (prompt cache and preserved thinking both depend on that). Once it passes its token
 * budget the older turns are folded into a summary (fold.ts, saveFold), so long threads stay cheap. Past MAX_TURNS the
 * next message starts a new thread, and the app shows the earlier one as finished above it.
 */

export const MAX_TURNS = 60;

export type Thread = {
  id: string; messages: unknown[]; transcript: unknown[]; turns: number; lang: string; summary: string | null; foldedTurns: number;
  /** "agent" while a person on the desk has it (takeover.ts): the model doesn't run. */
  mode: string; takenBy: string | null;
  /** What happened while a person had it, read once by the next turn after Hand back. */
  deskNote: string | null;
  /** The conversations list (ASK-INTEGRATED.md §2): the trip it's about, and its title and how that was made. */
  tripId: string | null; title: string | null; titledBy: string | null;
  /** private, or trip: the shared trip chat (trip-chat.ts), whose owner is the trip's owner. */
  kind: string; ownerId: string;
};

type Row = typeof appAskThreads.$inferSelect;
const threadOf = (row: Row): Thread => ({
  id: row.id, messages: row.messages, transcript: row.transcript, turns: row.turns, lang: row.lang, summary: row.summary, foldedTurns: row.foldedTurns,
  mode: row.mode, takenBy: row.takenBy, deskNote: row.deskNote, tripId: row.tripId, title: row.title, titledBy: row.titledBy,
  kind: row.kind, ownerId: row.ownerId,
});

/** A row as a thread, for the trip chat (trip-chat.ts sharedThreadRow decided the caller may use it). */
export const asThread = (row: Row): Thread | null => (row.turns >= MAX_TURNS && row.mode !== "agent" ? null : threadOf(row));

export async function loadThread(ownerId: string, threadId: string | null | undefined): Promise<Thread | null> {
  if (!threadId) return null;
  const [row] = await db.select().from(appAskThreads).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId))).limit(1);
  // A thread a person has taken over stays theirs, however long.
  if (!row || (row.turns >= MAX_TURNS && row.mode !== "agent")) return null;
  return threadOf(row);
}

/** The trip a full (ended) thread was about, so the chat that continues it carries the trip over. */
export async function tripOfEnded(ownerId: string, threadId: string | null | undefined): Promise<string | null> {
  if (!threadId) return null;
  const [row] = await db.select({ tripId: appAskThreads.tripId, turns: appAskThreads.turns }).from(appAskThreads)
    .where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId))).limit(1);
  return row && row.turns >= MAX_TURNS ? row.tripId : null;
}

/** A trip's own chat: the oldest one about it that isn't archived or full (ASK-INTEGRATED.md §2.2). */
export async function primaryThreadOf(ownerId: string, tripId: string): Promise<Thread | null> {
  const [row] = await db.select().from(appAskThreads)
    .where(and(eq(appAskThreads.ownerId, ownerId), eq(appAskThreads.tripId, tripId), isNull(appAskThreads.archivedAt), isNull(appAskThreads.endedAt)))
    .orderBy(asc(appAskThreads.createdAt)).limit(1);
  return row ? threadOf(row) : null;
}

export async function newThread(ownerId: string, lang: string, tripId: string | null = null): Promise<Thread> {
  const [row] = await db.insert(appAskThreads).values({ ownerId, lang, tripId }).returning({ id: appAskThreads.id });
  return { id: row!.id, messages: [], transcript: [], turns: 0, lang, summary: null, foldedTurns: 0, mode: "ai", takenBy: null, deskNote: null, tripId, title: null, titledBy: null, kind: "private", ownerId };
}

/** The chat is about this trip from now on (a trip-page chat, or "Yes, that trip"). */
export async function attachTrip(ownerId: string, threadId: string, tripId: string) {
  await db.update(appAskThreads).set({ tripId }).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
}

/** What every new line does to the list: it moves to the top, shows this line, and comes back from the archive. */
const listed = (text: string | null | undefined, now = new Date()) => {
  const preview = text ? previewOf(text) : null;
  return { lastAt: now, archivedAt: null, ...(preview ? { preview } : {}) };
};

/** The older turns folded (fold.ts): the kept messages replace the history, the summary stands for the rest. */
export async function saveFold(ownerId: string, threadId: string, f: { messages: unknown[]; summary: string; folded: number }) {
  await db.update(appAskThreads).set({
    messages: f.messages,
    summary: f.summary,
    foldedTurns: sql`${appAskThreads.foldedTurns} + ${f.folded}`,
    updatedAt: new Date(),
  }).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
}

/**
 * Append one turn: the new model messages, the transcript lines, the tokens and the cost. handedOff: the model passed
 * it to the desk this turn (talk_to_human). Any note from the desk's Hand back was read by this turn and is cleared.
 */
export async function appendTurn(ownerId: string, threadId: string, add: { messages: unknown[]; transcript: unknown[]; usage: Usage; costMicros: number; lang: string; handedOff?: boolean; title?: { title: string; by: TitleBy } | null }) {
  const last = [...add.transcript].reverse().find((l) => typeof (l as { text?: unknown })?.text === "string" && (l as { text: string }).text.trim()) as { text: string } | undefined;
  await db.update(appAskThreads).set({
    ...(add.handedOff ? { handedOffAt: new Date() } : {}),
    ...listed(last?.text),
    ...(add.title ? { title: add.title.title, titledBy: add.title.by } : {}),
    // Full: the list offers to continue in a new chat (a taken-over thread stays the desk's, however long).
    endedAt: sql`CASE WHEN ${appAskThreads.turns} + 1 >= ${MAX_TURNS} AND ${appAskThreads.mode} <> 'agent' THEN now() ELSE NULL END`,
    deskNote: null,
    messages: sql`${appAskThreads.messages} || ${JSON.stringify(add.messages)}::jsonb`,
    transcript: sql`${appAskThreads.transcript} || ${JSON.stringify(add.transcript)}::jsonb`,
    lang: add.lang,
    turns: sql`${appAskThreads.turns} + 1`,
    inputTokens: sql`${appAskThreads.inputTokens} + ${add.usage.input}`,
    outputTokens: sql`${appAskThreads.outputTokens} + ${add.usage.output}`,
    cacheReadTokens: sql`${appAskThreads.cacheReadTokens} + ${add.usage.cacheRead}`,
    cacheWriteTokens: sql`${appAskThreads.cacheWriteTokens} + ${add.usage.cacheWrite}`,
    costMicros: sql`${appAskThreads.costMicros} + ${add.costMicros}`,
    updatedAt: new Date(),
  }).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
}

/** A line kept without a turn (the traveller writing while a person has the thread): the transcript only. */
export async function appendLine(ownerId: string, threadId: string, line: unknown) {
  await db.update(appAskThreads).set({
    ...listed((line as { text?: string })?.text),
    transcript: sql`${appAskThreads.transcript} || ${JSON.stringify([line])}::jsonb`,
    updatedAt: new Date(),
  }).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
}

/**
 * A line kept in a thread whoever owns it: the trip chat (its owner is the trip's owner, and anyone on the trip writes
 * in it) and the lines a change request adds there. Server-side only; callers decided who may write.
 */
export async function appendLineTo(threadId: string, line: unknown) {
  await db.update(appAskThreads).set({
    ...listed((line as { text?: string })?.text),
    transcript: sql`${appAskThreads.transcript} || ${JSON.stringify([line])}::jsonb`,
    updatedAt: new Date(),
  }).where(eq(appAskThreads.id, threadId));
}

const day = () => todayIn();

/** Spent today: this person and everyone, in micro-dollars. */
export async function spentToday(ownerId: string): Promise<{ mine: number; all: number }> {
  const rows = await db.select({ key: appAskSpend.ownerKey, cost: appAskSpend.costMicros }).from(appAskSpend)
    .where(and(eq(appAskSpend.day, day()), sql`${appAskSpend.ownerKey} IN (${ownerId}, 'all')`));
  return { mine: rows.find((r) => r.key === ownerId)?.cost ?? 0, all: rows.find((r) => r.key === "all")?.cost ?? 0 };
}

export async function addSpend(ownerId: string, micros: number): Promise<void> {
  const d = day();
  for (const key of [ownerId, "all"]) {
    await db.insert(appAskSpend).values({ day: d, ownerKey: key, costMicros: micros, turns: 1 })
      .onConflictDoUpdate({ target: [appAskSpend.day, appAskSpend.ownerKey], set: { costMicros: sql`${appAskSpend.costMicros} + ${micros}`, turns: sql`${appAskSpend.turns} + 1` } });
  }
}
