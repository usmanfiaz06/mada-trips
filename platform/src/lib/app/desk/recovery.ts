import "server-only";
import { and, asc, desc, eq, inArray, isNull, ne, sql } from "drizzle-orm";
import { DESK_PHONE, t, type CopyLocale } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appRequests, appSessions, appUsers } from "@/db/app-schema";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { suppliers } from "@/lib/app/suppliers";
import { maskContact, type Contact } from "@/lib/app/recovery";
import { assertCap, deskAudit, DeskError, travellerName, type DeskActor } from "./core";

/*
 * Account recovery on the desk. Someone who can't use their old number or email asked (signed out) for the account
 * to move to a new contact. The agent checks it's them against what's on file (the passport, the last booking), then:
 *   approve  → the account's phone or email becomes the new one, on our side and in Supabase Auth (admin API), every
 *              session on the account ends, and the new contact gets a text or email saying so;
 *   decline  → nothing changes; the new contact hears it plainly, with the desk's number.
 * A move to the same kind (phone → phone, email → email) replaces it in place. A move across kinds gives the account a
 * new Supabase user holding only the new contact and removes the old one, so whoever holds the old number or address
 * next can't sign in to this account with it.
 */

export type RecoveryStatus = "open" | "approved" | "declined";
type Row = typeof appRecoveryRequests.$inferSelect;
const contactOf = (kind: string, value: string): Contact => ({ kind: kind === "email" ? "email" : "phone", value });

/** The requests, with what the desk needs to check it's them: the matched account, its passport on file, its last booking. */
export async function listRecovery(status: "open" | "closed" = "open") {
  const open = status === "open";
  const rows = await db.select().from(appRecoveryRequests)
    .where(open ? eq(appRecoveryRequests.status, "open") : ne(appRecoveryRequests.status, "open"))
    .orderBy(open ? asc(appRecoveryRequests.createdAt) : desc(appRecoveryRequests.decidedAt)).limit(200);
  const ids = [...new Set(rows.map((r) => r.matchedUserId).filter((x): x is string => !!x))];
  const [accounts, selves, last] = ids.length ? await Promise.all([
    db.select({ id: appUsers.id, name: appUsers.name, phone: appUsers.phone, email: appUsers.email, createdAt: appUsers.createdAt, deletedAt: appUsers.deletedAt }).from(appUsers).where(inArray(appUsers.id, ids)),
    db.select({ ownerId: appPeople.ownerId, givenNames: appPeople.givenNames, surname: appPeople.surname, dateOfBirth: appPeople.dateOfBirth, nationality: appPeople.nationality, number: appPeople.passportNumberMasked, expiry: appPeople.passportExpiry })
      .from(appPeople).where(and(inArray(appPeople.ownerId, ids), eq(appPeople.isSelf, true), isNull(appPeople.deletedAt))),
    db.selectDistinctOn([appRequests.ownerId], { ownerId: appRequests.ownerId, summary: appRequests.summary, status: appRequests.status, createdAt: appRequests.createdAt })
      .from(appRequests).where(inArray(appRequests.ownerId, ids)).orderBy(appRequests.ownerId, desc(appRequests.createdAt)),
  ]) : [[], [], []];
  return rows.map((r) => {
    const a = accounts.find((x) => x.id === r.matchedUserId) ?? null;
    return {
      ...r,
      oldMasked: maskContact(contactOf(r.oldKind, r.oldValue)),
      newMasked: maskContact(contactOf(r.newKind, r.newValue)),
      account: a ? { ...a, shortName: travellerName(a.name), passport: selves.find((p) => p.ownerId === a.id) ?? null, lastBooking: last.find((l) => l.ownerId === a.id) ?? null } : null,
    };
  });
}
export type RecoveryItem = Awaited<ReturnType<typeof listRecovery>>[number];

async function lockOpen(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], id: string): Promise<Row> {
  const [r] = await tx.select().from(appRecoveryRequests).where(eq(appRecoveryRequests.id, id)).for("update");
  if (!r) throw new DeskError("Not found", "NOT_FOUND");
  if (r.status !== "open") throw new DeskError("Already decided", "CONFLICT");
  return r;
}

/** Tell the new contact, in the language they asked in. A failure here never undoes the decision. */
async function tell(r: Row, kind: "done" | "declined") {
  const locale = (r.locale === "ar" ? "ar" : "en") as CopyLocale;
  const text = kind === "done"
    ? t("recover.done.body", { kind: t(r.newKind === "email" ? "recover.done.email" : "recover.done.phone", undefined, locale) }, locale)
    : t("recover.declined.body", { phone: DESK_PHONE }, locale);
  try {
    if (r.newKind === "phone") await suppliers.sms().send(r.newValue, text);
    else await suppliers.email().send({ to: r.newValue, subject: t(kind === "done" ? "recover.done.subject" : "recover.declined.subject", undefined, locale), text });
  } catch (e) {
    console.warn(`[desk] recovery message to the new contact didn't send (${(e as Error).message})`);
  }
}

/**
 * Move the account to the new contact. `how` is how the agent checked it's them (kept in both audit trails).
 * Refused when nothing matched, the account is gone, or the new contact already belongs to another account.
 */
export async function approveRecovery(actor: DeskActor, id: string, how: string) {
  assertCap(actor, "desk.act");
  const note = how.trim();
  if (note.length < 5) throw new DeskError("Say how you checked it's them");
  const decided = await db.transaction(async (tx) => {
    const r = await lockOpen(tx, id);
    if (!r.matchedUserId) throw new DeskError("No account uses the old number or email. Decline it and say so.");
    const [u] = await tx.select().from(appUsers).where(eq(appUsers.id, r.matchedUserId)).for("update");
    if (!u || u.deletedAt) throw new DeskError("That account was deleted. Decline it and say so.");
    const next = contactOf(r.newKind, r.newValue);
    const takenWhere = next.kind === "phone" ? eq(appUsers.phone, next.value) : sql`lower(${appUsers.email}) = ${next.value}`;
    const [taken] = await tx.select({ id: appUsers.id }).from(appUsers).where(and(takenWhere, ne(appUsers.id, u.id), isNull(appUsers.deletedAt))).limit(1);
    if (taken) throw new DeskError("The new number or email is already on another account. Call them before going further.", "CONFLICT");

    const sameKind = r.oldKind === r.newKind;
    const now = new Date();
    // Supabase first, inside the transaction: if it refuses, nothing changes on our side either.
    let supabaseUserId = u.supabaseUserId;
    let oldSupabaseUser: string | null = null;
    const admin = suppliers.supabaseAdmin();
    if (u.supabaseUserId) {
      if (sameKind) await admin.setContact(u.supabaseUserId, next);
      else { supabaseUserId = await admin.createUser(next); oldSupabaseUser = u.supabaseUserId; }
    }
    const patch: Partial<typeof appUsers.$inferInsert> = { supabaseUserId, updatedAt: now };
    if (next.kind === "phone") Object.assign(patch, { phone: next.value, phoneVerified: true });
    else Object.assign(patch, { email: next.value, emailVerified: true, emailRelay: false });
    if (!sameKind) {
      // The old contact no longer opens this account.
      if (r.oldKind === "phone") Object.assign(patch, { phone: null, phoneVerified: false });
      else Object.assign(patch, { email: null, emailVerified: false, emailRelay: false });
      patch.authProviders = [next.kind];
    } else {
      patch.authProviders = [...new Set([...u.authProviders, next.kind])];
    }
    await tx.update(appUsers).set(patch).where(eq(appUsers.id, u.id));
    await tx.update(appSessions).set({ revokedAt: now, revokedReason: "account_recovery" }).where(and(eq(appSessions.userId, u.id), isNull(appSessions.revokedAt)));
    await tx.update(appRecoveryRequests).set({ status: "approved", decidedBy: actor.id, decidedAt: now, decisionNote: note, updatedAt: now }).where(eq(appRecoveryRequests.id, r.id));
    const from = maskContact(contactOf(r.oldKind, r.oldValue));
    const to = maskContact(next);
    await deskAudit(tx, actor, {
      action: "desk.recovery.approved", entityType: "app_user", entityId: u.id, ref: "Account recovery",
      summary: `Moved ${travellerName(u.name)}'s account from ${from} to ${to}`,
      data: { requestId: r.id, from, to, how: note.slice(0, 300), supabase: u.supabaseUserId ? (sameKind ? "updated" : "replaced") : "not linked", sessionsEnded: true },
    });
    return { r, oldSupabaseUser };
  });
  // The old Supabase user still holds the old contact: remove it. Best effort; the account no longer points at it.
  if (decided.oldSupabaseUser) {
    await suppliers.supabaseAdmin().deleteUser(decided.oldSupabaseUser).catch((e: Error) => console.warn(`[desk] old Supabase user not removed (${e.message})`));
  }
  await tell(decided.r, "done");
}

export async function declineRecovery(actor: DeskActor, id: string, reason: string) {
  assertCap(actor, "desk.act");
  const why = reason.trim();
  if (why.length < 5) throw new DeskError("Say why, for the record");
  const r = await db.transaction(async (tx) => {
    const r = await lockOpen(tx, id);
    const now = new Date();
    await tx.update(appRecoveryRequests).set({ status: "declined", decidedBy: actor.id, decidedAt: now, decisionNote: why, updatedAt: now }).where(eq(appRecoveryRequests.id, r.id));
    await deskAudit(tx, actor, {
      action: "desk.recovery.declined", entityType: "recovery_request", entityId: r.id, ref: "Account recovery",
      summary: `Declined moving an account from ${maskContact(contactOf(r.oldKind, r.oldValue))}: ${why.slice(0, 100)}`,
      data: { matchedUserId: r.matchedUserId },
    });
    return r;
  });
  await tell(r, "declined");
}
