import "server-only";
import { and, asc, eq, isNull, ne, sql } from "drizzle-orm";
import { maskPhone, type MeResponse, type SignInResponse, type SupabaseSessionRequest } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appUsers } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { AppError } from "./http";
import { suppliers, type SupabaseIdentity } from "./suppliers";
import { createSession, type SessionContext } from "./tokens";
import { createUser, getUser, toUser } from "./users";

/*
 * Identity lives in Supabase Auth; the session, the household, passports and bookings live here (docs/app/AUTH.md).
 *
 * POST /auth/session swaps a Supabase access token for our own access + refresh tokens:
 *   1. the account already linked to this Supabase user, or
 *   2. an account with the same verified phone (stronger), then the same verified email: linked now, or
 *   3. a new account.
 * Then what Supabase has proven is copied across: the verified phone, the verified email, the ways in.
 *
 * POST /auth/session/sync (signed in) does step 3 for the current account after the app added a phone, an email or a
 * provider in Supabase. There a number or a Supabase user that belongs to someone else is refused (PHONE_TAKEN,
 * IDENTITY_TAKEN); at sign-in it is skipped instead, so a conflict never locks anyone out.
 */

type UserRow = typeof appUsers.$inferSelect;
type Ctx = SessionContext & { ipHash: string | null };

async function verify(token: string): Promise<SupabaseIdentity> {
  try {
    return await suppliers.supabase().verify(token);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UNAUTHORIZED");
  }
}

const live = isNull(appUsers.deletedAt);

async function findLinked(tx: Tx, id: SupabaseIdentity): Promise<{ user: UserRow; via: "supabase" | "phone" | "email" } | null> {
  const [bySub] = await tx.select().from(appUsers).where(and(eq(appUsers.supabaseUserId, id.sub), live));
  if (bySub) return { user: bySub, via: "supabase" };
  if (id.phone && id.phoneVerified) {
    const [byPhone] = await tx.select().from(appUsers).where(and(eq(appUsers.phone, id.phone), live));
    if (byPhone) return { user: byPhone, via: "phone" };
  }
  if (id.email && id.emailVerified) {
    const [byEmail] = await tx.select().from(appUsers)
      .where(and(sql`lower(${appUsers.email}) = ${id.email}`, live))
      .orderBy(asc(appUsers.createdAt)).limit(1);
    if (byEmail) return { user: byEmail, via: "email" };
  }
  return null;
}

/** Copy what Supabase proved onto the account. `strict`: refuse conflicts (sync) instead of skipping them (sign-in). */
async function applyIdentity(tx: Tx, user: UserRow, id: SupabaseIdentity, opts: { strict: boolean; givenName?: string; ipHash: string | null }): Promise<UserRow> {
  const set: Partial<typeof appUsers.$inferInsert> = {};

  if (!user.supabaseUserId) {
    const [other] = await tx.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.supabaseUserId, id.sub), ne(appUsers.id, user.id)));
    if (other) {
      if (opts.strict) throw new AppError("IDENTITY_TAKEN");
    } else set.supabaseUserId = id.sub;
  }

  if (id.phone && id.phoneVerified && id.phone !== user.phone) {
    const [owner] = await tx.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, id.phone), live, ne(appUsers.id, user.id)));
    if (owner) {
      if (opts.strict) throw new AppError("PHONE_TAKEN");
    } else {
      set.phone = id.phone;
      set.phoneVerified = true;
    }
  } else if (id.phone && id.phoneVerified && id.phone === user.phone && !user.phoneVerified) {
    set.phoneVerified = true;
  }

  // The contact email only changes when there was none, or it is the same address now proven.
  if (id.email && id.emailVerified) {
    if (!user.email) { set.email = id.email; set.emailRelay = id.isPrivateEmail; set.emailVerified = true; }
    else if (user.email.toLowerCase() === id.email && !user.emailVerified) set.emailVerified = true;
  }

  const providers = [...new Set(id.providers)].sort();
  if (providers.join() !== [...user.authProviders].sort().join()) set.authProviders = providers;

  if (!user.name) {
    const first = (opts.givenName ?? id.name ?? "").trim().split(/\s+/)[0]?.slice(0, 30) ?? "";
    if (first) set.name = first;
  }

  if (!Object.keys(set).length) return user;
  const [u] = await tx.update(appUsers).set({ ...set, updatedAt: new Date() }).where(eq(appUsers.id, user.id)).returning();
  if (set.phone) await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "account.phone_verified", entityType: "app_user", entityId: user.id, summary: `Mobile number verified (${maskPhone(set.phone)})`, ipHash: opts.ipHash });
  return u!;
}

const providerLabel = (id: SupabaseIdentity) => id.providers.length ? id.providers.join(", ") : "supabase";

export async function exchangeSupabaseSession(input: SupabaseSessionRequest, ctx: Ctx): Promise<SignInResponse> {
  const id = await verify(input.accessToken);
  return db.transaction(async (tx) => {
    const found = await findLinked(tx, id);
    let user: UserRow;
    let isNew = false;
    if (found) {
      user = found.user;
      if (found.via !== "supabase") {
        await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "account.identity_linked", entityType: "app_user", entityId: user.id, summary: `Sign-in linked by verified ${found.via}`, data: { via: found.via, providers: id.providers }, ipHash: ctx.ipHash });
      }
    } else {
      const phoneFree = id.phone && id.phoneVerified
        ? !(await tx.select({ id: appUsers.id }).from(appUsers).where(and(eq(appUsers.phone, id.phone), live)))[0]
        : false;
      user = await createUser(tx, {
        supabaseUserId: id.sub,
        phone: phoneFree ? id.phone : null, phoneVerified: phoneFree,
        email: id.emailVerified ? id.email : null, emailVerified: id.emailVerified && !!id.email, emailRelay: id.emailVerified && id.isPrivateEmail,
        authProviders: [...new Set(id.providers)].sort(),
        name: ((input.givenName ?? id.name ?? "").trim().split(/\s+/)[0] ?? "").slice(0, 30),
      });
      isNew = true;
      await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "account.created", entityType: "app_user", entityId: user.id, summary: `Account created with ${providerLabel(id)}`, ipHash: ctx.ipHash });
    }
    user = await applyIdentity(tx, user, id, { strict: false, givenName: input.givenName, ipHash: ctx.ipHash });
    const tokens = await createSession(tx, user.id, { ...ctx, device: input.device ?? ctx.device });
    await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "auth.signed_in", entityType: "app_user", entityId: user.id, summary: `Signed in with ${providerLabel(id)}`, data: { method: "supabase", providers: id.providers, platform: input.device?.platform ?? null }, ipHash: ctx.ipHash });
    return { tokens, user: toUser(user), isNew: isNew || !user.onboardedAt };
  });
}

export async function syncSupabaseIdentity(userId: string, accessToken: string, ipHash: string | null): Promise<MeResponse> {
  const id = await verify(accessToken);
  const before = await getUser(userId);
  if (before.supabaseUserId && before.supabaseUserId !== id.sub) throw new AppError("IDENTITY_TAKEN");
  return db.transaction(async (tx) => {
    const user = await applyIdentity(tx, before, id, { strict: true, ipHash });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "account.identity_synced", entityType: "app_user", entityId: userId, summary: "Sign-in methods updated", data: { providers: id.providers }, ipHash });
    return { user: toUser(user) };
  });
}
