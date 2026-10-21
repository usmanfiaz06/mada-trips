import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { db } from "@/db";
import { appAskSpend, appAskThreads } from "@/db/app-schema-ask";
import { todayIn } from "@mada/shared";
import type { Usage } from "./config";

/*
 * Threads and spend. A thread is the model's own history, append-only between folds, so a later turn replays every
 * earlier block byte for byte (prompt cache and preserved thinking both depend on that). Once it passes its token
 * budget the older turns are folded into a summary (fold.ts, saveFold), so long threads stay cheap. Past MAX_TURNS the
 * next message starts a new thread, and the app shows the earlier one as finished above it.
 */

export const MAX_TURNS = 60;

export type Thread = { id: string; messages: unknown[]; transcript: unknown[]; turns: number; lang: string; summary: string | null; foldedTurns: number };

export async function loadThread(ownerId: string, threadId: string | null | undefined): Promise<Thread | null> {
  if (!threadId) return null;
  const [row] = await db.select().from(appAskThreads).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId))).limit(1);
  if (!row || row.turns >= MAX_TURNS) return null;
  return { id: row.id, messages: row.messages, transcript: row.transcript, turns: row.turns, lang: row.lang, summary: row.summary, foldedTurns: row.foldedTurns };
}

export async function newThread(ownerId: string, lang: string): Promise<Thread> {
  const [row] = await db.insert(appAskThreads).values({ ownerId, lang }).returning({ id: appAskThreads.id });
  return { id: row!.id, messages: [], transcript: [], turns: 0, lang, summary: null, foldedTurns: 0 };
}

/** The older turns folded (fold.ts): the kept messages replace the history, the summary stands for the rest. */
export async function saveFold(ownerId: string, threadId: string, f: { messages: unknown[]; summary: string; folded: number }) {
  await db.update(appAskThreads).set({
    messages: f.messages,
    summary: f.summary,
    foldedTurns: sql`${appAskThreads.foldedTurns} + ${f.folded}`,
    updatedAt: new Date(),
  }).where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
}

/** Append one turn: the new model messages, the transcript lines, the tokens and the cost. */
export async function appendTurn(ownerId: string, threadId: string, add: { messages: unknown[]; transcript: unknown[]; usage: Usage; costMicros: number; lang: string }) {
  await db.update(appAskThreads).set({
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
