"use server";
import bcrypt from "bcryptjs";
import { and, eq, gt, isNull, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { clientIp, createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { safeNext } from "@/lib/security";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/actions";

export async function login(prev: ActionState, fd: FormData): Promise<ActionState> {
  try {
    return await doLogin(prev, fd);
  } catch (e) {
    if (e && typeof e === "object" && "digest" in e && String((e as { digest: string }).digest).startsWith("NEXT_REDIRECT")) throw e;
    console.error("Sign-in failed", e);
    return { error: "The platform can't reach its database right now. Open /adminwork/api/health for details." };
  }
}

// Compared against when the email doesn't exist, so a wrong email takes as long as a wrong password.
let dummyHash: Promise<string> | null = null;
const dummy = () => (dummyHash ??= bcrypt.hash("not-a-real-password", 12));

const failuresSince = (where: ReturnType<typeof and>) =>
  db.select({ n: sql<number>`count(*)::int` }).from(schema.auditEvents).where(and(eq(schema.auditEvents.action, "auth.login_failed"), gt(schema.auditEvents.at, new Date(Date.now() - 15 * 60_000)), where)).then((r) => r[0].n);

async function doLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = safeNext(String(fd.get("next") ?? ""));
  // Malformed input is refused before touching the database or the log.
  if (!/^[^\s@]{1,64}@[^\s@]{1,190}$/.test(email) || email.length > 254) return { error: "Email or password is incorrect" };
  if (!password || password.length > 200) return { error: "Email or password is incorrect" };

  // Throttle, all within 15 minutes:
  //   one address, from one network: 8 failures   (guessing one person's password)
  //   one address, from anywhere:    40 failures   (spread-out guessing, without letting a stranger lock someone out for long)
  //   one network, any address:      30 failures   (trying many accounts)
  const ip = await clientIp();
  const ipCond = ip ? eq(schema.auditEvents.ip, ip) : isNull(schema.auditEvents.ip);
  const [perPair, perEmail, perIp] = await Promise.all([
    failuresSince(and(eq(schema.auditEvents.entityRef, email), ipCond)),
    failuresSince(and(eq(schema.auditEvents.entityRef, email))),
    failuresSince(and(ipCond)),
  ]);
  if (perPair >= 8 || perEmail >= 40 || perIp >= 30) return { error: "Too many attempts. Wait 15 minutes, or ask an admin to reset your password" };

  const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email)).limit(1);
  const ok = await bcrypt.compare(password, u?.passwordHash ?? (await dummy()));
  if (!u || !ok || !u.active) {
    await audit(db, { actorId: null, action: "auth.login_failed", entityType: "user", entityId: u?.id, entityRef: email, summary: `Failed sign-in for ${email}` });
    return { error: "Email or password is incorrect" };
  }
  await createSession(u.id);
  await audit(db, { actorId: u.id, action: "auth.login", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} signed in` });
  redirect(u.mustChangePassword ? "/adminwork/me?welcome=1" : next);
}

export async function logout() {
  const u = await getCurrentUser();
  if (u) await audit(db, { actorId: u.id, action: "auth.logout", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} signed out` });
  await destroySession();
  redirect("/adminwork/login");
}
