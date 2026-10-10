import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull, lte, sql } from "drizzle-orm";
import { t, type ExportStatus } from "@mada/shared";
import { db } from "@/db";
import { appCreditLedger, appMessages, appNotifications, appPeople, appRequests, appSessions, appTrackedFlights, appTrips, appUsers } from "@/db/app-schema";
import { appAccounts, appCards, appDataExports, appDocuments, appEmailCodes, appFiles, appPersonDetails, appSupportThreads } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { listPeople } from "../people";
import { suppliers } from "../suppliers";
import { listDocuments } from "../documents";
import { deleteFile, readFileBytes, storeFile, getFile } from "../documents/storage";
import { getCredit } from "../credit";
import { accountRow, getAccount, getConsents } from "./index";
import { listCards } from "./cards";
import { listDetails } from "./people";

/*
 * Privacy (Account.jsx → Privacy, FLOWS.md §9, PDPL): a copy of everything by email, and deletion with 30 days to
 * change your mind. Deletion anonymises rather than removing the account row: app_credit_ledger and app_audit are
 * append-only evidence and keep pointing at a user that no longer has a name, phone, email or sign-in. Receipts
 * (app_invoices, app_payments) stay for 5 years as the law asks; everything personal goes.
 */

const DAY = 86_400_000;
export const DELETE_AFTER_DAYS = 30;
export const EXPORT_LINK_DAYS = 7;

/* ───────────── deletion ───────────── */

export async function scheduleDeletion(userId: string, ipHash: string | null): Promise<Date> {
  const at = new Date(Date.now() + DELETE_AFTER_DAYS * DAY);
  await accountRow(userId);
  await db.update(appAccounts).set({ deleteAt: at, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.deletion_scheduled", entityType: "app_user", entityId: userId, summary: `Asked to delete the account on ${at.toISOString().slice(0, 10)}`, ipHash });
  return at;
}

export async function cancelDeletion(userId: string, ipHash: string | null): Promise<void> {
  await accountRow(userId);
  await db.update(appAccounts).set({ deleteAt: null, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.deletion_cancelled", entityType: "app_user", entityId: userId, summary: "Cancelled the account deletion", ipHash });
}

/**
 * Anonymise one account now. Idempotent. The user row stays as a tombstone (no name, phone, email or sign-in) so the
 * credit ledger, payments and audit trail still add up; every personal row and every file is removed.
 */
export async function anonymiseAccount(userId: string, actor: { kind: "user" | "system" | "agent"; id: string | null } = { kind: "system", id: null }): Promise<void> {
  const files = await db.select({ id: appFiles.id, storage: appFiles.storage, storageKey: appFiles.storageKey }).from(appFiles).where(and(eq(appFiles.ownerId, userId), isNull(appFiles.deletedAt)));
  await db.transaction(async (tx) => {
    const threads = await tx.select({ id: appSupportThreads.id }).from(appSupportThreads).where(eq(appSupportThreads.userId, userId));
    if (threads.length) await tx.delete(appMessages).where(and(eq(appMessages.threadKind, "support"), inArray(appMessages.threadId, threads.map((x) => x.id))));
    await tx.delete(appSupportThreads).where(eq(appSupportThreads.userId, userId));
    await tx.delete(appDocuments).where(eq(appDocuments.ownerId, userId));
    const people = await tx.select({ id: appPeople.id }).from(appPeople).where(eq(appPeople.ownerId, userId));
    if (people.length) await tx.delete(appPersonDetails).where(inArray(appPersonDetails.personId, people.map((p) => p.id)));
    await tx.delete(appPeople).where(eq(appPeople.ownerId, userId));
    await tx.delete(appCards).where(eq(appCards.userId, userId));
    await tx.delete(appEmailCodes).where(eq(appEmailCodes.userId, userId));
    await tx.delete(appDataExports).where(eq(appDataExports.userId, userId));
    await tx.delete(appNotifications).where(eq(appNotifications.userId, userId));
    await tx.delete(appTrackedFlights).where(eq(appTrackedFlights.userId, userId));
    // Trips and requests go (bookings stay with the airline and hotel); payments and invoices stay as receipts.
    await tx.delete(appRequests).where(eq(appRequests.ownerId, userId));
    await tx.delete(appTrips).where(eq(appTrips.ownerId, userId));
    await tx.update(appSessions).set({ revokedAt: new Date(), revokedReason: "account_deleted", ip: null, userAgent: null, deviceName: null }).where(eq(appSessions.userId, userId));
    await tx.update(appAccounts).set({ preferredName: null, prefs: {}, photoFileId: null, photoAt: null, deleteAt: null, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
    await tx.update(appUsers).set({ phone: null, email: null, emailRelay: false, name: "", appleSub: null, googleSub: null, supabaseUserId: null, authProviders: [], emailVerified: false, phoneVerified: false, deletedAt: sql`COALESCE(${appUsers.deletedAt}, now())`, updatedAt: new Date() }).where(eq(appUsers.id, userId));
    await appAuditLog(tx, { actorKind: actor.kind, actorId: actor.id, action: "account.anonymised", entityType: "app_user", entityId: userId, summary: "Account deleted: personal details and files removed, receipts and ledger kept anonymous" });
  });
  for (const f of files) await deleteFile(db, f);
}

/** Run daily: every account whose 30 days are up. Returns how many were anonymised. */
export async function purgeDueAccounts(now = new Date()): Promise<number> {
  const due = await db.select({ userId: appAccounts.userId }).from(appAccounts).where(and(isNotNull(appAccounts.deleteAt), lte(appAccounts.deleteAt, now)));
  for (const { userId } of due) await anonymiseAccount(userId);
  return due.length;
}

/* ───────────── a copy of everything ───────────── */

type ExportRow = typeof appDataExports.$inferSelect;
const toExport = (e: ExportRow): ExportStatus => ({
  id: e.id, status: e.status as ExportStatus["status"], email: e.email, requestedAt: e.requestedAt.toISOString(),
  readyAt: e.readyAt?.toISOString() ?? null, expiresAt: e.expiresAt?.toISOString() ?? null,
});

export async function latestExport(userId: string): Promise<ExportStatus | null> {
  const [e] = await db.select().from(appDataExports).where(eq(appDataExports.userId, userId)).orderBy(desc(appDataExports.requestedAt)).limit(1);
  if (!e) return null;
  if (e.expiresAt && e.expiresAt < new Date() && e.status !== "expired") return { ...toExport(e), status: "expired" };
  return toExport(e);
}

/** Ask for a copy. One at a time: a request in the last 24 hours that hasn't expired is returned as is. */
export async function requestExport(userId: string, ipHash: string | null): Promise<ExportStatus> {
  const [u] = await db.select({ email: appUsers.email }).from(appUsers).where(eq(appUsers.id, userId));
  if (!u?.email) throw new AppError("VALIDATION", { copy: "error.emailNeeded", fields: { email: "missing" } });
  const latest = await latestExport(userId);
  if (latest && latest.status !== "expired" && Date.now() - Date.parse(latest.requestedAt) < DAY) return latest;
  const [e] = await db.insert(appDataExports).values({ userId, email: u.email }).returning();
  await accountRow(userId);
  await db.update(appAccounts).set({ exportRequestedAt: e!.requestedAt, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.export_requested", entityType: "app_data_export", entityId: e!.id, summary: "Asked for a copy of everything", ipHash });
  return toExport(e!);
}

/** Everything we hold for one account, as one JSON document (passport and iqama numbers stay masked). */
export async function buildExport(userId: string): Promise<Record<string, unknown>> {
  const [user] = await db.select().from(appUsers).where(eq(appUsers.id, userId));
  const threads = await db.select().from(appSupportThreads).where(eq(appSupportThreads.userId, userId));
  const messages = threads.length ? await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), inArray(appMessages.threadId, threads.map((x) => x.id)))) : [];
  return {
    generatedAt: new Date().toISOString(),
    account: { name: user?.name, phone: user?.phone, email: user?.email, createdAt: user?.createdAt, settings: await getAccount(userId), consents: await getConsents(userId) },
    household: await listPeople(userId),
    householdDetails: await listDetails(userId),
    documents: await listDocuments(userId),
    trips: await db.select().from(appTrips).where(eq(appTrips.ownerId, userId)),
    cards: (await listCards(userId)).cards,
    credit: await getCredit(userId),
    support: threads.map((th) => ({ about: th.about, createdAt: th.createdAt, messages: messages.filter((m) => m.threadId === th.id).map((m) => ({ from: m.authorKind, name: m.authorName, body: m.body, at: m.createdAt })) })),
    notifications: await db.select({ title: appNotifications.title, body: appNotifications.body, at: appNotifications.createdAt }).from(appNotifications).where(eq(appNotifications.userId, userId)),
    creditLedgerRows: (await db.select({ n: sql<number>`count(*)::int` }).from(appCreditLedger).where(eq(appCreditLedger.userId, userId)))[0]?.n ?? 0,
  };
}

/** The worker step: build, store encrypted, email the link. Run for every pending export. */
export async function processExport(exportId: string, linkBase = process.env.APP_PUBLIC_URL ?? "https://madatrips.sa"): Promise<ExportStatus> {
  const [e] = await db.select().from(appDataExports).where(eq(appDataExports.id, exportId));
  if (!e) throw new AppError("NOT_FOUND");
  if (e.status !== "pending") return toExport(e);
  const json = Buffer.from(JSON.stringify(await buildExport(e.userId), null, 2));
  const f = await storeFile(db, e.userId, "export", { name: "mada-trips-copy.json", mime: "application/json", bytes: json });
  const expiresAt = new Date(Date.now() + EXPORT_LINK_DAYS * DAY);
  const [done] = await db.update(appDataExports).set({ status: "sent", fileId: f.id, readyAt: new Date(), expiresAt }).where(eq(appDataExports.id, exportId)).returning();
  await suppliers.email().send({ to: e.email, subject: t("privacy.exportEmail.subject"), text: t("privacy.exportEmail.body", { link: `${linkBase}/app/export/${exportId}` }) });
  await appAuditLog(db, { actorKind: "system", actorId: null, action: "account.export_sent", entityType: "app_data_export", entityId: exportId, summary: "Sent the copy of everything by email" });
  return toExport(done!);
}

export async function processPendingExports(): Promise<number> {
  const pending = await db.select({ id: appDataExports.id }).from(appDataExports).where(eq(appDataExports.status, "pending"));
  for (const p of pending) await processExport(p.id);
  return pending.length;
}

/** The owner downloads their copy, signed in, while the link is live. */
export async function readExport(userId: string, exportId: string) {
  const [e] = await db.select().from(appDataExports).where(and(eq(appDataExports.id, exportId), eq(appDataExports.userId, userId)));
  if (!e || !e.fileId || !e.expiresAt || e.expiresAt < new Date()) throw new AppError("NOT_FOUND");
  const f = await getFile(e.fileId, userId);
  if (!f) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.export_downloaded", entityType: "app_data_export", entityId: exportId, summary: "Downloaded the copy of everything" });
  return { file: f, bytes: await readFileBytes(f) };
}

/* ───────────── profile photo ───────────── */

export async function setPhoto(userId: string, file: { name: string; mime: string; bytes: Buffer }, ipHash: string | null) {
  const acc = await accountRow(userId);
  const f = await storeFile(db, userId, "photo", file);
  await db.update(appAccounts).set({ photoFileId: f.id, photoAt: new Date(), updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.photo_set", entityType: "app_user", entityId: userId, summary: "Changed the profile photo", ipHash });
  if (acc.photoFileId) { const old = await getFile(acc.photoFileId, userId); if (old) await deleteFile(db, old); }
  return getAccount(userId);
}

export async function removePhoto(userId: string, ipHash: string | null) {
  const acc = await accountRow(userId);
  await db.update(appAccounts).set({ photoFileId: null, photoAt: null, updatedAt: new Date() }).where(eq(appAccounts.userId, userId));
  if (acc.photoFileId) { const old = await getFile(acc.photoFileId, userId); if (old) await deleteFile(db, old); }
  await appAuditLog(db, { actorKind: "user", actorId: userId, action: "account.photo_removed", entityType: "app_user", entityId: userId, summary: "Removed the profile photo", ipHash });
  return getAccount(userId);
}

export async function readPhoto(userId: string) {
  const acc = await accountRow(userId);
  const f = acc.photoFileId ? await getFile(acc.photoFileId, userId) : null;
  if (!f) throw new AppError("NOT_FOUND");
  return { file: f, bytes: await readFileBytes(f) };
}
