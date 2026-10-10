import "server-only";
import { desc, eq, sql } from "drizzle-orm";
import { formatSar, type Credit } from "@mada/shared";
import { db, type Tx } from "@/db";
import { appCreditLedger } from "@/db/app-schema";
import { appAuditLog } from "./audit";
import { AppError } from "./http";

/*
 * Mada credit (FLOWS.md §7, SCOPE.md): money Mada holds for a traveller. It's a ledger in app_credit_ledger, which the
 * database keeps append-only; the balance is always the sum, never a stored number. Refunds taken as credit call
 * addCredit; the pay sheet calls spendCredit inside the same transaction as the payment.
 *
 * Every write takes a per-user advisory lock for the rest of its transaction, so two payments at once can never
 * spend the same riyal twice. Amounts are halalas (integers).
 */

export type CreditKind = "refund" | "goodwill" | "spend" | "expiry" | "adjustment";
type Exec = Tx | typeof db;

async function lockUser(tx: Exec, userId: string) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${`credit:${userId}`}, 0))`);
}

/** The balance in halalas. */
export async function getBalance(userId: string, tx: Exec = db): Promise<number> {
  const [r] = await tx.select({ sum: sql<string | null>`COALESCE(SUM(${appCreditLedger.amount}), 0)` }).from(appCreditLedger).where(eq(appCreditLedger.userId, userId));
  return Number(r?.sum ?? 0);
}

/** The balance and every movement, newest first. */
export async function getCredit(userId: string, tx: Exec = db): Promise<Credit> {
  const rows = await tx.select().from(appCreditLedger).where(eq(appCreditLedger.userId, userId)).orderBy(desc(appCreditLedger.createdAt), desc(appCreditLedger.id));
  return {
    balance: { amount: rows.reduce((s, r) => s + r.amount, 0), currency: "SAR" },
    entries: rows.map((r) => ({ id: r.id, amount: r.amount, kind: r.kind as CreditKind, note: r.note, createdAt: r.createdAt.toISOString() })),
  };
}

type AddInput = { userId: string; amount: number; kind: Exclude<CreditKind, "spend">; note?: string | null; refundId?: string | null; actor?: { kind: "user" | "agent" | "system"; id: string | null }; ipHash?: string | null };

/** Put money in (a refund taken as credit, goodwill, a correction). Pass the caller's transaction. */
export async function addCredit(tx: Tx, input: AddInput): Promise<{ entryId: string; balance: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", { fields: { amount: "Must be a positive number of halalas" } });
  await lockUser(tx, input.userId);
  const [row] = await tx.insert(appCreditLedger).values({ userId: input.userId, amount: input.amount, kind: input.kind, note: input.note ?? null, refundId: input.refundId ?? null }).returning({ id: appCreditLedger.id });
  const balance = await getBalance(input.userId, tx);
  await appAuditLog(tx, {
    actorKind: input.actor?.kind ?? "system", actorId: input.actor?.id ?? null, action: "credit.added", entityType: "app_credit_ledger", entityId: row!.id,
    summary: `Added ${formatSar(input.amount)} Mada credit (${input.kind})`, data: { userId: input.userId, amount: input.amount, kind: input.kind, refundId: input.refundId ?? null, balance }, ipHash: input.ipHash ?? null,
  });
  return { entryId: row!.id, balance };
}

type SpendInput = { userId: string; amount: number; note?: string | null; paymentId?: string | null; kind?: "spend" | "adjustment" | "expiry"; actor?: { kind: "user" | "agent" | "system"; id: string | null }; ipHash?: string | null };

/** Take money out (a booking, a move to the card). Refuses to go below zero. Pass the caller's transaction. */
export async function spendCredit(tx: Tx, input: SpendInput): Promise<{ entryId: string; balance: number }> {
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("VALIDATION", { fields: { amount: "Must be a positive number of halalas" } });
  await lockUser(tx, input.userId);
  const before = await getBalance(input.userId, tx);
  if (before < input.amount) throw new AppError("VALIDATION", { copy: "error.creditShort", vars: { amount: formatSar(before) }, fields: { amount: "more_than_balance" } });
  const [row] = await tx.insert(appCreditLedger).values({ userId: input.userId, amount: -input.amount, kind: input.kind ?? "spend", note: input.note ?? null, paymentId: input.paymentId ?? null }).returning({ id: appCreditLedger.id });
  await appAuditLog(tx, {
    actorKind: input.actor?.kind ?? "system", actorId: input.actor?.id ?? null, action: "credit.spent", entityType: "app_credit_ledger", entityId: row!.id,
    summary: `Used ${formatSar(input.amount)} Mada credit`, data: { userId: input.userId, amount: input.amount, paymentId: input.paymentId ?? null, balance: before - input.amount }, ipHash: input.ipHash ?? null,
  });
  return { entryId: row!.id, balance: before - input.amount };
}

/** "Move it to my card": the whole balance goes back to a saved card (the refund is sent by the payments desk). */
export async function moveCreditToCard(userId: string, card: { id: string; label: string }, ipHash: string | null): Promise<{ moved: number; credit: Credit }> {
  return db.transaction(async (tx) => {
    await lockUser(tx, userId);
    const balance = await getBalance(userId, tx);
    if (balance <= 0) throw new AppError("VALIDATION", { copy: "money.credit.nothing", fields: { amount: "zero" } });
    await spendCredit(tx, { userId, amount: balance, kind: "adjustment", note: `Moved to ${card.label}`, actor: { kind: "user", id: userId }, ipHash });
    await appAuditLog(tx, { actorKind: "user", actorId: userId, action: "credit.move_requested", entityType: "app_card", entityId: card.id, summary: `Asked to move ${formatSar(balance)} to ${card.label}`, data: { amount: balance }, ipHash });
    return { moved: balance, credit: await getCredit(userId, tx) };
  });
}
