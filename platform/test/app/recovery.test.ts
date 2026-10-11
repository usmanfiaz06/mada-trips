import { describe, expect, it } from "vitest";
import { eq, sql as rawSql } from "drizzle-orm";
import { ApiErrorBody, RecoveryResponse } from "@mada/shared";
import { db, schema } from "@/db";
import { appSessions, appUsers } from "@/db/app-schema";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { mockSupabaseAdminLog, outbox } from "@/lib/app/suppliers";
import { createSession } from "@/lib/app/tokens";
import type { DeskActor } from "@/lib/app/desk/core";
import { approveRecovery, declineRecovery, listRecovery } from "@/lib/app/desk/recovery";
import { deskInbox } from "@/lib/app/desk/inbox";
import { POST as recovery } from "@/app/api/app/v1/auth/recovery/route";
import { call, freshIp, newPhone } from "./helpers";

/*
 * "I can't use this number or email any more": the signed-out request (same answer whether or not an account matched,
 * limits per network and per old contact, Idempotency-Key), then the desk moving the account or declining.
 */

let seq = 0;
async function agent(perms = ["desk.view", "desk.act"]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `recovery_test_${Date.now()}_${seq}`, name: `Recovery ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: "Noura", email: `rec${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: "Noura", permissions: new Set(perms) };
}
const email = () => `sara.${Date.now()}.${++seq}@example.com`;
const ask = (b: Record<string, unknown>, opts: { ip?: string; key?: string } = {}) => callWithKey(b, opts);
async function callWithKey(b: Record<string, unknown>, opts: { ip?: string; key?: string }) {
  if (!opts.key) return call(recovery, { body: { name: "Sara Alqahtani", ...b }, ip: opts.ip ?? freshIp() });
  const req = new Request("http://localhost/api/app/v1/auth/recovery", {
    method: "POST", headers: { "content-type": "application/json", "x-forwarded-for": opts.ip ?? freshIp(), "idempotency-key": opts.key }, body: JSON.stringify({ name: "Sara Alqahtani", ...b }),
  });
  const res = await recovery(req);
  return { status: res.status, headers: res.headers, json: JSON.parse(await res.text()) };
}
const rowsFor = (oldValue: string) => db.select().from(appRecoveryRequests).where(eq(appRecoveryRequests.oldValue, oldValue));

describe("POST /auth/recovery", () => {
  it("answers exactly the same whether or not an account uses the old contact", async () => {
    const phone = newPhone();
    const [u] = await db.insert(appUsers).values({ name: "Sara", phone, phoneVerified: true }).returning();
    const known = await ask({ oldContact: { kind: "phone", value: phone }, newContact: { kind: "email", value: email() } });
    const unknownPhone = newPhone();
    const unknown = await ask({ oldContact: { kind: "phone", value: unknownPhone }, newContact: { kind: "email", value: email() } });
    expect(known.status).toBe(200);
    expect(unknown.status).toBe(200);
    expect(known.json).toEqual(unknown.json);
    expect(RecoveryResponse.parse(known.json)).toEqual({ received: true });
    // The match is kept for the desk only.
    expect((await rowsFor(phone))[0]!.matchedUserId).toBe(u!.id);
    expect((await rowsFor(unknownPhone))[0]!.matchedUserId).toBeNull();
    const audit = await db.execute<{ summary: string }>(rawSql`SELECT summary FROM app_audit WHERE action = 'auth.recovery_requested' AND entity_id = ${(await rowsFor(phone))[0]!.id}`);
    expect(audit[0]!.summary).not.toContain(phone);
  });

  it("works signed out, accepts a loosely typed number, and refuses bad input", async () => {
    const phone = newPhone();
    const r = await ask({ oldContact: { kind: "phone", value: `0${phone.slice(4, 6)} ${phone.slice(6, 9)} ${phone.slice(9)}` }, newContact: { kind: "phone", value: newPhone() }, note: "My last trip was Istanbul" });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect(await rowsFor(phone)).toHaveLength(1);
    const same = await ask({ oldContact: { kind: "email", value: "a@example.com" }, newContact: { kind: "email", value: "A@Example.com" } });
    expect(same.status).toBe(400);
    expect(ApiErrorBody.parse(same.json).error.code).toBe("VALIDATION");
    const badPhone = await ask({ oldContact: { kind: "phone", value: "12345" }, newContact: { kind: "email", value: email() } });
    expect(badPhone.status).toBe(400);
    const noName = await call(recovery, { body: { name: " ", oldContact: { kind: "email", value: email() }, newContact: { kind: "email", value: email() } }, ip: freshIp() });
    expect(noName.status).toBe(400);
  });

  it("limits each old contact to 3 a day and each network to 5 an hour, the same for unknown contacts", async () => {
    const old = email();
    for (let i = 0; i < 3; i++) expect((await ask({ oldContact: { kind: "email", value: old }, newContact: { kind: "email", value: email() } })).status).toBe(200);
    const fourth = await ask({ oldContact: { kind: "email", value: old }, newContact: { kind: "email", value: email() } });
    expect(fourth.status).toBe(429);
    expect(ApiErrorBody.parse(fourth.json).error.code).toBe("RATE_LIMITED");
    expect(fourth.headers.get("retry-after")).toBe("86400");

    const ip = freshIp();
    for (let i = 0; i < 5; i++) expect((await ask({ oldContact: { kind: "email", value: email() }, newContact: { kind: "email", value: email() } }, { ip })).status).toBe(200);
    const sixth = await ask({ oldContact: { kind: "email", value: email() }, newContact: { kind: "email", value: email() } }, { ip });
    expect(sixth.status).toBe(429);
  });

  it("answers a retry with the same Idempotency-Key once, without a second request", async () => {
    const old = email();
    const key = `rec-${Date.now()}-abcdefgh`;
    const ip = freshIp();
    const b = { oldContact: { kind: "email", value: old }, newContact: { kind: "phone", value: newPhone() } };
    const a = await ask(b, { ip, key });
    const again = await ask(b, { ip, key });
    expect(a.status).toBe(200);
    expect(again.status).toBe(200);
    expect(await rowsFor(old)).toHaveLength(1);
  });
});

describe("the desk decides", () => {
  async function account(opts: { email?: string; supabase?: boolean } = {}) {
    const phone = newPhone();
    const [u] = await db.insert(appUsers).values({ name: "Sara Alqahtani", phone, phoneVerified: true, email: opts.email ?? null, emailVerified: !!opts.email, supabaseUserId: opts.supabase === false ? null : `sb-${Date.now()}-${++seq}`, authProviders: ["phone"] }).returning();
    await createSession(db, u!.id, { platform: "ios" } as never);
    return u!;
  }
  const requestFor = async (oldContact: { kind: string; value: string }, newContact: { kind: string; value: string }) => {
    expect((await ask({ oldContact, newContact })).status).toBe(200);
    return (await rowsFor(oldContact.value.toLowerCase()))[0]!;
  };

  it("shows open requests in the inbox and the recovery list with what's on file", async () => {
    const u = await account();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "phone", value: newPhone() });
    const list = await listRecovery("open");
    const item = list.find((x) => x.id === r.id)!;
    expect(item.account?.id).toBe(u.id);
    expect(item.oldMasked).toContain(u.phone!.slice(-4));
    const { items } = await deskInbox(new Date());
    expect(items.find((i) => i.kind === "recovery" && i.id === r.id)).toMatchObject({ note: "Move an account", userId: u.id });
  });

  it("approve, same kind: moves the number on our side and in Supabase, ends sessions, audits, tells the new number", async () => {
    const actor = await agent();
    const u = await account();
    const next = newPhone();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "phone", value: next });
    await expect(approveRecovery(actor, r.id, "no")).rejects.toThrow(/how you checked/);
    await approveRecovery(actor, r.id, "Passport number and the Istanbul booking match");
    const [after] = await db.select().from(appUsers).where(eq(appUsers.id, u.id));
    expect(after).toMatchObject({ phone: next, phoneVerified: true, supabaseUserId: u.supabaseUserId });
    expect(mockSupabaseAdminLog[0]).toMatchObject({ op: "setContact", userId: u.supabaseUserId, kind: "phone", value: next });
    const open = await db.select().from(appSessions).where(eq(appSessions.userId, u.id));
    expect(open.length).toBeGreaterThan(0);
    expect(open.every((s) => s.revokedAt && s.revokedReason === "account_recovery")).toBe(true);
    const [req] = await db.select().from(appRecoveryRequests).where(eq(appRecoveryRequests.id, r.id));
    expect(req).toMatchObject({ status: "approved", decidedBy: actor.id });
    const audit = await db.execute<{ action: string; actor_kind: string }>(rawSql`SELECT action, actor_kind FROM app_audit WHERE entity_id = ${u.id} AND action = 'desk.recovery.approved'`);
    expect(audit[0]).toMatchObject({ actor_kind: "agent" });
    const ops = await db.execute<{ action: string }>(rawSql`SELECT action FROM audit_events WHERE action = 'desk.recovery.approved' AND entity_id = ${u.id}`);
    expect(ops).toHaveLength(1);
    expect(outbox.find((o) => o.to === next && o.body.includes("your account is now on this number"))).toBeTruthy();
    await expect(approveRecovery(actor, r.id, "again, checked")).rejects.toThrow(/Already decided/);
  });

  it("approve, phone to email: a new Supabase user with only the email, the old number no longer opens the account", async () => {
    const actor = await agent();
    const u = await account();
    const next = email();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "email", value: next });
    await approveRecovery(actor, r.id, "Checked passport and last booking");
    const [after] = await db.select().from(appUsers).where(eq(appUsers.id, u.id));
    expect(after).toMatchObject({ email: next, emailVerified: true, phone: null, phoneVerified: false, authProviders: ["email"] });
    expect(after!.supabaseUserId).not.toBe(u.supabaseUserId);
    const ops = mockSupabaseAdminLog.slice(0, 2).map((c) => c.op);
    expect(ops).toEqual(["deleteUser", "createUser"]);
    expect(mockSupabaseAdminLog[0]).toMatchObject({ op: "deleteUser", userId: u.supabaseUserId });
    expect(outbox.find((o) => o.channel === "email" && o.to === next)).toBeTruthy();
  });

  it("refuses to move onto a contact another account already uses, and when nothing matched", async () => {
    const actor = await agent();
    const u = await account();
    const other = await account();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "phone", value: other.phone! });
    await expect(approveRecovery(actor, r.id, "Checked passport")).rejects.toThrow(/another account/);
    expect((await db.select().from(appUsers).where(eq(appUsers.id, u.id)))[0]!.phone).toBe(u.phone);

    const nobody = await requestFor({ kind: "email", value: email() }, { kind: "email", value: email() });
    await expect(approveRecovery(actor, nobody.id, "Checked passport")).rejects.toThrow(/No account/);
  });

  it("decline: nothing moves, the reason is kept, they hear it on the new contact", async () => {
    const actor = await agent();
    const u = await account();
    const next = newPhone();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "phone", value: next });
    await expect(declineRecovery(actor, r.id, "")).rejects.toThrow(/Say why/);
    await declineRecovery(actor, r.id, "Passport details didn't match");
    const [after] = await db.select().from(appUsers).where(eq(appUsers.id, u.id));
    expect(after!.phone).toBe(u.phone);
    const [req] = await db.select().from(appRecoveryRequests).where(eq(appRecoveryRequests.id, r.id));
    expect(req).toMatchObject({ status: "declined", decisionNote: "Passport details didn't match" });
    expect(outbox.find((o) => o.to === next && o.body.includes("stays as it was"))).toBeTruthy();
  });

  it("needs the desk action right", async () => {
    const viewer = await agent(["desk.view"]);
    const u = await account();
    const r = await requestFor({ kind: "phone", value: u.phone! }, { kind: "phone", value: newPhone() });
    await expect(approveRecovery(viewer, r.id, "Checked passport")).rejects.toThrow(/access/);
    await expect(declineRecovery(viewer, r.id, "No reason at all")).rejects.toThrow(/access/);
  });
});
