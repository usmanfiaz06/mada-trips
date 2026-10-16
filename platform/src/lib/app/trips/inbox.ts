import "server-only";
import { and, count, desc, eq, inArray, isNull, lt, sql } from "drizzle-orm";
import { NotificationKind, type Notification } from "@mada/shared";
import { db } from "@/db";
import { appDevices, appNotifications } from "@/db/app-schema";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { isExpoToken } from "../push";
import { localeOfUser } from "../locale";
import { renderNotification } from "../notify-copy";
import type { Lang } from "@mada/shared";

/* The inbox (the bell on Today) and the phones that receive pushes. */

type Row = typeof appNotifications.$inferSelect;
const toView = (n: Row, locale: Lang): Notification => {
  // The words in the reader's language now (notify-copy.ts), not the one they had when the line was written.
  const words = renderNotification(n, locale);
  return {
    // A kind this build doesn't know reads as 'other', so one new kind never breaks an older phone's whole inbox.
    id: n.id, kind: NotificationKind.safeParse(n.kind).success ? (n.kind as Notification["kind"]) : "other", level: n.level as Notification["level"], title: words.title.slice(0, 32), body: words.body.slice(0, 90),
    href: n.href, readAt: n.readAt?.toISOString() ?? null, createdAt: n.createdAt.toISOString(),
  };
};

export async function listNotifications(userId: string, before: string | null, limit = 30) {
  const where = before ? and(eq(appNotifications.userId, userId), lt(appNotifications.createdAt, new Date(before))) : eq(appNotifications.userId, userId);
  // The page and the unread count side by side (each query is a round trip).
  const [rows, [unread], locale] = await Promise.all([
    db.select().from(appNotifications).where(where).orderBy(desc(appNotifications.createdAt)).limit(limit + 1),
    db.select({ n: count() }).from(appNotifications).where(and(eq(appNotifications.userId, userId), isNull(appNotifications.readAt))),
    localeOfUser(userId),
  ]);
  const items = rows.slice(0, limit).map((r) => toView(r, locale));
  return { items, next: rows.length > limit ? items[items.length - 1]!.createdAt : null, unread: unread?.n ?? 0 };
}

/** Marks some (or all) of the user's notifications read. Ids that aren't theirs are ignored. */
export async function markRead(userId: string, input: { ids?: string[]; all?: boolean }) {
  const now = new Date();
  if (input.all) {
    await db.update(appNotifications).set({ readAt: now }).where(and(eq(appNotifications.userId, userId), isNull(appNotifications.readAt)));
  } else if (input.ids?.length) {
    await db.update(appNotifications).set({ readAt: now }).where(and(eq(appNotifications.userId, userId), inArray(appNotifications.id, input.ids), isNull(appNotifications.readAt)));
  }
}

export async function markOne(userId: string, id: string, read: boolean): Promise<Notification> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new AppError("NOT_FOUND");
  const [row] = await db.update(appNotifications).set({ readAt: read ? new Date() : null }).where(and(eq(appNotifications.id, id), eq(appNotifications.userId, userId))).returning();
  if (!row) throw new AppError("NOT_FOUND");
  return toView(row, await localeOfUser(userId));
}

/** Registers this phone's Expo push token. A token moves to whoever signed in on that phone last. */
export async function registerDevice(userId: string, sessionId: string, input: { pushToken: string; platform: "ios" | "android" | "web"; name?: string }, ipHash: string | null) {
  if (!isExpoToken(input.pushToken)) throw new AppError("VALIDATION", { fields: { pushToken: "Expected an Expo push token" } });
  const values = { userId, sessionId, platform: input.platform, name: input.name ?? null, pushToken: input.pushToken, lastSeenAt: new Date(), disabledAt: null };
  return db.transaction(async (tx) => {
    const [d] = await tx.insert(appDevices).values(values).onConflictDoUpdate({ target: appDevices.pushToken, targetWhere: sql`push_token IS NOT NULL`, set: values }).returning({ id: appDevices.id });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "device.registered", entityType: "app_device", entityId: d!.id, summary: `Registered a ${input.platform} device for alerts`, ipHash });
    return d!.id;
  });
}

export async function unregisterDevice(userId: string, pushToken: string) {
  await db.update(appDevices).set({ disabledAt: new Date() }).where(and(eq(appDevices.userId, userId), eq(appDevices.pushToken, pushToken)));
}
