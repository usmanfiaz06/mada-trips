"use server";
import { revalidatePath } from "next/cache";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { toHalalas, sar } from "@/lib/money";
import { riyadhDate } from "@/lib/dates";
import { flash, str, optStr, toState, type ActionState } from "@/lib/actions";
import { getSettings, setSetting } from "@/lib/settings";
import { proposeGovernance } from "@/lib/governance";
import { isIsoDate, isUuid } from "@/lib/security";

export async function clearPayments(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const ids = fd.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const date = str(fd, "clearedOn");
  if (!ids.length) return { error: "Tick the receipts that appear on the bank statement" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date the funds cleared" };
  if (date > riyadhDate()) return { error: "Funds can't clear in the future" };
  try {
    const n = await db.transaction(async (tx) => {
      const rows = await tx.select({ p: schema.payments, ref: schema.bookings.ref }).from(schema.payments).leftJoin(schema.bookings, eq(schema.bookings.id, schema.payments.bookingId))
        .where(and(inArray(schema.payments.id, ids), isNull(schema.payments.clearedOn))).for("update");
      if (rows.some((r) => date < r.p.businessDate)) throw new Error("A receipt can't clear before it was collected");
      if (!rows.length) return 0;
      await tx.update(schema.payments).set({ clearedOn: date, clearedBy: u.id }).where(and(inArray(schema.payments.id, rows.map((r) => r.p.id)), isNull(schema.payments.clearedOn)));
      for (const r of rows) {
        await audit(tx, { actorId: u.id, action: "payment.cleared", entityType: "booking", entityId: r.p.bookingId, entityRef: r.ref, summary: `Marked ${sar(r.p.amount)} for ${r.ref ?? "receipt"} as cleared in the ${r.p.account} account on ${date}` });
      }
      return rows.length;
    });
    revalidatePath("/adminwork/finance");
    return { ok: `${n} receipt${n === 1 ? "" : "s"} marked as cleared on ${date}` };
  } catch (e) { return toState(e); }
}

export async function addBsp(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  try {
    const amount = toHalalas(str(fd, "amount"));
    const period = str(fd, "period").slice(0, 40), dueDate = str(fd, "dueDate");
    if (!period || !isIsoDate(dueDate) || amount <= 0) throw new Error("Fill period, due date and amount");
    const account = str(fd, "account") === "retail" ? "retail" : "corporate";
    await db.transaction(async (tx) => {
      const [b] = await tx.insert(schema.bspObligations).values({ period, dueDate, amount, account, note: optStr(fd, "note"), createdBy: u.id }).returning();
      await audit(tx, { actorId: u.id, action: "bsp.added", entityType: "bsp", entityId: b.id, entityRef: period, summary: `Added BSP debit ${period}: SAR ${sar(amount)} due ${dueDate}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/finance");
  return { ok: "BSP debit added" };
}

export async function payBsp(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const id = str(fd, "id"), paidOn = str(fd, "paidOn") || riyadhDate();
  if (!isUuid(id)) return { error: "Not found" };
  if (!isIsoDate(paidOn) || paidOn > riyadhDate()) return { error: "Pick the date it was debited (not in the future)" };
  try {
    await db.transaction(async (tx) => {
      const [b] = await tx.select().from(schema.bspObligations).where(eq(schema.bspObligations.id, id)).for("update");
      if (!b || b.status === "paid") throw new Error("Already paid");
      await tx.update(schema.bspObligations).set({ status: "paid", paidOn }).where(eq(schema.bspObligations.id, id));
      // The debit is paid out of the IATA reserve, so what's held goes down by the same amount.
      const s = await getSettings(tx);
      const held = Math.max(0, s.iataReserveHeld - b.amount);
      if (held !== s.iataReserveHeld) await setSetting(tx, "iataReserveHeld", held, u.id);
      await audit(tx, { actorId: u.id, action: "bsp.paid", entityType: "bsp", entityId: id, entityRef: b.period, summary: `BSP ${b.period} debited: SAR ${sar(b.amount)} on ${paidOn}` });
    });
  } catch (e) { return toState(e); }
  await flash("BSP debit recorded");
  revalidatePath("/adminwork", "layout");
  return null;
}

export async function updateBank(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settings.manage");
  const key = str(fd, "key");
  let proposed = "";
  try {
    const [before] = await db.select().from(schema.bankAccounts).where(eq(schema.bankAccounts.key, key));
    if (!before) throw new Error("Unknown account");
    const bank = optStr(fd, "bank")?.slice(0, 80) ?? null, iban = optStr(fd, "iban")?.replace(/\s/g, "").toUpperCase().slice(0, 34) ?? null;
    if (iban && !/^SA\d{22}$/.test(iban)) throw new Error("Enter a Saudi IBAN (SA followed by 22 digits)");
    if (!str(fd, "openingBalance")) throw new Error("Enter the opening balance");
    const openingBalance = toHalalas(str(fd, "openingBalance"));
    const { diff } = await import("@/lib/audit");
    await db.transaction(async (tx) => {
      const patch = { bank, iban };
      const changes = diff(before, patch);
      if (Object.keys(changes).length) {
        await tx.update(schema.bankAccounts).set(patch).where(eq(schema.bankAccounts.key, key));
        await audit(tx, { actorId: u.id, action: "bank.updated", entityType: "bank", entityRef: before.name, summary: `Updated ${before.name} account details`, changes });
      }
      // The opening balance feeds cash position and the settlement, so it changes only when every other director agrees.
      if (openingBalance !== before.openingBalance) {
        proposed = (await proposeGovernance(tx, u.id, `${before.name}: opening balance SAR ${sar(before.openingBalance)} → SAR ${sar(openingBalance)}`,
          { type: "opening_balance", key, name: before.name, from: before.openingBalance, to: openingBalance })).ref;
      }
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/finance");
  return { ok: proposed ? `Saved. The opening balance change was sent to the other directors as ${proposed}` : "Saved" };
}
