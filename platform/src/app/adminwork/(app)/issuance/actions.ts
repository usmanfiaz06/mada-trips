"use server";
import { revalidatePath } from "next/cache";
import { and, eq, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { toHalalas, sar } from "@/lib/money";
import { str, optStr, toState, type ActionState } from "@/lib/actions";
import { isIsoDate, isUuid } from "@/lib/security";

export async function grantDelegation(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("issue.delegate");
  try {
    const userId = str(fd, "userId");
    const scope = str(fd, "scope") === "all" ? "all" : "retail";
    const maxTicket = toHalalas(str(fd, "maxTicket"));
    const dailyCap = toHalalas(str(fd, "dailyCap"));
    const expires = str(fd, "expiresAt");
    if (!isUuid(userId)) throw new Error("Choose who gets issuing rights");
    if (userId === u.id) throw new Error("You can't grant issuing rights to yourself");
    if (maxTicket <= 0 || dailyCap <= 0) throw new Error("Set both limits");
    if (dailyCap < maxTicket) throw new Error("The daily cap can't be lower than the per-ticket limit");
    // Hard ceilings, whatever is typed: SAR 100,000 a ticket, SAR 500,000 a day, 6 months at most.
    if (maxTicket > 100_000_00 || dailyCap > 500_000_00) throw new Error("Limits can be at most SAR 100,000 per ticket and SAR 500,000 a day");
    if (!isIsoDate(expires)) throw new Error("Set an end date. Rights should never be open-ended");
    const expiresAt = new Date(`${expires}T23:59:00+03:00`);
    if (expiresAt < new Date()) throw new Error("The end date is in the past");
    if (expiresAt.getTime() - Date.now() > 183 * 86_400_000) throw new Error("Grant issuing rights for 6 months at most, then renew");
    const [target] = await db.select().from(schema.users).where(eq(schema.users.id, userId));
    if (!target || !target.active) throw new Error("User not found");
    await db.transaction(async (tx) => {
      // One active delegation per person: the new one replaces the old.
      await tx.update(schema.delegations).set({ revokedAt: new Date(), revokedBy: u.id }).where(and(eq(schema.delegations.userId, userId), isNull(schema.delegations.revokedAt)));
      await tx.insert(schema.delegations).values({ userId, grantedBy: u.id, scope, maxTicket, dailyCap, expiresAt, note: optStr(fd, "note")?.slice(0, 300) ?? null });
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
  if (!isUuid(id)) return;
  const [d] = await db.select({ d: schema.delegations, name: schema.users.name }).from(schema.delegations).innerJoin(schema.users, eq(schema.users.id, schema.delegations.userId)).where(eq(schema.delegations.id, id));
  if (!d || d.d.revokedAt) return;
  await db.transaction(async (tx) => {
    await tx.update(schema.delegations).set({ revokedAt: new Date(), revokedBy: u.id }).where(eq(schema.delegations.id, id));
    await audit(tx, { actorId: u.id, action: "delegation.revoked", entityType: "user", entityId: d.d.userId, entityRef: d.name, summary: `Revoked issuing rights from ${d.name}` });
  });
  revalidatePath("/adminwork/issuance");
}
