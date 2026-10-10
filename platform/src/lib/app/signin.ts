import "server-only";
import { and, eq, isNull } from "drizzle-orm";
import { maskPhone, type DeviceInfo, type SignInResponse, type SocialSignInRequest } from "@mada/shared";
import { db } from "@/db";
import { appUsers } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { AppError } from "./http";
import { verifyOtp } from "./otp";
import { suppliers } from "./suppliers";
import { createSession, type AppAuth } from "./tokens";
import { attachPhone, createUser, findOrCreateByPhone, toUser } from "./users";

type Ctx = { device?: DeviceInfo | null; ip: string | null; ipHash: string | null; userAgent: string | null };

/**
 * Phone code verified → signed in. If the caller is already signed in (Apple/Google first), the number is added to
 * that account and the same session continues with fresh tokens.
 */
export async function signInWithPhone(rawPhone: string, code: string, ctx: Ctx, current: AppAuth | null): Promise<SignInResponse> {
  const phone = await verifyOtp(rawPhone, code);
  return db.transaction(async (tx) => {
    let user, isNew;
    if (current) {
      user = await attachPhone(tx, current.userId, phone, ctx.ipHash);
      isNew = !user.onboardedAt;
    } else {
      ({ user, isNew } = await findOrCreateByPhone(tx, phone, ctx.ipHash));
      isNew = isNew || !user.onboardedAt;
    }
    const tokens = await createSession(tx, user.id, ctx);
    await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "auth.signed_in", entityType: "app_user", entityId: user.id, summary: `Signed in with ${maskPhone(phone)}`, data: { method: "phone", platform: ctx.device?.platform ?? null }, ipHash: ctx.ipHash });
    return { tokens, user: toUser(user), isNew };
  });
}

/** Sign in with Apple or Google. The provider token is verified by the identity supplier (mock or JWKS). */
export async function signInWithProvider(provider: "apple" | "google", req: SocialSignInRequest, ctx: Ctx): Promise<SignInResponse> {
  let id;
  try {
    id = await suppliers.identity().verify(provider, req.idToken, req.nonce);
  } catch (e) {
    if (e instanceof AppError) throw e;
    throw new AppError("UNAUTHORIZED");
  }
  const col = provider === "apple" ? appUsers.appleSub : appUsers.googleSub;
  return db.transaction(async (tx) => {
    const [existing] = await tx.select().from(appUsers).where(and(eq(col, id.sub), isNull(appUsers.deletedAt)));
    let user = existing;
    const isNew = !existing;
    if (!user) {
      user = await createUser(tx, {
        ...(provider === "apple" ? { appleSub: id.sub } : { googleSub: id.sub }),
        email: id.email, emailRelay: id.isPrivateEmail, name: (req.givenName ?? "").trim().slice(0, 30),
      });
      await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "account.created", entityType: "app_user", entityId: user.id, summary: `Account created with ${provider === "apple" ? "Apple" : "Google"}`, ipHash: ctx.ipHash });
    }
    const tokens = await createSession(tx, user.id, ctx);
    await appAuditLog(tx, { actorKind: "user", actorId: user.id, action: "auth.signed_in", entityType: "app_user", entityId: user.id, summary: `Signed in with ${provider === "apple" ? "Apple" : "Google"}`, data: { method: provider }, ipHash: ctx.ipHash });
    return { tokens, user: toUser(user), isNew: isNew || !user.onboardedAt };
  });
}
