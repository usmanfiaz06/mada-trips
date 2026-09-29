"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq, gte, inArray, lte } from "drizzle-orm";
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

const money = z.string().transform((v, ctx) => { try { return toHalalas(v); } catch { ctx.addIssue({ code: "custom", message: "Enter a valid amount" }); return z.NEVER; } });
const S = z.object({
  amount: money.refine((v) => v > 0, "Enter the exact amount paid in SAR"),
  vatAmount: money,
  expenseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick the date it was paid"),
  category: z.string().refine((v) => v in EXPENSE_CATEGORY, "Choose a category"),
  description: z.string().trim().min(3, "Describe what was paid for"),
  justification: z.string().trim().min(5, "Explain the business reason"),
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
  if (!/^(image\/|application\/pdf)/.test(file.type)) return { error: "Proof must be a PDF or photo" };
  if (v.paidBy === "partner" && !u.partnerId) return { error: "Only partners can record personal payments for reimbursement" };
  if (v.vatAmount > v.amount) return { error: "VAT can't be more than the amount" };
  if (v.expenseDate > new Date(Date.now() + 86400000).toISOString().slice(0, 10)) return { error: "The payment date can't be in the future" };
  const data = Buffer.from(await file.arrayBuffer());
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const ref = await nextRef(tx, "EX");
      const [e] = await tx.insert(schema.expenses).values({
        ref, category: v.category, description: v.description, justification: v.justification, vendor: v.vendor || null,
        amount: v.amount, vatAmount: v.vatAmount, expenseDate: v.expenseDate, paidBy: v.paidBy,
        partnerId: v.paidBy === "partner" ? u.partnerId : null, isStartup: v.paidBy === "partner" && v.isStartup === "on", submittedBy: u.id,
      }).returning();
      await tx.insert(schema.attachments).values({ entityType: "expense", entityId: e.id, filename: file.name.slice(0, 200), mime: file.type, size: file.size, data, uploadedBy: u.id });
      await audit(tx, { actorId: u.id, action: "expense.submitted", entityType: "expense", entityId: e.id, entityRef: ref, summary: `Submitted ${ref} · ${v.description} · SAR ${sar(v.amount)}${v.paidBy === "partner" ? " (paid personally)" : ""}` });
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
  try {
    await db.transaction(async (tx) => {
      const [e] = await tx.select().from(schema.expenses).where(eq(schema.expenses.id, id)).for("update");
      if (!e) throw new Error("Expense not found");
      if (e.status !== "approved") throw new Error("Only approved expenses can be voided");
      // Overheads that were part of a signed settlement already shaped the payout; changing them would rewrite history.
      if (!e.isStartup) {
        const [closed] = await tx.select().from(schema.settlementCycles).where(and(
          lte(schema.settlementCycles.startDate, e.expenseDate), gte(schema.settlementCycles.endDate, e.expenseDate),
          inArray(schema.settlementCycles.status, ["pending_approval", "approved", "paid"])));
        if (closed) throw new Error("This expense is part of a settlement that's already signed. Record a correcting entry in the next cycle instead");
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
