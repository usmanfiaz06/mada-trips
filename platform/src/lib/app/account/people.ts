import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import {
  PassportInput, firstNameOf, maskPassportNumber, type Person, type PersonDetails, type SavePassportRequest, type UpdatePersonRequest,
} from "@mada/shared";
import { db } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { appDocuments, appPersonDetails } from "@/db/app-schema-wallet";
import { appAuditLog } from "../audit";
import { encryptField, passportAad } from "../crypto";
import { AppError } from "../http";
import { toPerson } from "../people";
import { deleteFile, getFile } from "../documents/storage";

/*
 * The household beyond M0's list and add: one person with their details, a passport from a scan (or typed),
 * the helper's iqama and exit and re-entry visa, and removing someone. Owner checks on every call: a person who
 * isn't in your household is "not found", never "forbidden".
 */

type PersonRow = typeof appPeople.$inferSelect;
type DetailsRow = typeof appPersonDetails.$inferSelect;

const iqamaAad = (personId: string) => `app_person_details:${personId}:iqama`;
/** "2•••••4561" */
export const maskIqama = (n: string) => `${n.slice(0, 1)}•••••${n.slice(-4)}`;

export async function ownPerson(ownerId: string, personId: string): Promise<PersonRow> {
  const [p] = await db.select().from(appPeople).where(and(eq(appPeople.id, personId), eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt)));
  if (!p) throw new AppError("NOT_FOUND");
  return p;
}

export function toDetails(d: DetailsRow | undefined | null): PersonDetails {
  return {
    relationLabel: (d?.relationLabel as PersonDetails["relationLabel"]) ?? null,
    meal: (d?.meal as PersonDetails["meal"]) ?? null,
    iqamaMasked: d?.iqamaMasked ?? null,
    iqamaAt: d?.iqamaAt?.toISOString() ?? null,
    exitVisa: { kind: (d?.exitKind as PersonDetails["exitVisa"]["kind"]) ?? "none", until: d?.exitUntil ?? null },
  };
}

async function selfName(ownerId: string) {
  const [u] = await db.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, ownerId));
  return u?.name ?? "";
}

export async function getPersonDetail(ownerId: string, personId: string): Promise<{ person: Person; details: PersonDetails }> {
  const p = await ownPerson(ownerId, personId);
  const [d] = await db.select().from(appPersonDetails).where(eq(appPersonDetails.personId, personId));
  return { person: toPerson(p, await selfName(ownerId)), details: toDetails(d) };
}

/** Every person's details at once, for the household list. */
export async function listDetails(ownerId: string): Promise<Record<string, PersonDetails>> {
  const rows = await db.select({ d: appPersonDetails }).from(appPersonDetails).innerJoin(appPeople, eq(appPeople.id, appPersonDetails.personId))
    .where(and(eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt)));
  return Object.fromEntries(rows.map(({ d }) => [d.personId, toDetails(d)]));
}

export async function updatePerson(ownerId: string, personId: string, patch: UpdatePersonRequest, ipHash: string | null) {
  const p = await ownPerson(ownerId, personId);
  if (p.isSelf && patch.relationLabel) throw new AppError("VALIDATION", { fields: { relationLabel: "You are the account holder" } });
  await db.transaction(async (tx) => {
    const set: Partial<typeof appPersonDetails.$inferInsert> = { updatedAt: new Date() };
    if (patch.relationLabel !== undefined) set.relationLabel = patch.relationLabel;
    if (patch.meal !== undefined) set.meal = patch.meal;
    if (patch.iqama !== undefined) {
      set.iqamaEnc = patch.iqama ? encryptField(patch.iqama, iqamaAad(personId)) : null;
      set.iqamaMasked = patch.iqama ? maskIqama(patch.iqama) : null;
      set.iqamaAt = patch.iqama ? new Date() : null;
    }
    if (patch.exitVisa !== undefined) { set.exitKind = patch.exitVisa.kind; set.exitUntil = patch.exitVisa.kind === "none" ? null : patch.exitVisa.until; }
    await tx.insert(appPersonDetails).values({ personId, ...set }).onConflictDoUpdate({ target: appPersonDetails.personId, set });
    // The booking relation follows the everyday word.
    if (patch.relationLabel) {
      const rel = ({ Spouse: "spouse", Son: "child", Daughter: "child", Parent: "parent", Sibling: "family", Relative: "family", Friend: "friend", Helper: "helper", Colleague: "colleague" } as const)[patch.relationLabel];
      await tx.update(appPeople).set({ relation: rel, updatedAt: new Date() }).where(eq(appPeople.id, personId));
    }
    await appAuditLog(tx, {
      actorKind: "user", actorId: ownerId, action: patch.iqama !== undefined ? "person.iqama_saved" : "person.updated", entityType: "app_person", entityId: personId,
      summary: `Updated ${firstNameOf(p.givenNames) || "a traveller"}'s ${Object.keys(patch).join(", ")}`, data: { fields: Object.keys(patch) }, ipHash,
    });
  });
  return getPersonDetail(ownerId, personId);
}

/** A passport read on the phone (or typed). Names come with it, exactly as printed; the number is encrypted. */
export async function savePassport(ownerId: string, personId: string, input: SavePassportRequest, ipHash: string | null) {
  const p = await ownPerson(ownerId, personId);
  const pp = PassportInput.parse(input.passport);
  await db.transaction(async (tx) => {
    await tx.update(appPeople).set({
      givenNames: input.givenNames.trim().toUpperCase(), surname: input.surname.trim().toUpperCase(), dateOfBirth: input.dateOfBirth,
      sex: input.sex ?? p.sex, nationality: pp.nationality,
      passportNumberEnc: encryptField(pp.number, passportAad(personId)), passportNumberMasked: maskPassportNumber(pp.number),
      passportIssuingCountry: pp.issuingCountry, passportNationality: pp.nationality, passportExpiry: pp.expiry,
      passportSource: pp.source, passportUpdatedAt: new Date(), updatedAt: new Date(),
    }).where(eq(appPeople.id, personId));
    // The account holder's first name fills in what Mada calls them, if they skipped it.
    if (p.isSelf) {
      const [u] = await tx.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, ownerId));
      if (u && !u.name) await tx.update(appUsers).set({ name: firstNameOf(input.givenNames), updatedAt: new Date() }).where(eq(appUsers.id, ownerId));
    }
    await appAuditLog(tx, {
      actorKind: "user", actorId: ownerId, action: p.passportNumberEnc ? "passport.replaced" : "passport.saved", entityType: "app_person", entityId: personId,
      summary: `Saved ${firstNameOf(input.givenNames) || "a traveller"}'s passport (${maskPassportNumber(pp.number)})`, data: { source: pp.source, expiry: pp.expiry }, ipHash,
    });
  });
  return getPersonDetail(ownerId, personId);
}

/** Remove someone: their passport, details and documents go; bookings already made stay as they are. */
export async function removePerson(ownerId: string, personId: string, ipHash: string | null) {
  const p = await ownPerson(ownerId, personId);
  if (p.isSelf) throw new AppError("FORBIDDEN");
  const files = await db.select({ fileId: appDocuments.fileId }).from(appDocuments).where(and(eq(appDocuments.personId, personId), isNull(appDocuments.deletedAt)));
  await db.transaction(async (tx) => {
    await tx.update(appPeople).set({
      deletedAt: new Date(), passportNumberEnc: null, passportNumberMasked: null, passportExpiry: null, passportIssuingCountry: null,
      passportNationality: null, dateOfBirth: null, updatedAt: new Date(),
    }).where(eq(appPeople.id, personId));
    await tx.delete(appPersonDetails).where(eq(appPersonDetails.personId, personId));
    await tx.update(appDocuments).set({ deletedAt: new Date() }).where(and(eq(appDocuments.personId, personId), isNull(appDocuments.deletedAt)));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "person.removed", entityType: "app_person", entityId: personId, summary: `Removed ${firstNameOf(p.givenNames) || "a traveller"} from the household`, ipHash });
  });
  for (const { fileId } of files) {
    const f = fileId ? await getFile(fileId, ownerId) : null;
    if (f) await deleteFile(db, f);
  }
}

/** The account holder's own row in the household. */
export async function selfPersonId(ownerId: string): Promise<string> {
  const [p] = await db.select({ id: appPeople.id }).from(appPeople).where(and(eq(appPeople.ownerId, ownerId), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt)));
  if (p) return p.id;
  const [made] = await db.insert(appPeople).values({ ownerId, isSelf: true, relation: "self" }).returning({ id: appPeople.id });
  return made!.id;
}
