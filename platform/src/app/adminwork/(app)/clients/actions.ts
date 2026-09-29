"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { can, requirePerm } from "@/lib/auth";
import { isUuid } from "@/lib/security";
import { audit, diff } from "@/lib/audit";
import { createApproval } from "@/lib/approvals";
import { toHalalas, sar } from "@/lib/money";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";

const ClientSchema = z.object({
  name: z.string().trim().min(2, "Enter the client's name"),
  type: z.enum(["retail", "contracted", "noncontracted"]),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  email: z.string().trim().max(120).optional().transform((v) => v || null).refine((v) => !v || /.+@.+\..+/.test(v), "Enter a valid email"),
  contactPerson: z.string().trim().max(120).optional().transform((v) => v || null),
  contractRef: z.string().trim().max(60).optional().transform((v) => v || null),
  paymentTermsDays: z.coerce.number().int().min(0).max(180),
  notes: z.string().trim().max(2000).optional().transform((v) => v || null),
});

export async function createClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const p = ClientSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  // Payment terms are a credit decision.
  if (!can(u, "clients.credit")) p.data.paymentTermsDays = 0;
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      const [c] = await tx.insert(schema.clients).values({ ...p.data, createdBy: u.id }).returning();
      await audit(tx, { actorId: u.id, action: "client.created", entityType: "client", entityId: c.id, entityRef: c.name, summary: `Added client ${c.name}` });
      const limit = str(fd, "creditLimit");
      if (p.data.type === "contracted" && limit && toHalalas(limit) > 0) {
        const r = await createApproval(tx, { kind: "credit_limit", entityType: "client", entityId: c.id, title: `Credit limit for ${c.name}: SAR ${sar(toHalalas(limit))}`, amount: toHalalas(limit), reason: `New contract ${p.data.contractRef ?? ""}`.trim(), requestedBy: u.id });
        await flash(`${c.name} added. Credit limit sent for approval (${r.ref})`);
      } else await flash(`${c.name} added`);
      return c.id;
    });
  } catch (e) { return toState(e); }
  redirect(`/adminwork/clients/${id}`);
}

export async function updateClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const id = str(fd, "id");
  const p = ClientSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  try {
    if (!isUuid(id)) throw new Error("Client not found");
    const [before] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
    if (!before) throw new Error("Client not found");
    // Type decides the channel, bank account and credit rules; terms decide when money is due. Both are credit decisions.
    if (!can(u, "clients.credit") && (p.data.type !== before.type || p.data.paymentTermsDays !== before.paymentTermsDays)) throw new Error("Only management can change a client's type or payment terms");
    const changes = diff(before, p.data);
    if (!Object.keys(changes).length) return { ok: "No changes" };
    await db.transaction(async (tx) => {
      await tx.update(schema.clients).set(p.data).where(eq(schema.clients.id, id));
      await audit(tx, { actorId: u.id, action: "client.updated", entityType: "client", entityId: id, entityRef: p.data.name, summary: `Updated ${p.data.name}: ${Object.keys(changes).join(", ")}`, changes });
    });
  } catch (e) { return toState(e); }
  revalidatePath(`/adminwork/clients/${id}`);
  return { ok: "Saved" };
}

export async function requestCreditLimit(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const id = str(fd, "id");
  try {
    if (!isUuid(id) || !str(fd, "amount")) throw new Error("Enter a limit");
    const amount = toHalalas(str(fd, "amount"));
    if (amount < 0) throw new Error("Enter a limit");
    const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, id));
    if (!c) throw new Error("Client not found");
    if (c.type !== "contracted") throw new Error("Only contracted clients have a standing credit limit");
    if (amount === c.creditLimit) throw new Error("That's already the limit");
    await db.transaction(async (tx) => {
      const [open] = await tx.select().from(schema.approvalRequests).where(and(eq(schema.approvalRequests.entityId, id), eq(schema.approvalRequests.kind, "credit_limit"), eq(schema.approvalRequests.status, "pending")));
      if (open) throw new Error(`A limit change (${open.ref}) is already waiting for approval`);
      // Lowering a limit reduces risk, so it applies immediately; raising it needs directors.
      if (amount < c.creditLimit) {
        if (!can(u, "clients.credit")) throw new Error("Only management can lower a credit limit");
        await tx.update(schema.clients).set({ creditLimit: amount }).where(eq(schema.clients.id, id));
        await audit(tx, { actorId: u.id, action: "client.credit_limit_changed", entityType: "client", entityId: id, entityRef: c.name, summary: `Lowered credit limit for ${c.name} to SAR ${sar(amount)}`, changes: { creditLimit: { from: c.creditLimit, to: amount } } });
        await flash("Limit lowered");
      } else {
        const r = await createApproval(tx, { kind: "credit_limit", entityType: "client", entityId: id, title: `Raise ${c.name} credit limit to SAR ${sar(amount)}`, amount, reason: str(fd, "reason") || null, requestedBy: u.id });
        await flash(`Sent to directors (${r.ref})`);
      }
    });
  } catch (e) { return toState(e); }
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/clients/${id}`);
}
