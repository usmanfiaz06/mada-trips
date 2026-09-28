"use server";
import bcrypt from "bcryptjs";
import { and, eq, gt, sql } from "drizzle-orm";
import { redirect } from "next/navigation";
import { db, schema } from "@/db";
import { createSession, destroySession, getCurrentUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import type { ActionState } from "@/lib/actions";

export async function login(_: ActionState, fd: FormData): Promise<ActionState> {
  const email = String(fd.get("email") ?? "").trim().toLowerCase();
  const password = String(fd.get("password") ?? "");
  const next = String(fd.get("next") ?? "/");
  // Throttle: 8 failures for one email in 15 minutes locks sign-in for that email briefly.
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.auditEvents)
    .where(and(eq(schema.auditEvents.action, "auth.login_failed"), eq(schema.auditEvents.entityRef, email), gt(schema.auditEvents.at, new Date(Date.now() - 15 * 60_000))));
  if (n >= 8) return { error: "Too many attempts. Wait 15 minutes, or ask an admin to reset your password" };
  const [u] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, email)).limit(1);
  // Same message and similar timing whether the email exists or not.
  const ok = u ? await bcrypt.compare(password, u.passwordHash) : await bcrypt.compare(password, "$2b$10$invalidinvalidinvalidinvalidinvalidinvalidinvalidinva");
  if (!u || !ok || !u.active) {
    await audit(db, { actorId: u?.id ?? null, action: "auth.login_failed", entityType: "user", entityId: u?.id, entityRef: email, summary: `Failed sign-in for ${email}` });
    return { error: "Email or password is incorrect" };
  }
  await createSession(u.id);
  await audit(db, { actorId: u.id, action: "auth.login", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} signed in` });
  redirect(next.startsWith("/") && !next.startsWith("//") ? next : "/");
}

export async function logout() {
  const u = await getCurrentUser();
  if (u) await audit(db, { actorId: u.id, action: "auth.logout", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} signed out` });
  await destroySession();
  redirect("/login");
}
