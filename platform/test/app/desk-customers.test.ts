import { beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import { db, schema } from "@/db";
import { appCreditLedger, appPayments, appPeople, appRefunds, appRequests, appSegments, appTrips, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appEsims } from "@/db/app-schema-esim";
import { appAskMemory, appAskThreads } from "@/db/app-schema-ask";
import { encryptField, passportAad } from "@/lib/app/crypto";
import { decide } from "@/lib/approvals";
import type { DeskActor } from "@/lib/app/desk/core";
import { deskSections } from "@/lib/app/desk/nav";
import {
  askAccess, blockCustomer, customerAudit, customerBookings, customerChats, customerMemory, getCustomer, giveGoodwill, maskPassport, openItems,
  pageCustomers, phoneDigits, quickSearch, readAskThread, refHex, revealCustomerPassport, unblockCustomer,
} from "@/lib/app/desk/customers";

/* Customer 360 and search on the desk (DESK-PLAN U3). */

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `cust_test_${Date.now()}_${seq}`, name: `Cust ${seq}`, nameAr: "عملاء", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `cust${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}

const PHONE = `+96650${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}`;
const PNR = `Q${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const ICCID = `89972123${String(Math.floor(Math.random() * 1e11)).padStart(11, "0")}`;
let agent: DeskActor, refunder: DeskActor, lead: DeskActor, viewer: DeskActor;
let sara: typeof appUsers.$inferSelect, quiet: typeof appUsers.$inferSelect;
let saraSelf: string, request: string, handedThread: string, plainThread: string, quietThread: string;

beforeAll(async () => {
  agent = await opsUser("Support Agent", ["desk.view", "desk.act", "desk.ask.read"]);
  refunder = await opsUser("Senior Agent", ["desk.view", "desk.act", "desk.ask.read", "desk.refund", "desk.moderate"]);
  lead = await opsUser("Support Lead", ["desk.view", "desk.act", "desk.ask.read", "desk.refund", "desk.issue", "desk.moderate", "desk.admin"]);
  viewer = await opsUser("Viewer", ["desk.view"]);

  [sara] = await db.insert(appUsers).values({ name: "Sara Custtest", phone: PHONE, email: `sara.${Date.now()}@example.com`, locale: "ar" }).returning() as [typeof appUsers.$inferSelect];
  const [p] = await db.insert(appPeople).values({ ownerId: sara.id, isSelf: true, givenNames: "Sara", surname: "Custtest", relation: "self", nationality: "SAU" }).returning();
  saraSelf = p!.id;
  await db.update(appPeople).set({ passportNumberEnc: encryptField("A11493107", passportAad(p!.id)), passportNumberMasked: "A11•••07", passportExpiry: "2030-01-01" }).where(eq(appPeople.id, p!.id));
  const [trip] = await db.insert(appTrips).values({ ownerId: sara.id, city: "Istanbul", country: "TR", startDate: "2030-11-14", travellerIds: [p!.id], status: "booked", bookingRef: PNR }).returning();
  await db.insert(appSegments).values({ tripId: trip!.id, direction: "out", carrier: "SV", carrierName: "Saudia", flightNumber: "SV263", fromAirport: "RUH", toAirport: "IST",
    departLocal: "2030-11-14 09:40:00", departTz: "Asia/Riyadh", arriveLocal: "2030-11-14 13:55:00", arriveTz: "Europe/Istanbul", durationMin: 255, pnr: PNR });
  const [r] = await db.insert(appRequests).values({ ownerId: sara.id, kind: "flight", status: "confirmed", summary: "Riyadh to Istanbul", travellerIds: [p!.id], tripId: trip!.id, details: { desk: { pnr: PNR } } }).returning();
  request = r!.id;
  const [pay] = await db.insert(appPayments).values({ ownerId: sara.id, requestId: r!.id, method: "card", status: "captured", amount: 412000, provider: "mock", idempotencyKey: `cust:${r!.id}` }).returning();
  await db.insert(appRefunds).values({ paymentId: pay!.id, amount: 12000, stage: "sent" });
  const [o] = await db.insert(appOrders).values({ ownerId: sara.id, kind: "esim", status: "confirmed", idempotencyKey: `cust-esim:${ICCID}`, draft: {}, snapshot: {}, lines: [{ key: "e", icon: "sim", text: "Türkiye eSIM", amount: 7900 }],
    subtotal: 7900, total: 7900, paymentLabel: "Apple Pay", paymentMethod: {}, ref: `ES-${ICCID.slice(-6)}` }).returning();
  await db.insert(appEsims).values({ ownerId: sara.id, orderId: o!.id, idx: 0, supplier: "mock", packageId: "tr-15d", plan: { coverage: { name: "Türkiye", code: "TR" }, gb: 10, days: 15 }, status: "installed", iccid: ICCID });
  const [h] = await db.insert(appAskThreads).values({ ownerId: sara.id, turns: 2, messages: [{ role: "assistant", content: [{ type: "tool_use", name: "talk_to_human", input: {} }] }],
    transcript: [{ who: "me", text: "Seats together please" }, { who: "mada", text: "Handed to the desk" }] }).returning();
  handedThread = h!.id;
  const [n] = await db.insert(appAskThreads).values({ ownerId: sara.id, turns: 1, transcript: [{ who: "me", text: "What's the weather in Istanbul?" }, { who: "mada", text: "Mild, about 18°C." }] }).returning();
  plainThread = n!.id;
  await db.insert(appAskMemory).values({ ownerId: sara.id, kind: "seat", text: "Aisle seat" });

  [quiet] = await db.insert(appUsers).values({ name: "Quiet Custtest", phone: `+96655${String(Math.floor(Math.random() * 1e7)).padStart(7, "0")}` }).returning() as [typeof appUsers.$inferSelect];
  const [q] = await db.insert(appAskThreads).values({ ownerId: quiet.id, turns: 1, transcript: [{ who: "me", text: "hi" }] }).returning();
  quietThread = q!.id;
});

describe("what a search term is", () => {
  it("reads a phone however it is typed", () => {
    expect(phoneDigits("+966 50 000 4127")).toBe("500004127");
    expect(phoneDigits("0500004127")).toBe("500004127");
    expect(phoneDigits("00966500004127")).toBe("500004127");
    expect(phoneDigits("Sara")).toBeNull();
    expect(phoneDigits("12")).toBeNull();
  });
  it("reads a desk ref, or a bare id start with letters and digits", () => {
    expect(refHex("R-7B21C4")).toBe("7b21c4");
    expect(refHex("o-7b21c4")).toBe("7b21c4");
    expect(refHex("7b21c4")).toBe("7b21c4");
    expect(refHex("500004")).toBeNull();
    expect(refHex("JED4KT")).toBeNull();
  });
  it("masks a passport to its last three characters", () => {
    expect(maskPassport("A11493107")).toBe("••••••107");
    expect(maskPassport("P123")).toBe("•123");
    expect(maskPassport(null, "A11•••07")).toBe("A11•••07");
  });
});

describe("finding a customer", () => {
  it("by phone (any format), email, name, PNR, booking ref and ICCID", async () => {
    const local = `0${PHONE.slice(4)}`;
    for (const q of [PHONE, local, PHONE.slice(-7), sara.email!, "custtest", PNR, PNR.toLowerCase(), ICCID, ICCID.slice(-8), `O-${request.replace(/-/g, "").slice(0, 6)}`]) {
      const r = await pageCustomers({ q });
      expect(r.rows.map((x) => x.id), q).toContain(sara.id);
    }
  });
  it("shows lifetime value, bookings and filters by language", async () => {
    const r = await pageCustomers({ q: PHONE });
    const row = r.rows.find((x) => x.id === sara.id)!;
    expect(row.lifetime).toBe(412000 - 12000);
    expect(row.bookings).toBeGreaterThanOrEqual(2);
    expect((await pageCustomers({ q: PHONE, lang: "en" })).rows.some((x) => x.id === sara.id)).toBe(false);
    expect((await pageCustomers({ q: PHONE, lang: "ar" })).rows.some((x) => x.id === sara.id)).toBe(true);
  });
  it("⌘K finds the customer by phone, the booking by PNR and the eSIM by ICCID, quickly", async () => {
    for (const [q, kind, href] of [[PHONE.slice(-9), "customer", `/adminwork/desk/customers/${sara.id}`], [PNR, "order", `/adminwork/desk/orders/${request}`], [ICCID, "esim", "/adminwork/desk/esims/"]] as const) {
      const t0 = performance.now();
      const hits = await quickSearch(q);
      const ms = performance.now() - t0;
      expect(hits.some((h) => h.kind === kind && h.href.startsWith(href)), q).toBe(true);
      expect(ms, `${q} took ${ms}ms`).toBeLessThan(300);
    }
  });
  it("pages of 50 from SQL, with counts per filter", async () => {
    const all = await pageCustomers({ limit: 1 });
    expect(all.rows.length).toBe(1);
    expect(all.counts.all).toBeGreaterThanOrEqual(2);
    expect(all.total).toBe(all.counts.all);
  });
  it("Customers is live in the sidebar for desk users", () => {
    const sections = deskSections({ permissions: new Set(["desk.view"]) } as never, (s) => s, { queue: 0, chats: 0, orders: 0, requests: 0, refunds: 0, disruptions: 0, moderation: 0, recovery: 0, esims: 0 });
    expect(sections.flatMap((s) => s.items.map((i) => i.href))).toContain("/adminwork/desk/customers");
  });
});

describe("the profile", () => {
  it("has household with masked passports, bookings with the PNR, memory and stats", async () => {
    const c = (await getCustomer(sara.id))!;
    expect(c.household[0]!.passportMasked).toBe("••••••107");
    expect(c.stats.lifetime).toBe(400000);
    const b = await customerBookings(sara.id);
    expect(b.trips[0]!.bookingRef).toBe(PNR);
    expect(b.orders.some((o) => o.href === `/adminwork/desk/orders/${request}`)).toBe(true);
    expect((await customerMemory(sara.id)).map((m) => m.text)).toContain("Aisle seat");
  });
  it("reveals a full passport only with desk.issue, only for their own household, and logs it", async () => {
    await expect(revealCustomerPassport(agent, sara.id, saraSelf)).rejects.toThrow(/access/);
    await expect(revealCustomerPassport(lead, quiet.id, saraSelf)).rejects.toThrow(/household/);
    expect(await revealCustomerPassport(lead, sara.id, saraSelf)).toBe("A11493107");
    const [log] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'desk.passport.revealed' AND entity_id = ${saraSelf} AND actor_id = ${lead.id}`);
    expect(log!.n).toBe(1);
  });
});

describe("Ask transcripts on the desk (§7 default 5)", () => {
  it("the rule: leads read any, agents only handed-off ones or while something is open", () => {
    expect(askAccess(new Set(["desk.admin"]), { handedOff: false, customerHasOpen: false })).toBe("lead");
    expect(askAccess(new Set(["desk.ask.read"]), { handedOff: true, customerHasOpen: false })).toBe("handoff");
    expect(askAccess(new Set(["desk.ask.read"]), { handedOff: false, customerHasOpen: true })).toBe("open_item");
    expect(askAccess(new Set(["desk.ask.read"]), { handedOff: false, customerHasOpen: false })).toBeNull();
    expect(askAccess(new Set(["desk.view"]), { handedOff: true, customerHasOpen: true })).toBeNull();
  });
  it("an agent reads the handed-off thread, not the other one, and each read is audited", async () => {
    expect((await openItems(sara.id)).length).toBe(0);
    const t = await readAskThread(agent, sara.id, handedThread);
    expect(t.lines[0]!.text).toBe("Seats together please");
    await expect(readAskThread(agent, sara.id, plainThread)).rejects.toThrow(/handed over/);
    await expect(readAskThread(viewer, sara.id, handedThread)).rejects.toThrow(/handed over/);
    await expect(readAskThread(agent, quiet.id, handedThread)).rejects.toThrow(/Not found/);
    const chats = await customerChats(agent, sara.id, false);
    expect(chats.ask.find((a) => a.id === plainThread)!.access).toBeNull();
    expect(chats.ask.find((a) => a.id === handedThread)!.access).toBe("handoff");
    const [n] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'desk.ask.read' AND entity_id = ${sara.id} AND actor_id = ${agent.id}`);
    expect(n!.n).toBe(1);
  });
  it("an open item opens the customer's other threads to agents; a lead reads anyone's", async () => {
    const [r] = await db.insert(appRequests).values({ ownerId: sara.id, kind: "visa", status: "sent", summary: "Visa for Ahmed" }).returning();
    expect((await openItems(sara.id)).map((o) => o.id)).toContain(r!.id);
    expect((await readAskThread(agent, sara.id, plainThread)).why).toBe("open_item");
    expect((await readAskThread(lead, quiet.id, quietThread)).why).toBe("lead");
    await db.update(appRequests).set({ status: "done" }).where(eq(appRequests.id, r!.id));
  });
});

describe("goodwill credit and blocks from the profile", () => {
  it("desk.refund gives up to the limit at once, in both logs", async () => {
    const r = await giveGoodwill(refunder, sara.id, { amount: 15000, note: "Sorry for the wait" });
    expect(r).toMatchObject({ applied: true });
    const rows = await db.select().from(appCreditLedger).where(and(eq(appCreditLedger.userId, sara.id), eq(appCreditLedger.kind, "goodwill")));
    expect(rows.map((x) => x.amount)).toContain(15000);
    const [n] = await db.execute<{ n: number }>(rawSql`SELECT count(*)::int AS n FROM audit_events WHERE action = 'desk.credit.added' AND entity_id = ${sara.id} AND actor_id = ${refunder.id}`);
    expect(n!.n).toBe(1);
  });
  it("above the limit, or without desk.refund, it goes to Ops Approvals and lands when a lead approves", async () => {
    // The lead from beforeAll votes; nobody votes on their own request.
    const approver = lead;
    const over = await giveGoodwill(refunder, sara.id, { amount: 50000, note: "Missed connection in Istanbul" });
    expect(over).toMatchObject({ applied: false, reason: "over_limit" });
    const plain = await giveGoodwill(agent, sara.id, { amount: 5000, note: "Late reply" });
    expect(plain).toMatchObject({ applied: false, reason: "no_right" });
    const [req] = await db.select().from(schema.approvalRequests).where(eq(schema.approvalRequests.ref, (over as { approvalRef: string }).approvalRef));
    expect(req).toMatchObject({ kind: "goodwill", amount: 50000, approverPool: "permission:desk.admin" });
    const before = (await getCustomer(sara.id))!.stats.credit;
    await db.transaction((tx) => decide(tx, req!.id, approver.id, "approve", null));
    expect((await getCustomer(sara.id))!.stats.credit).toBe(before + 50000);
  });
  it("a lead gives any amount; nobody gives without desk.act", async () => {
    expect(await giveGoodwill(lead, quiet.id, { amount: 80000, note: "Big apology" })).toMatchObject({ applied: true });
    await expect(giveGoodwill(viewer, quiet.id, { amount: 100, note: "Nope nope" })).rejects.toThrow(/access/);
    await expect(giveGoodwill(refunder, quiet.id, { amount: 100, note: "x" })).rejects.toThrow(/why/);
  });
  it("blocks and unblocks, audited, and the history tab shows it", async () => {
    await expect(blockCustomer(agent, quiet.id, "Spam in tips")).rejects.toThrow(/access/);
    await blockCustomer(refunder, quiet.id, "Spam in tips");
    expect((await getCustomer(quiet.id))!.flags.blocked).toBe(true);
    expect((await pageCustomers({ f: "blocked" })).rows.map((r) => r.id)).toContain(quiet.id);
    await unblockCustomer(refunder, quiet.id);
    expect((await getCustomer(quiet.id))!.flags.blocked).toBe(false);
    const actions = (await customerAudit(quiet.id)).map((a) => a.action);
    expect(actions).toEqual(expect.arrayContaining(["desk.traveller.blocked", "desk.traveller.unblocked", "desk.credit.added"]));
  });
});
