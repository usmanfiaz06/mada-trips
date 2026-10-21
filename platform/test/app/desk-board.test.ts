import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { addDays, todayIn, type OrderDraft } from "@mada/shared";
import { db, schema } from "@/db";
import { appMessages, appPayments, appRequests, appTrips, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appDeskCanned } from "@/db/app-schema-desk";
import { appDropoffMarks, appSearchLog } from "@/db/app-schema-dropoffs";
import { appSupportThreads } from "@/db/app-schema-wallet";
import { riyadhDate } from "@/lib/dates";
import type { DeskActor } from "@/lib/app/desk/core";
import { BOARD_TABS, boardHref, boardStage, isStuck, pageBoard, productOf, type BoardTab, type StageInput } from "@/lib/app/desk/board";
import { canNudge, getDropoff, markDropoff, nudgeDropoff, pageDropoffs } from "@/lib/app/desk/dropoffs";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";

/* The desk's live board and drop-offs (DESK-PLAN.md U4): every order in exactly one lifecycle tab, the same rule in TS
   and SQL, and a declined payment with no later order on the Drop-offs list at once, with its recovery actions. */

const TODAY = riyadhDate();
const ORDER_STATUSES = ["payment_requested", "requires_action", "pending_agent", "held", "price_locked", "issuing", "needs_answer", "fare_changed", "ticketing_failed", "confirmed", "cancelled", "declined", "something_new"];
const REQUEST_STATUSES = ["queued", "sent", "reviewing", "needs_answer", "quoted", "awaiting_payment", "with_agent", "confirmed", "done", "cancelled"];
let seq = 0;

async function opsUser(perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `board_test_${Date.now()}_${seq}`, name: `Board ${seq}`, nameAr: "لوحة", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name: `Board Agent ${seq}`, email: `board${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name: u!.name, permissions: new Set(perms) };
}

describe("boardStage: one tab for every order", () => {
  const dates = { none: {}, future: { start: addDays(TODAY, 10), end: addDays(TODAY, 15) }, now: { start: addDays(TODAY, -1), end: addDays(TODAY, 2) }, past: { start: addDays(TODAY, -9), end: addDays(TODAY, -2) } };
  it("every combination of status, payment, eSIM, dates and disruption lands in exactly one known tab", () => {
    let n = 0;
    for (const source of ["order", "request"] as const)
      for (const status of source === "order" ? ORDER_STATUSES : REQUEST_STATUSES)
        for (const pay of [null, "authorized", "captured", "failed", "declined"])
          for (const esim of source === "order" ? [null, "ordering", "active", "used_up", "stuck"] : [null])
            for (const d of Object.values(dates))
              for (const disrupted of [false, true]) {
                const tabs = BOARD_TABS.filter((tab) => boardStage({ source, status, pay, esim, disrupted, ...d }, TODAY) === tab);
                expect(tabs, `${source} ${status} ${pay} ${esim} ${JSON.stringify(d)} ${disrupted}`).toHaveLength(1);
                n += 1;
              }
    expect(n).toBeGreaterThan(1000);
  });
  it("puts each state where the desk expects it", () => {
    const o = (status: string, x: Partial<StageInput> = {}) => boardStage({ source: "order", status, ...x }, TODAY);
    const r = (status: string, x: Partial<StageInput> = {}) => boardStage({ source: "request", status, ...x }, TODAY);
    expect(boardStage({ source: "search", status: "searching" }, TODAY)).toBe("searching");
    expect(o("requires_action")).toBe("held");
    expect(o("payment_requested")).toBe("held");
    expect(o("pending_agent")).toBe("paid");
    expect(o("needs_answer")).toBe("paid");
    expect(o("pending_agent", { disrupted: true })).toBe("problem");
    expect(o("ticketing_failed")).toBe("problem");
    expect(o("declined")).toBe("problem");
    expect(o("confirmed", { pay: "failed" })).toBe("problem");
    expect(o("confirmed", dates.future)).toBe("confirmed");
    expect(o("confirmed", dates.now)).toBe("travelling");
    expect(o("confirmed", dates.past)).toBe("done");
    expect(o("confirmed", { ...dates.future, disrupted: true })).toBe("problem");
    expect(o("confirmed", { ...dates.past, disrupted: true })).toBe("done");
    expect(o("confirmed", { esim: "active" })).toBe("travelling");
    expect(o("confirmed", { esim: "ready" })).toBe("confirmed");
    expect(o("confirmed", { esim: "used_up" })).toBe("done");
    expect(o("confirmed", { esim: "stuck" })).toBe("problem");
    expect(o("cancelled")).toBe("done");
    expect(o("something_new")).toBe("problem");
    expect(r("sent")).toBe("searching");
    expect(r("quoted")).toBe("held");
    expect(r("with_agent")).toBe("paid");
    expect(r("done")).toBe("done");
    expect(r("done", dates.future)).toBe("confirmed");
    expect(r("confirmed", dates.now)).toBe("travelling");
    expect(r("cancelled")).toBe("done");
  });
  it("names products and calls an item stuck only past its tab's limit", () => {
    expect(productOf("order", "trip")).toBe("flight");
    expect(productOf("order", "quote", "umrah")).toBe("umrah");
    expect(productOf("order", "esim")).toBe("esim");
    expect(productOf("request", "car")).toBe("transfer");
    expect(productOf("request", "general")).toBe("request");
    const now = new Date();
    expect(isStuck("paid", new Date(now.getTime() - 31 * 60_000), now)).toBe(true);
    expect(isStuck("paid", new Date(now.getTime() - 5 * 60_000), now)).toBe(false);
    expect(isStuck("confirmed", new Date(0), now)).toBe(false);
  });
});

describe("the live board in SQL", () => {
  type Seeded = { key: string; input: StageInput };
  const seeded: Seeded[] = [];
  let userId = "";
  const name = `Board Tester ${Date.now().toString(36)}`;

  beforeAll(async () => {
    const [u] = await db.insert(appUsers).values({ name, phone: `+9665${String(Math.floor(Math.random() * 1e8)).padStart(8, "0")}` }).returning();
    userId = u!.id;
    const trip = async (start: string, end: string) => (await db.insert(appTrips).values({ ownerId: userId, city: "Istanbul", startDate: start, endDate: end }).returning())[0]!.id;
    const future = await trip(addDays(TODAY, 10), addDays(TODAY, 14));
    const now = await trip(addDays(TODAY, -1), addDays(TODAY, 3));
    const past = await trip(addDays(TODAY, -10), addDays(TODAY, -3));
    const base = (status: string, i: number, more: Partial<typeof appOrders.$inferInsert> = {}) => ({
      ownerId: userId, kind: "trip", status, idempotencyKey: `board-${i}-${Math.random()}`, draft: {}, snapshot: { title: `Istanbul ${status} ${i}` }, lines: [],
      subtotal: 100_000, total: 100_000, paymentLabel: "Visa ending 41", paymentMethod: { method: "card" }, ...more,
    });
    let i = 0;
    for (const status of ORDER_STATUSES) {
      const [o] = await db.insert(appOrders).values(base(status, i++)).returning();
      seeded.push({ key: `order:${o!.id}`, input: { source: "order", status } });
    }
    for (const [label, tripId, d] of [["future", future, [addDays(TODAY, 10), addDays(TODAY, 14)]], ["now", now, [addDays(TODAY, -1), addDays(TODAY, 3)]], ["past", past, [addDays(TODAY, -10), addDays(TODAY, -3)]]] as const) {
      const [o] = await db.insert(appOrders).values(base("confirmed", i++, { tripId, snapshot: { title: `Confirmed ${label}` } })).returning();
      seeded.push({ key: `order:${o!.id}`, input: { source: "order", status: "confirmed", start: d[0], end: d[1] } });
    }
    // A stay booked by dates in its search (no trip yet), an eSIM in use, a capture that failed.
    const [stay] = await db.insert(appOrders).values(base("confirmed", i++, { kind: "stay", snapshot: { title: "Stay", search: { checkIn: addDays(TODAY, 3), nights: 4 } } })).returning();
    seeded.push({ key: `order:${stay!.id}`, input: { source: "order", status: "confirmed", start: addDays(TODAY, 3), end: addDays(TODAY, 7) } });
    const [esim] = await db.insert(appOrders).values(base("confirmed", i++, { kind: "esim" })).returning();
    await db.insert(appEsims).values({ ownerId: userId, orderId: esim!.id, idx: 0, supplier: "esimaccess", packageId: "TR-5", plan: {}, status: "active" });
    seeded.push({ key: `order:${esim!.id}`, input: { source: "order", status: "confirmed", esim: "active" } });
    const [pay] = await db.insert(appPayments).values({ ownerId: userId, method: "card", status: "failed", amount: 100_000, provider: "mock", idempotencyKey: `board-pay-${Math.random()}` }).returning();
    const [failed] = await db.insert(appOrders).values(base("confirmed", i++, { paymentId: pay!.id })).returning();
    seeded.push({ key: `order:${failed!.id}`, input: { source: "order", status: "confirmed", pay: "failed" } });
    // Requests with no order behind them: Umrah, visas, cars…
    for (const status of REQUEST_STATUSES) {
      const [r] = await db.insert(appRequests).values({ ownerId: userId, kind: "umrah", status, summary: `Umrah ${status}` }).returning();
      seeded.push({ key: `request:${r!.id}`, input: { source: "request", status } });
    }
    // A search with no order after it.
    const [l] = await db.insert(appSearchLog).values({ userId, kind: "flight", summary: "RUH → Istanbul · 14 Nov – 18 Nov · 2 travellers · economy", value: 120_000, results: 8 }).returning();
    seeded.push({ key: `search:${l!.id}`, input: { source: "search", status: "searching" } });
  });

  it("every order appears in exactly one tab, the one boardStage() names, and the counts add up", async () => {
    const where = new Map<string, BoardTab[]>();
    let total = 0;
    let counts: Record<string, number> = {};
    for (const tab of BOARD_TABS) {
      const page = await pageBoard({ tab, q: name, limit: 200 });
      counts = page.counts;
      total += page.total;
      for (const r of page.rows) where.set(`${r.source}:${r.id}`, [...(where.get(`${r.source}:${r.id}`) ?? []), tab]);
    }
    for (const s of seeded) expect(where.get(s.key), `${s.key} ${JSON.stringify(s.input)}`).toEqual([boardStage(s.input, TODAY)]);
    expect(total).toBe(seeded.length);
    expect(Object.values(counts).reduce((a, b) => a + b, 0)).toBe(seeded.length);
  });

  it("filters by product and supplier, flags stuck items, and links each row to its page", async () => {
    const umrah = await pageBoard({ tab: "held", q: name, product: "umrah" });
    expect(umrah.rows.map((r) => r.summary).sort()).toEqual(["Umrah awaiting_payment", "Umrah quoted"]);
    const esim = await pageBoard({ tab: "travelling", q: name, supplier: "esimaccess" });
    expect(esim.rows).toHaveLength(1);
    expect(boardHref(esim.rows[0]!)).toMatch(/^\/adminwork\/desk\/esims\//);
    const id = seeded.find((s) => s.input.status === "pending_agent")!.key.split(":")[1]!;
    await db.update(appOrders).set({ updatedAt: new Date(Date.now() - 45 * 60_000) }).where(eq(appOrders.id, id));
    const paid = await pageBoard({ tab: "paid", q: name, stuck: true });
    expect(paid.rows.map((r) => r.id)).toEqual([id]);
    expect(paid.stuck).toBe(1);
    const search = (await pageBoard({ tab: "searching", q: name })).rows.find((r) => r.source === "search")!;
    expect(boardHref(search)).toBe(`/adminwork/desk/customers/${userId}`);
  });
});

describe("drop-offs", () => {
  let lead: DeskActor, viewer: DeskActor;
  let cannedId = "";
  beforeAll(async () => {
    lead = await opsUser(["desk.view", "desk.act"]);
    viewer = await opsUser(["desk.view"]);
    const [c] = await db.insert(appDeskCanned).values({ title: "Still thinking?", bodyEn: "Your fare is still there if you want it. Anything I can help with?", bodyAr: "سعرك ما زال متاحًا إن أردته. هل أساعدك بشيء؟" }).returning();
    cannedId = c!.id;
  });

  const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, query = "") => callP(h, {}, { method: "POST", token, body, query });

  it("logs searches and pay sheets, and a declined card with no later order shows at once; booking takes it off", async () => {
    const me = await signIn();
    const self = ((await callP(peopleGet, {}, { token: me.token })).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
    const card = await post(cardsPost, me.token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
    const cardId = (card.json.cards as { id: string }[])[0]!.id;
    const depart = addDays(todayIn(), 40);
    const s = await post(searchFlights, me.token, { from: "RUH", destination: "istanbul", depart, return: addDays(depart, 5), travellerIds: [self], cabin: "economy" });
    expect(s.status, JSON.stringify(s.json)).toBe(200);
    // The same search again moves the line on instead of adding one.
    await post(searchFlights, me.token, { from: "RUH", destination: "istanbul", depart, return: addDays(depart, 5), travellerIds: [self], cabin: "economy" });
    const logged = await db.select().from(appSearchLog).where(eq(appSearchLog.userId, me.user.id));
    expect(logged).toHaveLength(1);
    expect(logged[0]!.summary).toMatch(/^RUH → Istanbul · .* · 1 traveller · economy$/);
    expect(logged[0]!.value).toBe(Math.min(...(s.json.options as { total: { amount: number } }[]).map((o) => o.total.amount)));

    // Left at the results for half an hour: a search drop-off.
    await db.update(appSearchLog).set({ at: new Date(Date.now() - 31 * 60_000) }).where(eq(appSearchLog.userId, me.user.id));
    expect((await pageDropoffs({ tab: "search", q: me.phone })).rows.map((r) => r.userId)).toEqual([me.user.id]);

    const draft: OrderDraft = { kind: "trip", flightOfferId: s.json.options[0].id, bundle: false, travellerIds: [self] };
    const p = await post(previewPost, me.token, { draft, useCredit: false });
    expect(p.status).toBe(200);
    const sheet = await db.select().from(appSearchLog).where(and(eq(appSearchLog.userId, me.user.id), eq(appSearchLog.kind, "pay_sheet")));
    expect(sheet).toHaveLength(1);
    const declined = await post(ordersPost, me.token, { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: p.json.preview.total.amount, idempotencyKey: `k-${Math.random()}` }, "?demo=decline");
    expect(declined.json.outcome).toBe("declined");

    // At once (no waiting): the payment drop-off, with what they were buying. The search and pay sheet before it are not listed again.
    const list = await pageDropoffs({ q: me.phone });
    expect(list.rows).toHaveLength(1);
    const row = list.rows[0]!;
    expect(row).toMatchObject({ kind: "payment", step: "declined", userId: me.user.id, what: p.json.preview.title, value: p.json.preview.total.amount, attempts: 1 });
    expect(canNudge(row)).toBe(true);
    expect(list.counts.payment).toBeGreaterThanOrEqual(1);

    // They come back and book: the drop-off goes by itself.
    const ok = await post(ordersPost, me.token, { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: p.json.preview.total.amount, idempotencyKey: `k-${Math.random()}` });
    expect(ok.json.outcome, JSON.stringify(ok.json)).toBe("created");
    expect((await pageDropoffs({ q: me.phone })).rows).toHaveLength(0);
    expect(await getDropoff(row.key)).toBeNull();
  });

  it("nudges once in the app within 48 hours, and marks recovered with both audit trails", async () => {
    const me = await signIn();
    const [pay] = await db.insert(appPayments).values({ ownerId: me.user.id, method: "card", status: "declined", amount: 250_000, label: "Visa ending 41", provider: "mock", idempotencyKey: `dk-${Math.random()}` }).returning();
    const key = `pay:${pay!.id}`;
    await expect(nudgeDropoff(viewer, key, cannedId)).rejects.toThrow(/access/);
    const { threadId } = await nudgeDropoff(lead, key, cannedId);
    const [th] = await db.select().from(appSupportThreads).where(eq(appSupportThreads.id, threadId));
    expect(th!.userId).toBe(me.user.id);
    const msgs = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "support"), eq(appMessages.threadId, threadId)));
    expect(msgs.map((m) => m.body)).toContain("Your fare is still there if you want it. Anything I can help with?");
    await expect(nudgeDropoff(lead, key, cannedId)).rejects.toThrow("Already nudged");
    expect((await getDropoff(key))!.nudgedAt).not.toBeNull();

    await expect(markDropoff(viewer, key, { status: "recovered" })).rejects.toThrow(/access/);
    await markDropoff(lead, key, { status: "recovered", note: "Booked by phone" });
    const d = (await getDropoff(key))!;
    expect(d).toMatchObject({ mark: "recovered", markNote: "Booked by phone", markBy: lead.name });
    expect((await pageDropoffs({ tab: "closed", q: me.phone })).rows.map((r) => r.key)).toEqual([key]);
    expect((await pageDropoffs({ q: me.phone })).rows).toHaveLength(0);
    await expect(markDropoff(lead, key, { status: "ignored" })).rejects.toThrow("Already marked recovered");
    const app = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE entity_id = ${me.user.id} AND action LIKE 'desk.dropoff.%' ORDER BY created_at`);
    expect(app.map((a) => a.action)).toEqual(["desk.dropoff.nudged", "desk.dropoff.recovered"]);
    const ops = await db.execute<{ action: string; entity_ref: string }>(rawSql`SELECT action, entity_ref FROM audit_events WHERE entity_type = 'desk' AND entity_id = ${me.user.id} AND action = 'desk.dropoff.recovered'`);
    expect(ops).toHaveLength(1);
    expect((await db.select().from(appDropoffMarks).where(eq(appDropoffMarks.key, key))).map((m) => m.status).sort()).toEqual(["nudged", "recovered"]);
  });

  it("refuses a nudge after 48 hours, and lists a friend's share and a quote held and not paid", async () => {
    const me = await signIn();
    const [old] = await db.insert(appPayments).values({ ownerId: me.user.id, method: "card", status: "declined", amount: 90_000, provider: "mock", idempotencyKey: `dk-${Math.random()}`,
      createdAt: new Date(Date.now() - 50 * 3_600_000), updatedAt: new Date(Date.now() - 50 * 3_600_000) }).returning();
    await expect(nudgeDropoff(lead, `pay:${old!.id}`, cannedId)).rejects.toThrow("Nudges go within 48 hours of the drop-off");
    const [o] = await db.insert(appOrders).values({ ownerId: me.user.id, kind: "trip", status: "payment_requested", idempotencyKey: `h-${Math.random()}`, draft: {}, snapshot: { title: "Dubai for four" }, lines: [],
      subtotal: 400_000, total: 400_000, paymentLabel: "A friend pays", paymentMethod: { method: "someone_else" }, createdAt: new Date(Date.now() - 2 * 3_600_000) }).returning();
    const [r] = await db.insert(appRequests).values({ ownerId: me.user.id, kind: "umrah", status: "quoted", summary: "Umrah in Ramadan", updatedAt: new Date(Date.now() - 3 * 3_600_000) }).returning();
    await db.execute(rawSql`INSERT INTO app_quotes (request_id, total, status) VALUES (${r!.id}, 780000, 'open')`);
    const held = await pageDropoffs({ tab: "held", q: me.phone });
    expect(held.rows.map((x) => [x.key, x.step, x.value]).sort()).toEqual([[`order:${o!.id}`, "friend_to_pay", 400_000], [`quote:${r!.id}`, "quote_sent", 780_000]].sort());
    expect(held.value).toBe(1_180_000);
  });
});
