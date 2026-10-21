import "server-only";
import { and, desc, eq, isNotNull, isNull, sql, type SQL } from "drizzle-orm";
import { ChatCard, todayIn, type AskThreadLine, type AskThreadResponse, type AskThreadRow, type AskTripStatus } from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { appAgents } from "@/db/app-schema-desk";
import { joinedText, nameIn, type AskLine } from "./takeover";

/*
 * The conversations list (docs/app/ASK-INTEGRATED.md §2.4 and the U1+ row of §11): the traveller's own chats, newest
 * first, 30 to a page. Search reads the title, the trip's place and every line said in the chat (the traveller's own
 * chats only; lines were redacted before they were kept), and says which line matched so the app opens the chat at it.
 * Filters: trips (about a trip), upcoming (a trip still to come or on now), past (a trip that's over). A chat with nothing said in
 * it (a turn that stopped before anything was kept) isn't listed. Archiving keeps everything; deleting a chat never
 * touches its trip, plan or bookings.
 */

const PAGE = 30;
const SAID = sql`jsonb_array_length(${appAskThreads.transcript}) > 0`;

const cols = {
  id: appAskThreads.id, title: appAskThreads.title, tripId: appAskThreads.tripId, preview: appAskThreads.preview, lastAt: appAskThreads.lastAt,
  mode: appAskThreads.mode, archivedAt: appAskThreads.archivedAt, endedAt: appAskThreads.endedAt, lang: appAskThreads.lang,
  tripStatus: appTrips.status, tripStart: appTrips.startDate, tripEnd: appTrips.endDate,
  agent: appAgents.displayName, agentAr: appAgents.displayNameAr,
  unread: sql<boolean>`coalesce(${appAskThreads.transcript} -> -1 ->> 'who' = 'agent', false)`,
};
type Raw = {
  id: string; title: string | null; tripId: string | null; preview: string | null; lastAt: Date; mode: string; archivedAt: Date | null; endedAt: Date | null; lang: string;
  tripStatus: string | null; tripStart: string | null; tripEnd: string | null; agent: string | null; agentAr: string | null; unread: boolean;
};

/** Planning, booked, today or done, from the trip's status and days. */
export function tripStatusOf(status: string | null, start: string | null, end: string | null, today = todayIn()): AskTripStatus | null {
  if (!status || !start) return null;
  if (status === "cancelled" || status === "completed" || (end ?? start) < today) return "done";
  if (status === "planning") return "planning";
  return start <= today ? "today" : "booked";
}

function rowOf(r: Raw, today: string): AskThreadRow {
  const lang = r.lang === "ar" ? "ar" : "en";
  const agent = r.mode === "agent" ? (lang === "ar" && r.agentAr ? r.agentAr : r.agent) ?? "Mada" : null;
  return {
    id: r.id, title: r.title, tripId: r.tripId, tripStatus: r.tripId ? tripStatusOf(r.tripStatus, r.tripStart, r.tripEnd, today) : null,
    tripStart: r.tripId ? r.tripStart : null, preview: r.preview, lastAt: r.lastAt.toISOString(), mode: r.mode === "agent" ? "agent" : "ai", agent,
    unread: !!r.unread, archived: !!r.archivedAt, ended: !!r.endedAt, lang,
  };
}

const base = () => db.select(cols).from(appAskThreads)
  .leftJoin(appTrips, eq(appTrips.id, appAskThreads.tripId))
  .leftJoin(appAgents, eq(appAgents.opsUserId, appAskThreads.takenBy));

/** `before`: the cursor from the page before ("<lastAt ISO>|<id>"). */
export const THREAD_FILTERS = ["trips", "upcoming", "past"] as const;
export type ThreadFilter = (typeof THREAD_FILTERS)[number];

/** The last line said in the chat that has the words: the list shows it, and the app opens the chat there. */
const matchOf = (like: string) => sql<string | null>`(
  SELECT x.e->>'text' FROM jsonb_array_elements(${appAskThreads.transcript}) WITH ORDINALITY AS x(e, n)
  WHERE x.e->>'who' IN ('me', 'mada', 'agent') AND x.e->>'text' ILIKE ${like} ORDER BY x.n DESC LIMIT 1)`;

/** A few words either side of the match, on one line. */
export function snippetOf(text: string, q: string, width = 90): string {
  const one = text.replace(/\s+/g, " ").trim();
  const at = one.toLowerCase().indexOf(q.toLowerCase());
  if (at < 0 || one.length <= width) return one.slice(0, width);
  const from = Math.max(0, Math.min(at - Math.floor((width - q.length) / 2), one.length - width));
  return `${from > 0 ? "…" : ""}${one.slice(from, from + width).trim()}${from + width < one.length ? "…" : ""}`;
}

export async function listThreads(ownerId: string, o: { q?: string | null; archived?: boolean; tripId?: string | null; filter?: ThreadFilter | null; before?: string | null; limit?: number } = {}) {
  const q = (o.q ?? "").trim().slice(0, 80);
  const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
  const search: SQL | undefined = q ? sql`(${appAskThreads.title} ILIKE ${like} OR ${appTrips.city} ILIKE ${like} OR ${matchOf(like)} IS NOT NULL)` : undefined;
  const today = todayIn();
  const over = sql`(${appTrips.status} IN ('cancelled', 'completed') OR coalesce(${appTrips.endDate}, ${appTrips.startDate}) < ${today})`;
  const filter: SQL | undefined = o.filter === "trips" ? isNotNull(appAskThreads.tripId)
    : o.filter === "upcoming" ? and(isNotNull(appAskThreads.tripId), sql`NOT ${over}`)
    : o.filter === "past" ? and(isNotNull(appAskThreads.tripId), over) : undefined;
  const [at, id] = (o.before ?? "").split("|");
  const cursor = at && id && !Number.isNaN(Date.parse(at)) && /^[0-9a-f-]{36}$/i.test(id)
    ? sql`(${appAskThreads.lastAt}, ${appAskThreads.id}) < (${new Date(at).toISOString()}::timestamptz, ${id}::uuid)` : undefined;
  const mine = and(eq(appAskThreads.ownerId, ownerId), SAID);
  const limit = Math.min(Math.max(o.limit ?? PAGE, 1), PAGE);
  const [rows, [arch]] = await Promise.all([
    (q ? db.select({ ...cols, match: matchOf(like) }) : db.select(cols)).from(appAskThreads)
      .leftJoin(appTrips, eq(appTrips.id, appAskThreads.tripId)).leftJoin(appAgents, eq(appAgents.opsUserId, appAskThreads.takenBy))
      .where(and(mine, o.archived ? isNotNull(appAskThreads.archivedAt) : isNull(appAskThreads.archivedAt), o.tripId ? eq(appAskThreads.tripId, o.tripId) : undefined, filter, search, cursor))
      .orderBy(desc(appAskThreads.lastAt), desc(appAskThreads.id)).limit(limit + 1),
    db.select({ n: sql<number>`count(*)::int` }).from(appAskThreads).where(and(mine, isNotNull(appAskThreads.archivedAt))),
  ]);
  const page = (rows as (Raw & { match?: string | null })[]).slice(0, limit);
  const last = page.at(-1);
  return {
    threads: page.map((r) => ({ ...rowOf(r, today), ...(q ? { match: r.match ? snippetOf(r.match, q) : null } : {}) })),
    next: rows.length > limit && last ? `${last.lastAt.toISOString()}|${last.id}` : null,
    archivedCount: arch?.n ?? 0,
  };
}

const KEPT = new Set(["change", "people", "invite"]);

/** The lines the app shows again: the traveller's, Mada's, the desk's replies and "Noura from Mada joined". */
export function linesOf(transcript: unknown[], lang: "en" | "ar"): AskThreadLine[] {
  const out: AskThreadLine[] = [];
  for (const raw of transcript as AskLine[]) {
    if (!raw || typeof raw !== "object") continue;
    if (raw.who === "me" && typeof raw.text === "string") out.push({ who: "me", text: raw.text, at: raw.at ?? null, ...(raw.attachment?.label ? { attachment: { kind: String(raw.attachment.kind ?? "other"), label: String(raw.attachment.label) } } : {}) });
    else if (raw.who === "mada" && typeof raw.text === "string") {
      // Reference cards kept with a line (a companion's change request): only the kinds that are read again live.
      const kept = (raw.kept ?? []).map((c) => ChatCard.safeParse(c)).filter((c) => c.success && KEPT.has(c.data.type)).map((c) => c.data!).slice(0, 2);
      out.push({ who: "mada", text: raw.text, cards: (raw.cards ?? []).filter((c) => typeof c === "string").slice(0, 6), next: (raw.next ?? []).filter((c) => typeof c === "string").slice(0, 3), ...(kept.length ? { kept, at: raw.at ?? null } : {}) });
    }
    else if (raw.who === "agent") out.push({ who: "agent", text: raw.text, by: nameIn(raw, lang), at: raw.at });
    else if (raw.who === "system" && raw.event === "joined") out.push({ who: "joined", text: joinedText(nameIn(raw, lang), raw.pronoun, lang), by: nameIn(raw, lang), at: raw.at });
  }
  return out;
}

/** One chat and every line of it, for opening it on any device. Null when it isn't the caller's. */
export async function getThread(ownerId: string, id: string): Promise<AskThreadResponse | null> {
  const [r] = await base().where(and(eq(appAskThreads.id, id), eq(appAskThreads.ownerId, ownerId))).limit(1);
  if (!r) return null;
  const [t] = await db.select({ transcript: appAskThreads.transcript }).from(appAskThreads).where(eq(appAskThreads.id, id));
  const transcript = t?.transcript ?? [];
  const row = rowOf(r as Raw, todayIn());
  return { thread: row, lines: linesOf(transcript, row.lang), last: transcript.length - 1 };
}

/** Rename (empty: back to the automatic title, written again on the next turn), archive or unarchive. */
export async function patchThread(ownerId: string, id: string, p: { title?: string | null; archived?: boolean }): Promise<AskThreadRow | null> {
  const title = p.title === undefined ? undefined : (p.title ?? "").trim();
  const set = {
    ...(title === undefined ? {} : title ? { title, titledBy: "traveller" } : { title: null, titledBy: null }),
    ...(p.archived === undefined ? {} : { archivedAt: p.archived ? new Date() : null }),
  };
  const done = await db.update(appAskThreads).set(set).where(and(eq(appAskThreads.id, id), eq(appAskThreads.ownerId, ownerId))).returning({ id: appAskThreads.id });
  if (!done.length) return null;
  return (await getThread(ownerId, id))?.thread ?? null;
}

/** Delete a chat for good. Its trip, plan, requests and bookings stay. */
export async function deleteThread(ownerId: string, id: string): Promise<boolean> {
  const done = await db.delete(appAskThreads).where(and(eq(appAskThreads.id, id), eq(appAskThreads.ownerId, ownerId))).returning({ id: appAskThreads.id });
  return done.length > 0;
}
