import "server-only";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { setSetting, type Settings } from "./settings";
import { sar } from "./money";

// Changes that move money or power between partners are never made by one partner alone.
// They open an approval that every other director must accept, and are applied exactly as requested once they do.

export type GovernancePayload =
  | { type: "settings"; changes: Partial<Record<keyof Settings, { from: number; to: number; label: string; shown: { from: string; to: string } }>> }
  | { type: "equity"; shares: { partnerId: string; name: string; from: number; to: number }[] }
  | { type: "advance"; partnerId: string; partnerName: string; amount: number; description: string; entryDate: string }
  | { type: "opening_balance"; key: string; name: string; from: number; to: number };

export async function proposeGovernance(tx: Tx, requestedBy: string, title: string, payload: GovernancePayload, amount = 0) {
  return createApproval(tx, { kind: "governance", entityType: "governance", entityId: randomUUID(), title, amount, requestedBy, payload, reason: null });
}

type Req = typeof schema.approvalRequests.$inferSelect;

export async function applyGovernance(tx: Tx, req: Req, _decidedBy: string) {
  const p = req.payload as GovernancePayload | null;
  if (!p) return;
  const by = req.requestedBy;
  switch (p.type) {
    case "settings":
      for (const [k, c] of Object.entries(p.changes)) {
        if (!c) continue;
        await setSetting(tx, k as keyof Settings, c.to, by);
        await audit(tx, { actorId: null, action: "settings.changed", entityType: "settings", entityRef: c.label, summary: `${req.ref} approved: ${c.label} changed from ${c.shown.from} to ${c.shown.to}`, changes: { [k]: c.shown } });
      }
      return;
    case "equity": {
      const partners = await tx.select().from(schema.partners).for("update");
      const next = new Map(p.shares.map((s) => [s.partnerId, s.to]));
      const total = partners.reduce((s, x) => s + (next.get(x.id) ?? x.equityBps), 0);
      if (total !== 10000) throw new Error("Equity no longer adds up to 100% with the current partners. Request the change again");
      for (const s of p.shares) {
        await tx.update(schema.partners).set({ equityBps: s.to }).where(eq(schema.partners.id, s.partnerId));
        await audit(tx, { actorId: null, action: "equity.changed", entityType: "partner", entityRef: s.name, summary: `${req.ref} approved: ${s.name}'s equity changed from ${s.from / 100}% to ${s.to / 100}%`, changes: { equity: { from: `${s.from / 100}%`, to: `${s.to / 100}%` } } });
      }
      return;
    }
    case "advance": {
      const [e] = await tx.insert(schema.ledgerEntries).values({ partnerId: p.partnerId, type: "advance", amount: p.amount, description: p.description, entryDate: p.entryDate, createdBy: by, sourceType: "approval", sourceId: req.id }).returning();
      await audit(tx, { actorId: null, action: "ledger.advance", entityType: "ledger", entityId: e.id, entityRef: p.partnerName, summary: `${req.ref} approved: capital advance of SAR ${sar(p.amount)} from ${p.partnerName}: ${p.description}` });
      return;
    }
    case "opening_balance": {
      await tx.update(schema.bankAccounts).set({ openingBalance: p.to }).where(eq(schema.bankAccounts.key, p.key));
      await audit(tx, { actorId: null, action: "bank.updated", entityType: "bank", entityRef: p.name, summary: `${req.ref} approved: ${p.name} opening balance changed from SAR ${sar(p.from)} to SAR ${sar(p.to)}`, changes: { openingBalance: { from: p.from, to: p.to } } });
      return;
    }
  }
}
