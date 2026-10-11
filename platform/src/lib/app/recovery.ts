import "server-only";
import { and, count, eq, gt, isNull, sql } from "drizzle-orm";
import { RECOVERY_LIMITS, checkSaudiMobile, maskPhone, type RecoveryContact, type RecoveryRequest, type RecoveryResponse } from "@mada/shared";
import { db } from "@/db";
import { appUsers } from "@/db/app-schema";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { appAuditLog } from "./audit";
import { AppError } from "./http";

/*
 * "I can't use this number or email any more" (docs/app/AUTH.md). Signed out, so the answer is always the same
 * { received: true } whether or not an account uses the old contact: nobody can use this to learn who has an account.
 * The match is kept for the desk only. Limits, counted from the table itself: 5 per network an hour, 3 per old
 * contact a day (both the same whether or not an account matched).
 */

export type Contact = { kind: "phone" | "email"; value: string };

/** E.164 for a phone, lower case for an email. A phone that isn't a Saudi mobile is a field problem. */
export function normaliseContact(c: RecoveryContact, field: string): Contact {
  if (c.kind === "email") return { kind: "email", value: c.value.trim().toLowerCase() };
  const r = checkSaudiMobile(c.value);
  if (!r.ok) throw new AppError("VALIDATION", { fields: { [field]: r.problem } });
  return { kind: "phone", value: r.e164 };
}

/** "+966 •• ••• 4567" or "s•••@example.com": enough for a log line or the desk list, never the whole thing. */
export function maskContact(c: Contact): string {
  if (c.kind === "phone") return maskPhone(c.value);
  const [local = "", domain = ""] = c.value.split("@");
  return `${local.slice(0, 1)}•••@${domain}`;
}

/** The live account that signs in with this contact, if any. */
export async function accountFor(c: Contact): Promise<string | null> {
  const where = c.kind === "phone" ? eq(appUsers.phone, c.value) : sql`lower(${appUsers.email}) = ${c.value}`;
  const [u] = await db.select({ id: appUsers.id }).from(appUsers).where(and(where, isNull(appUsers.deletedAt))).limit(1);
  return u?.id ?? null;
}

export async function requestRecovery(input: RecoveryRequest, ctx: { ipHash: string | null }, now = new Date()): Promise<RecoveryResponse> {
  const oldContact = normaliseContact(input.oldContact, "oldContact.value");
  const newContact = normaliseContact(input.newContact, "newContact.value");
  if (oldContact.value === newContact.value) throw new AppError("VALIDATION", { fields: { "newContact.value": "same" } });

  const hourAgo = new Date(now.getTime() - 3_600_000);
  const dayAgo = new Date(now.getTime() - 86_400_000);
  if (ctx.ipHash) {
    const [{ n }] = (await db.select({ n: count() }).from(appRecoveryRequests).where(and(eq(appRecoveryRequests.ipHash, ctx.ipHash), gt(appRecoveryRequests.createdAt, hourAgo)))) as [{ n: number }];
    if (n >= RECOVERY_LIMITS.perIpPerHour) throw new AppError("RATE_LIMITED", { copy: "recover.tooMany", retryAfter: 3600 });
  }
  const [{ n: perContact }] = (await db.select({ n: count() }).from(appRecoveryRequests).where(and(eq(appRecoveryRequests.oldValue, oldContact.value), gt(appRecoveryRequests.createdAt, dayAgo)))) as [{ n: number }];
  if (perContact >= RECOVERY_LIMITS.perContactPerDay) throw new AppError("RATE_LIMITED", { copy: "recover.tooMany", retryAfter: 86_400 });

  const matchedUserId = await accountFor(oldContact);
  await db.transaction(async (tx) => {
    const [row] = await tx.insert(appRecoveryRequests).values({
      name: input.name.trim(), oldKind: oldContact.kind, oldValue: oldContact.value, newKind: newContact.kind, newValue: newContact.value,
      note: input.note?.trim() || null, locale: input.locale ?? "en", matchedUserId, ipHash: ctx.ipHash, createdAt: now, updatedAt: now,
    }).returning({ id: appRecoveryRequests.id });
    await appAuditLog(tx, {
      actorKind: "system", actorId: null, action: "auth.recovery_requested", entityType: "recovery_request", entityId: row!.id,
      summary: `Asked to move an account from ${maskContact(oldContact)} to ${maskContact(newContact)}`,
      data: { matched: !!matchedUserId }, ipHash: ctx.ipHash,
    });
  });
  return { received: true };
}
