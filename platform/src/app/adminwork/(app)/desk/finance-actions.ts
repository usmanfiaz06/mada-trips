"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { requirePerm } from "@/lib/auth";
import { str, toState, type ActionState } from "@/lib/actions";
import { toHalalas } from "@/lib/money";
import { isUuid } from "@/lib/security";
import { DeskError } from "@/lib/app/desk/core";
import { approveRefund } from "@/lib/app/desk/adapters";
import { giveGoodwill } from "@/lib/app/desk/customers";
import { markRefundSent, sendApprovedNow, startDeskRefund } from "@/lib/app/finance/refunds";
import { costsJob, setLineCost } from "@/lib/app/finance/costs";
import { postingJob } from "@/lib/app/finance/ops-posting";
import { importSettlement } from "@/lib/app/finance/recon";
import { supplierBalances } from "@/lib/app/finance/balances";
import { requireDeskFinance } from "@/lib/app/finance/access";

/*
 * Server actions for refunds and App finance (DESK-PLAN U6). Each checks the signed-in person; the lib checks the
 * capability again and writes the audit trails. Declining a refund stays in desk/actions.ts (rejectRefundAction).
 */

const uuid = (fd: FormData, k: string) => { const v = str(fd, k); if (!isUuid(v)) throw new DeskError("Not found", "NOT_FOUND"); return v; };
const amountOf = (fd: FormData, k: string) => { const raw = str(fd, k); if (!raw) return null; try { return toHalalas(raw); } catch { throw new DeskError("Check the amount"); } };
const refunds = (ok: string): ActionState => { revalidatePath("/adminwork/desk/refunds"); return { ok }; };

/** Approve all or part of a refund, to the card or to Mada credit. Over the agent's limits it goes to a lead. */
export async function decideRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.refund");
    const r = await approveRefund(u, uuid(fd, "id"), { destination: str(fd, "destination") === "credit" ? "credit" : "original", amount: amountOf(fd, "amount"), note: str(fd, "note") || null });
    if (r.status === "awaiting_lead") return refunds(`Over your limit, so a support lead approves it in Approvals (${r.approvalRef})`);
    return refunds(r.status === "sent" ? "Refunded to Mada credit" : "Refund approved. It moves to Sent when the provider confirms");
  } catch (e) { return toState(e); }
}

export async function markRefundSentAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.refund"); await markRefundSent(u, uuid(fd, "id"), str(fd, "reference")); return refunds("Marked sent. The traveller has been told"); } catch (e) { return toState(e); }
}

export async function sendApprovedNowAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try { const u = await requirePerm("desk.refund"); await sendApprovedNow(u, uuid(fd, "id")); return refunds("Sent"); } catch (e) { return toState(e); }
}

/** Goodwill credit from the refunds page: the same limits as from the customer page. */
export async function refundsGoodwillAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requirePerm("desk.act");
    const r = await giveGoodwill(u, uuid(fd, "userId"), { amount: amountOf(fd, "amount") ?? 0, note: str(fd, "note") });
    return refunds(r.applied ? "Goodwill credit added" : `Sent to a support lead to approve in Approvals (${r.approvalRef})`);
  } catch (e) { return toState(e); }
}

/** Cancel with the supplier and open the refund (the preview is the page itself, refunds/new). */
export async function startDeskRefundAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let id: string;
  try {
    const u = await requirePerm("desk.refund");
    const r = await startDeskRefund(u, { orderRef: str(fd, "order"), cancel: str(fd, "cancel"), amount: amountOf(fd, "amount"), reason: str(fd, "reason"), confirm: true });
    if (r.preview) return { error: "Nothing was done" };
    id = r.refundId;
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/desk/refunds");
  redirect(`/adminwork/desk/refunds?focus=${id}`);
}

export async function setLineCostAction(_: ActionState, fd: FormData): Promise<ActionState> {
  try {
    const u = await requireDeskFinance();
    const n = Number(str(fd, "net").replace(/,/g, ""));
    await setLineCost(u.id, uuid(fd, "id"), { amount: n, currency: str(fd, "currency") || "SAR" });
    revalidatePath("/adminwork/desk/finance");
    return { ok: "Cost saved" };
  } catch (e) { return toState(e); }
}

/** Cost lines for new captures and Ops posting now, instead of waiting for the job. */
export async function refreshFinanceAction(_: ActionState): Promise<ActionState> {
  try {
    await requireDeskFinance();
    const c = await costsJob();
    const p = await postingJob();
    revalidatePath("/adminwork/desk/finance");
    return { ok: `${c.costed} payments costed, ${p.sales} sales and ${p.refunds} refunds posted to Ops` };
  } catch (e) { return toState(e); }
}

export async function importSettlementAction(_: ActionState, fd: FormData): Promise<ActionState> {
  let importId: string;
  try {
    const u = await requireDeskFinance();
    const f = fd.get("file");
    if (!(f instanceof File) || f.size === 0) throw new Error("Choose the settlement file (CSV)");
    if (f.size > 5_000_000) throw new Error("The file is over 5 MB. Export a shorter period");
    const r = await importSettlement(u.id, { fileName: f.name, text: await f.text() });
    importId = r.importId;
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork/desk/finance/reconciliation");
  redirect(`/adminwork/desk/finance/reconciliation?import=${importId}`);
}

export async function readBalancesAction(_: ActionState): Promise<ActionState> {
  try { await requireDeskFinance(); await supplierBalances({ fresh: true }); revalidatePath("/adminwork/desk/finance/balances"); return { ok: "Balances read" }; } catch (e) { return toState(e); }
}
