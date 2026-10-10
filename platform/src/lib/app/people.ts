import "server-only";
import { randomUUID } from "node:crypto";
import { and, asc, desc, eq, isNull } from "drizzle-orm";
import { PassportInput, firstNameOf, maskPassportNumber, type CreatePersonRequest, type Person } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { encryptField, passportAad } from "./crypto";

type PersonRow = typeof appPeople.$inferSelect;

/** The API shape. The passport number only ever leaves masked; the ciphertext never leaves at all. */
export function toPerson(p: PersonRow, selfName = ""): Person {
  const firstName = firstNameOf(p.givenNames) || (p.isSelf ? selfName : "");
  return {
    id: p.id, isSelf: p.isSelf, givenNames: p.givenNames, surname: p.surname, firstName,
    relation: p.relation as Person["relation"], dateOfBirth: p.dateOfBirth, sex: (p.sex as Person["sex"]) ?? null, nationality: p.nationality,
    passport: p.passportNumberMasked && p.passportExpiry && p.passportIssuingCountry && p.passportNationality
      ? { numberMasked: p.passportNumberMasked, issuingCountry: p.passportIssuingCountry, nationality: p.passportNationality, expiry: p.passportExpiry, source: (p.passportSource as "scan" | "manual" | "import") ?? "manual", updatedAt: (p.passportUpdatedAt ?? p.updatedAt).toISOString() }
      : null,
    createdAt: p.createdAt.toISOString(),
  };
}

export async function listPeople(ownerId: string): Promise<Person[]> {
  const [u] = await db.select({ name: appUsers.name }).from(appUsers).where(eq(appUsers.id, ownerId));
  const rows = await db.select().from(appPeople)
    .where(and(eq(appPeople.ownerId, ownerId), isNull(appPeople.deletedAt)))
    .orderBy(desc(appPeople.isSelf), asc(appPeople.createdAt));
  return rows.map((r) => toPerson(r, u?.name ?? ""));
}

export async function createPerson(ownerId: string, input: CreatePersonRequest, ipHash: string | null): Promise<Person> {
  const id = randomUUID();
  const passport = input.passport ? PassportInput.parse(input.passport) : null;
  return db.transaction(async (tx) => {
    const [row] = await tx.insert(appPeople).values({
      id, ownerId, isSelf: false, givenNames: input.givenNames.trim(), surname: input.surname.trim(), relation: input.relation,
      dateOfBirth: input.dateOfBirth ?? null, sex: input.sex ?? null, nationality: input.nationality ?? passport?.nationality ?? null,
      ...(passport ? {
        passportNumberEnc: encryptField(passport.number, passportAad(id)),
        passportNumberMasked: maskPassportNumber(passport.number),
        passportIssuingCountry: passport.issuingCountry, passportNationality: passport.nationality, passportExpiry: passport.expiry,
        passportSource: passport.source, passportUpdatedAt: new Date(),
      } : {}),
    }).returning();
    const name = firstNameOf(input.givenNames);
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "person.created", entityType: "app_person", entityId: id, summary: `Added ${name} (${input.relation}) to the household`, ipHash });
    if (passport) {
      await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "passport.saved", entityType: "app_person", entityId: id, summary: `Saved ${name}'s passport (${maskPassportNumber(passport.number)})`, data: { source: passport.source, expiry: passport.expiry }, ipHash });
    }
    return toPerson(row!);
  });
}
