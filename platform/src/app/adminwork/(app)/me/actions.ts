"use server";
import bcrypt from "bcryptjs";
import { and, eq, ne } from "drizzle-orm";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createHash } from "node:crypto";
import { BASE } from "@/lib/base";
import { db, schema } from "@/db";
import { requireUser, SESSION_COOKIE } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str, type ActionState } from "@/lib/actions";

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  // Passwords are used exactly as typed (no trimming), same as at sign-in.
  const raw = (k: string) => String(fd.get(k) ?? "");
  const current = raw("current"), next = raw("next"), confirm = raw("confirm");
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  if (current.length > 200 || !(await bcrypt.compare(current, row.passwordHash))) return { error: "Your current password is wrong" };
  if (next.length < 10) return { error: "Use at least 10 characters" };
  if (Buffer.byteLength(next) > 72) return { error: "Use at most 72 characters" };
  if (next !== confirm) return { error: "The new passwords don't match" };
  if (next === current) return { error: "Choose a password different from the current one" };
  const token = (await cookies()).get(SESSION_COOKIE)?.value ?? "";
  const thisSession = createHash("sha256").update(token).digest("hex");
  // Hash before opening the transaction: bcrypt is deliberately slow, and computing it inside the
  // transaction would hold the connection "idle in transaction" (with its locks) for the whole hash.
  const passwordHash = await bcrypt.hash(next, 12);
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash, mustChangePassword: false }).where(eq(schema.users.id, u.id));
    // Anyone else signed in as this person (another device, or whoever knew the old password) is signed out.
    await tx.delete(schema.sessions).where(and(eq(schema.sessions.userId, u.id), ne(schema.sessions.id, thisSession)));
    await audit(tx, { actorId: u.id, action: "user.password_changed", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} changed their password and signed out other devices` });
  });
  if (row.mustChangePassword) redirect("/adminwork");
  return { ok: "Password changed. Other devices were signed out" };
}

export async function setLanguage(fd: FormData) {
  const u = await requireUser();
  const locale = str(fd, "locale") === "ar" ? "ar" : "en";
  await db.update(schema.users).set({ locale }).where(eq(schema.users.id, u.id));
  (await cookies()).set("mada_locale", locale, { path: BASE || "/", maxAge: 31536000, sameSite: "lax" });
}
