import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { ACCOUNT } from "./labels";
import { sar } from "./money";

// Deposits, withdrawals and transfers go through a director before the money actually moves.
export type CashPayload =
  | { op: "txn"; account: string; direction: "in" | "out"; kind: string; amount: number; note: string | null; date: string; partnerId?: string | null }
  | { op: "transfer"; from: string; to: string; amount: number; note: string | null; date: string; partnerId?: string | null };

export async function proposeCashMove(tx: Tx, requestedBy: string, title: string, payload: CashPayload, amount: number) {
  return createApproval(tx, { kind: "cash", entityType: "cash", entityId: randomUUID(), title, amount, requestedBy, payload });
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** Apply an approved bank movement: record the transaction(s). */
export async function applyCashMove(tx: Tx, req: Req, actorId: string) {
  const p = req.payload as CashPayload | null;
  if (!p) return;
  const byName = p.partnerId ? (await tx.select({ name: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, p.partnerId)))[0]?.name ?? null : null;
  const by = byName ? ` · by ${byName}` : "";
  if (p.op === "txn") {
    await tx.insert(schema.bankTransactions).values({ account: p.account, direction: p.direction, kind: p.kind, amount: p.amount, note: p.note, partnerId: p.partnerId ?? null, txnDate: p.date, recordedBy: req.requestedBy });
    await audit(tx, { actorId: null, action: `bank.${p.kind}`, entityType: "bank", entityRef: ACCOUNT[p.account],
      summary: `${req.ref} approved: ${p.kind === "deposit" ? "deposit into" : "withdrawal from"} ${ACCOUNT[p.account]} SAR ${sar(p.amount)}${by}${p.note ? ` · ${p.note}` : ""}` });
    return;
  }
  await tx.insert(schema.bankTransactions).values([
    { account: p.from, direction: "out", kind: "transfer", amount: p.amount, counterparty: p.to, note: p.note, partnerId: p.partnerId ?? null, txnDate: p.date, recordedBy: req.requestedBy },
    { account: p.to, direction: "in", kind: "transfer", amount: p.amount, counterparty: p.from, note: p.note, partnerId: p.partnerId ?? null, txnDate: p.date, recordedBy: req.requestedBy },
  ]);
  await audit(tx, { actorId: null, action: "bank.transfer", entityType: "bank", entityRef: `${ACCOUNT[p.from]} → ${ACCOUNT[p.to]}`,
    summary: `${req.ref} approved: transfer SAR ${sar(p.amount)} from ${ACCOUNT[p.from]} to ${ACCOUNT[p.to]}${by}${p.note ? ` · ${p.note}` : ""}` });
}
