import "server-only";
import { eq, inArray } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { setSetting, getSettings } from "./settings";
import type { SettlementFigures } from "./finance";
import { riyadhDate } from "./dates";
import { sar } from "./money";

/** Runs when every director has signed: lock the numbers into the books. */
export async function finalizeSettlement(tx: Tx, cycleId: string, actorId: string) {
  const [c] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, cycleId)).for("update");
  if (!c || c.status !== "pending_approval") return;
  const f = c.figures as SettlementFigures;
  if (f.bookingIds.length) {
    await tx.update(schema.bookings).set({ recognizedCycleId: c.id }).where(inArray(schema.bookings.id, f.bookingIds));
  }
  const today = riyadhDate();
  for (const r of f.repayments.filter((r) => r.amount > 0)) {
    await tx.insert(schema.ledgerEntries).values({ partnerId: r.partnerId, type: "repayment", amount: r.amount, description: `Priority 3 repayment · ${c.label}`, sourceType: "settlement", sourceId: c.id, cycleId: c.id, entryDate: today, createdBy: actorId });
  }
  for (const d of f.dividends.filter((d) => d.amount > 0)) {
    await tx.insert(schema.ledgerEntries).values({ partnerId: d.partnerId, type: "dividend", amount: d.amount, description: `Dividend · ${c.label}`, sourceType: "settlement", sourceId: c.id, cycleId: c.id, entryDate: today, createdBy: actorId });
  }
  const s = await getSettings(tx);
  const reserve = f.waterfall.find((w) => w.key === "reserve")?.amount ?? 0;
  if (reserve > 0) await setSetting(tx, "iataReserveHeld", s.iataReserveHeld + reserve, actorId);
  await tx.update(schema.settlementCycles).set({ status: "approved" }).where(eq(schema.settlementCycles.id, c.id));
  await audit(tx, { actorId, action: "settlement.approved", entityType: "settlement", entityId: c.id, entityRef: c.label,
    summary: `${c.label} approved by all directors · net profit SAR ${sar(f.netProfit)}` });
}

export async function reopenSettlement(tx: Tx, cycleId: string) {
  await tx.update(schema.settlementCycles).set({ status: "draft", approvalId: null }).where(eq(schema.settlementCycles.id, cycleId));
}
