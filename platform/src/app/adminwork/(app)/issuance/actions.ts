"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { toHalalas, sar } from "@/lib/money";
import { str, optStr, toState, type ActionState } from "@/lib/actions";

export async function grantDelegation(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("issue.delegate");
  try {
    const userId = str(fd, "userId");
    const scope = str(fd, "scope") === "all" ? "all" : "retail";
    const maxTicket = toHalalas(str(fd, "maxTicket"));
    const dailyCap = toHalalas(str(fd, "dailyCap"));
    const expires = str(fd, "expiresAt");
    if (!userId) throw new Error("Choose who gets issuing rights");
    if (maxTicket <= 0 || dailyCap <= 0) throw new Error("Set both limits");
    if (dailyCap < maxTicket) throw new Error("The daily cap can't be lower than the per-ticket limit");
    if (!expires) throw new Error("Set an end date. Rights should never be open-ended");
    const expiresAt = new Date(`${expires}T23:59:00+03:00`);
    if (expiresAt < new Date()) throw new Error("The end date is in the past");
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!target) throw new Error("User not found");
    await db.transaction(async (tx) => {
      // One active delegation per person: the new one replaces the old.
      await tx.update(schema.delegations).set({ revokedAt: new Date(), revokedBy: u.id }).where(and(eq(schema.delegations.userId, userId), isNull(schema.delegations.revokedAt)));
      await tx.insert(schema.delegations).values({ userId, grantedBy: u.id, scope, maxTicket, dailyCap, expiresAt, note: optStr(fd, "note") });
      await audit(tx, { actorId: u.id, action: "delegation.granted", entityType: "user", entityId: userId, entityRef: target.name,
        summary: `Granted ${target.name} ${scope === "retail" ? "retail" : "retail & corporate"} issuing up to SAR ${sar(maxTicket)} per ticket, SAR ${sar(dailyCap)} a day, until ${expires}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/issuance");
  return { ok: "Issuing rights granted" };
}

export async function revokeDelegation(fd: FormData) {
  const u = await requirePerm("issue.delegate");
  const id = str(fd, "id");
  const [d] = await db.select({ d: schema.delegations, name: schema.users.name }).from(schema.delegations).innerJoin(schema.users, eq(schema.users.id, schema.delegations.userId)).where(eq(schema.delegations.id, id));
  if (!d || d.d.revokedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(schema.delegations).set({ revokedAt: new Date(), revokedBy: u.id }).where(eq(schema.delegations.id, id));
    await audit(tx, { actorId: u.id, action: "delegation.revoked", entityType: "user", entityId: d.d.userId, entityRef: d.name, summary: `Revoked issuing rights from ${d.name}` });
  });
  revalidatePath("/adminwork/issuance");
}
