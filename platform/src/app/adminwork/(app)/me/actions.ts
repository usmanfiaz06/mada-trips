"use server";
import bcrypt from "bcryptjs";
import { eq } from "drizzle-orm";
import { cookies } from "next/headers";
import { BASE } from "@/lib/base";
import { db, schema } from "@/db";
import { requireUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { str, type ActionState } from "@/lib/actions";

export async function changePassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const current = str(fd, "current"), next = str(fd, "next"), confirm = str(fd, "confirm");
  const [row] = await db.select().from(schema.users).where(eq(schema.users.id, u.id));
  if (!(await bcrypt.compare(current, row.passwordHash))) return { error: "Your current password is wrong" };
  if (next.length < 10) return { error: "Use at least 10 characters" };
  if (next !== confirm) return { error: "The new passwords don't match" };
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash: await bcrypt.hash(next, 10) }).where(eq(schema.users.id, u.id));
    await audit(tx, { actorId: u.id, action: "user.password_changed", entityType: "user", entityId: u.id, entityRef: u.name, summary: `${u.name} changed their password` });
  });
  return { ok: "Password changed" };
}

export async function setLanguage(fd: FormData) {
  const u = await requireUser();
  const locale = str(fd, "locale") === "ar" ? "ar" : "en";
  await db.update(schema.users).set({ locale }).where(eq(schema.users.id, u.id));
  (await cookies()).set("mada_locale", locale, { path: BASE || "/", maxAge: 31536000, sameSite: "lax" });
}
