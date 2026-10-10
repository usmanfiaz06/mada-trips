import "server-only";
import { and, desc, eq, gt, inArray, isNull } from "drizzle-orm";
import { CreateDocumentMeta, t, type CopyKey, type DocumentGrant, type WalletDocument } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appTrips } from "@/db/app-schema";
import { appDocumentGrants, appDocuments, appFiles } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { deleteFile, getFile, readFileBytes, storeFile, type StoredFile } from "./storage";

/*
 * The document vault (FLOWS.md §7, §8c): visas, IDs, insurance and anything else, per person in the household.
 * Files are encrypted at rest (storage.ts). Faisal sees a document only through a grant for one trip, read-only,
 * and every view is written to the audit trail.
 */

type DocRow = typeof appDocuments.$inferSelect;
const DAY = 86_400_000;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const monthYear = (iso: string) => `${MONTHS[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

function toDocument(d: DocRow, file: Pick<StoredFile, "id" | "name" | "mime" | "size"> | null, sharedUntil: Date | null): WalletDocument {
  return {
    id: d.id, personId: d.personId, kind: d.kind as WalletDocument["kind"], title: d.title, detail: d.detail,
    validUntil: d.validUntil, fields: d.fields ?? {},
    file: file ? { id: file.id, name: file.name, mime: file.mime, size: file.size } : null,
    source: d.source as WalletDocument["source"], removable: d.removable,
    sharedUntil: sharedUntil?.toISOString() ?? null,
    createdAt: d.createdAt.toISOString(), updatedAt: d.updatedAt.toISOString(),
  };
}

async function hydrate(rows: DocRow[]): Promise<WalletDocument[]> {
  if (!rows.length) return [];
  const fileIds = rows.map((r) => r.fileId).filter((x): x is string => !!x);
  const files = fileIds.length ? await db.select({ id: appFiles.id, name: appFiles.name, mime: appFiles.mime, size: appFiles.size }).from(appFiles).where(and(inArray(appFiles.id, fileIds), isNull(appFiles.deletedAt))) : [];
  const grants = await db.select({ documentId: appDocumentGrants.documentId, expiresAt: appDocumentGrants.expiresAt }).from(appDocumentGrants)
    .where(and(inArray(appDocumentGrants.documentId, rows.map((r) => r.id)), isNull(appDocumentGrants.revokedAt), gt(appDocumentGrants.expiresAt, new Date())));
  return rows.map((r) => {
    const until = grants.filter((g) => g.documentId === r.id).map((g) => g.expiresAt).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    return toDocument(r, files.find((f) => f.id === r.fileId) ?? null, until);
  });
}

async function ownPerson(ownerId: string, personId: string) {
  const [p] = await db.select({ id: appPeople.id, givenNames: appPeople.givenNames, isSelf: appPeople.isSelf }).from(appPeople)
    .where(and(eq(appPeople.id, personId), eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt)));
  if (!p) throw new AppError("NOT_FOUND");
  return p;
}

async function ownDocument(ownerId: string, id: string): Promise<DocRow> {
  const [d] = await db.select().from(appDocuments).where(and(eq(appDocuments.id, id), eq(appDocuments.ownerId, ownerId), isNull(appDocuments.deletedAt)));
  if (!d) throw new AppError("NOT_FOUND");
  return d;
}

export async function listDocuments(ownerId: string, personId?: string): Promise<WalletDocument[]> {
  const rows = await db.select().from(appDocuments)
    .where(and(eq(appDocuments.ownerId, ownerId), isNull(appDocuments.deletedAt), ...(personId ? [eq(appDocuments.personId, personId)] : [])))
    .orderBy(appDocuments.createdAt);
  return hydrate(rows);
}

export async function getDocument(ownerId: string, id: string): Promise<WalletDocument> {
  return (await hydrate([await ownDocument(ownerId, id)]))[0]!;
}

const TITLE_KEY: Record<WalletDocument["kind"], CopyKey> = {
  passport: "docs.title.passport", visa: "docs.title.visa", national_id: "docs.title.national_id", iqama: "docs.title.iqama",
  exit_reentry: "docs.title.exit_reentry", insurance: "docs.title.insurance", other: "docs.title.other",
};

/** Save a document (with its file, if any). With `replaces`, the old one goes once the new one is saved. */
export async function createDocument(
  ownerId: string, rawMeta: unknown, file: { name: string; mime: string; bytes: Buffer } | null, ipHash: string | null,
): Promise<WalletDocument> {
  const parsed = CreateDocumentMeta.safeParse(rawMeta ?? {});
  if (!parsed.success) {
    const fields: Record<string, string> = {};
    for (const i of parsed.error.issues) fields[i.path.join(".") || "_"] ??= i.message;
    throw new AppError("VALIDATION", { fields });
  }
  const meta = parsed.data;
  const person = await ownPerson(ownerId, meta.personId);
  const old = meta.replaces ? await ownDocument(ownerId, meta.replaces) : null;
  if (old && old.personId !== meta.personId) throw new AppError("VALIDATION", { fields: { replaces: "Another person's document" } });
  const detail = meta.detail ?? (meta.validUntil ? t("wallet.docs.validUntil", { date: monthYear(meta.validUntil) }) : t("wallet.docs.added"));

  const saved = await db.transaction(async (tx) => {
    const f = file ? await storeFile(tx, ownerId, "document", file) : null;
    const [row] = await tx.insert(appDocuments).values({
      ownerId, personId: person.id, kind: meta.kind, title: meta.title ?? t(TITLE_KEY[meta.kind]), detail,
      validUntil: meta.validUntil ?? null, fields: meta.fields ?? {}, fileId: f?.id ?? null, source: meta.source,
    }).returning();
    await appAuditLog(tx, {
      actorKind: "user", actorId: ownerId, action: old ? "document.replaced" : "document.added", entityType: "app_document", entityId: row!.id,
      summary: `${old ? "Replaced" : "Added"} a ${meta.kind.replace("_", " ")} document${f ? ` (${f.mime}, ${Math.ceil(f.size / 1024)} KB)` : ""}`,
      data: { personId: person.id, kind: meta.kind, replaces: old?.id ?? null }, ipHash,
    });
    if (old) await tx.update(appDocuments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(appDocuments.id, old.id));
    return row!;
  });
  if (old?.fileId) {
    const of = await getFile(old.fileId, ownerId);
    if (of) await deleteFile(db, of);
  }
  return getDocument(ownerId, saved.id);
}

export async function deleteDocument(ownerId: string, id: string, ipHash: string | null): Promise<void> {
  const d = await ownDocument(ownerId, id);
  if (!d.removable) throw new AppError("FORBIDDEN", { copy: "wallet.docs.setup" });
  await db.transaction(async (tx) => {
    await tx.update(appDocuments).set({ deletedAt: new Date(), updatedAt: new Date() }).where(eq(appDocuments.id, id));
    await tx.update(appDocumentGrants).set({ revokedAt: new Date() }).where(and(eq(appDocumentGrants.documentId, id), isNull(appDocumentGrants.revokedAt)));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "document.deleted", entityType: "app_document", entityId: id, summary: `Deleted a ${d.kind.replace("_", " ")} document`, ipHash });
  });
  if (d.fileId) {
    const f = await getFile(d.fileId, ownerId);
    if (f) await deleteFile(db, f);
  }
}

/** The owner opens their own file. Logged, like every view. */
export async function readDocumentFile(ownerId: string, id: string, ipHash: string | null): Promise<{ file: StoredFile; bytes: Buffer }> {
  const d = await ownDocument(ownerId, id);
  const file = d.fileId ? await getFile(d.fileId, ownerId) : null;
  if (!file) throw new AppError("NOT_FOUND");
  const bytes = await readFileBytes(file);
  await appAuditLog(db, { actorKind: "user", actorId: ownerId, action: "document.viewed", entityType: "app_document", entityId: id, summary: "Opened their own document", ipHash });
  return { file, bytes };
}

/**
 * Let Faisal see a document for one trip: read-only, until the trip ends (the day after it ends), or the date given,
 * or 30 days when there's no trip. One live grant per document; sharing again moves its end.
 */
export async function shareDocument(ownerId: string, id: string, opts: { tripId?: string; until?: string }, ipHash: string | null): Promise<DocumentGrant> {
  await ownDocument(ownerId, id);
  let end: Date;
  if (opts.tripId) {
    const [trip] = await db.select({ startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(and(eq(appTrips.id, opts.tripId), eq(appTrips.ownerId, ownerId)));
    if (!trip) throw new AppError("NOT_FOUND");
    end = new Date(Date.parse(`${trip.endDate ?? trip.startDate}T00:00:00+03:00`) + 2 * DAY);
  } else end = new Date(Date.now() + 30 * DAY);
  if (opts.until) {
    const u = new Date(Date.parse(`${opts.until}T23:59:59+03:00`));
    if (u.getTime() <= Date.now()) throw new AppError("VALIDATION", { fields: { until: "In the past" } });
    if (u < end) end = u;
  }
  return db.transaction(async (tx) => {
    await tx.update(appDocumentGrants).set({ revokedAt: new Date() }).where(and(eq(appDocumentGrants.documentId, id), isNull(appDocumentGrants.revokedAt)));
    const [g] = await tx.insert(appDocumentGrants).values({ documentId: id, ownerId, tripId: opts.tripId ?? null, expiresAt: end }).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "document.shared", entityType: "app_document", entityId: id, summary: `Shared a document with Mada until ${end.toISOString().slice(0, 10)}`, data: { tripId: opts.tripId ?? null }, ipHash });
    return { id: g!.id, documentId: id, tripId: g!.tripId, expiresAt: g!.expiresAt.toISOString(), revokedAt: null, createdAt: g!.createdAt.toISOString() };
  });
}

export async function revokeShare(ownerId: string, id: string, ipHash: string | null): Promise<void> {
  await ownDocument(ownerId, id);
  await db.transaction(async (tx) => {
    await tx.update(appDocumentGrants).set({ revokedAt: new Date() }).where(and(eq(appDocumentGrants.documentId, id), isNull(appDocumentGrants.revokedAt)));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "document.unshared", entityType: "app_document", entityId: id, summary: "Stopped sharing a document with Mada", ipHash });
  });
}

/**
 * For the desk (Ops): an agent opens a shared document. Only with a live grant; the view is audited with the agent.
 * The desk shows it inline and never offers a download (the grant is read-only).
 */
export async function agentReadDocument(documentId: string, agent: { opsUserId: string; name: string }): Promise<{ document: WalletDocument; file: StoredFile | null; bytes: Buffer | null }> {
  const [g] = await db.select({ id: appDocumentGrants.id }).from(appDocumentGrants)
    .where(and(eq(appDocumentGrants.documentId, documentId), isNull(appDocumentGrants.revokedAt), gt(appDocumentGrants.expiresAt, new Date())))
    .orderBy(desc(appDocumentGrants.expiresAt)).limit(1);
  if (!g) throw new AppError("FORBIDDEN");
  const [d] = await db.select().from(appDocuments).where(and(eq(appDocuments.id, documentId), isNull(appDocuments.deletedAt)));
  if (!d) throw new AppError("NOT_FOUND");
  const file = d.fileId ? await getFile(d.fileId) : null;
  const bytes = file ? await readFileBytes(file) : null;
  await appAuditLog(db, { actorKind: "agent", actorId: agent.opsUserId, action: "document.agent_viewed", entityType: "app_document", entityId: documentId, summary: `${agent.name} viewed a shared document`, data: { grantId: g.id } });
  return { document: (await hydrate([d]))[0]!, file, bytes };
}

/** Documents shared with Mada right now, for the desk's view of one traveller. */
export async function sharedDocuments(ownerId: string): Promise<WalletDocument[]> {
  const live = await db.select({ documentId: appDocumentGrants.documentId }).from(appDocumentGrants)
    .where(and(eq(appDocumentGrants.ownerId, ownerId), isNull(appDocumentGrants.revokedAt), gt(appDocumentGrants.expiresAt, new Date())));
  if (!live.length) return [];
  const rows = await db.select().from(appDocuments).where(and(inArray(appDocuments.id, live.map((l) => l.documentId)), isNull(appDocuments.deletedAt)));
  return hydrate(rows);
}
