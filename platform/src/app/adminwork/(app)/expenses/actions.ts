"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePerm, requireUser, can } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { cancelApproval, createApproval } from "@/lib/approvals";
import { nextRef } from "@/lib/refs";
import { toHalalas, sar } from "@/lib/money";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";
import { riyadhDate } from "@/lib/dates";
import { EXPENSE_CATEGORY } from "@/lib/labels";
import { partnerBalances } from "@/lib/finance";
import { detectFileType, isIsoDate, isUuid } from "@/lib/security";

const money = z.string().transform((v, ctx) => { try { return toHalalas(v); } catch { ctx.addIssue({ code: "custom", message: "Enter a valid amount" }); return z.NEVER; } });
const S = z.object({
  amount: money.refine((v) => v > 0, "Enter the exact amount paid in SAR"),
  vatAmount: money.refine((v) => v >= 0, "VAT can't be negative"),
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was paid"),
  category: z.string().refine((v) => v in EXPENSE_CATEGORY && v !== "commission", "Choose a category"),
  description: z.string().trim().min(3, "Describe what was paid for").max(200, "Keep the description under 200 characters"),
  justification: z.string().trim().min(5, "Explain the business reason").max(1000, "Keep the justification under 1,000 characters"),
  vendor: z.string().trim().max(120).optional(),
  paidBy: z.enum(["retail", "corporate", "partner"]),
  isStartup: z.string().optional(),
});

export async function submitExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("expenses.create");
  const p = S.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const v = p.data;
  const file = fd.get("proof");
  if (!(file instanceof File) || file.size === 0) return { error: "Attach the proof of payment (transfer confirmation or tax invoice)", fields: { proof: "x" } };
  if (file.size > 6 * 1024 * 1024) return { error: "Proof must be under 6 MB" };
  const data = Buffer.from(await file.arrayBuffer());
  const mime = detectFileType(data); // from the file's own bytes, never the browser's claim
  if (!mime) return { error: "Proof must be a PDF or photo" };
  if (v.paidBy === "partner" && !u.partnerId) return { error: "Only partners can record personal payments for reimbursement" };
  // Partners may record what any partner paid (Abdulaziz entering Bader's receipt). It goes to that partner's ledger.
  let payerId: string | null = null;
  if (v.paidBy === "partner") {
    const chosen = str(fd, "partnerId") || u.partnerId!;
    if (!isUuid(chosen)) return { error: "Choose which partner paid" };
    const [pp] = await db.select({ id: schema.partners.id }).from(schema.partners).where(eq(schema.partners.id, chosen));
    if (!pp) return { error: "Choose which partner paid" };
    payerId = pp.id;
  }
  if (v.vatAmount > v.amount) return { error: "VAT can't be more than the amount" };
  if (!isIsoDate(v.expenseDate) || v.expenseDate > riyadhDate()) return { error: "The payment date can't be in the future" };
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const ref = await nextRef(tx, "EX");
      const [e] = await tx.insert(schema.expenses).values({
        ref, category: v.category, description: v.description, justification: v.justification, vendor: v.vendor || null,
        amount: v.amount, vatAmount: v.vatAmount, expenseDate: v.expenseDate, paidBy: v.paidBy,
        partnerId: payerId, isStartup: v.paidBy === "partner" && v.isStartup === "on", submittedBy: u.id,
      }).returning();
      await tx.insert(schema.attachments).values({ entityType: "expense", entityId: e.id, filename: file.name.replace(/[\u0000-\u001f\u007f/\\]/g, "_").slice(0, 200) || "proof", mime, size: data.length, data, uploadedBy: u.id });
      const payerName = payerId ? (await tx.select({ n: schema.partners.name }).from(schema.partners).where(eq(schema.partners.id, payerId)))[0]?.n : null;
      await audit(tx, { actorId: u.id, action: "expense.submitted", entityType: "expense", entityId: e.id, entityRef: ref,
        summary: `Submitted ${ref} · ${v.description} · SAR ${sar(v.amount)}${payerId ? (payerId === u.partnerId ? " (paid personally)" : ` (paid personally by ${payerName})`) : ""}` });
      const r = await createApproval(tx, { kind: "expense", entityType: "expense", entityId: e.id, title: `${ref} · ${v.description}`, amount: v.amount, reason: v.justification, requestedBy: u.id });
      await tx.update(schema.expenses).set({ approvalId: r.id }).where(eq(schema.expenses.id, e.id));
      await flash(`${ref} submitted for verification`);
      return e.id;
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/expenses/${id}`);
}

/** Pull back an expense that hasn't been verified yet. The record stays in the log; it just stops counting. */
export async function withdrawExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id");
  try {
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id)).for("update");
      if (!e) throw new Error("Expense not found");
      if (e.submittedBy !== u.id) throw new Error("Only the person who submitted it can withdraw it");
      if (e.status !== "pending") throw new Error("Only expenses still waiting for verification can be withdrawn");
      await tx.update(schema.expenses).set({ status: "withdrawn" }).where(eq(schema.expenses.id, id));
      if (e.approvalId) {
        const [req] = await tx.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.id, e.approvalId));
        if (req?.status === "pending") await cancelApproval(tx, req.id, u.id);
      }
      await audit(tx, { actorId: u.id, action: "expense.withdrawn", entityType: "expense", entityId: id, entityRef: e.ref, summary: `Withdrew ${e.ref} · ${e.description}${str(fd, "reason") ? `: "${str(fd, "reason")}"` : ""}` });
      await flash(`${e.ref} withdrawn`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/expenses/${id}`);
}

/** Cancel an approved expense that was a mistake. Reverses the partner ledger if a partner paid it. */
export async function voidExpense(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireUser();
  const id = str(fd, "id"), reason = str(fd, "reason");
  if (!can(u, "expenses.verify")) return { error: "Only verifiers can void an approved expense" };
  if (!reason) return { error: "Give a reason for voiding" };
  if (reason.length > 1000) return { error: "Keep the reason under 1,000 characters" };
  try {
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id)).for("update");
      if (!e) throw new Error("Expense not found");
      if (e.status !== "approved") throw new Error("Only approved expenses can be voided");
      // Overheads a signed settlement already counted shaped the payout; changing them would rewrite history.
      if (e.recognizedCycleId) throw new Error("This expense is part of a settlement that's already signed. Record a correcting entry in the next cycle instead");
      if (!e.isStartup) {
        const [pending] = await tx.select().from(schema.settlementCycles).where(eq(schema.settlementCycles.status, "pending_approval"));
        if (pending && ((pending.figures as { expenseIds?: string[] }).expenseIds ?? []).includes(e.id)) throw new Error(`This expense is in ${pending.label}, which is waiting for signatures. Withdraw that first`);
      }
      // A partner can't end up owing money back because a reimbursement they were already repaid is voided.
      if (e.paidBy === "partner" && e.partnerId) {
        const bal = (await partnerBalances(tx)).find((b) => b.id === e.partnerId);
        if (!bal || bal.outstanding < e.amount) throw new Error("This partner has already been repaid part of this. Agree a correction with the directors instead of voiding");
      }
      await tx.update(schema.expenses).set({ status: "void" }).where(eq(schema.expenses.id, id));
      if (e.paidBy === "partner" && e.partnerId) {
        await tx.insert(schema.ledgerEntries).values({
          partnerId: e.partnerId, type: e.isStartup ? "advance" : "expense", amount: -e.amount,
          description: `Reversal of ${e.ref} (voided) · ${e.description}`, sourceType: "expense", sourceId: e.id, entryDate: riyadhDate(), createdBy: u.id,
        });
      }
      await audit(tx, { actorId: u.id, action: "expense.voided", entityType: "expense", entityId: id, entityRef: e.ref,
        summary: `Voided ${e.ref} · SAR ${sar(e.amount)}: "${reason}"${e.paidBy === "partner" ? " · partner ledger reversed" : ""}` });
      await tx.insert(schema.remarks).values({ entityType: "expense", entityId: id, userId: u.id, body: `Voided: ${reason}` });
      await flash(`${e.ref} voided`);
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/expenses/${id}`);
}
