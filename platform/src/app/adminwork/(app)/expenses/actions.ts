"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { createApproval } from "@/lib/approvals";
import { nextRef } from "@/lib/refs";
import { toHalalas, sar } from "@/lib/money";
import { flash, toState, zodError, type ActionState } from "@/lib/actions";
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
