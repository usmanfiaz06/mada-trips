"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { toHalalas, sar } from "@/lib/money";
import { str, toState, type ActionState } from "@/lib/actions";

export async function recordAdvance(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("ledger.manage");
  try {
    const partnerId = str(fd, "partnerId"), description = str(fd, "description"), date = str(fd, "entryDate");
    const amount = toHalalas(str(fd, "amount"));
    if (!partnerId || !description || amount <= 0 || !date) throw new Error("Fill partner, amount, date and description");
    const [p] = await db.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
    if (!p) throw new Error("Partner not found");
    await db.transaction(async (tx) => {
      const [e] = await tx.insert(schema.ledgerEntries).values({ partnerId, type: "advance", amount, description, entryDate: date, createdBy: u.id }).returning();
      await audit(tx, { actorId: u.id, action: "ledger.advance", entityType: "ledger", entityId: e.id, entityRef: p.name, summary: `Recorded capital advance of SAR ${sar(amount)} from ${p.name}: ${description}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath("/partners");
  return { ok: "Advance recorded" };
}
