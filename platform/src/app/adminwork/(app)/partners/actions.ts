"use server";
import { revalidatePath } from "next/cache";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { toHalalas, sar } from "@/lib/money";
import { str, toState, type ActionState } from "@/lib/actions";
import { proposeGovernance } from "@/lib/governance";
import { isIsoDate, isUuid } from "@/lib/security";
import { riyadhDate } from "@/lib/dates";

export async function recordAdvance(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("ledger.manage");
  let ref = "";
  try {
    const partnerId = str(fd, "partnerId"), description = str(fd, "description"), date = str(fd, "entryDate");
    if (!isUuid(partnerId) || !description || !str(fd, "amount") || !isIsoDate(date)) throw new Error("Fill partner, amount, date and description");
    const amount = toHalalas(str(fd, "amount"));
    if (amount <= 0) throw new Error("Enter the amount advanced");
    if (description.length > 300) throw new Error("Keep the description under 300 characters");
    if (date > riyadhDate()) throw new Error("The advance date can't be in the future");
    const [p] = await db.select().from(schema.partners).where(eq(schema.partners.id, partnerId));
    if (!p) throw new Error("Partner not found");
    // Advances are repaid ahead of dividends, so the other directors confirm the money actually arrived.
    ref = await db.transaction(async (tx) => (await proposeGovernance(tx, u.id, `Capital advance from ${p.name}: SAR ${sar(amount)}`,
      { type: "advance", partnerId, partnerName: p.name, amount, description, entryDate: date }, amount)).ref);
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/partners");
  return { ok: `Sent to the other directors as ${ref}. It's added to the ledger once they confirm` };
}
