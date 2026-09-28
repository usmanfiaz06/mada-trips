"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { computeSettlement, type SettlementFigures, type SettlementInputs } from "@/lib/finance";
import { getSettings } from "@/lib/settings";
import { createApproval } from "@/lib/approvals";
import { cycleFor, fmtDate, businessDate } from "@/lib/dates";
import { toHalalas, sar } from "@/lib/money";
import { flash, str, toState, type ActionState } from "@/lib/actions";

export async function prepareCycle(fd: FormData) {
  const u = await requirePerm("settlement.run");
  const end = str(fd, "end");
  const s = await getSettings();
  const { start } = cycleFor(end, s.cutoffDay);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(end) || businessDate(new Date(), s.closeHour) <= end) { await flash("This cycle hasn't passed its cut-off yet"); redirect("/settlement"); }
  const id = await db.transaction(async (tx) => {
    const [exists] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.endDate, end));
    if (exists) return exists.id;
    const inputs: SettlementInputs = { reserveTopUp: -1, repaymentPctBps: s.repaymentPctBps, payoutAccount: "retail" };
    const figures = await computeSettlement(tx, start, end, { repaymentPctBps: inputs.repaymentPctBps, payoutAccount: "retail" }, s.iataReserveHeld, s.repaymentPctBps, s.iataBuffer);
    inputs.reserveTopUp = figures.waterfall.find((w) => w.key === "reserve")!.amount;
    const label = `Cycle ending ${fmtDate(end, "en")}`;
    const [c] = await tx.insert(schema.settlementCycles).values({ label, startDate: start, endDate: end, inputs, figures, createdBy: u.id }).returning();
    await audit(tx, { actorId: u.id, action: "settlement.prepared", entityType: "settlement", entityId: c.id, entityRef: label, summary: `Prepared ${label}: net profit SAR ${sar(figures.netProfit)}` });
    return c.id;
  });
  redirect(`/settlement/${id}`);
}

export async function recompute(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settlement.run");
  const id = str(fd, "id");
  try {
    const s = await getSettings();
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, id)).for("update");
      if (!c || c.status !== "draft") throw new Error("Only a draft can be changed");
      const pct = Number(str(fd, "repaymentPct"));
      if (!(pct >= 0 && pct <= 100)) throw new Error("Repayment share must be between 0 and 100%");
      const inputs: SettlementInputs = { reserveTopUp: toHalalas(str(fd, "reserveTopUp")), repaymentPctBps: Math.round(pct * 100), payoutAccount: str(fd, "payoutAccount") === "corporate" ? "corporate" : "retail" };
      if (inputs.reserveTopUp < 0) throw new Error("Reserve can't be negative");
      const figures = await computeSettlement(tx, c.startDate, c.endDate, inputs, s.iataReserveHeld, s.repaymentPctBps, s.iataBuffer, c.id);
      await tx.update(schema.settlementCycles).set({ inputs, figures }).where(eq(schema.settlementCycles.id, id));
      await audit(tx, { actorId: u.id, action: "settlement.updated", entityType: "settlement", entityId: id, entityRef: c.label,
        summary: `Updated ${c.label}: reserve SAR ${sar(inputs.reserveTopUp)}, repayments ${pct}% · dividends SAR ${sar(figures.waterfall[3].amount)}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath(`/settlement/${id}`);
  return { ok: "Recalculated" };
}

export async function submitSettlement(fd: FormData) {
  const u = await requirePerm("settlement.run");
  const id = str(fd, "id");
  await db.transaction(async (tx) => {
    const [c] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, id)).for("update");
    if (!c || c.status !== "draft") throw new Error("Already submitted");
    const f = c.figures as SettlementFigures;
    const r = await createApproval(tx, { kind: "settlement", entityType: "settlement", entityId: c.id, title: `${c.label} · distribute SAR ${sar(f.waterfall[2].amount + f.waterfall[3].amount)}`, amount: f.netProfit, reason: `Net profit ${sar(f.netProfit)}; reserve ${sar(f.waterfall[1].amount)}; repayments ${sar(f.waterfall[2].amount)}; dividends ${sar(f.waterfall[3].amount)}`, requestedBy: u.id });
    await tx.update(schema.settlementCycles).set({ status: "pending_approval", approvalId: r.id }).where(eq(schema.settlementCycles.id, id));
    await flash(`Sent to all directors to sign (${r.ref})`);
  });
  revalidatePath("/", "layout");
  redirect(`/settlement/${id}`);
}

export async function markPaid(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("settlement.run");
  const id = str(fd, "id");
  try {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.id, id)).for("update");
      if (!c || c.status !== "approved") throw new Error("Only an approved settlement can be paid");
      const f = c.figures as SettlementFigures;
      const refs: Record<string, string> = {};
      for (const d of f.dividends) {
        const total = d.amount + (f.repayments.find((r) => r.partnerId === d.partnerId)?.amount ?? 0);
        const ref = str(fd, `ref_${d.partnerId}`);
        if (total > 0 && !ref) throw new Error(`Enter the transfer reference for ${d.name}`);
        refs[d.partnerId] = ref;
      }
      await tx.update(schema.settlementCycles).set({ status: "paid", paidAt: new Date(), figures: { ...f, transferRefs: refs } }).where(eq(schema.settlementCycles.id, id));
      await audit(tx, { actorId: u.id, action: "settlement.paid", entityType: "settlement", entityId: id, entityRef: c.label, summary: `Recorded partner transfers for ${c.label}` });
    });
  } catch (e) { return toState(e); }
  await flash("Transfers recorded. Cycle closed");
  revalidatePath("/", "layout");
  redirect(`/settlement/${id}`);
}
