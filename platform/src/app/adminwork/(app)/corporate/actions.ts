"use server";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { toHalalas, sar } from "@/lib/money";
import { detectFileType, isUuid } from "@/lib/security";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";
import { billNextMonth, freeSlug, LEASE_TERMS, postMessage, refreshCosts, SERVICES, siteOrigin, SLUG_RE, workspaceLink, type Line } from "@/lib/portal";

const tempPassword = () => `Mada-${randomBytes(10).toString("hex").match(/.{4}/g)!.join("-")}`;
const done = (path: string) => { revalidatePath("/adminwork", "layout"); revalidatePath(path); };

/* ───────── Set up a client's workspace ───────── */

export async function enableWorkspace(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const clientId = str(fd, "clientId");
  const newName = str(fd, "newName").slice(0, 120);
  let id = "";
  try {
    id = await db.transaction(async (tx) => {
      let c: typeof schema.clients.$inferSelect | undefined;
      if (isUuid(clientId)) [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, clientId)).for("update");
      else if (newName.length >= 2) {
        [c] = await tx.insert(schema.clients).values({ name: newName, type: "contracted", paymentTermsDays: 30, createdBy: u.id }).returning();
        await audit(tx, { actorId: u.id, action: "client.created", entityType: "client", entityId: c.id, entityRef: c.name, summary: `Added client ${c.name}` });
      }
      if (!c) throw new Error("Choose a client or type a new company name");
      if (c.type === "retail") throw new Error("Workspaces are for companies. Change this client's type first");
      await tx.update(schema.clients).set({ portalEnabled: true, portalSlug: c.portalSlug ?? (await freeSlug(tx, c.name)), portalServices: Object.keys(c.portalServices as object).length ? c.portalServices : { lease: "price" }, accountManagerId: c.accountManagerId ?? u.id })
        .where(eq(schema.clients.id, c.id));
      await audit(tx, { actorId: u.id, action: "portal.enabled", entityType: "client", entityId: c.id, entityRef: c.name, summary: `Opened a corporate workspace for ${c.name}` });
      return c.id;
    });
  } catch (e) { return toState(e); }
  done("/adminwork/corporate");
  redirect(`/adminwork/corporate/clients/${id}`);
}

const Settings = z.object({
  id: z.string().uuid(),
  enabled: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).catch("#1e352d"),
  accountManagerId: z.string().uuid().optional().or(z.literal("").transform(() => undefined)),
  needsApproval: z.string().optional(),
  hiddenNames: z.string().max(1000).optional(),
  slug: z.string().trim().toLowerCase().optional().transform((v) => v || undefined)
    .refine((v) => v === undefined || (SLUG_RE.test(v) && v !== "login"), "Use 2–40 lowercase letters, numbers or dashes for the link"),
});

export async function saveWorkspace(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const p = Settings.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const v = p.data;
  const services: Record<string, string> = {};
  for (const s of SERVICES) { const m = str(fd, `svc_${s.key}`); if (m === "price" || m === "quote") services[s.key] = m; }
  if (!Object.keys(services).length) return { error: "Offer at least one service" };
  const hiddenNames = [...new Set((v.hiddenNames ?? "").split(/[,\n]/).map((x) => x.trim()).filter((x) => x.length >= 2).map((x) => x.slice(0, 60)))].slice(0, 30);
  try {
    await db.transaction(async (tx) => {
      const [before] = await tx.select().from(schema.clients).where(eq(schema.clients.id, v.id));
      if (!before) throw new Error("Client not found");
      if (v.slug && v.slug !== before.portalSlug) {
        const [taken] = await tx.select({ id: schema.clients.id }).from(schema.clients).where(eq(schema.clients.portalSlug, v.slug));
        if (taken) throw new Error("Another client already uses that link");
      }
      const after = { portalSlug: v.slug ?? before.portalSlug, portalEnabled: v.enabled === "on", portalColor: v.color, portalServices: services, portalNeedsApproval: v.needsApproval === "on", hiddenNames, accountManagerId: v.accountManagerId ?? null };
      await tx.update(schema.clients).set(after).where(eq(schema.clients.id, v.id));
      await audit(tx, { actorId: u.id, action: "portal.settings", entityType: "client", entityId: v.id, entityRef: before.name, summary: `Updated ${before.name}'s workspace`,
        changes: { services, hiddenNames: hiddenNames.length, needsApproval: after.portalNeedsApproval, enabled: after.portalEnabled } });
    });
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/clients/${v.id}`);
  return { ok: "Saved. The client sees it next time a page loads" };
}

export async function uploadLogo(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const id = str(fd, "id");
  const file = fd.get("file");
  if (!isUuid(id)) return { error: "Unknown client" };
  if (!(file instanceof File) || file.size === 0) return { error: "Choose an image" };
  if (file.size > 2 * 1024 * 1024) return { error: "Logos must be under 2 MB" };
  const data = Buffer.from(await file.arrayBuffer());
  const mime = detectFileType(data);
  if (mime !== "image/png" && mime !== "image/jpeg" && mime !== "image/webp") return { error: "Upload the logo as PNG, JPEG or WebP" };
  try {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!c) throw new Error("Client not found");
      const [a] = await tx.insert(schema.attachments).values({ entityType: "client_logo", entityId: id, filename: "logo", mime, size: data.length, data, uploadedBy: u.id }).returning({ id: schema.attachments.id });
      await tx.update(schema.clients).set({ portalLogoId: a.id }).where(eq(schema.clients.id, id));
      await audit(tx, { actorId: u.id, action: "portal.logo", entityType: "client", entityId: id, entityRef: c.name, summary: `Uploaded ${c.name}'s logo` });
    });
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/clients/${id}`);
  return { ok: "Logo updated" };
}

/* ───────── What the client sees and pays (directors) ───────── */

export async function savePricing(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.credit");
  const id = str(fd, "id");
  if (!isUuid(id)) return { error: "Unknown client" };
  const terms = LEASE_TERMS.filter((t) => fd.get(`term_${t}`) === "on");
  if (!terms.length) return { error: "Offer at least one lease term" };
  const mode = str(fd, "mode");
  let markupBps: number | null = null;
  if (mode === "markup") {
    const pct = Number(str(fd, "markup"));
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) return { error: "Markup must be between 0 and 100%" };
    markupBps = Math.round(pct * 100);
  }
  try {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, id));
      if (!c) throw new Error("Client not found");
      const all = await tx.select().from(schema.vehicles);
      const hidden = all.filter((v) => fd.get(`show_${v.key}`) !== "on").map((v) => v.key);
      await tx.update(schema.clients).set({ portalTerms: [...terms], portalMarkupBps: markupBps, portalHiddenVehicles: hidden }).where(eq(schema.clients.id, id));
      // Agreed prices: a typed amount sets it, an empty box removes it.
      let changed = 0;
      for (const v of all) for (const t of LEASE_TERMS) {
        const raw = fd.get(`price_${v.key}_${t}`);
        if (raw === null) continue;
        const val = String(raw).trim();
        await tx.delete(schema.clientVehiclePrices).where(and(eq(schema.clientVehiclePrices.clientId, id), eq(schema.clientVehiclePrices.vehicleId, v.id), eq(schema.clientVehiclePrices.term, t)));
        if (val) {
          const price = toHalalas(val);
          if (price <= 0) throw new Error(`Enter a price above zero for ${v.model}`);
          await tx.insert(schema.clientVehiclePrices).values({ clientId: id, vehicleId: v.id, term: t, price });
          changed++;
        }
      }
      await audit(tx, { actorId: u.id, action: "portal.pricing", entityType: "client", entityId: id, entityRef: c.name,
        summary: `Updated ${c.name}'s lease prices: ${markupBps === null ? "list prices" : `${markupBps / 100}% on cost`}, ${changed} agreed prices, ${hidden.length} cars hidden`, changes: { terms, markupBps } });
    });
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/clients/${id}`);
  return { ok: "Prices saved" };
}

export async function saveVehicle(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.credit");
  const id = str(fd, "id");
  if (!isUuid(id)) return { error: "Unknown vehicle" };
  try {
    const cost: Record<string, number> = {}, price: Record<string, number> = {};
    for (const t of LEASE_TERMS) {
      const c = str(fd, `cost_${t}`), p = str(fd, `price_${t}`);
      if (c) cost[t] = toHalalas(c);
      if (p) price[t] = toHalalas(p);
    }
    await db.transaction(async (tx) => {
      const [v] = await tx.select().from(schema.vehicles).where(eq(schema.vehicles.id, id));
      if (!v) throw new Error("Vehicle not found");
      const after = { cost, price, supplier: str(fd, "supplier").slice(0, 80) || null, onRequest: fd.get("onRequest") === "on", active: fd.get("active") === "on" };
      await tx.update(schema.vehicles).set(after).where(eq(schema.vehicles.id, id));
      await audit(tx, { actorId: u.id, action: "vehicle.updated", entityType: "vehicle", entityId: id, entityRef: `${v.make} ${v.model}`, summary: `Updated ${v.make} ${v.model} costs and list prices`, changes: { cost: { from: v.cost, to: cost }, price: { from: v.price, to: price } } });
    });
  } catch (e) { return toState(e); }
  done("/adminwork/corporate/catalog");
  return { ok: "Saved" };
}

/* ───────── Client logins ───────── */

const Login = z.object({
  clientId: z.string().uuid(),
  name: z.string().trim().min(2, "Enter a name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["admin", "approver", "requester", "viewer"]),
});

export async function addClientLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const p = Login.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const pw = tempPassword();
  try {
    const [dupe] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, p.data.email));
    if (dupe) throw new Error("Someone already uses that email");
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.key, "client_user"));
    if (!role) throw new Error("The client role is missing. Run the latest migration");
    const passwordHash = await bcrypt.hash(pw, 12);
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, p.data.clientId));
      if (!c) throw new Error("Client not found");
      const [m] = await tx.insert(schema.users).values({ name: p.data.name, email: p.data.email, passwordHash, roleId: role.id, team: "management", clientId: c.id, clientRole: p.data.role, mustChangePassword: true }).returning();
      await audit(tx, { actorId: u.id, action: "user.created", entityType: "user", entityId: m.id, entityRef: m.name, summary: `Gave ${m.name} (${c.name}) a workspace login as ${p.data.role}` });
    });
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/clients/${p.data.clientId}`);
  const [c] = await db.select({ slug: schema.clients.portalSlug }).from(schema.clients).where(eq(schema.clients.id, p.data.clientId));
  return { ok: `Login created. Send ${p.data.email} this link: ${workspaceLink(await siteOrigin(), c?.slug ?? null)} and the temporary password ${pw}. They choose their own on first sign-in.` };
}

export async function manageClientLogin(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const id = str(fd, "id");
  const op = str(fd, "op") === "role" || !str(fd, "op") ? str(fd, "role") : str(fd, "op");
  if (!isUuid(id)) return { error: "Unknown person" };
  const [m] = await db.select().from(schema.users).where(eq(schema.users.id, id));
  if (!m?.clientId) return { error: "That isn't a client login" };
  try {
    if (op === "reset") {
      const pw = tempPassword();
      const passwordHash = await bcrypt.hash(pw, 12);
      await db.transaction(async (tx) => {
        await tx.update(schema.users).set({ passwordHash, mustChangePassword: true }).where(eq(schema.users.id, id));
        await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
        await audit(tx, { actorId: u.id, action: "user.password_reset", entityType: "user", entityId: id, entityRef: m.name, summary: `Reset ${m.name}'s workspace password` });
      });
      done(`/adminwork/corporate/clients/${m.clientId}`);
      return { ok: `New temporary password for ${m.name}: ${pw}` };
    }
    if (op === "toggle") {
      await db.transaction(async (tx) => {
        await tx.update(schema.users).set({ active: !m.active }).where(eq(schema.users.id, id));
        if (m.active) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
        await audit(tx, { actorId: u.id, action: m.active ? "user.deactivated" : "user.activated", entityType: "user", entityId: id, entityRef: m.name, summary: `${m.active ? "Switched off" : "Switched on"} ${m.name}'s workspace login` });
      });
    } else if (["admin", "approver", "requester", "viewer"].includes(op)) {
      await db.transaction(async (tx) => {
        await tx.update(schema.users).set({ clientRole: op }).where(eq(schema.users.id, id));
        await audit(tx, { actorId: u.id, action: "user.updated", entityType: "user", entityId: id, entityRef: m.name, summary: `${m.name} is now ${op} in their workspace` });
      });
    } else return { error: "Unknown action" };
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/clients/${m.clientId}`);
  return { ok: "Saved" };
}

/* ───────── Moving a request along ───────── */

export async function advanceRequest(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const id = str(fd, "id"), op = str(fd, "op"), note = str(fd, "note").slice(0, 500);
  if (!isUuid(id)) return { error: "Unknown request" };
  let msg = "";
  try {
    msg = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.portalRequests).where(eq(schema.portalRequests.id, id)).for("update");
      if (!r) throw new Error("Request not found");
      const set = (patch: Partial<typeof schema.portalRequests.$inferInsert>) => tx.update(schema.portalRequests).set({ ...patch, updatedAt: new Date() }).where(eq(schema.portalRequests.id, id));
      const tell = (body: string) => postMessage(tx, { clientId: r.clientId, requestId: r.id, authorId: u.id, side: "system", kind: "status", body });
      const log = (action: string, summary: string) => audit(tx, { actorId: u.id, action, entityType: "portal_request", entityId: r.id, entityRef: r.ref, summary });
      if (op === "confirm") {
        if (r.status !== "submitted") throw new Error("Only new requests can be confirmed");
        const c = await refreshCosts(tx, r.lines as Line[], r.term);
        if (c.monthlyCost === null) throw new Error(`Add the supplier cost for ${c.missing.join(", ")} (${r.term} months) in the catalog first`);
        await set({ status: "confirmed", lines: c.lines, monthlyCost: c.monthlyCost, confirmedBy: u.id, confirmedAt: new Date() });
        await tell(`Order ${r.ref} confirmed. Delivery is usually 90–120 days. A deposit of two months (SAR ${sar(r.monthly * 2)}) is due with your PO.${note ? ` ${note}` : ""}`);
        await log("portal.confirmed", `Confirmed ${r.ref} · margin SAR ${sar(r.monthly - c.monthlyCost)} / month`);
        return `${r.ref} confirmed`;
      }
      if (op === "delivering") {
        if (r.status !== "confirmed") throw new Error("Confirm the order first");
        await set({ status: "delivering" });
        await tell(`Your cars for ${r.ref} are registered and on their way.${note ? ` ${note}` : ""}`);
        await log("portal.delivering", `${r.ref} out for delivery`);
        return `${r.ref} marked out for delivery`;
      }
      if (op === "delivered") {
        if (r.status !== "delivering") throw new Error("Mark it out for delivery first");
        await set({ status: "active", deliveredAt: new Date() });
        await tell(`Delivered and signed for. Your ${r.term}-month lease ${r.ref} has started.`);
        await log("portal.delivered", `${r.ref} delivered; lease started`);
        return `${r.ref} delivered. Bill month 1 when ready`;
      }
      if (op === "cancel") {
        if (["completed", "cancelled", "declined"].includes(r.status) || r.monthsBilled > 0) throw new Error("This request can't be cancelled now");
        if (!note) throw new Error("Say why, so the client knows");
        await set({ status: "cancelled", decisionNote: note });
        await tell(`Request ${r.ref} was cancelled: ${note}`);
        await log("portal.cancelled", `Cancelled ${r.ref}: ${note}`);
        return `${r.ref} cancelled`;
      }
      if (op === "bill") {
        const { booking, approvalRef } = await billNextMonth(tx, id, u.id);
        return approvalRef ? `${booking.ref} created. Credit request ${approvalRef} sent to directors` : `${booking.ref} created and ready to issue`;
      }
      throw new Error("Unknown action");
    });
  } catch (e) { return toState(e); }
  done(`/adminwork/corporate/requests/${id}`);
  await flash(msg);
  return null;
}

/* ───────── Talking to the client ───────── */

export async function replyToClient(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requirePerm("clients.manage");
  const clientId = str(fd, "clientId"), body = str(fd, "body").slice(0, 4000);
  if (!isUuid(clientId)) return { error: "Unknown client" };
  if (!body) return { error: "Write a message" };
  try {
    await db.transaction(async (tx) => {
      const [c] = await tx.select().from(schema.clients).where(eq(schema.clients.id, clientId));
      if (!c) throw new Error("Client not found");
      await postMessage(tx, { clientId, authorId: u.id, side: "mada", body });
      await audit(tx, { actorId: u.id, action: "portal.reply", entityType: "client", entityId: clientId, entityRef: c.name, summary: `Replied to ${c.name} in their workspace` });
    });
  } catch (e) { return toState(e); }
  done("/adminwork/corporate/inbox");
  return { ok: "Sent" };
}

export async function markHandled(fd: FormData) {
  await requirePerm("clients.manage");
  const clientId = str(fd, "clientId");
  if (!isUuid(clientId)) return;
  await db.update(schema.portalMessages).set({ handledAt: new Date() })
    .where(and(eq(schema.portalMessages.clientId, clientId), eq(schema.portalMessages.side, "client"), sql`${schema.portalMessages.handledAt} IS NULL`));
  done("/adminwork/corporate/inbox");
}
