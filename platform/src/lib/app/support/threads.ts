import "server-only";
import { and, asc, desc, eq, gt, inArray, isNull, ne, or, sql } from "drizzle-orm";
import {
  SupportCard, supportIntent, t, type FileInfo, type SendSupportMessageRequest, type SupportIntent, type SupportMessage, type SupportThread, type SupportTopic,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appMessages, appTrips, appUsers } from "@/db/app-schema";
import { appSupportThreads } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { getFile, readFileBytes, storeFile, type StoredFile } from "../documents/storage";
import { autoReplies, autoReplyOn, isSafetyIntent, type Reply } from "./replies";

/*
 * Talk to Mada (Support.jsx): one conversation per traveller, and one per trip. Messages live in app_messages with
 * thread_kind 'support'. Who wrote each one is explicit (COPY.md §1): the traveller, a named person at Mada, or Mada
 * itself ("we") for instant answers. Safety answers (someone hurt, at the airport) are fixed templates and always
 * sent; the other instant answers run in mock mode (or SUPPORT_AUTOREPLY=on) until the desk answers everything.
 */

type ThreadRow = typeof appSupportThreads.$inferSelect;
type MessageRow = typeof appMessages.$inferSelect;
type StoredCard = SupportCard & { _clientId?: string; _file?: FileInfo };

const TOPIC_INTENT: Record<SupportTopic, SupportIntent> = { change: "change", refund: "refund", bag: "bag", docs: "docs", airport: "airport", other: "other" };
const TOPIC_KEY = { change: "support.topic.change", refund: "support.topic.refund", bag: "support.topic.bag", docs: "support.topic.docs", airport: "support.topic.airport", other: "support.topic.other" } as const;

export function toMessage(m: MessageRow): SupportMessage {
  const raw = (m.card ?? {}) as StoredCard;
  const { _clientId, _file, ...rest } = raw;
  const parsed = SupportCard.safeParse(rest);
  const card = parsed.success && Object.keys(parsed.data).length ? parsed.data : null;
  const author: SupportMessage["author"] = m.authorKind === "user" ? { kind: "user", id: m.authorUserId!, name: m.authorName ?? "" }
    : m.authorKind === "agent" ? { kind: "agent", id: m.authorOpsUserId ?? "desk", name: m.authorName ?? "", photoUrl: null }
      : { kind: "mada" };
  return { id: m.id, threadId: m.threadId, author, body: m.body, card, attachment: _file ?? null, clientId: _clientId ?? null, createdAt: m.createdAt.toISOString() };
}

async function unreadFor(threadIds: string[], readAt: Map<string, Date | null>): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (!threadIds.length) return out;
  const rows = await db.select({ threadId: appMessages.threadId, createdAt: appMessages.createdAt }).from(appMessages)
    .where(and(eq(appMessages.threadKind, "support"), inArray(appMessages.threadId, threadIds), ne(appMessages.authorKind, "user")));
  for (const r of rows) {
    const seen = readAt.get(r.threadId);
    if (!seen || r.createdAt > seen) out.set(r.threadId, (out.get(r.threadId) ?? 0) + 1);
  }
  return out;
}

function toThread(th: ThreadRow, unread: number): SupportThread {
  return { id: th.id, tripId: th.tripId, about: th.about, status: th.status as SupportThread["status"], unread, lastMessageAt: th.lastMessageAt?.toISOString() ?? null, createdAt: th.createdAt.toISOString() };
}

export async function listThreads(userId: string): Promise<SupportThread[]> {
  const rows = await db.select().from(appSupportThreads).where(eq(appSupportThreads.userId, userId)).orderBy(desc(appSupportThreads.lastMessageAt), desc(appSupportThreads.createdAt));
  const unread = await unreadFor(rows.map((r) => r.id), new Map(rows.map((r) => [r.id, r.userReadAt])));
  return rows.map((r) => toThread(r, unread.get(r.id) ?? 0));
}

export async function unreadCount(userId: string): Promise<number> {
  return (await listThreads(userId)).reduce((s, th) => s + th.unread, 0);
}

const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function tripAbout(trip: { city: string; startDate: string; endDate: string | null }) {
  const a = trip.startDate; const b = trip.endDate;
  const d = (iso: string) => `${Number(iso.slice(8, 10))} ${SHORT[Number(iso.slice(5, 7)) - 1]}`;
  const range = !b || b === a ? d(a) : a.slice(5, 7) === b.slice(5, 7) ? `${Number(a.slice(8, 10))}–${d(b)}` : `${d(a)} – ${d(b)}`;
  return `${t("support.aboutTrip", { city: trip.city })} · ${range}`;
}

/** The conversation for the account (no trip) or for one of the traveller's trips. Created on first use. */
export async function openThread(userId: string, opts: { tripId?: string; about?: string } = {}): Promise<ThreadRow> {
  let about = opts.about?.trim() || t("support.aboutAccount");
  if (opts.tripId) {
    const [trip] = await db.select({ city: appTrips.city, startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, opts.tripId), eq(appTrips.ownerId, userId)));
    if (!trip) throw new AppError("NOT_FOUND");
    about = tripAbout(trip);
  }
  const where = opts.tripId ? and(eq(appSupportThreads.userId, userId), eq(appSupportThreads.tripId, opts.tripId)) : and(eq(appSupportThreads.userId, userId), isNull(appSupportThreads.tripId));
  const [found] = await db.select().from(appSupportThreads).where(where);
  if (found) return found;
  await db.insert(appSupportThreads).values({ userId, tripId: opts.tripId ?? null, about }).onConflictDoNothing();
  const [row] = await db.select().from(appSupportThreads).where(where);
  return row!;
}

export async function ownThread(userId: string, threadId: string): Promise<ThreadRow> {
  const [th] = await db.select().from(appSupportThreads).where(and(eq(appSupportThreads.id, threadId), eq(appSupportThreads.userId, userId)));
  if (!th) throw new AppError("NOT_FOUND");
  return th;
}

export async function threadMessages(threadId: string): Promise<SupportMessage[]> {
  const rows = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId))).orderBy(asc(appMessages.createdAt), asc(appMessages.id));
  return rows.map(toMessage);
}

export async function getThread(userId: string, threadId: string) {
  const th = await ownThread(userId, threadId);
  const unread = await unreadFor([th.id], new Map([[th.id, th.userReadAt]]));
  return { thread: toThread(th, unread.get(th.id) ?? 0), messages: await threadMessages(th.id) };
}

export async function markRead(userId: string, threadId: string) {
  await ownThread(userId, threadId);
  await db.update(appSupportThreads).set({ userReadAt: new Date() }).where(eq(appSupportThreads.id, threadId));
}

async function insertMessage(tx: Tx, threadId: string, m: { authorKind: "user" | "mada" | "agent"; authorUserId?: string | null; authorOpsUserId?: string | null; authorName?: string | null; body: string; card?: StoredCard | null; at?: Date }): Promise<MessageRow> {
  const at = m.at ?? new Date();
  const [row] = await tx.insert(appMessages).values({
    threadKind: "support", threadId, authorKind: m.authorKind, authorUserId: m.authorUserId ?? null, authorOpsUserId: m.authorOpsUserId ?? null,
    authorName: m.authorName ?? null, body: m.body, card: m.card && Object.keys(m.card).length ? m.card : null, createdAt: at,
  }).returning();
  await tx.update(appSupportThreads).set({ lastMessageAt: at, status: "open" }).where(eq(appSupportThreads.id, threadId));
  return row!;
}

async function patchCard(tx: Tx, threadId: string, messageId: string, patch: Partial<SupportCard>) {
  const [m] = await tx.select().from(appMessages).where(and(eq(appMessages.id, messageId), eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId)));
  if (!m) throw new AppError("NOT_FOUND");
  await tx.update(appMessages).set({ card: { ...((m.card ?? {}) as object), ...patch } }).where(eq(appMessages.id, messageId));
  return m;
}

async function writeReplies(tx: Tx, threadId: string, replies: Reply[], after: Date): Promise<MessageRow[]> {
  const out: MessageRow[] = [];
  let at = after.getTime();
  for (const r of replies) {
    at += 1;
    out.push(await insertMessage(tx, threadId, { authorKind: "mada", body: r.body, card: r.card ?? null, at: new Date(at) }));
  }
  return out;
}

/**
 * The traveller writes (or taps a topic, a choice, the bag form, a rating). Returns the new messages: theirs first,
 * then any instant answers. A `clientId` already seen returns what was saved before, so an offline resend never
 * doubles a message.
 */
export async function sendMessage(userId: string, threadId: string, req: SendSupportMessageRequest, ipHash: string | null, attachment?: StoredFile | null): Promise<SupportMessage[]> {
  const th = await ownThread(userId, threadId);
  if (req.clientId) {
    const [seen] = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId), sql`${appMessages.card}->>'_clientId' = ${req.clientId}`));
    if (seen) {
      const later = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId), gt(appMessages.createdAt, seen.createdAt), ne(appMessages.authorKind, "user"))).orderBy(asc(appMessages.createdAt)).limit(4);
      return [seen, ...later].map(toMessage);
    }
  }
  const [user] = await db.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, userId));
  const auto = autoReplyOn();

  const rows = await db.transaction(async (tx) => {
    const now = new Date();
    const own = (body: string, card: StoredCard = {}) => insertMessage(tx, threadId, {
      authorKind: "user", authorUserId: userId, authorName: user?.name ?? "", body,
      card: { ...card, ...(req.clientId ? { _clientId: req.clientId } : {}), ...(attachment ? { _file: { id: attachment.id, name: attachment.name, mime: attachment.mime, size: attachment.size } } : {}) }, at: now,
    });
    const ctx = { userId, tripId: th.tripId, text: req.body };

    if (req.reply) {
      const m = await patchCard(tx, threadId, req.reply.messageId, { picked: req.reply.choice });
      const choice = ((m.card ?? {}) as SupportCard).choices?.find((c) => c.key === req.reply!.choice);
      if (!choice) throw new AppError("VALIDATION", { fields: { "reply.choice": "Not one of the choices" } });
      const mine = await own(choice.label);
      return [mine, ...(auto ? await writeReplies(tx, threadId, await autoReplies({ ...ctx, kind: "pick", choice: choice.key, label: choice.label }), now) : [])];
    }
    if (req.bag) {
      if ("none" in req.bag) {
        await patchCard(tx, threadId, req.bag.messageId, { filed: true });
        const mine = await own(t("support.reply.bagNoneSaid"));
        return [mine, ...(auto ? await writeReplies(tx, threadId, await autoReplies({ ...ctx, kind: "bagNone" }), now) : [])];
      }
      if (req.bagFor) await patchCard(tx, threadId, req.bagFor, { filed: true });
      const ref = req.bag.ref.trim().toUpperCase();
      const mine = await own(t("support.bag.summary", { ref, kind: req.bag.kind.toLowerCase(), to: req.bag.to.toLowerCase() }));
      return [mine, ...(auto ? await writeReplies(tx, threadId, await autoReplies({ ...ctx, kind: "bag", ref, to: req.bag.to }), now) : [])];
    }
    if (req.rating) {
      const mine = await own(t(req.rating === "yes" ? "support.rate.yesSaid" : "support.rate.noSaid"), { rated: true });
      return [mine, ...(auto && req.rating === "not_yet" ? await writeReplies(tx, threadId, await autoReplies({ ...ctx, kind: "intent", intent: "other" }), now) : [])];
    }

    const intent: SupportIntent = attachment ? "photo" : req.topic ? TOPIC_INTENT[req.topic] : supportIntent(req.body);
    const body = req.body || (req.topic ? t(TOPIC_KEY[req.topic]) : attachment ? (attachment.mime === "application/pdf" ? t("support.pdf", { name: attachment.name }) : "") : "");
    const mine = await own(body, { intent });
    // An open bag form and a photo of the baggage desk's form: file it.
    if (attachment && auto) {
      const open = (await tx.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId), sql`${appMessages.card}->>'form' = 'bag'`, or(isNull(sql`${appMessages.card}->>'filed'`), sql`${appMessages.card}->>'filed' <> 'true'`))).orderBy(desc(appMessages.createdAt)).limit(1))[0];
      if (open) {
        await patchCard(tx, threadId, open.id, { filed: true });
        return [mine, ...await writeReplies(tx, threadId, await autoReplies({ ...ctx, kind: "bag", ref: "SV 482913", to: th.tripId ? "Our hotel" : "Home" }), now)];
      }
    }
    const replies = auto || isSafetyIntent(intent) ? await autoReplies({ ...ctx, kind: "intent", intent }) : [];
    return [mine, ...await writeReplies(tx, threadId, replies, now)];
  });
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: attachment ? "support.attachment_sent" : "support.message_sent", entityType: "app_support_thread", entityId: threadId, summary: attachment ? "Sent a file to Mada" : "Wrote to Mada", ipHash });
  return rows.map(toMessage);
}

/** A photo or PDF into the conversation (stored encrypted, like documents). */
export async function sendAttachment(userId: string, threadId: string, file: { name: string; mime: string; bytes: Buffer }, req: { clientId?: string }, ipHash: string | null) {
  await ownThread(userId, threadId);
  const stored = await storeFile(db, userId, "support", file);
  return sendMessage(userId, threadId, { body: "", clientId: req.clientId }, ipHash, stored);
}

/** The traveller opens a file from their own conversation. */
export async function readAttachment(userId: string, fileId: string) {
  const f = await getFile(fileId, userId);
  if (!f || f.purpose !== "support") throw new AppError("NOT_FOUND");
  return { file: f, bytes: await readFileBytes(f) };
}
