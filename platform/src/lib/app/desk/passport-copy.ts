import "server-only";
import { and, desc, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { needsPassports } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appRequests, appTrips } from "@/db/app-schema";
import { appDocuments } from "@/db/app-schema-wallet";
import { getFile, readFileBytes, type StoredFile } from "../documents/storage";
import { assertCap, deskAudit, DeskError, shortRef, type DeskActor } from "./core";

/*
 * The passport copy (a photo or PDF of the photo page the traveller chose to keep, encrypted at rest) for the desk.
 * An agent sees it only through a booking that needs it: the person is a traveller on that request, the request asks
 * for passports (a flight, a package, a visa, Umrah), it isn't cancelled, and it's still live (until 30 days after the
 * trip ends, or 90 days after the request last changed when there's no trip). Every look lands in both audit trails.
 */

const DAY = 86_400_000;
/** How long after a trip (or a request without one) the desk can still open its travellers' copies. */
export const COPY_WINDOW = { afterTripDays: 30, idleRequestDays: 90 } as const;

type RequestRow = { id: string; ownerId: string; kind: string; status: string; travellerIds: string[]; tripId: string | null; updatedAt: Date };

/** Whether this request still opens its travellers' passport copies today. */
export async function copyWindowOpen(r: RequestRow, now = new Date()): Promise<boolean> {
  if (!needsPassports(r.kind) || r.status === "cancelled") return false;
  if (r.tripId) {
    const [trip] = await db.select({ startDate: appTrips.startDate, endDate: appTrips.endDate }).from(appTrips).where(eq(appTrips.id, r.tripId));
    if (trip) return now.getTime() <= Date.parse(`${trip.endDate ?? trip.startDate}T23:59:59+03:00`) + COPY_WINDOW.afterTripDays * DAY;
  }
  return now.getTime() - r.updatedAt.getTime() <= COPY_WINDOW.idleRequestDays * DAY;
}

/** Which of these travellers have a passport copy on file (for the desk's Travellers table). */
export async function travellersWithCopy(personIds: string[]): Promise<Set<string>> {
  if (!personIds.length) return new Set();
  const rows = await db.select({ personId: appDocuments.personId }).from(appDocuments)
    .where(and(inArray(appDocuments.personId, personIds), eq(appDocuments.kind, "passport"), isNotNull(appDocuments.fileId), isNull(appDocuments.deletedAt)));
  return new Set(rows.map((r) => r.personId));
}

/** An agent opens a traveller's passport copy for one booking. Shown inline, never offered as a download. */
export async function readPassportCopy(actor: DeskActor, requestId: string, personId: string): Promise<{ file: StoredFile; bytes: Buffer }> {
  assertCap(actor, "desk.act");
  const [r] = await db.select({ id: appRequests.id, ownerId: appRequests.ownerId, kind: appRequests.kind, status: appRequests.status, travellerIds: appRequests.travellerIds, tripId: appRequests.tripId, updatedAt: appRequests.updatedAt })
    .from(appRequests).where(eq(appRequests.id, requestId));
  if (!r) throw new DeskError("Not found", "NOT_FOUND");
  if (!r.travellerIds.includes(personId)) throw new DeskError("That traveller isn't on this booking", "FORBIDDEN");
  if (!(await copyWindowOpen(r))) throw new DeskError("This booking doesn't need the passport copy now", "FORBIDDEN");
  const [doc] = await db.select({ id: appDocuments.id, fileId: appDocuments.fileId }).from(appDocuments)
    .where(and(eq(appDocuments.ownerId, r.ownerId), eq(appDocuments.personId, personId), eq(appDocuments.kind, "passport"), isNull(appDocuments.deletedAt)))
    .orderBy(desc(appDocuments.createdAt)).limit(1);
  const file = doc?.fileId ? await getFile(doc.fileId, r.ownerId) : null;
  if (!doc || !file) throw new DeskError("No passport copy on file", "NOT_FOUND");
  const bytes = await readFileBytes(file);
  const [p] = await db.select({ givenNames: appPeople.givenNames, surname: appPeople.surname }).from(appPeople).where(eq(appPeople.id, personId));
  await db.transaction((tx) => deskAudit(tx, actor, {
    action: "document.agent_viewed", entityType: "app_document", entityId: doc.id, ref: shortRef(requestId, "R"),
    summary: `${actor.name} viewed ${p?.givenNames || "a traveller"}'s passport copy for a booking`, data: { requestId, personId },
  }));
  return { file, bytes };
}
