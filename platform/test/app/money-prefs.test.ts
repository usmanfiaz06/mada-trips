import { describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { CreateOrderResponse, FlightSearchResponse, OrderResponse, PreviewResponse, TripMoneyResponse, type OrderDraft } from "@mada/shared";
import { db } from "@/db";
import { appMessages, appPayments, appRequests } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appCircleSplitShares } from "@/db/app-schema-circles";
import { advance, ownOrder } from "@/lib/app/booking/orders";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as orderGet } from "@/app/api/app/v1/orders/[id]/route";
import { POST as orderAnswer } from "@/app/api/app/v1/orders/[id]/answer/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { PATCH as accountPatch } from "@/app/api/app/v1/account/route";
import { POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as inviteAccept } from "@/app/api/app/v1/invites/[ref]/accept/route";
import { GET as moneyGet } from "@/app/api/app/v1/trips/[id]/money/route";
import { GET as statementGet } from "@/app/api/app/v1/trips/[id]/money/statement/route";
import { callP, signIn } from "./wallet-helpers";
import { person } from "./circles-helpers";

/* Owner audit items 4–7 and 31 on the platform: preferences and loyalty applied to an order (and what the desk gets),
   a paid extra that is only ever added by hand, a friend in a circle paying for a booking, and the trip's Money view. */

const EID_OUT = "2027-03-09";
const EID_BACK = "2027-03-15";
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}) => callP(h, params, { method: "GET", token });

async function familyOf(token: string) {
  const add = async (givenNames: string, relation: string, dob: string, number: string) =>
    (await post(peoplePost, token, { givenNames, surname: "Alharbi", relation, dateOfBirth: dob, passport: { number, nationality: "SAU", expiry: "2029-01-15", issuingCountry: "SAU", source: "scan" } })).json.person.id as string;
  const hessa = await add("Hessa", "spouse", "1988-07-24", "A11493107");
  const sara = await add("Sara", "child", "2013-05-12", "A23111196");
  const people = (await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[];
  const me = people.find((p) => p.isSelf)!.id;
  return { me, hessa, sara };
}

async function istanbul(token: string, travellerIds: string[]) {
  const r = await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: EID_OUT, return: EID_BACK, travellerIds, cabin: "economy" });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return FlightSearchResponse.parse(r.json);
}

async function preview(token: string, body: Record<string, unknown>) {
  const r = await post(previewPost, token, { useCredit: true, ...body });
  expect(r.status, JSON.stringify(r.json)).toBe(200);
  return PreviewResponse.parse(r.json).preview;
}

async function addCard(token: string) {
  const r = await post(cardsPost, token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  expect(r.status).toBe(201);
  return (r.json.cards as { id: string }[])[0]!.id;
}

async function runDesk(orderId: string, seconds = 30) {
  const owner = (await db.select({ o: appOrders.ownerId }).from(appOrders).where(eq(appOrders.id, orderId)))[0]!.o;
  let o = await ownOrder(owner, orderId);
  for (let s = 2; s <= seconds; s += 2) o = await advance(o, new Date(Date.now() + s * 1000));
  return o;
}

describe("preferences and loyalty applied at booking", () => {
  it("copies the saved preferences onto the order sheet, attaches the matching loyalty number, and tells the desk and the supplier", async () => {
    const { token } = await signIn();
    const f = await familyOf(token);
    const saved = { seat: "window", together: true, meal: "veg", assist: ["wchr"], loyalty: [{ id: "l1", program: "alfursan", number: "48213377" }, { id: "l2", program: "skywards", number: "EK123456789" }], notes: "", room: "twin", bed: "any", floor: "high", quiet: true };
    expect((await callP(accountPatch, {}, { method: "PATCH", token, body: { prefs: saved } })).status).toBe(200);
    const s = await istanbul(token, [f.me, f.hessa, f.sara]);
    const sv = s.options.find((o) => o.carrier === "SV")!;
    const draft: OrderDraft = { kind: "trip", flightOfferId: sv.id, bundle: false, travellerIds: [f.me, f.hessa, f.sara] };
    const p = await preview(token, { draft });
    expect(p.applied?.scope).toBe("flight");
    expect(p.applied?.summary).toEqual(["Window", "Seats together", "Vegetarian", "Wheelchair to the gate"]);
    expect(p.applied?.loyalty).toEqual([{ personId: f.me, program: "alfursan", number: "48213377", programName: "Saudia Alfursan", masked: "••••3377" }]);
    expect(p.applied?.programmes).toEqual(["alfursan"]);
    expect(p.applied?.extrasOffer).toBeNull(); // Saudia does not charge for seats
    expect(p.lines.map((l) => l.key)).toEqual(["flight"]);

    // Changed for this booking only: an aisle seat, no loyalty for me but Hessa's number instead. The account is untouched.
    const mine = await preview(token, { draft, prefs: { ...p.applied!.prefs, seat: "aisle" }, loyalty: [{ personId: f.hessa, program: "alfursan", number: "9988776655" }] });
    expect(mine.applied?.summary[0]).toBe("Aisle");
    expect(mine.applied?.loyalty.map((l) => [l.personId, l.masked])).toEqual([[f.hessa, "••••6655"]]);
    const bad = await post(previewPost, token, { draft, loyalty: [{ personId: f.hessa, program: "alfursan", number: "12" }] });
    expect(bad.status).toBe(400);

    const cardId = await addCard(token);
    const r = await post(ordersPost, token, { draft, prefs: { ...p.applied!.prefs, seat: "aisle" }, loyalty: [{ personId: f.hessa, program: "alfursan", number: "9988776655" }], payment: { method: "card", cardId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `prefs-${Math.random()}` });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const out = CreateOrderResponse.parse(r.json);
    if (out.outcome !== "created") throw new Error(out.outcome);
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, out.order.id));
    const applied = (o!.snapshot as { applied: { ssr: string[]; remarks: string[]; hotelRemarks: string[]; loyalty: { personId: string; number: string }[] } }).applied;
    expect(applied.ssr).toEqual(["VGML", "WCHR"]); // halal needs no code on Saudia; the seat wish and "together" are remarks
    expect(applied.remarks).toEqual(["SEAT AISLE", "SEAT TOGETHER"]);
    expect(applied.hotelRemarks).toEqual([]);
    expect(applied.loyalty).toEqual([{ personId: f.hessa, program: "alfursan", number: "9988776655" }]);
    const [req] = await db.select().from(appRequests).where(eq(appRequests.id, o!.requestId!));
    expect((req!.details as { prefs: { summary: string[]; loyalty: unknown[] } }).prefs.summary[0]).toBe("Aisle");
  });

  it("offers seats together on flynas at SAR 35 each way, as a line only when added this time, never silently", async () => {
    const { token } = await signIn();
    const f = await familyOf(token);
    const s = await istanbul(token, [f.me, f.hessa]);
    const xy = s.options.find((o) => o.carrier === "XY")!;
    const draft: OrderDraft = { kind: "trip", flightOfferId: xy.id, bundle: false, travellerIds: [f.me, f.hessa] };
    const p = await preview(token, { draft });
    expect(p.applied?.extrasOffer).toEqual({ key: "seatsTogether", perPerson: { amount: 3500, currency: "SAR" }, count: 2, legs: 2, total: { amount: 14_000, currency: "SAR" }, added: false });
    expect(p.lines.map((l) => l.key)).toEqual(["flight"]);
    expect(p.applied?.programmes).toEqual(["nasmiles"]);
    const added = await preview(token, { draft, extras: { seatsTogether: true } });
    expect(added.lines.map((l) => [l.key, l.amount])).toEqual([["flight", xy.total.amount], ["seats", 14_000]]);
    expect(added.total.amount).toBe(p.total.amount + 14_000);
    expect(added.applied?.extrasOffer?.added).toBe(true);
    // The slide carries the total the traveller saw: an order without the extra at the extra's total is a price question, not a charge.
    const cardId = await addCard(token);
    const r = await post(ordersPost, token, { draft, payment: { method: "card", cardId }, plan: "full", expectedTotal: added.total.amount, idempotencyKey: `seats-${Math.random()}` });
    expect(CreateOrderResponse.parse(r.json).outcome).toBe("price_changed");
    const ok = await post(ordersPost, token, { draft, extras: { seatsTogether: true }, payment: { method: "card", cardId }, plan: "full", expectedTotal: added.total.amount, idempotencyKey: `seats2-${Math.random()}` });
    const out = CreateOrderResponse.parse(ok.json);
    expect(out.outcome).toBe("created");
    if (out.outcome === "created") expect(out.order.total.amount).toBe(added.total.amount);
  });

  it("a stay carries the room preferences for the hotel's remark and finds the hotel programme", async () => {
    const { token } = await signIn();
    const f = await familyOf(token);
    expect((await callP(accountPatch, {}, { method: "PATCH", token, body: { prefs: { seat: "any", together: true, meal: "halal", assist: [], loyalty: [{ id: "h1", program: "hilton", number: "123456789" }], notes: "", room: "connecting", bed: "king", floor: "high", quiet: true } } })).status).toBe(200);
    const { POST: searchStays } = await import("@/app/api/app/v1/search/stays/route");
    const r = await post(searchStays, token, { destination: "istanbul", checkIn: EID_OUT, nights: 3, travellerIds: [f.me, f.hessa, f.sara] });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const options = (r.json.options as { id: string; name: string }[]);
    const hilton = options.find((o) => /hilton/i.test(o.name)) ?? options[0]!;
    const p = await preview(token, { draft: { kind: "stay", stayOfferId: hilton.id, travellerIds: [f.me, f.hessa, f.sara] } });
    expect(p.applied?.scope).toBe("stay");
    expect(p.applied?.summary).toEqual(["Connecting rooms", "King bed", "High floor", "Quiet room"]);
    if (/hilton/i.test(hilton.name)) expect(p.applied?.loyalty.map((l) => l.masked)).toEqual(["••••6789"]);
  });
});

describe("someone else in the circle pays", () => {
  it("writes the order without a charge, puts the pay link in the circle, and moves to the desk when the friend pays", async () => {
    const omar = await person("Omar");
    const hessa = await person("Hessa");
    const made = await post(circlesPost, omar.token, { name: `Eid ${Math.random().toString(36).slice(2, 6)}`, invite: [hessa.id] });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const circleId = made.json.circle.id as string;
    const inviteId = (made.json.invited as { inviteId: string; person: { id: string } }[]).find((i) => i.person.id === hessa.id)!.inviteId;
    expect((await post(inviteAccept, hessa.token, {}, { ref: inviteId })).status).toBe(200);
    const f = await familyOf(omar.token);
    const s = await istanbul(omar.token, [f.me, f.hessa]);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: [f.me, f.hessa] };
    const p = await preview(omar.token, { draft });
    const key = `mp-${Math.random()}`;
    const r = await post(ordersPost, omar.token, { draft, payment: { method: "someone_else", userId: hessa.id, circleId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: key });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const out = CreateOrderResponse.parse(r.json);
    if (out.outcome !== "payment_requested") throw new Error(out.outcome);
    expect(out.order.status).toBe("payment_requested");
    expect(out.order.payRequest).toMatchObject({ userId: hessa.id, name: "Hessa", circleId, paidAt: null });
    expect(out.order.paymentLabel).toBe("Paid by Hessa");
    // Nothing charged, the desk sees it as waiting for payment, a replay returns the same order.
    const [o] = await db.select().from(appOrders).where(eq(appOrders.id, out.order.id));
    expect(o!.paymentId).toBeNull();
    const [req] = await db.select().from(appRequests).where(eq(appRequests.id, o!.requestId!));
    expect(req!.status).toBe("awaiting_payment");
    const again = CreateOrderResponse.parse((await post(ordersPost, omar.token, { draft, payment: { method: "someone_else", userId: hessa.id, circleId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: key })).json);
    expect(again.outcome).toBe("payment_requested");
    // A stranger to the circle, or yourself, can't be asked.
    const stranger = await person("Khalid");
    expect((await post(ordersPost, omar.token, { draft, payment: { method: "someone_else", userId: stranger.id, circleId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `x-${Math.random()}` })).status).toBe(400);
    expect((await post(ordersPost, omar.token, { draft, payment: { method: "someone_else", userId: omar.id, circleId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `y-${Math.random()}` })).status).toBe(400);

    // The split in the circle: Omar's share is nil and settled, Hessa's is the whole price.
    const pr = out.order.payRequest!;
    const shares = await db.select().from(appCircleSplitShares).where(eq(appCircleSplitShares.messageId, pr.messageId));
    expect(shares.find((x) => x.key === hessa.id)).toMatchObject({ amount: p.total.amount, paidAt: null });
    expect(shares.find((x) => x.key === omar.id)!.paidAt).not.toBeNull();
    const [msg] = await db.select().from(appMessages).where(eq(appMessages.id, pr.messageId));
    expect((msg!.card as { orderId: string }).orderId).toBe(out.order.id);
    // Omar can nudge once a day, and sees the state on the order.
    expect((await post(orderAnswer, omar.token, { answer: "remind" }, { id: out.order.id })).status).toBe(200);
    expect((await post(orderAnswer, omar.token, { answer: "remind" }, { id: out.order.id })).status).toBe(400);
    expect(OrderResponse.parse((await get(orderGet, omar.token, { id: out.order.id })).json).order.status).toBe("payment_requested");

    // Hessa pays her share by card from the circle: the order goes to the desk with her payment, and books.
    const cardId = await addCard(hessa.token);
    const shareDraft: OrderDraft = { kind: "share", circleId, messageId: pr.messageId, shareKey: pr.shareKey };
    const sp = await preview(hessa.token, { draft: shareDraft });
    expect(sp.total.amount).toBe(p.total.amount);
    const paid = CreateOrderResponse.parse((await post(ordersPost, hessa.token, { draft: shareDraft, payment: { method: "card", cardId }, plan: "full", expectedTotal: sp.total.amount, idempotencyKey: `share-${Math.random()}` })).json);
    expect(paid.outcome).toBe("paid");
    const funded = OrderResponse.parse((await get(orderGet, omar.token, { id: out.order.id })).json).order;
    expect(["pending_agent", "held", "price_locked", "issuing", "confirmed"]).toContain(funded.status);
    expect(funded.payRequest?.paidAt).not.toBeNull();
    const [o2] = await db.select().from(appOrders).where(eq(appOrders.id, out.order.id));
    const [pay] = await db.select().from(appPayments).where(eq(appPayments.id, o2!.paymentId!));
    expect(pay).toMatchObject({ status: "captured", amount: p.total.amount });
    const done = await runDesk(out.order.id, 40);
    expect(done.status).toBe("confirmed");
    expect(done.tripId).not.toBeNull();

    // The trip's Money view: paid by Hessa, per person, with the split and the statement.
    const m = await get(moneyGet, omar.token, { id: done.tripId! });
    expect(m.status, JSON.stringify(m.json)).toBe(200);
    const money = TripMoneyResponse.parse(m.json).money;
    expect(money.total.amount).toBe(p.total.amount);
    expect(money.payers).toEqual([{ name: "Hessa", amount: { amount: p.total.amount, currency: "SAR" }, mine: false }]);
    expect(money.travellers.map((x) => x.amount.amount).reduce((a, b) => a + b, 0)).toBe(p.total.amount);
    expect(money.travellers.find((x) => x.isSelf)?.name).toBe("You");
    expect(money.items[0]?.paidBy).toBe("Hessa");
    expect(money.splits).toHaveLength(1);
    expect(money.splits[0]).toMatchObject({ circleId, settled: true, paidByName: "You" });
    expect(money.statement).toContain("Trip statement · Istanbul");
    expect(money.statement).toContain("Hessa");
    const html = await statementGet(new Request("http://localhost/api/app/v1/x", { headers: { authorization: `Bearer ${omar.token}`, "x-forwarded-for": "10.9.0.1", "user-agent": "vitest" } }), { params: Promise.resolve({ id: done.tripId! }) });
    expect(html.status).toBe(200);
    expect(html.headers.get("content-type")).toContain("text/html");
    expect(await html.text()).toContain("Trip statement");
  });

  it("cancelling a booking that waits for a friend closes the pay link", async () => {
    const omar = await person("Omar");
    const noor = await person("Noor");
    const made = await post(circlesPost, omar.token, { name: `Trip ${Math.random().toString(36).slice(2, 6)}`, invite: [noor.id] });
    const circleId = made.json.circle.id as string;
    const inviteId = (made.json.invited as { inviteId: string; person: { id: string } }[])[0]!.inviteId;
    await post(inviteAccept, noor.token, {}, { ref: inviteId });
    const f = await familyOf(omar.token);
    const s = await istanbul(omar.token, [f.me]);
    const draft: OrderDraft = { kind: "trip", flightOfferId: s.options[0]!.id, bundle: false, travellerIds: [f.me] };
    const p = await preview(omar.token, { draft });
    const out = CreateOrderResponse.parse((await post(ordersPost, omar.token, { draft, payment: { method: "someone_else", userId: noor.id, circleId }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `c-${Math.random()}` })).json);
    if (out.outcome !== "payment_requested") throw new Error(out.outcome);
    const cancelled = OrderResponse.parse((await post(orderAnswer, omar.token, { answer: "cancel" }, { id: out.order.id })).json).order;
    expect(cancelled.status).toBe("cancelled");
    const pr = out.order.payRequest!;
    const r = await post(previewPost, noor.token, { draft: { kind: "share", circleId, messageId: pr.messageId, shareKey: pr.shareKey } });
    expect(r.status).toBe(400);
    const [share] = await db.select().from(appCircleSplitShares).where(and(eq(appCircleSplitShares.messageId, pr.messageId), eq(appCircleSplitShares.key, noor.id)));
    expect(share!.paidAt).toBeNull();
  });
});
