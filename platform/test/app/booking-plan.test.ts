import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { BookReadyResponse, CreateOrderResponse, FlightSearchResponse, LivingPlanResponse, PaymentsResponse, StaySearchResponse, addDays, todayIn, type OrderDraft, type Plan } from "@mada/shared";
import { db } from "@/db";
import { appQuotes, appRequests, appStays } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appPlanItems } from "@/db/app-schema-plans";
import { confirmOrder } from "@/lib/app/booking/desk";
import { deriveStatus, planTotals, relinkOrders, type Bookings } from "@/lib/app/plans/plans";
import { esimOffer, priceItems, resolveItemIds } from "@/lib/app/plans/booking";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { listPeople } from "@/lib/app/people";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planGet } from "@/app/api/app/v1/trips/[id]/plan/route";
import { POST as itemsPost } from "@/app/api/app/v1/trips/[id]/plan/items/route";
import { GET as readyGet } from "@/app/api/app/v1/trips/[id]/plan/ready/route";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { POST as requestsPost } from "@/app/api/app/v1/requests/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { GET as paymentsGet } from "@/app/api/app/v1/trips/[id]/payments/route";
import { POST as refundPost } from "@/app/api/app/v1/trips/[id]/refunds/route";
import { callP, signIn } from "./wallet-helpers";

/*
 * Booking from the plan (ASK-INTEGRATED §7, U7) against the Core API on a real Postgres, mock suppliers only: items
 * priced by tool results, "Book what's ready" pricing each as its own order, the order's draft linking its items
 * (priced → booked → confirmed), a request for an item and the desk's quote on it, a demo fare on the plan's total,
 * a refund cancelling the item, and a price that ran out going back to an idea.
 */

const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}) => callP(h, params, { method: "GET", token });
const START = addDays(todayIn(), 60);

let A: Awaited<ReturnType<typeof signIn>>;
let tripId = "";
let cardId = "";
let me = "";
const readPlan = async (): Promise<Plan> => LivingPlanResponse.parse((await get(planGet, A.token, { id: tripId })).json).plan;

beforeAll(async () => {
  A = await signIn();
  const r = await post(createPost, A.token, { templateId: "istanbul3", origin: { name: "RUH", code: "RUH" }, start: START });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  tripId = r.json.plan.tripId;
  me = (await listPeople(A.user.id)).find((p) => p.isSelf)!.id;
  const c = await post(cardsPost, A.token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  expect(c.status, JSON.stringify(c.json)).toBe(201);
  cardId = (c.json.cards as { id: string }[])[0]!.id;
});

describe("pure: statuses and totals", () => {
  const NO: Bookings = { stays: [], segments: [], pickups: [], esims: [], orders: new Map(), requests: new Map(), offers: new Map() };
  const item = { status: "idea", statusNote: null, bookingKind: "order", bookingId: "00000000-0000-4000-8000-0000000000c1", requestId: null, offerId: "00000000-0000-4000-8000-0000000000f1" } as const;
  it("an order moves its item held → booked → confirmed → cancelled; a declined card leaves it priced", () => {
    const at = (status: string) => deriveStatus(item, { ...NO, orders: new Map([[item.bookingId, { status, ref: "MT1" }]]), offers: new Map([[item.offerId, { expiresAt: new Date(Date.now() + 60_000) }]]) }, null).status;
    expect(["payment_requested", "requires_action", "pending_agent", "confirmed", "cancelled", "refunded", "declined"].map(at)).toEqual(["held", "held", "booked", "confirmed", "cancelled", "cancelled", "priced"]);
  });
  it("a request reads when the team gets back, and its open quote as Quote ready", () => {
    const r = { ...item, bookingKind: null, bookingId: null, offerId: null, requestId: "00000000-0000-4000-8000-0000000000e1" };
    const by = new Date(Date.now() + 2 * 3600_000);
    expect(deriveStatus(r, { ...NO, requests: new Map([[r.requestId, { status: "sent", promisedBy: by }]]) }, null)).toMatchObject({ status: "requested", line: expect.stringMatching(/^With the team · back by \d\d:\d\d$/) });
    expect(deriveStatus(r, { ...NO, requests: new Map([[r.requestId, { status: "quoted", promisedBy: by, quote: { amount: 4200_00, expiresAt: null } }]]) }, null)).toMatchObject({ status: "requested", line: "Quote ready · SAR 4,200" });
  });
  it("totals add only tool, quote and booking prices, and carry the demo label", () => {
    const price = (amount: number, demo = false) => ({ amount, currency: "SAR" as const, asOf: "", expiresAt: null, demo });
    expect(planTotals([{ status: "idea", price: null, quote: null }])).toBeNull();
    expect(planTotals([
      { status: "priced", price: price(1000_00, true), quote: null }, { status: "booked", price: price(500_00), quote: null },
      { status: "requested", price: null, quote: { requestId: item.bookingId, amount: 300_00, currency: "SAR", expiresAt: null } },
    ])).toEqual({ priced: 1300_00, booked: 500_00, currency: "SAR", demo: true, ready: 2 });
  });
  it("a confirmed order's item moves onto the stay it wrote", () => {
    const stay = { id: "00000000-0000-4000-8000-0000000000d1" } as Bookings["stays"][number];
    const links = relinkOrders([{ id: "i1", kind: "stay", mode: null, bookingKind: "order", bookingId: item.bookingId, deletedAt: null }], { ...NO, stays: [stay], wrote: new Map([[item.bookingId, { stays: [stay.id], segments: [], esims: [] }]]) });
    expect(links.get("i1")).toEqual({ kind: "stay", id: stay.id });
  });
});

describe("booking from the plan", () => {
  let out = "", home = "", stay = "", esim = "", cruise = "";

  it("prices four items from tool results: two flights, a stay and an eSIM", async () => {
    const plan = await readPlan();
    out = plan.items.find((i) => i.kind === "leg" && i.mode === "flight" && i.from?.code === "RUH")!.id;
    home = plan.items.find((i) => i.kind === "leg" && i.mode === "flight" && i.to?.code === "RUH")!.id;
    stay = plan.items.find((i) => i.kind === "stay")!.id;
    cruise = plan.items.find((i) => i.title.startsWith("Bosphorus"))!.id;
    const added = await post(itemsPost, A.token, { version: plan.version, day: null, item: { kind: "note", title: "eSIM for Türkiye" } }, { id: tripId });
    expect(added.status, JSON.stringify(added.json)).toBeLessThan(300);
    esim = (await readPlan()).items.find((i) => i.title === "eSIM for Türkiye")!.id;

    const fl = FlightSearchResponse.parse((await post(searchFlights, A.token, { from: "RUH", destination: "istanbul", depart: START, return: null, travellerIds: [me], cabin: "economy" })).json);
    expect(fl.options[0]!.demo).toBe(true); // the mock catalogue: sample fares
    const st = StaySearchResponse.parse((await post(searchStays, A.token, { destination: "istanbul", checkIn: START, nights: 2, travellerIds: [me] })).json);
    await priceItems(A.user.id, [out], fl.options[0]!.id);
    await priceItems(A.user.id, [home], fl.options[1]!.id);
    await priceItems(A.user.id, [stay], st.options[0]!.id);
    await priceItems(A.user.id, [esim], await esimOffer(A.user.id, { packageId: "merhaba-7days-5gb", count: 1, where: "TR", tripId, travellerIds: [me], total: 79_00, demo: false }));

    const p = await readPlan();
    for (const id of [out, home, stay, esim]) expect(p.items.find((i) => i.id === id)).toMatchObject({ status: "priced", price: { currency: "SAR" } });
    // A demo fare is on the total, and the total is only what tools priced.
    expect(p.totals).toMatchObject({ demo: true, ready: 4, booked: 0 });
    expect(p.totals!.priced).toBe([out, home, stay, esim].reduce((a, id) => a + p.items.find((i) => i.id === id)!.price!.amount, 0));
  });

  it("Book what's ready lists each priced item as its own order, with lines, and a demo flag on the total", async () => {
    const r = BookReadyResponse.parse((await get(readyGet, A.token, { id: tripId })).json);
    expect(r.items.map((i) => i.itemId).sort()).toEqual([out, home, stay, esim].sort());
    expect(r.demo).toBe(true);
    expect(r.items.find((i) => i.itemId === out)).toMatchObject({ demo: true, draft: { kind: "trip", tripId, planItemIds: [out] } });
    expect(r.items.find((i) => i.itemId === stay)!.draft).toMatchObject({ kind: "stay", tripId, planItemIds: [stay] });
    expect(r.items.find((i) => i.itemId === esim)!.draft).toMatchObject({ kind: "esim", where: "TR", planItemIds: [esim] }); // the package id leaves sealed (supplier privacy)
    expect(r.total.amount).toBe(r.items.reduce((a, i) => a + i.total.amount, 0));
    for (const i of r.items) expect(i.lines.length).toBeGreaterThan(0);
    // Never a supplier's name or a net cost on the traveller's sheet.
    expect(JSON.stringify(r)).not.toMatch(/hotelbeds|esimaccess|airalo|tbo|supplier|net/i);
    // Someone else's trip: nothing.
    const B = await signIn();
    expect((await get(readyGet, B.token, { id: tripId })).status).toBe(404);
  });

  it("book 2 of 4: the two booked move on, the other two stay priced; confirmation follows the booking", async () => {
    const r = BookReadyResponse.parse((await get(readyGet, A.token, { id: tripId })).json);
    const orders: string[] = [];
    for (const id of [out, stay]) {
      const it = r.items.find((i) => i.itemId === id)!;
      const res = await post(ordersPost, A.token, { draft: it.draft as OrderDraft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: it.total.amount, idempotencyKey: `bp-${id}` });
      expect([200, 201], JSON.stringify(res.json)).toContain(res.status);
      const o = CreateOrderResponse.parse(res.json);
      expect(o.outcome).toBe("created");
      if (o.outcome === "created") orders.push(o.order.id);
    }
    let p = await readPlan();
    expect(p.items.find((i) => i.id === out)!.status).toBe("booked");
    expect(p.items.find((i) => i.id === stay)!.status).toBe("booked");
    expect(p.items.find((i) => i.id === home)!.status).toBe("priced");
    expect(p.items.find((i) => i.id === esim)!.status).toBe("priced");
    expect(p.totals).toMatchObject({ ready: 2 });
    // The orders are on the plan's trip.
    for (const id of orders) expect((await db.select({ tripId: appOrders.tripId }).from(appOrders).where(eq(appOrders.id, id)))[0]!.tripId).toBe(tripId);

    for (const id of orders) await confirmOrder(id, { name: "Noura" });
    p = await readPlan();
    const st = p.items.find((i) => i.id === stay)!;
    // Moved onto the hotel it wrote, by name; a room reads confirmed once the hotel's own reference is in (§3.2).
    expect(st).toMatchObject({ status: "booked", booking: { kind: "stay" } });
    expect(st.statusLine).toMatch(/^Booked · /);
    // The flight has its PNR: confirmed.
    expect(p.items.find((i) => i.id === out)).toMatchObject({ status: "confirmed", booking: { kind: "segment" } });
    // No second stay or flight appears for what the orders wrote.
    expect(p.items.filter((i) => i.kind === "stay" && i.source === "booking")).toHaveLength(0);
    expect(p.items.find((i) => i.id === home)!.status).toBe("priced");
  });

  it("a refund cancels the item", async () => {
    const pays = PaymentsResponse.parse((await get(paymentsGet, A.token, { id: tripId })).json).payments;
    const stayPay = pays.find((x) => x.item === "stay")!;
    const r = await post(refundPost, A.token, { paymentIds: [stayPay.id], reason: "plans", destination: "credit", clientKey: `rf-${Math.random().toString(36).slice(2)}` }, { id: tripId });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const [row] = await db.select({ status: appStays.status }).from(appStays).where(eq(appStays.tripId, tripId));
    expect(row!.status).toBe("cancelled");
    const item = (await readPlan()).items.find((i) => i.id === stay)!;
    expect(item).toMatchObject({ status: "cancelled" });
    expect(item.statusLine).toMatch(/^Cancelled · /);
  });

  it("a request for an item: With the team, back by the promise; the desk's quote makes it Quote ready, payable from the sheet", async () => {
    const res = await post(requestsPost, A.token, { kind: "todo", query: "Bosphorus dinner cruise for 1", travellerIds: [me], planItemId: cruise, contactPreference: "whatsapp" });
    expect(res.status, JSON.stringify(res.json)).toBe(201);
    const requestId = res.json.request.id as string;
    const [req] = await db.select({ planItemId: appRequests.planItemId, tripId: appRequests.tripId }).from(appRequests).where(eq(appRequests.id, requestId));
    expect(req).toEqual({ planItemId: cruise, tripId });
    let it = (await readPlan()).items.find((i) => i.id === cruise)!;
    expect(it.status).toBe("requested");
    expect(it.statusLine).toMatch(/^With the team · back by \d\d:\d\d$/);
    // The desk quotes it (as the desk's quote writes it).
    await db.insert(appQuotes).values({ requestId, total: 650_00, lines: [{ label: "Dinner cruise", amount: 650_00, kind: "service" }], expiresAt: new Date(Date.now() + 86_400_000), status: "open", offerSnapshot: { source: "desk", breakdown: [], text: "Dinner cruise, window table", lead: null, needLines: [] } });
    await db.update(appRequests).set({ status: "quoted" }).where(eq(appRequests.id, requestId));
    it = (await readPlan()).items.find((i) => i.id === cruise)!;
    expect(it).toMatchObject({ status: "requested", statusLine: "Quote ready · SAR 650", quote: { amount: 650_00 } });
    const ready = BookReadyResponse.parse((await get(readyGet, A.token, { id: tripId })).json);
    expect(ready.items.find((i) => i.itemId === cruise)).toMatchObject({ quote: true, draft: { kind: "quote", requestId, planItemIds: [cruise] } });
  });

  it("a price that ran out: the item is an idea again with Price again, and the sheet lists it apart", async () => {
    const [row] = await db.select({ offerId: appPlanItems.offerId }).from(appPlanItems).where(eq(appPlanItems.id, esim));
    const { appOffers } = await import("@/db/app-schema-booking");
    await db.update(appOffers).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appOffers.id, row!.offerId!));
    const it = (await readPlan()).items.find((i) => i.id === esim)!;
    expect(it).toMatchObject({ status: "idea", statusLine: "Price expired, check again", priceExpired: true });
    const ready = BookReadyResponse.parse((await get(readyGet, A.token, { id: tripId })).json);
    expect(ready.items.some((i) => i.itemId === esim)).toBe(false);
    expect(ready.expired.map((x) => x.itemId)).toContain(esim);
  });
});

describe("Ask's two tools for the plan", () => {
  it("create_request for a self-drive car on a plan item: request-only, the item with the team; short ids resolve", async () => {
    const plan = await readPlan();
    const people = await listPeople(A.user.id);
    const ctx: ToolCtx = { ownerId: A.user.id, people, today: todayIn(), lang: "en", ipHash: null, demo: new Set(), tripId };
    const target = plan.items.find((i) => i.kind === "activity" && i.status === "idea")!;
    expect(await resolveItemIds(A.user.id, tripId, [`[${target.id.slice(0, 8)}]`])).toEqual([target.id]);
    const r = await runTool("create_request", { kind: "car_rental", summary: "A car for the Istanbul days", traveller_ids: [me], destination_name: "Istanbul", depart: START, return: addDays(START, 2), contact_preference: "whatsapp", contact_window: null, item_id: target.id.slice(0, 8) }, ctx);
    expect(r.isError, r.text).toBeFalsy();
    const card = r.cards![0] as { type: string; requestId: string; title: string };
    expect(card).toMatchObject({ type: "request", title: "Car rental in Istanbul" });
    const [req] = await db.select().from(appRequests).where(eq(appRequests.id, card.requestId));
    expect(req).toMatchObject({ kind: "car_rental", planItemId: target.id, tripId });
    expect(req!.details).toMatchObject({ car: { pickup: "Istanbul", from: START } });
    expect((await readPlan()).items.find((i) => i.id === target.id)!.status).toBe("requested");
  });

  it("price_quote_for_pay with plan item ids prices the item and puts the ids and the trip on the draft", async () => {
    const plan = await readPlan();
    const people = await listPeople(A.user.id);
    const ctx: ToolCtx = { ownerId: A.user.id, people, today: todayIn(), lang: "en", ipHash: null, demo: new Set(), tripId };
    const fl = FlightSearchResponse.parse((await post(searchFlights, A.token, { from: "RUH", destination: "istanbul", depart: START, return: null, travellerIds: [me], cabin: "economy" })).json);
    const home = plan.items.find((i) => i.kind === "leg" && i.mode === "flight" && i.to?.code === "RUH")!;
    const r = await runTool("price_quote_for_pay", { kind: "flight", offer_id: fl.options[2]!.id, package_id: null, traveller_ids: [me], item_ids: `[${home.id.slice(0, 8)}]` }, ctx);
    expect(r.isError, r.text).toBeFalsy();
    expect(r.pay!.draft).toMatchObject({ kind: "trip", tripId, planItemIds: [home.id] });
    expect((await readPlan()).items.find((i) => i.id === home.id)).toMatchObject({ status: "priced", offerId: fl.options[2]!.id });
  });
});
