import "server-only";
import { and, asc, desc, eq, inArray } from "drizzle-orm";
import { maskPhone, t, type SupportCard, type SupportMessage } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appNotifications, appUsers } from "@/db/app-schema";
import { appSupportThreads } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { getFile, readFileBytes } from "../documents/storage";
import { sharedDocuments } from "../documents";
import { threadMessages, toMessage } from "./threads";

/*
 * The 24/7 desk's side of "Talk to Mada", for the Ops desk UI. Agents always write as themselves (their name shows
 * with their face, COPY.md §1); the traveller gets an in-app notification from Mada naming them. Every agent action
 * is audited. Callers (Ops route handlers) are responsible for checking the Ops session and role first.
 */

export type DeskAgent = { opsUserId: string; name: string };

export type DeskThreadSummary = {
  id: string;
  userId: string;
  travellerName: string;
  /** "+966 50 ••• 4127": the desk sees the full number only on the traveller's page in Ops. */
  phoneMasked: string | null;
  tripId: string | null;
  about: string;
  status: "open" | "closed";
  assignedOpsUserId: string | null;
  lastMessageAt: string | null;
  lastMessage: string | null;
  lastFrom: "user" | "agent" | "mada" | null;
  /** Messages from the traveller the desk hasn't read yet. */
  unreadForDesk: number;
  urgent: boolean;
};

/** Open conversations, newest activity first (or every one with status 'all'). */
export async function listDeskThreads(opts: { status?: "open" | "closed" | "all"; assignedTo?: string; limit?: number } = {}): Promise<DeskThreadSummary[]> {
  const where = [] as ReturnType<typeof eq>[];
  if ((opts.status ?? "open") !== "all") where.push(eq(appSupportThreads.status, opts.status ?? "open"));
  if (opts.assignedTo) where.push(eq(appSupportThreads.assignedOpsUserId, opts.assignedTo));
  const rows = await db.select({ th: appSupportThreads, name: appUsers.name, phone: appUsers.phone })
    .from(appSupportThreads).innerJoin(appUsers, eq(appUsers.id, appSupportThreads.userId))
    .where(where.length ? and(...where) : undefined)
    .orderBy(desc(appSupportThreads.lastMessageAt)).limit(opts.limit ?? 100);
  if (!rows.length) return [];
  const msgs = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), inArray(appMessages.threadId, rows.map((r) => r.th.id)))).orderBy(asc(appMessages.createdAt));
  return rows.map(({ th, name, phone }) => {
    const mine = msgs.filter((m) => m.threadId === th.id);
    const last = mine[mine.length - 1];
    const fromUser = mine.filter((m) => m.authorKind === "user" && (!th.agentReadAt || m.createdAt > th.agentReadAt));
    return {
      id: th.id, userId: th.userId, travellerName: name || "Traveller", phoneMasked: phone ? maskPhone(phone) : null, tripId: th.tripId, about: th.about,
      status: th.status as "open" | "closed", assignedOpsUserId: th.assignedOpsUserId, lastMessageAt: th.lastMessageAt?.toISOString() ?? null,
      lastMessage: last?.body ?? null, lastFrom: (last?.authorKind as DeskThreadSummary["lastFrom"]) ?? null, unreadForDesk: fromUser.length,
      urgent: fromUser.some((m) => ["urgent", "airport"].includes(String((m.card as Record<string, unknown> | null)?.intent ?? ""))),
    };
  });
}

/** One conversation with everything the agent needs: messages, and documents the traveller shared for a trip. */
export async function getDeskThread(threadId: string, agent: DeskAgent) {
  const [row] = await db.select({ th: appSupportThreads, name: appUsers.name, phone: appUsers.phone }).from(appSupportThreads).innerJoin(appUsers, eq(appUsers.id, appSupportThreads.userId)).where(eq(appSupportThreads.id, threadId));
  if (!row) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "agent", actorId: agent.opsUserId, action: "support.thread_viewed", entityType: "app_support_thread", entityId: threadId, summary: `${agent.name} opened a conversation` });
  return {
    thread: { id: row.th.id, userId: row.th.userId, travellerName: row.name || "Traveller", phoneMasked: row.phone ? maskPhone(row.phone) : null, tripId: row.th.tripId, about: row.th.about, status: row.th.status, assignedOpsUserId: row.th.assignedOpsUserId },
    messages: await threadMessages(threadId),
    sharedDocuments: await sharedDocuments(row.th.userId),
  };
}

/** The agent answers as themselves. The traveller gets an in-app notification from Mada naming them. */
export async function agentReply(threadId: string, agent: DeskAgent, body: string, card?: SupportCard | null): Promise<SupportMessage> {
  const text = body.trim();
  if (!text || text.length > 4000) throw new AppError("VALIDATION", { fields: { body: "1 to 4000 characters" } });
  const [th] = await db.select().from(appSupportThreads).where(eq(appSupportThreads.id, threadId));
  if (!th) throw new AppError("NOT_FOUND");
  const msg = await db.transaction(async (tx) => {
    const now = new Date();
    const [m] = await tx.insert(appMessages).values({ threadKind: "support", threadId, authorKind: "agent", authorOpsUserId: agent.opsUserId, authorName: agent.name, body: text, card: card ?? null, createdAt: now }).returning();
    await tx.update(appSupportThreads).set({ lastMessageAt: now, agentReadAt: now, status: "open", assignedOpsUserId: th.assignedOpsUserId ?? agent.opsUserId }).where(eq(appSupportThreads.id, threadId));
    const preview = text.length > 70 ? `${text.slice(0, 69)}…` : text;
    await tx.insert(appNotifications).values({
      userId: th.userId, kind: "agent_reply", level: "active", title: t("notify.supportReply.title"),
      body: t("notify.supportReply.body", { name: agent.name, text: preview }).slice(0, 90), href: `/support/${threadId}`, data: { threadId },
    });
    await appAuditLog(tx, { actorKind: "agent", actorId: agent.opsUserId, action: "support.agent_replied", entityType: "app_support_thread", entityId: threadId, summary: `${agent.name} replied` });
    return m!;
  });
  return toMessage(msg);
}

export async function markReadByDesk(threadId: string, agent: DeskAgent) {
  const r = await db.update(appSupportThreads).set({ agentReadAt: new Date() }).where(eq(appSupportThreads.id, threadId)).returning({ id: appSupportThreads.id });
  if (!r.length) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "agent", actorId: agent.opsUserId, action: "support.read", entityType: "app_support_thread", entityId: threadId, summary: `${agent.name} read the conversation` });
}

export async function assignThread(threadId: string, opsUserId: string | null, by: DeskAgent) {
  const r = await db.update(appSupportThreads).set({ assignedOpsUserId: opsUserId }).where(eq(appSupportThreads.id, threadId)).returning({ id: appSupportThreads.id });
  if (!r.length) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "agent", actorId: by.opsUserId, action: "support.assigned", entityType: "app_support_thread", entityId: threadId, summary: `${by.name} assigned the conversation`, data: { to: opsUserId } });
}

export async function setThreadStatus(threadId: string, status: "open" | "closed", by: DeskAgent) {
  const r = await db.update(appSupportThreads).set({ status }).where(eq(appSupportThreads.id, threadId)).returning({ id: appSupportThreads.id });
  if (!r.length) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "agent", actorId: by.opsUserId, action: status === "closed" ? "support.closed" : "support.reopened", entityType: "app_support_thread", entityId: threadId, summary: `${by.name} ${status === "closed" ? "closed" : "reopened"} the conversation` });
}

/** How many conversations wait on the desk (traveller wrote last, unread). For the desk's badge and alerts. */
export async function deskWaiting(): Promise<number> {
  return (await listDeskThreads({ status: "open", limit: 500 })).filter((x) => x.unreadForDesk > 0).length;
}

/** An attachment in a conversation, for the agent. Audited. */
export async function deskAttachment(threadId: string, fileId: string, agent: DeskAgent) {
  const [th] = await db.select({ userId: appSupportThreads.userId }).from(appSupportThreads).where(eq(appSupportThreads.id, threadId));
  if (!th) throw new AppError("NOT_FOUND");
  const inThread = (await threadMessages(threadId)).some((m) => m.attachment?.id === fileId);
  const f = inThread ? await getFile(fileId, th.userId) : null;
  if (!f) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "agent", actorId: agent.opsUserId, action: "support.attachment_viewed", entityType: "app_support_thread", entityId: threadId, summary: `${agent.name} opened an attachment` });
  return { file: f, bytes: await readFileBytes(f) };
}
