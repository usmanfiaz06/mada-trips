"use server";
import { revalidatePath } from "next/cache";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { audit } from "@/lib/audit";
import { nextRef } from "@/lib/refs";
import { flash, str, toState, zodError, type ActionState } from "@/lib/actions";
import { agreedPrices, catalog, linesText, postMessage, priceFor, vehicleShort, type Delivery, type Line } from "@/lib/portal";
import { isUuid } from "@/lib/security";

const done = () => revalidatePath("/adminwork/portal", "layout");

async function myClient(clientId: string) {
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, clientId));
  if (!c || !c.portalEnabled) throw new Error("Your company's workspace is switched off. Contact Mada");
  return c;
}

const Plan = z.object({
  term: z.coerce.number().int(),
  lines: z.array(z.object({ vehicleId: z.string().uuid(), qty: z.coerce.number().int().min(1).max(200) })).min(1, "Add at least one car").max(20),
  delivery: z.object({
    place: z.enum(["office", "home", "site", "collect"]),
    address: z.string().trim().max(200).default(""),
    city: z.string().trim().max(60).default("Riyadh"),
    contact: z.string().trim().max(80).default(""),
    window: z.enum(["morning", "evening"]).default("morning"),
  }),
  note: z.string().trim().max(1000).optional(),
});

/** A plan from the showroom. Prices are worked out again here; nothing the browser sends about money is trusted. */
export async function submitPlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireClientUser();
  if (u.clientRole === "viewer") return { error: "Viewers can't send plans. Ask your admin" };
  let raw: unknown;
  try { raw = JSON.parse(str(fd, "plan")); } catch { return { error: "Something went wrong with the plan. Reload and try again" }; }
  const p = Plan.safeParse(raw);
  if (!p.success) return zodError(p.error);
  const v = p.data;
  if (v.delivery.place !== "collect" && v.delivery.address.length < 3) return { error: "Add the delivery address" };
  let ref = "";
  try {
    ref = await db.transaction(async (tx) => {
      const c = await myClient(u.clientId);
      if (c.portalServices && (c.portalServices as Record<string, string>).lease !== "price") throw new Error("Leasing isn't priced in your workspace yet. Ask Mada for a quote");
      if (!c.portalTerms.includes(v.term)) throw new Error("Choose one of the lease terms offered to you");
      const [cars, agreed] = await Promise.all([catalog(tx), agreedPrices(c.id, tx)]);
      const lines: Line[] = [];
      let monthly = 0;
      for (const l of v.lines) {
        const car = cars.find((x) => x.id === l.vehicleId);
        if (!car || c.portalHiddenVehicles.includes(car.key)) throw new Error("One of those cars isn't available to you");
        const price = priceFor(c, car, v.term, agreed);
        if (price === null) throw new Error(`${car.model} is priced on request. Ask Mada for a price first`);
        lines.push({ vehicleId: car.id, key: car.key, name: `${car.make} ${vehicleShort(car)}`, qty: l.qty, unitPrice: price, unitCost: null });
        monthly += price * l.qty;
      }
      // Approvers and admins can send straight to Mada; requesters need an approver when the company asks for it.
      const selfApproved = !c.portalNeedsApproval || u.clientRole === "admin" || u.clientRole === "approver";
      const status = selfApproved ? "submitted" : "awaiting_approval";
      const r = await nextRef(tx, "LR");
      const [row] = await tx.insert(schema.portalRequests).values({
        ref: r, clientId: c.id, status, lines, term: v.term, monthly, delivery: v.delivery satisfies Delivery, note: v.note || null,
        requestedBy: u.id, approvedBy: selfApproved ? u.id : null, approvedAt: selfApproved ? new Date() : null,
      }).returning();
      await audit(tx, { actorId: u.id, action: "portal.plan", entityType: "portal_request", entityId: row.id, entityRef: r, summary: `${u.name} (${c.name}) sent ${r}: ${linesText(lines)}, ${v.term} months` });
      if (selfApproved) await postMessage(tx, { clientId: c.id, requestId: row.id, authorId: u.id, side: "client", kind: "quote", body: `New plan ${r}: ${linesText(lines)} for ${v.term} months.${v.note ? ` ${v.note}` : ""}` });
      return status === "submitted" ? `${r} sent to Mada` : `${r} saved. It is waiting for your approver`;
    });
  } catch (e) { return toState(e); }
  done();
  return { ok: ref };
}

export async function decidePlan(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireClientUser();
  const id = str(fd, "id"), op = str(fd, "op"), note = str(fd, "note").slice(0, 500);
  if (!isUuid(id)) return { error: "Unknown request" };
  if (u.clientRole !== "admin" && u.clientRole !== "approver") return { error: "Only your approvers can decide plans" };
  let msg = "";
  try {
    msg = await db.transaction(async (tx) => {
      const [r] = await tx.select().from(schema.portalRequests).where(and(eq(schema.portalRequests.id, id), eq(schema.portalRequests.clientId, u.clientId))).for("update");
      if (!r) throw new Error("Request not found");
      if (r.status !== "awaiting_approval") throw new Error("This plan is already decided");
      if (r.requestedBy === u.id) throw new Error("Someone else must approve your own plan");
      const ok = op === "approve";
      if (!ok && !note) throw new Error("Say why, so the requester knows");
      await tx.update(schema.portalRequests).set({ status: ok ? "submitted" : "declined", approvedBy: u.id, approvedAt: new Date(), decisionNote: note || null, updatedAt: new Date() }).where(eq(schema.portalRequests.id, id));
      await audit(tx, { actorId: u.id, action: ok ? "portal.approved" : "portal.declined", entityType: "portal_request", entityId: id, entityRef: r.ref, summary: `${u.name} ${ok ? "approved" : "declined"} ${r.ref}${note ? `: ${note}` : ""}` });
      if (ok) await postMessage(tx, { clientId: u.clientId, requestId: id, authorId: u.id, side: "client", kind: "quote", body: `Plan ${r.ref} approved by ${u.name}: ${linesText(r.lines as Line[])} for ${r.term} months. Please go ahead.` });
      return ok ? `${r.ref} approved and sent to Mada` : `${r.ref} declined`;
    });
  } catch (e) { return toState(e); }
  done();
  // The approval card leaves the page once decided, so the confirmation is a toast.
  await flash(msg);
  return null;
}

const KINDS = { message: "", price: "Price request", call: "Call request", issue: "Issue" } as const;

export async function sendToMada(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireClientUser();
  const kind = (str(fd, "kind") || "message") as keyof typeof KINDS;
  if (!(kind in KINDS)) return { error: "Unknown request" };
  let body = str(fd, "body").slice(0, 3000);
  if (kind === "call") body = `Please call ${u.name} ${str(fd, "slot") || "as soon as possible"}.${body ? ` ${body}` : ""}`;
  if (kind === "issue") {
    const what = str(fd, "what") || "Issue", plate = str(fd, "plate").slice(0, 20);
    body = `${what}${plate ? ` on ${plate}` : ""}${str(fd, "where") ? ` at ${str(fd, "where").slice(0, 120)}` : ""}.${body ? ` ${body}` : ""}`;
  }
  if (!body) return { error: "Write a message" };
  try {
    await db.transaction(async (tx) => {
      const c = await myClient(u.clientId);
      await postMessage(tx, { clientId: c.id, authorId: u.id, side: "client", kind, body });
      await audit(tx, { actorId: u.id, action: "portal.message", entityType: "client", entityId: c.id, entityRef: c.name, summary: `${u.name} (${c.name}) sent ${KINDS[kind] || "a message"}` });
    });
  } catch (e) { return toState(e); }
  done();
  return { ok: kind === "issue" ? "Sent to the roadside team. They'll call you shortly" : kind === "call" ? "Call requested. Mada will call you" : "Sent to Mada" };
}

/* ───────── The client's own team (admins only) ───────── */

const Invite = z.object({
  name: z.string().trim().min(2, "Enter a name").max(80),
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  role: z.enum(["admin", "approver", "requester", "viewer"]),
});
const tempPassword = () => `Mada-${randomBytes(10).toString("hex").match(/.{4}/g)!.join("-")}`;

export async function inviteTeammate(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireClientUser();
  if (u.clientRole !== "admin") return { error: "Only your admins can add people" };
  const p = Invite.safeParse(Object.fromEntries(fd));
  if (!p.success) return zodError(p.error);
  const domain = u.email.split("@")[1];
  if (p.data.email.split("@")[1] !== domain) return { error: `Use a work email ending in @${domain}` };
  const pw = tempPassword();
  try {
    const [dupe] = await db.select({ id: schema.users.id }).from(schema.users).where(eq(sql`lower(${schema.users.email})`, p.data.email));
    if (dupe) throw new Error("Someone already uses that email");
    const [role] = await db.select().from(schema.roles).where(eq(schema.roles.key, "client_user"));
    const passwordHash = await bcrypt.hash(pw, 12);
    await db.transaction(async (tx) => {
      const c = await myClient(u.clientId);
      const [m] = await tx.insert(schema.users).values({ name: p.data.name, email: p.data.email, passwordHash, roleId: role.id, team: "management", clientId: c.id, clientRole: p.data.role, mustChangePassword: true }).returning();
      await audit(tx, { actorId: u.id, action: "user.created", entityType: "user", entityId: m.id, entityRef: m.name, summary: `${u.name} added ${m.name} to ${c.name}'s workspace as ${p.data.role}` });
    });
  } catch (e) { return toState(e); }
  done();
  return { ok: `Added. Temporary password: ${pw}. Share it privately; they choose their own on first sign-in.` };
}

export async function setTeammate(_: ActionState, fd: FormData): Promise<ActionState> {
  const u = await requireClientUser();
  if (u.clientRole !== "admin") return { error: "Only your admins can change people" };
  const id = str(fd, "id"), op = str(fd, "op");
  if (!isUuid(id) || id === u.id) return { error: "You can't change your own access" };
  const [m] = await db.select().from(schema.users).where(and(eq(schema.users.id, id), eq(schema.users.clientId, u.clientId)));
  if (!m) return { error: "Not found" };
  try {
    await db.transaction(async (tx) => {
      if (op === "toggle") {
        await tx.update(schema.users).set({ active: !m.active }).where(eq(schema.users.id, id));
        if (m.active) await tx.delete(schema.sessions).where(eq(schema.sessions.userId, id));
      } else if (["admin", "approver", "requester", "viewer"].includes(op)) {
        await tx.update(schema.users).set({ clientRole: op }).where(eq(schema.users.id, id));
      } else throw new Error("Unknown action");
      await audit(tx, { actorId: u.id, action: "user.updated", entityType: "user", entityId: id, entityRef: m.name, summary: `${u.name} changed ${m.name}'s workspace access (${op})` });
    });
  } catch (e) { return toState(e); }
  done();
  return { ok: "Saved" };
}
