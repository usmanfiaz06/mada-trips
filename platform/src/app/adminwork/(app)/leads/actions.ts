"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { can, requirePerm } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";
import { isUuid } from "@/lib/security";
import { LEAD_STATUSES, LEAD_STATUS, leadAssignees } from "@/lib/leads-server";

const Fields = z.object({
  status: z.enum(LEAD_STATUSES, "Choose a status"),
  assignedTo: z.string().optional().transform((v) => v || null).refine((v) => v === null || isUuid(v), "Choose who follows it up"),
  notes: z.string().trim().max(4000, "Keep the notes under 4,000 characters").optional().transform((v) => v || null),
});

export async function updateLead(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("leads.manage");
  const id = str(fd, "id");
  const p = Fields.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const v = p.data;
  try {
    if (!isUuid(id)) throw new Error("Lead not found");
    if (v.assignedTo && !(await leadAssignees()).some((x) => x.id === v.assignedTo)) throw new Error("Choose who follows it up");
    const msg = await db.transaction(async (tx) => {
      const [l] = await tx.select().from(schema.leads).where(eq(schema.leads.id, id)).for("update");
      if (!l) throw new Error("Lead not found");
      const changes = diff(l as unknown as Record<string, unknown>, v);
      if (!Object.keys(changes).length) return "No changes";
      await tx.update(schema.leads).set({ ...v, updatedAt: new Date() }).where(eq(schema.leads.id, id));
      if (changes.assignedTo) {
        const names = await tx.select({ id: schema.users.id, name: schema.users.name }).from(schema.users);
        const nm = (x: unknown) => names.find((n) => n.id === x)?.name ?? "—";
        changes.assignedTo = { from: nm(l.assignedTo), to: nm(v.assignedTo) };
      }
      const what = Object.keys(changes).filter((k) => k !== "status").map((k) => ({ assignedTo: "assignee" } as Record<string, string>)[k] ?? k).join(", ");
      delete changes.notes; // notes can be long; the page shows the current text
      await audit(tx, { actorId: u.id, action: changes.status ? "lead.status" : "lead.updated", entityType: "lead", entityId: id, entityRef: l.ref,
        summary: changes.status ? `Marked ${l.ref} ${LEAD_STATUS[v.status].label.toLowerCase()}${what ? ` · updated ${what}` : ""}` : `Updated ${l.ref}: ${what}`,
        changes: Object.keys(changes).length ? changes : null });
      return "Saved";
    });
    revalidatePath("/adminwork", "layout");
    return { ok: msg };
  } catch (e) { return toState(e); }
}

/** Turn a lead into a retail client, or link it to the client who already has that phone or email. */
export async function createClientFromLead(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("leads.manage");
  if (!can(u, "clients.manage")) return { error: "You can't add clients" };
  const id = str(fd, "id");
  let r: { clientId: string; msg: string };
  try {
    if (!isUuid(id)) throw new Error("Lead not found");
    r = await db.transaction(async (tx) => {
      const [l] = await tx.select().from(schema.leads).where(eq(schema.leads.id, id)).for("update");
      if (!l) throw new Error("Lead not found");
      if (l.clientId) return { clientId: l.clientId, msg: "" };
      // Same person if the phone matches on its last 9 digits (so 05…, 9665… and +966 5… agree), or the email matches.
      const digits = l.phone?.replace(/\D/g, "") ?? "";
      const phoneMatch = digits.length >= 9 ? sql`right(regexp_replace(${schema.clients.phone}, '\\D', '', 'g'), 9) = ${digits.slice(-9)}`
        : digits ? sql`regexp_replace(${schema.clients.phone}, '\\D', '', 'g') = ${digits}` : sql`false`;
      const [match] = await tx.select().from(schema.clients).where(sql`(${phoneMatch})
        OR (${l.email ? sql`lower(${schema.clients.email}) = ${l.email.toLowerCase()}` : sql`false`})`).orderBy(schema.clients.createdAt).limit(1);
      let c = match;
      if (!c) {
        const name = (l.name || l.phone || l.email || l.ref).slice(0, 80);
        [c] = await tx.insert(schema.clients).values({
          name: name.length >= 2 ? name : l.ref, type: "retail", phone: l.phone, email: l.email,
          notes: `From website lead ${l.ref}`, createdBy: u.id,
        }).returning();
        await audit(tx, { actorId: u.id, action: "client.created", entityType: "client", entityId: c.id, entityRef: c.name, summary: `Added client ${c.name} from website lead ${l.ref}` });
      }
      await tx.update(schema.leads).set({ clientId: c.id, status: l.status === "new" || l.status === "contacted" ? "qualified" : l.status, updatedAt: new Date() }).where(eq(schema.leads.id, id));
      await audit(tx, { actorId: u.id, action: "lead.converted", entityType: "lead", entityId: id, entityRef: l.ref,
        summary: match ? `Linked ${l.ref} to existing client ${c.name}` : `Created client ${c.name} from ${l.ref}` });
      return { clientId: c.id, msg: match ? `Linked to existing client ${c.name}` : `${c.name} added` };
    });
  } catch (e) { return toState(e); }
  if (r.msg) await flash(r.msg);
  revalidatePath("/adminwork", "layout");
  redirect(`/adminwork/clients/${r.clientId}`);
}
