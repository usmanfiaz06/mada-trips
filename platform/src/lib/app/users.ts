import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import type { UpdateMeRequest, User } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPeople, appUsers } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { AppError } from "./http";
import { currentLocale } from "./resilience/request";

type UserRow = typeof appUsers.$inferSelect;

export function toUser(u: UserRow): User {
  return {
    id: u.id, name: u.name, phone: u.phone, email: u.email, emailRelay: u.emailRelay,
    locale: u.locale === "ar" ? "ar" : "en",
    alerts: u.alerts === "everything" ? "everything" : "quiet",
    notifications: u.notifications === "allowed" || u.notifications === "declined" ? u.notifications : "unknown",
    methods: {
      apple: !!u.appleSub || u.authProviders.includes("apple"),
      google: !!u.googleSub || u.authProviders.includes("google"),
      phone: !!u.phone,
      email: u.authProviders.includes("email"),
    },
    emailVerified: u.emailVerified,
    onboardedAt: u.onboardedAt?.toISOString() ?? null,
    createdAt: u.createdAt.toISOString(),
  };
}

export async function getUser(id: string): Promise<UserRow> {
  const [u] = await db.select().from(appUsers).where(and(eq(appUsers.id, id), isNull(appUsers.deletedAt)));
  if (!u) throw new AppError("UNAUTHORIZED");
  return u;
}

/** Every account starts with its holder in the household ("You"); the passport fills it in later. */
async function createSelf(tx: Tx, userId: string) {
  await tx.insert(appPeople).values({ ownerId: userId, isSelf: true, relation: "self" });
}

export async function createUser(tx: Tx, values: Partial<typeof appUsers.$inferInsert>): Promise<UserRow> {
  // A new account starts in the language its phone asked in (Accept-Language); the app keeps it in step after.
  const [u] = await tx.insert(appUsers).values({ locale: currentLocale(), ...values }).returning();
  await createSelf(tx, u!.id);
  return u!;
}

/** The account for a verified phone number, created on first sign-in. */
export async function findOrCreateByPhone(tx: Tx, phone: string, ipHash: string | null): Promise<{ user: UserRow; isNew: boolean }> {
  const [existing] = await tx.select().from(appUsers).where(and(eq(appUsers.phone, phone), isNull(appUsers.deletedAt)));
  if (existing) return { user: existing, isNew: false };
  const user = await createUser(tx, { phone, phoneVerified: true, authProviders: ["phone"] });
  await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "account.created", entityType: "app_user", entityId: user.id, summary: "Account created with a phone number", ipHash });
  return { user, isNew: true };
}

/** A signed-in (Apple/Google) account adds its mobile number: FLOWS.md §1 "a mobile number is still needed for alerts". */
export async function attachPhone(tx: Tx, userId: string, phone: string, ipHash: string | null): Promise<UserRow> {
  const [owner] = await tx.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, phone), isNull(appUsers.deletedAt)));
  if (owner && owner.id !== userId) throw new AppError("PHONE_TAKEN");
  const [u] = await tx.update(appUsers).set({ phone, phoneVerified: true, updatedAt: new Date() }).where(eq(appUsers.id, userId)).returning();
  await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.phone_verified", entityType: "app_user", entityId: userId, summary: "Mobile number verified", ipHash });
  return u!;
}

export async function updateMe(userId: string, patch: UpdateMeRequest, ipHash: string | null): Promise<UserRow> {
  return db.transaction(async (tx) => {
    const set: Partial<typeof appUsers.$inferInsert> = { updatedAt: new Date() };
    if (patch.name !== undefined) set.name = patch.name.trim();
    if (patch.locale) set.locale = patch.locale;
    if (patch.alerts) set.alerts = patch.alerts;
    if (patch.notifications) set.notifications = patch.notifications;
    const [before] = await tx.select().from(appUsers).where(eq(appUsers.id, userId));
    if (!before || before.deletedAt) throw new AppError("UNAUTHORIZED");
    if (patch.onboarded && !before.onboardedAt) set.onboardedAt = new Date();
    const [u] = await tx.update(appUsers).set(set).where(eq(appUsers.id, userId)).returning();
    const changed = Object.keys(patch).filter((k) => k !== "onboarded");
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.updated", entityType: "app_user", entityId: userId, summary: `Updated ${changed.join(", ") || "onboarding"}`, data: { fields: Object.keys(patch) }, ipHash });
    return u!;
  });
}
