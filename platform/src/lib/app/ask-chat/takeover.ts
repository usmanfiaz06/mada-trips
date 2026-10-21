import "server-only";
import { and, eq } from "drizzle-orm";
import type { AskChatEvent, AskDeskLine, AskDeskResponse } from "@mada/shared";
import { db } from "@/db";
import { appAskThreads } from "@/db/app-schema-ask";
import { redact, screen } from "./guard";
import { appendLine, type Thread } from "./store";

/*
 * A person on the desk takes an Ask thread over (desk/ask, DESK-PLAN.md U5). While they have it the model never runs:
 * what the traveller writes is kept in the transcript for the desk, and the person's replies are transcript lines the
 * app reads from GET /ask/chat/desk. The traveller sees "Noura from Mada joined" once, then Noura's words as hers. Hand
 * back leaves a note the model reads on its next turn, so Mada knows what was said meanwhile.
 *
 * Transcript lines, beside the model's own ("me" and "mada"):
 *   { who: "agent", text, by, byAr, agentId, opsUserId, at }       a reply from the desk
 *   { who: "system", event: "joined", by, byAr, pronoun, at }       the person joined (shown to the traveller once)
 *   { who: "system", event: "handed_back", by, at }                 back to Mada (desk only)
 */

export type AgentLine = { who: "agent"; text: string; by: string; byAr: string | null; agentId: string; opsUserId: string; at: string };
export type SystemLine = { who: "system"; event: "joined" | "handed_back"; by: string; byAr?: string | null; pronoun?: string; at: string };
/** attachment: a document sent in the chat, by its masked label only (attachments.ts). */
export type TravellerLine = { who: "me"; text: string; at?: string; held?: string; attachment?: { kind: string; label: string }; /** In a trip chat: who wrote it (user id) and their first name. */ by?: string; name?: string | null };
/** kept: reference cards kept whole with a line Mada adds on her own (a change asked by a companion, trips/change-requests.ts). */
export type MadaLine = { who: "mada"; text: string; cards?: string[]; next?: string[]; held?: string; kept?: unknown[]; at?: string };
export type AskLine = TravellerLine | MadaLine | AgentLine | SystemLine;

/** The name the traveller reads: the Arabic one in Arabic when the agent has one. */
export const nameIn = (l: { by: string; byAr?: string | null }, lang: string) => (lang === "ar" && l.byAr ? l.byAr : l.by);

/** "Noura from Mada joined", in the traveller's language (Arabic agrees with the person). */
export function joinedText(name: string, pronoun: string | undefined, lang: string): string {
  if (lang === "ar") return `${pronoun === "she" ? "انضمّت" : "انضمّ"} ${name} من مادا`;
  return `${name} from Mada joined`;
}

/** The traveller wrote while a person has the thread: kept for the desk, no model, the stream says who has it. */
export async function keepForAgent(ownerId: string, thread: Thread, typed: string, emit: (e: AskChatEvent) => void, now = new Date()): Promise<void> {
  const screened = screen(typed);
  const { text } = redact(typed);
  const line: TravellerLine = { who: "me", text, at: now.toISOString(), ...(screened.ok ? {} : { held: screened.reason }) };
  await appendLine(ownerId, thread.id, line);
  const joined = [...(thread.transcript as AskLine[])].reverse().find((l): l is SystemLine => l?.who === "system" && l.event === "joined");
  emit({ type: "agent", name: joined ? nameIn(joined, thread.lang) : "Mada" });
  emit({ type: "done", text: "" });
  console.info(`[ask-chat] thread=${thread.id} kept for the desk`);
}

/** What the desk said since line `after`, for the app (its own thread only). */
export async function deskUpdates(ownerId: string, threadId: string, after: number, lang: string): Promise<AskDeskResponse | null> {
  const [row] = await db.select({ mode: appAskThreads.mode, transcript: appAskThreads.transcript }).from(appAskThreads)
    .where(and(eq(appAskThreads.id, threadId), eq(appAskThreads.ownerId, ownerId)));
  if (!row) return null;
  const all = row.transcript as AskLine[];
  const lines: AskDeskLine[] = [];
  let holder: string | null = null;
  all.forEach((l, n) => {
    if (l?.who === "system" && l.event === "joined") holder = nameIn(l, lang);
    if (l?.who === "system" && l.event === "handed_back") holder = null;
    if (n <= after) return;
    if (l?.who === "agent") lines.push({ n, kind: "agent", by: nameIn(l, lang), text: l.text, at: l.at });
    else if (l?.who === "system" && l.event === "joined") lines.push({ n, kind: "joined", by: nameIn(l, lang), text: joinedText(nameIn(l, lang), l.pronoun, lang), at: l.at });
  });
  const agent = row.mode === "agent";
  return { mode: agent ? "agent" : "ai", agent: agent ? holder : null, lines, last: all.length - 1 };
}

/**
 * The note the model reads after Hand back: who had the thread and what was said meanwhile (redacted, short), so
 * Mada carries on without repeating it. Read in the next turn's context, then cleared (store.ts appendTurn).
 */
export function handBackNote(transcript: AskLine[], since: Date | null, agent: string): string {
  const from = since?.getTime() ?? 0;
  const said = transcript
    .filter((l) => (l?.who === "me" || l?.who === "agent") && "at" in l && l.at && Date.parse(l.at) >= from)
    .map((l) => `${l.who === "me" ? "Traveller" : agent}: ${redact((l as { text: string }).text).text.replace(/\s+/g, " ").slice(0, 300)}`);
  const body = said.join("\n").slice(-1400);
  return [
    `[Mada's systems: ${agent}, a person on the Mada team, had this conversation for a while and has handed it back to you.`,
    said.length ? `What was said meanwhile:\n${body}` : "Nothing was said meanwhile.",
    `Carry on from there: don't repeat what ${agent} already said, and don't say a person is still on the chat.]`,
  ].join("\n");
}
