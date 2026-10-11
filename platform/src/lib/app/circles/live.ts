import "server-only";
import { and, eq, sql } from "drizzle-orm";
import { LiveKind, type CircleEventsResponse, type CircleLiveEvent, type CircleMessage, type ReactRequest } from "@mada/shared";
import { db } from "@/db";
import { appMessages } from "@/db/app-schema";
import { appCircleEvents, appCircleReactions } from "@/db/app-schema-circles";
import { AppError } from "../http";
import { isDm, memberIds, membership, toMessages } from "./circles";
import { err, isBlocked } from "./common";
import { hit } from "./limits";

/*
 * Circles, live. Every change in a circle writes a row to app_circle_events from a database trigger (migration 0021:
 * messages, votes, reactions, splits, members, read receipts, renames, pins, invites), plus "typing" rows from
 * POST /circles/{id}/typing. A row names what changed (kind, the message or person it concerns, who did it), never
 * the content: the app refetches what it shows through the same member-checked endpoints.
 *
 * Delivery works on Vercel without a socket server or LISTEN (the database sits behind a transaction pooler): the
 * app holds GET /circles/live open (Server-Sent Events) and the function polls this table about once a second for
 * ~25 s, then ends the stream; the app reconnects with ?after=<cursor> (or Last-Event-ID) and misses nothing. When
 * streaming isn't possible (a proxy that buffers, a flaky network) the app polls GET /circles/events?after= instead.
 *
 * A person sees events for circles they're in now, and events addressed to them (an invite, being removed, a circle
 * being deleted), never anyone else's. Rows older than 3 days are swept.
 */

export const LIVE = {
  /** How long one stream stays open before the app reconnects (Vercel functions are time-boxed). */
  get streamMs() { return Number(process.env.CIRCLES_LIVE_STREAM_MS ?? 25_000); },
  /** How often a stream looks for new events. */
  get pollMs() { return Number(process.env.CIRCLES_LIVE_POLL_MS ?? 1_000); },
  /** Comment lines that keep proxies from closing a quiet stream. */
  heartbeatMs: 10_000,
  /** A gap in event ids (a transaction not yet committed) is waited for this long, then skipped (a rollback). */
  gapMs: 5_000,
  batch: 200,
  keepDays: 3,
} as const;

type Row = { id: number; circle_id: string; kind: string; ref: string | null; actor_id: string | null; created_at: Date | string };

/** The newest event id: where a fresh connection starts. */
export async function headCursor(): Promise<number> {
  const rows = await db.execute<{ id: number | string | null }>(sql`SELECT max(id) AS id FROM app_circle_events`);
  return Number(rows[0]?.id ?? 0);
}

/**
 * Events after `cursor` for this person, and the cursor to ask from next. Ids come from a sequence, so a transaction
 * that took an id but hasn't committed yet leaves a gap. The next cursor is the "settled" mark: the highest id below
 * which every id has committed (or is old enough to have been a rollback). Events past the mark are sent now and may
 * come again next time; the app ignores ids it has seen.
 */
export async function eventsFor(userId: string, cursor: number): Promise<CircleEventsResponse> {
  const [rows, mark] = await Promise.all([
    db.execute<Row>(sql`
      SELECT e.id, e.circle_id, e.kind, e.ref, e.actor_id, e.created_at FROM app_circle_events e
      WHERE e.id > ${cursor} AND (e.user_id = ${userId} OR e.circle_id IN (SELECT circle_id FROM app_circle_members WHERE user_id = ${userId}))
      ORDER BY e.id LIMIT ${LIVE.batch}`),
    settledMark(cursor),
  ]);
  const events: CircleLiveEvent[] = rows.flatMap((r) => {
    const kind = LiveKind.safeParse(r.kind);
    return kind.success ? [{ id: Number(r.id), circleId: r.circle_id, kind: kind.data, ref: r.ref, actor: r.actor_id }] : [];
  });
  // A full batch: resume after the last one sent rather than re-reading it.
  const next = rows.length === LIVE.batch ? Math.min(mark, Number(rows[rows.length - 1]!.id)) : mark;
  return { events, cursor: Math.max(cursor, next) };
}

/** The highest id at or above `cursor` with no fresh gap below it (all circles, not just one person's). */
async function settledMark(cursor: number): Promise<number> {
  const rows = await db.execute<{ mark: number | string | null }>(sql`
    WITH s AS (
      SELECT id, created_at, lag(id, 1, ${cursor}::bigint) OVER (ORDER BY id) AS prev
      FROM (SELECT id, created_at FROM app_circle_events WHERE id > ${cursor} ORDER BY id LIMIT 2000) w
    )
    SELECT coalesce(
      (SELECT min(prev) FROM s WHERE id <> prev + 1 AND created_at > now() - make_interval(secs => ${LIVE.gapMs / 1000})),
      (SELECT max(id) FROM s),
      ${cursor}::bigint) AS mark`);
  return Number(rows[0]?.mark ?? cursor);
}

let lastSweep = 0;
/** Now and then, drop old events (any instance may do it; it's idempotent). */
export function sweep() {
  if (Date.now() - lastSweep < 3_600_000) return;
  lastSweep = Date.now();
  void db.execute(sql`DELETE FROM app_circle_events WHERE created_at < now() - make_interval(days => ${LIVE.keepDays})`).catch(() => {});
}

const enc = new TextEncoder();
const frame = (e: CircleLiveEvent) => enc.encode(`id: ${e.id}\nevent: circle\ndata: ${JSON.stringify(e)}\n\n`);

/**
 * The SSE body: `hello` with the starting cursor, then `circle` events (id: = cursor), heartbeats, and `bye` with a
 * retry hint when the window closes. Stops when the client goes away.
 */
export function liveStream(userId: string, start: number, signal: AbortSignal): ReadableStream<Uint8Array> {
  let cursor = start;
  const seen = new Set<number>();
  return new ReadableStream<Uint8Array>({
    async start(ctrl) {
      const ends = Date.now() + LIVE.streamMs;
      let beat = Date.now();
      const send = (s: string) => { try { ctrl.enqueue(enc.encode(s)); } catch { /* closed */ } };
      send(`retry: 1000\nevent: hello\ndata: ${JSON.stringify({ cursor })}\n\n`);
      sweep();
      try {
        while (!signal.aborted && Date.now() < ends) {
          const r = await eventsFor(userId, cursor);
          for (const e of r.events) if (!seen.has(e.id)) { seen.add(e.id); ctrl.enqueue(frame(e)); }
          if (r.cursor !== cursor) { cursor = r.cursor; send(`event: cursor\ndata: ${JSON.stringify({ cursor })}\n\n`); }
          if (Date.now() - beat >= LIVE.heartbeatMs) { send(": keep-alive\n\n"); beat = Date.now(); }
          await new Promise<void>((res) => { const t = setTimeout(res, LIVE.pollMs); signal.addEventListener("abort", () => { clearTimeout(t); res(); }, { once: true }); });
        }
        send(`event: bye\ndata: ${JSON.stringify({ cursor })}\n\n`);
      } catch {
        send(`event: bye\ndata: ${JSON.stringify({ cursor, problem: true })}\n\n`);
      } finally {
        try { ctrl.close(); } catch { /* already closed */ }
      }
    },
  });
}

/** Where a connection resumes: ?after=, else Last-Event-ID, else now. */
export async function resumeFrom(req: Request): Promise<number> {
  const raw = new URL(req.url).searchParams.get("after") ?? req.headers.get("last-event-id");
  const n = raw != null && /^\d{1,18}$/.test(raw) ? Number(raw) : null;
  if (n != null) {
    // A cursor from the future (another database, a typo) would hide everything: clamp it.
    const head = await headCursor();
    return Math.min(n, head);
  }
  return headCursor();
}

/* ───────────── typing ───────────── */

/** "Noor is typing": one row, at most every 3 seconds per person per circle. */
export async function typing(circleId: string, userId: string) {
  await membership(circleId, userId);
  const recent = await db.execute<{ n: number }>(sql`SELECT count(*)::int AS n FROM app_circle_events WHERE circle_id = ${circleId} AND actor_id = ${userId} AND kind = 'typing' AND created_at > now() - interval '3 seconds'`);
  if (Number(recent[0]?.n ?? 0) > 0) return;
  await db.insert(appCircleEvents).values({ circleId, kind: "typing", actorId: userId });
}

/* ───────────── reactions ───────────── */

/** Add or take back a reaction. Not on lines like "Noor joined"; not in a 1:1 chat with someone blocked. */
export async function react(circleId: string, userId: string, messageId: string, input: Required<Pick<ReactRequest, "emoji">> & { on: boolean }): Promise<CircleMessage> {
  await membership(circleId, userId);
  await hit(`react:${userId}`, 120, 60);
  const [m] = await db.select().from(appMessages).where(and(eq(appMessages.id, messageId), eq(appMessages.threadKind, "circle"), eq(appMessages.threadId, circleId)));
  if (!m) throw new AppError("NOT_FOUND");
  if ((m.card as { t?: string } | null)?.t === "sys") throw new AppError("VALIDATION", { fields: { messageId: "Can't react to this" } });
  if (await isDm(circleId)) {
    const other = (await memberIds(circleId)).find((id) => id !== userId);
    if (other && (await isBlocked(userId, other))) throw err("FORBIDDEN", "circles.err.blocked");
  }
  if (input.on) await db.insert(appCircleReactions).values({ messageId, userId, emoji: input.emoji }).onConflictDoNothing();
  else await db.delete(appCircleReactions).where(and(eq(appCircleReactions.messageId, messageId), eq(appCircleReactions.userId, userId), eq(appCircleReactions.emoji, input.emoji)));
  return (await toMessages([m]))[0]!;
}
