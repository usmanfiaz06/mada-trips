"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, ne, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit, diff } from "@/lib/audit";
import { ALL_PERMISSIONS, type Permission } from "@/lib/permissions";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";

const tempPassword = () => `Mada-${randomBytes(4).toString("hex")}`;

const Member = z.object({
  name: z.string().trim().min(2, "Enter a name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  phone: z.string().trim().max(40).optional().transform((v) => v || null),
  roleId: z.string().uuid("Choose a role"),
  team: z.enum(["management", "riyadh", "pakistan"]),
  partnerId: z.string().optional().transform((v) => (v ? v : null)),
});

export async function addMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("team.manage");
  const p = Member.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const pw = tempPassword();
  try {
    const [dupe] = await db.select().from(schema.users).where(eq(sql`lower(${schema.users.email})`, p.data.email));
    if (dupe) throw new Error("Someone already uses that email");
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.id, p.data.roleId));
    await db.transaction(async (tx) => {
      const [m] = await tx.insert(schema.users).values({ ...p.data, passwordHash: await bcrypt.hash(pw, 10) }).returning();
      await audit(tx, { actorId: u.id, action: "user.created", entityType: "user", entityId: m.id, entityRef: m.name, summary: `Added ${m.name} as ${role?.name ?? "member"}` });
    });
  } catch (e) { return toState(e); }
  revalidatePath("/team");
  return { ok: `Added. Temporary password: ${pw}. Share it privately; they'll change it on first sign-in.` };
}

/** Never leave the company without someone who can manage people and roles. */
async function assertAdminsRemain(excludeUserId: string, newRoleId?: string) {
  const rows = await db.select({ id: schema.users.id, perms: schema.roles.permissions }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
    .where(and(eq(schema.users.active, true), ne(schema.users.id, excludeUserId)));
  let extra = false;
  if (newRoleId) { const [r] = await db.select().from(schema.roles).where(eq(schema.roles.id, newRoleId)); extra = !!r?.permissions.includes("team.manage") && r.permissions.includes("roles.manage"); }
  if (!extra && !rows.some((r) => r.perms.includes("team.manage") && r.perms.includes("roles.manage"))) throw new Error("At least one active person must be able to manage the team and roles");
}

export async function updateMember(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("team.manage");
  const id = str(fd, "id");
  const p = Member.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  try {
    const [before] = await db.select().from(schema.users).where(eq(schema.users.id, id));
    if (!before) throw new Error("Not found");
    if (p.data.roleId !== before.roleId) await assertAdminsRemain(id, p.data.roleId);
    const changes = diff(before, p.data);
    if (!Object.keys(changes).length) return { ok: "No changes" };
    const roles = await db.select().from(schema.roles);
    const rn = (rid: unknown) => roles.find((r) => r.id === rid)?.name ?? rid;
    if (changes.roleId) changes.roleId = { from: rn(changes.roleId.from), to: rn(changes.roleId.to) };
    await db.transaction(async (tx) => {
      await tx.update(schema.users).set(p.data).where(eq(schema.users.id, id));
      await audit(tx, { actorId: u.id, action: changes.roleId ? "user.role_changed" : "user.updated", entityType: "user", entityId: id, entityRef: p.data.name,
        summary: changes.roleId ? `Changed ${p.data.name}'s role from ${changes.roleId.from} to ${changes.roleId.to}` : `Updated ${p.data.name}: ${Object.keys(changes).join(", ")}`, changes });
    });
  } catch (e) { return toState(e); }
  revalidatePath(`/team/${id}`);
  return { ok: "Saved" };
}

export async function setActive(fd: FormData) {
  const u = await requirePerm("team.manage");
  const id = str(fd, "id");
  const active = str(fd, "active") === "true";
  if (id === u.id && !active) { await flash("You can't deactivate yourself"); redirect(`/team/${id}`); }
  if (!active) await assertAdminsRemain(id);
  const [m] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ active }).where(eq(schema.users.id, id));
    if (!active) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await audit(tx, { actorId: u.id, action: active ? "user.reactivated" : "user.deactivated", entityType: "user", entityId: id, entityRef: m.name, summary: `${active ? "Reactivated" : "Deactivated"} ${m.name}${active ? "" : " and signed them out everywhere"}` });
  });
  await flash(active ? `${m.name} can sign in again` : `${m.name} deactivated`);
  revalidatePath("/team");
  redirect(`/team/${id}`);
}

export async function resetPassword(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("team.manage");
  const id = str(fd, "id");
  const pw = tempPassword();
  const [m] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!m) return { error: "Not found" };
  await db.transaction(async (tx) => {
    await tx.update(schema.users).set({ passwordHash: await bcrypt.hash(pw, 10) }).where(eq(schema.users.id, id));
    await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
    await audit(tx, { actorId: u.id, action: "user.password_reset", entityType: "user", entityId: id, entityRef: m.name, summary: `Reset ${m.name}'s password and signed them out everywhere` });
  });
  return { ok: `New temporary password: ${pw}` };
}

/* ───────── Roles ───────── */

const RoleSchema = z.object({
  name: z.string().trim().min(2, "Name the role"),
  nameAr: z.string().trim().min(1, "Add the Arabic name"),
  description: z.string().trim().max(300).optional().transform((v) => v || null),
});

export async function saveRole(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("roles.manage");
  const id = str(fd, "id");
  const p = RoleSchema.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const permissions = fd.getAll("permissions").map(String).filter((x): x is Permission => (ALL_PERMISSIONS as string[]).includes(x));
  let newId = id;
  try {
    if (id) {
      const [before] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
      if (!before) throw new Error("Role not found");
      // Don't let an edit lock everyone out of administration.
      const losesAdmin = before.permissions.includes("roles.manage") && !permissions.includes("roles.manage") || before.permissions.includes("team.manage") && !permissions.includes("team.manage");
      if (losesAdmin) {
        const others = await db.select({ perms: schema.roles.permissions }).from(schema.users).innerJoin(schema.roles, eq(schema.roles.id, schema.users.roleId))
          .where(and(eq(schema.users.active, true), ne(schema.roles.id, id)));
        if (!others.some((o) => o.perms.includes("roles.manage") && o.perms.includes("team.manage"))) throw new Error("Another active role must keep team and role management first");
      }
      const added = permissions.filter((x) => !before.permissions.includes(x));
      const removed = before.permissions.filter((x) => !permissions.includes(x as Permission));
      await db.transaction(async (tx) => {
        await tx.update(schema.roles).set({ ...p.data, permissions }).where(eq(schema.roles.id, id));
        await audit(tx, { actorId: u.id, action: "role.updated", entityType: "role", entityId: id, entityRef: p.data.name,
          summary: `Updated role ${p.data.name}${added.length ? ` · granted ${added.join(", ")}` : ""}${removed.length ? ` · removed ${removed.join(", ")}` : ""}`,
          changes: { permissions: { from: before.permissions.join(", "), to: permissions.join(", ") } } });
      });
    } else {
      const key = p.data.name.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "") + "_" + randomBytes(2).toString("hex");
      newId = await db.transaction(async (tx) => {
        const [r] = await tx.insert(schema.roles).values({ key, ...p.data, permissions }).returning();
        await audit(tx, { actorId: u.id, action: "role.created", entityType: "role", entityId: r.id, entityRef: r.name, summary: `Created role ${r.name} with ${permissions.length} permissions` });
        return r.id;
      });
    }
  } catch (e) { return toState(e); }
  revalidatePath("/", "layout");
  if (!id) { await flash("Role created"); redirect(`/team/roles/${newId}`); }
  return { ok: "Role saved. Changes apply on everyone's next click" };
}

export async function deleteRole(fd: FormData) {
  const u = await requirePerm("roles.manage");
  const id = str(fd, "id");
  const [r] = await db.select().from(schema.roles).where(eq(schema.roles.id, id));
  const [{ n }] = await db.select({ n: sql<number>`count(*)::int` }).from(schema.users).where(eq(schema.users.roleId, id));
  if (!r || r.isSystem || n > 0) { await flash(r?.isSystem ? "Built-in roles can't be deleted" : "Move everyone off this role first"); redirect(`/team/roles/${id}`); }
  await db.transaction(async (tx) => {
    await tx.delete(schema.roles).where(eq(schema.roles.id, id));
    await audit(tx, { actorId: u.id, action: "role.deleted", entityType: "role", entityId: id, entityRef: r.name, summary: `Deleted role ${r.name}` });
  });
  await flash("Role deleted");
  redirect("/team/roles");
}
