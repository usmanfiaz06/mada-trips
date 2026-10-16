import { describe, expect, it } from "vitest";
import { desc, eq } from "drizzle-orm";
import { db, schema } from "@/db";
import { appMessages, appNotifications, appRequests, appUsers } from "@/db/app-schema";
import { appDeskItems } from "@/db/app-schema-desk";
import { appOrders } from "@/db/app-schema-booking";
import { createSession } from "@/lib/app/tokens";
import type { DeskActor } from "@/lib/app/desk/core";
import { nudgeRequest, progressOfRequest, resultOfRequest, setOutcome, setPromise } from "@/lib/app/outcomes";
import { renderNotification } from "@/lib/app/notify-copy";
import { toRequestView } from "@/lib/app/trips/requests";
import { cancelOrder } from "@/lib/app/booking/desk";
import { orderView } from "@/lib/app/booking/orders";
import { POST as nudgePost } from "@/app/api/app/v1/requests/[id]/nudge/route";
import { call, type Handler } from "./helpers";

let seq = 0;
async function opsUser(name: string, perms = ["desk.view", "desk.act"]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `oc_test_${Date.now()}_${seq}`, name: `Desk ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `oc${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}
async function traveller(locale = "en") {
  const [u] = await db.insert(appUsers).values({ name: "Hessa Alotaibi", phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}`, locale }).returning();
  return u!;
}
async function request(ownerId: string, o: Partial<typeof appRequests.$inferInsert> = {}) {
  const [r] = await db.insert(appRequests).values({ ownerId, kind: "stay", status: "reviewing", summary: "Connecting rooms at Swissôtel Makkah", details: { withWhom: "hotel", withName: "Swissôtel Makkah" }, ...o }).returning();
  return r!;
}
const lastNotice = async (userId: string) => (await db.select().from(appNotifications).where(eq(appNotifications.userId, userId)).orderBy(desc(appNotifications.createdAt)).limit(1))[0]!;
const withP = (h: (req: Request, ctx: { params: Promise<{ id: string }> }) => Promise<Response>, id: string): Handler => (req) => h(req, { params: Promise.resolve({ id }) });

describe("request outcomes (critique 5)", () => {
  it("refused: reason, nothing charged and the next step, in the thread and the inbox, worded in the reader's language later", async () => {
    const me = await opsUser("Faisal Alharbi");
    const u = await traveller("en");
    const r = await request(u.id);
    const res = await setOutcome(me, { requestId: r.id, kind: "refused", reason: "sold_out", with: null, note: "The Hilton next door has two connecting rooms.", money: "none", amount: null, by: null, next: [] });
    expect(res).toMatchObject({ kind: "refused", reason: "sold_out", with: "Swissôtel Makkah", money: { kind: "none" }, next: ["other_dates", "talk"] });
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, r.id));
    expect(row!.status).toBe("cancelled");
    const view = toRequestView(row!);
    expect(view.result?.kind).toBe("refused");
    expect(view.outcome).toBe("no"); // older apps still read the refusal
    expect(view.alt).toMatch(/Swissôtel Makkah had nothing left/);
    expect(view.progress).toBeNull();
    const [msg] = await db.select().from(appMessages).where(eq(appMessages.threadId, r.id));
    expect(msg!.body).toMatch(/^Not this time\. Swissôtel Makkah had nothing left for those dates\. Nothing was charged\. The Hilton/);
    const n = await lastNotice(u.id);
    expect(n.href).toBe(`/ask/request/${r.id}`);
    expect(n.title).toBe("Mada couldn’t get this one");
    // The traveller switched to Arabic since: the reason is worded in Arabic when the inbox is read.
    expect(renderNotification(n, "ar").body).toMatch(/ما عندهم شي متاح/);
    await expect(setOutcome(me, { requestId: r.id, kind: "issued", reason: "done", with: null, note: null, money: "none", amount: null, by: null, next: [] })).rejects.toThrow(/already has its outcome/);
  });

  it("partial: says what was done, keeps the money for that part, and needs the agent's line", async () => {
    const me = await opsUser("Noura");
    const u = await traveller();
    const r = await request(u.id, { kind: "general", summary: "Wheelchair and a bassinet", details: { withWhom: "airline", withName: "Saudia" } });
    await expect(setOutcome(me, { requestId: r.id, kind: "partial", reason: "part", with: null, note: null, money: "kept", amount: 15000, by: null, next: [] })).rejects.toThrow(/Say in a line/);
    await expect(setOutcome(me, { requestId: r.id, kind: "partial", reason: "part", with: null, note: "x", money: "kept", amount: null, by: null, next: [] })).rejects.toThrow(/how much/);
    const res = await setOutcome(me, { requestId: r.id, kind: "partial", reason: "part", with: null, note: "Wheelchair confirmed. No bassinet seats left on SV263.", money: "kept", amount: 15000, by: null, next: ["talk"] });
    expect(res).toMatchObject({ kind: "partial", money: { kind: "kept", amount: { amount: 15000 } }, by: "Noura" });
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, r.id));
    expect(row!.status).toBe("confirmed");
    expect(resultOfRequest(row!)?.kind).toBe("partial");
  });

  it("a cancelled booking carries its outcome: the traveller's own cancel says so, nothing charged", async () => {
    const u = await traveller();
    const r = await request(u.id, { kind: "flight", status: "with_agent" });
    const [o] = await db.insert(appOrders).values({ ownerId: u.id, kind: "trip", status: "pending_agent", idempotencyKey: `oc-${r.id}`, draft: {}, snapshot: { place: "Istanbul" }, lines: [], subtotal: 100, total: 100, paymentLabel: "Visa 41", paymentMethod: {}, requestId: r.id }).returning();
    const after = await cancelOrder(o!.id, { kind: "user", name: "traveller" });
    expect(orderView(after).result).toMatchObject({ kind: "cancelled", reason: "you_asked", money: { kind: "none" }, next: ["book_again"] });
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, r.id));
    expect(row!.status).toBe("cancelled");
    expect(resultOfRequest(row!)?.reason).toBe("you_asked");
  });
});

describe("Mada is on it (critique 6)", () => {
  it("always says what, by when and the cost; the desk's promise replaces the usual time", async () => {
    const me = await opsUser("Faisal");
    const u = await traveller();
    const r = await request(u.id, { createdAt: new Date(Date.now() - 10 * 60_000) });
    const p0 = progressOfRequest(r)!;
    expect(p0).toMatchObject({ step: "asking_hotel", with: "Swissôtel Makkah", promised: false, cost: { kind: "later" } });
    const due = new Date(Date.now() + 90 * 60_000).toISOString();
    await setPromise(me, { requestId: r.id, step: "asking_hotel", with: "Swissôtel Makkah", dueAt: due, cost: "quoted", amount: 30000 });
    const [row] = await db.select().from(appRequests).where(eq(appRequests.id, r.id));
    expect(progressOfRequest(row!)).toMatchObject({ promised: true, dueAt: due, cost: { kind: "quoted", amount: { amount: 30000 } } });
    expect((await lastNotice(u.id)).body).toMatch(/Asking Swissôtel Makkah, answer by/);
  });

  it("past the time, the traveller can nudge once in 30 minutes: the desk sees it escalated and a line lands in the thread", async () => {
    const u = await traveller("ar");
    const r = await request(u.id, { createdAt: new Date(Date.now() - 3 * 3_600_000), promisedBy: new Date(Date.now() - 60 * 60_000) });
    const tokens = await createSession(db, u.id);
    const other = await createSession(db, (await traveller()).id);
    expect((await call(withP(nudgePost, r.id), { token: other.accessToken })).status).toBe(404);
    const res = await call(withP(nudgePost, r.id), { token: tokens.accessToken });
    expect(res.status).toBe(200);
    expect(res.json.progress.nudgedAt).toBeTruthy();
    const [item] = await db.select().from(appDeskItems).where(eq(appDeskItems.itemId, r.id));
    expect(item!.escalatedAt).toBeTruthy();
    const msgs = await db.select().from(appMessages).where(eq(appMessages.threadId, r.id));
    expect(msgs.map((m) => m.body)).toEqual(["فيه جديد؟"]);
    // Again straight away: nothing new is sent.
    await nudgeRequest(u.id, r.id, null);
    expect(await db.select().from(appMessages).where(eq(appMessages.threadId, r.id))).toHaveLength(1);
    // Not late yet: no nudge.
    const fresh = await request(u.id);
    await nudgeRequest(u.id, fresh.id, null);
    const [f] = await db.select().from(appRequests).where(eq(appRequests.id, fresh.id));
    expect((f!.details as { nudgedAt?: string }).nudgedAt).toBeUndefined();
  });
});
