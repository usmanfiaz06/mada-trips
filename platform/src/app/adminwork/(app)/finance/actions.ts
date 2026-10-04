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
import { settleBspClosing } from "@/lib/bsp";
import { ACCOUNT } from "@/lib/labels";
import { proposeCashMove } from "@/lib/cash";

/** Validate an optional "which partner did this" id — must be a real partner, or nothing. */
async function validPartner(id: string | null): Promise<string | null> {
  if (!id) return null;
  if (!isUuid(id)) throw new Error("Choose who made the transaction");
  const [p] = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.id, id));
  if (!p) throw new Error("Choose who made the transaction");
  return p.id;
}

export async function clearPayments(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const ids = fd.getAll("ids").map(String).filter((x) => /^[0-9a-f-]{36}$/.test(x));
  const date = str(fd, "clearedOn");
  if (!ids.length) return { error: "Tick the receipts that appear on the bank statement" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return { error: "Pick the date the funds cleared" };
  if (date > riyadhDate()) return { error: "Funds can't clear in the future" };
  try {
    const n = await db.transaction(async (tx) => {
      // Lock only the payment rows — FOR UPDATE can't be applied across the nullable side of a LEFT JOIN,
      // so booking refs (just for the audit note) are fetched separately below.
      const rows = await tx.select().from(schema.payments)
        .where(and(inArray(schema.payments.id, ids), isNull(schema.payments.clearedOn))).for("update");
      if (!rows.length) return 0;
      if (rows.some((r) => date < r.businessDate)) throw new Error("A receipt can't clear before it was collected");
      // Can't clear a receipt whose sale has been voided or refunded — it's off the books.
      const closedIds = new Set((await tx.select({ id: schema.bookings.id }).from(schema.bookings)
        .where(and(inArray(schema.bookings.id, [...new Set(rows.map((r) => r.bookingId).filter((x): x is string => !!x))]), inArray(schema.bookings.status, ["void", "refunded"])))).map((b) => b.id));
      if (closedIds.size && rows.some((r) => r.bookingId && closedIds.has(r.bookingId))) throw new Error("One of these sales has been voided or refunded. Refresh the page and try again");
      await tx.update(schema.payments).set({ clearedOn: date, clearedBy: u.id }).where(and(inArray(schema.payments.id, rows.map((r) => r.id)), isNull(schema.payments.clearedOn)));
      const bookingIds = [...new Set(rows.map((r) => r.bookingId).filter((x): x is string => !!x))];
      const refs = new Map<string, string>();
      if (bookingIds.length) {
        for (const bk of await tx.select({ id: schema.bookings.id, ref: schema.bookings.ref }).from(schema.bookings).where(inArray(schema.bookings.id, bookingIds))) refs.set(bk.id, bk.ref);
      }
      for (const r of rows) {
        const ref = r.bookingId ? refs.get(r.bookingId) ?? null : null;
        await audit(tx, { actorId: u.id, action: "payment.cleared", entityType: "booking", entityId: r.bookingId, entityRef: ref, summary: `Marked ${sar(r.amount)} for ${ref ?? "receipt"} as cleared in the ${r.account} account on ${date}` });
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

export async function settleBsp(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const source = str(fd, "source") === "partner" ? "partner" : "bank";
  const start = str(fd, "start"), end = str(fd, "end");
  if (!isIsoDate(start) || !isIsoDate(end)) return { error: "Bad BSP period" };
  try {
    if (source === "partner" && !u.partnerId) throw new Error("Only a partner can record a partner-paid BSP settlement");
    await db.transaction(async (tx) => {
      await settleBspClosing(tx, { periodStart: start, periodEnd: end, source, account: str(fd, "account") || "corporate", partnerId: optStr(fd, "partnerId"), reference: optStr(fd, "reference"), settledBy: u.id });
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  return { ok: source === "partner" ? "Sent to the other directors to approve" : "IATA BSP marked paid" };
}

export async function addBankTxn(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const account = str(fd, "account"), kind = str(fd, "kind");
  const date = str(fd, "date") || riyadhDate();
  if (!["retail", "corporate"].includes(account)) return { error: "Choose the bank account" };
  if (!["deposit", "withdrawal", "adjustment"].includes(kind)) return { error: "Choose deposit or withdrawal" };
  if (!isIsoDate(date) || date > riyadhDate()) return { error: "Pick a valid date (not in the future)" };
  try {
    const amount = toHalalas(str(fd, "amount"));
    if (amount <= 0) return { error: "Enter an amount" };
    const direction = kind === "deposit" ? "in" as const : "out" as const;
    const note = optStr(fd, "note")?.slice(0, 200) ?? null;
    const partnerId = await validPartner(optStr(fd, "partnerId"));
    const ref = await db.transaction((tx) => proposeCashMove(tx, u.id,
      `${kind === "deposit" ? "Deposit into" : "Withdrawal from"} ${ACCOUNT[account]} · SAR ${sar(amount)}`,
      { op: "txn", account, direction, kind, amount, note, date, partnerId }, amount));
    revalidatePath("/adminwork", "layout");
    return { ok: `Sent to the directors to approve (${ref.ref})` };
  } catch (e) { return toState(e); }
}

export async function transferFunds(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("finance.reconcile");
  const from = str(fd, "from"), to = str(fd, "to");
  const date = str(fd, "date") || riyadhDate();
  if (!["retail", "corporate"].includes(from) || !["retail", "corporate"].includes(to)) return { error: "Choose both accounts" };
  if (from === to) return { error: "Choose two different accounts" };
  if (!isIsoDate(date) || date > riyadhDate()) return { error: "Pick a valid date (not in the future)" };
  try {
    const amount = toHalalas(str(fd, "amount"));
    if (amount <= 0) return { error: "Enter an amount" };
    const note = optStr(fd, "note")?.slice(0, 200) ?? null;
    const partnerId = await validPartner(optStr(fd, "partnerId"));
    const ref = await db.transaction((tx) => proposeCashMove(tx, u.id,
      `Transfer ${ACCOUNT[from]} → ${ACCOUNT[to]} · SAR ${sar(amount)}`,
      { op: "transfer", from, to, amount, note, date, partnerId }, amount));
    revalidatePath("/adminwork", "layout");
    return { ok: `Sent to the directors to approve (${ref.ref})` };
  } catch (e) { return toState(e); }
}
