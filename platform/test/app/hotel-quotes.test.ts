import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import {
  AskThreadResponse, CreateOrderResponse, OrderResponse, PreviewResponse, RequestResponse, TripDetail, type ChatCard, type OrderDraft,
} from "@mada/shared";
import { db, schema } from "@/db";
import { appNotifications, appPayments, appQuotes, appRequests, appStays } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import type { DeskActor } from "@/lib/app/desk/core";
import { getRequestFull, listOrders, listRequests } from "@/lib/app/desk/adapters";
import { buildHotelQuote, confirmHandStay, handStayCostsOf, sendHotelQuote, type HotelQuoteInput } from "@/lib/app/desk/hotel-quotes";
import { handStayPrice } from "@/lib/app/desk/hotel-quote-math";
import { saveAgent } from "@/lib/app/desk/agents";
import { newThread } from "@/lib/app/ask-chat/store";
import { costHalalas, pricingRules, sellHalalas } from "@/lib/app/suppliers/hotelbeds/money";
import { costLinesFor } from "@/lib/app/finance/costs";
import { scrubResponse } from "@/lib/app/shield";
import { GET as requestGet } from "@/app/api/app/v1/requests/[id]/route";
import { POST as requestsPost } from "@/app/api/app/v1/requests/route";
import { GET as threadGet } from "@/app/api/app/v1/ask/threads/[id]/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as orderGet } from "@/app/api/app/v1/orders/[id]/route";
import { GET as tripGet } from "@/app/api/app/v1/trips/[id]/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";
import { scanJson } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Stays found by hand (desk/hotel-quotes.ts), end to end on a real Postgres: a stay request from Ask → "Add hotel
 * quote" on the desk (checked, priced like an instant stay, an override audited) → the card in the same Ask chat with a
 * push → the traveller books one option and pays → "Paid · confirm on the portal" with the hotel's reference → the
 * stay is Booked on the trip with that reference. What Mada pays and who it books with never reach the app.
 */

const IN = "2027-03-10";
const OUT = "2027-03-14";
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}) => callP(h, params, { method: "GET", token });

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `hq_test_${Date.now()}_${seq}`, name: `HQ ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `hq${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}

let agent: DeskActor, support: DeskActor, viewer: DeskActor;
const ENV_KEYS = ["APP_DESK_AUTOPILOT", "APP_STAY_MARKUP_BPS", "APP_FX_BUFFER_BPS", "APP_FX_RATES"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  agent = await opsUser("Faisal Alqahtani", ["desk.view", "desk.act", "desk.issue", "desk.admin"]);
  support = await opsUser("Sara Support", ["desk.view", "desk.act"]);
  viewer = await opsUser("Read Only", ["desk.view"]);
  await saveAgent(agent, { opsUserId: agent.id, displayName: "Faisal", languages: ["ar", "en"], pronoun: "he", replyMinutes: 2 });
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
});

function hotel(over: Partial<HotelQuoteInput["options"][number]> = {}): HotelQuoteInput["options"][number] {
  return {
    hotel: "Shangri-La Bosphorus", city: "Istanbul", room: "Deluxe room, Bosphorus view", board: "BB", checkIn: IN, checkOut: OUT, guests: 2,
    supplier: "hotelbeds_portal", net: 812.4, currency: "EUR", freeCancelUntil: "2027-03-08T18:00", note: "Ask for a high floor", supplierRef: "1-2345678",
    ...over,
  };
}

const TODAY = "2026-10-23";

describe("Add hotel quote: the form's checks", () => {
  const fails = (input: HotelQuoteInput) => expect(() => buildHotelQuote(input, { today: TODAY }));

  it("asks for exactly what a hotel quote needs, naming the hotel and the field", () => {
    fails({ options: [] }).toThrow(/Add the hotel/);
    fails({ options: [hotel({ hotel: "" })] }).toThrow(/Hotel 1: Name the hotel/);
    fails({ options: [hotel(), hotel({ room: " " })] }).toThrow(/Hotel 2: Say the room type/);
    fails({ options: [hotel({ board: "XX" as never })] }).toThrow(/Pick the board/);
    fails({ options: [hotel({ guests: 0 })] }).toThrow(/At least one guest/);
    fails({ options: [hotel({ supplier: "" as never })] }).toThrow(/Say where you found it/);
    fails({ options: [hotel({ net: 0 })] }).toThrow(/Enter the net cost/);
    fails({ options: [hotel({ currency: "euro" })] }).toThrow(/three letters/);
    fails({ options: [hotel({ currency: "XYZ" })] }).toThrow(/no rate for XYZ/);
    fails({ options: [hotel({ checkOut: IN })] }).toThrow(/check-out must be after check-in/);
    fails({ options: [hotel({ checkIn: "2026-10-01", checkOut: "2026-10-03" })] }).toThrow(/check-in is in the past/);
    fails({ options: [hotel({ freeCancelUntil: "2027-03-11T12:00" })] }).toThrow(/can't run past check-in/);
    fails({ options: [hotel({ freeCancelUntil: "8 March" })] }).toThrow(/date and time at the hotel/);
    fails({ options: [hotel(), hotel(), hotel(), hotel()] }).toThrow(/Up to 3 hotels/);
    fails({ options: [hotel({ sellSar: "5,000" })] }).toThrow(/say why the price is different/);
  });

  it("works out nights, keeps the agent's words, and reads empty cancellation as non-refundable", () => {
    const q = buildHotelQuote({ options: [hotel(), hotel({ hotel: "Pera Palace", freeCancelUntil: "", note: "" })] }, { today: TODAY });
    expect(q.options.map((o) => [o.id, o.hotel, o.nights, o.freeCancelUntil, o.note])).toEqual([
      ["h1", "Shangri-La Bosphorus", 4, "2027-03-08T18:00", "Ask for a high floor"], ["h2", "Pera Palace", 4, null, null],
    ]);
  });
});

describe("the selling price: the same margin and FX rules as an instant stay", () => {
  it("matches sellHalalas/costHalalas for the stay, under the env's own rules", () => {
    process.env.APP_STAY_MARKUP_BPS = "1200";
    process.env.APP_FX_BUFFER_BPS = "200";
    process.env.APP_FX_RATES = "EUR=4.20";
    const rules = pricingRules();
    const q = buildHotelQuote({ options: [hotel(), hotel({ net: 3100, currency: "SAR" })] }, { today: TODAY });
    expect(q.options[0]!.total).toBe(sellHalalas(812.4, "EUR", "stay", { rules }));
    expect(q.costs[0]!.costHalalas).toBe(costHalalas(812.4, "EUR", rules));
    // 812.40 EUR × 4.20 × 1.02 = 3,480.32 SAR cost; × 1.12 = 3,897.96, rounded up to a riyal.
    expect(q.costs[0]).toMatchObject({ costHalalas: 348_032, autoSell: 389_800, sell: 389_800, marginHalalas: 389_800 - 348_032, netAmount: "812.40", currency: "EUR", supplier: "hotelbeds_portal" });
    // SAR has no FX buffer, only the markup.
    expect(q.options[1]!.total).toBe(347_200);
    expect(handStayPrice(812.4, "EUR", rules)).toEqual({ cost: 348_032, sell: 389_800, margin: 41_768 });
  });

  it("takes another price only with a reason, and keeps both", () => {
    const rules = pricingRules();
    const q = buildHotelQuote({ options: [hotel({ sellSar: "3,750", overrideReason: "Matched the hotel's own rate" })] }, { today: TODAY, rules });
    const auto = sellHalalas(812.4, "EUR", "stay", { rules });
    expect(q.options[0]!.total).toBe(375_000);
    expect(q.costs[0]).toMatchObject({ autoSell: auto, sell: 375_000, overrideReason: "Matched the hotel's own rate", marginHalalas: 375_000 - costHalalas(812.4, "EUR", rules) });
    // The same price as worked out needs no reason.
    expect(buildHotelQuote({ options: [hotel({ sellSar: String(auto / 100) })] }, { today: TODAY, rules }).costs[0]!.overrideReason).toBeNull();
  });
});

describe("a stay found by hand: request → hotel quote in the Ask chat → pay → confirm on the portal → the trip", () => {
  it("runs end to end, and never shows the app what Mada pays or who it books with", async () => {
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token } = await signIn();
    const me = ((await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
    const card = await post(cardsPost, token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
    const cardId = (card.json.cards as { id: string; last4: string }[]).find((c) => c.last4 === "4241")!.id;

    // The request, as Ask's create_request sends it (a stay it can't price instantly).
    const created = await post(requestsPost, token, { kind: "stay", query: "Shangri-La in Istanbul", travellerIds: [me], contactPreference: "in_app", search: { destination: null, destinationName: "Istanbul", from: null, depart: IN, return: OUT, cabin: null, carrier: null } });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const r0 = RequestResponse.parse(created.json).request;
    const ownerId = (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o;
    // The chat it came from (its tool answer names the request), and a later chat about something else.
    const asked = await newThread(ownerId, "en");
    await db.update(appAskThreads).set({ messages: [{ role: "user", content: [{ type: "tool_result", content: `Request ${r0.id} noted for the team at Mada` }] }], transcript: [{ who: "me", text: "Shangri-La in Istanbul, 10 to 14 March" }] }).where(eq(appAskThreads.id, asked.id));
    const other = await newThread(ownerId, "en");
    await db.update(appAskThreads).set({ transcript: [{ who: "me", text: "eSIM for Baku?" }], updatedAt: new Date(Date.now() + 60_000) }).where(eq(appAskThreads.id, other.id));

    // On the desk: in Requests (not Orders) until it's paid, with the 2-hour promise.
    const onDesk = (await getRequestFull(r0.id))!;
    expect(onDesk).toMatchObject({ isOrder: false, stayAsk: true });
    expect(onDesk.request.promisedBy!.getTime() - onDesk.request.createdAt.getTime()).toBe(120 * 60_000);
    expect((await listRequests({ open: true })).some((x) => x.id === r0.id)).toBe(true);
    expect((await listOrders({ stage: "open" })).some((x) => x.id === r0.id)).toBe(false);

    // Only an agent sends it; then two hotels, one priced by hand with a reason.
    const input: HotelQuoteInput = { options: [hotel(), hotel({ hotel: "Pera Palace", room: "Superior room", board: "RO", net: 3100, currency: "SAR", supplier: "hotel_direct", freeCancelUntil: null, supplierRef: null, sellSar: "3,400", overrideReason: "The hotel's member rate" })] };
    await expect(sendHotelQuote(viewer, r0.id, input)).rejects.toThrow(/access/);
    const sent = await sendHotelQuote(agent, r0.id, input);
    expect(sent.threadId).toBe(asked.id);
    const rules = pricingRules();
    const sell1 = sellHalalas(812.4, "EUR", "stay", { rules });
    expect(sent.quote.total).toBe(Math.min(sell1, 340_000));
    expect(handStayCostsOf(sent.quote.offerSnapshot).map((c) => [c.id, c.supplier, c.netAmount, c.currency])).toEqual([["h1", "hotelbeds_portal", "812.40", "EUR"], ["h2", "hotel_direct", "3100.00", "SAR"]]);
    const [reqRow] = await db.select().from(appRequests).where(eq(appRequests.id, r0.id));
    expect(reqRow!.status).toBe("quoted");
    const audit = await db.execute<{ action: string; summary: string }>(rawSql`SELECT action, summary FROM app_audit WHERE entity_id = ${r0.id} AND action LIKE 'desk.quote.stay%' ORDER BY action`);
    expect(audit.map((a) => a.action)).toEqual(["desk.quote.stay_price_override", "desk.quote.stay_sent"]);
    expect(audit[0]!.summary).toContain("The hotel's member rate");

    // The card is in the chat the request came from, not the latest one, with one push that opens it.
    const [th] = await db.select().from(appAskThreads).where(eq(appAskThreads.id, asked.id));
    const line = (th!.transcript as { who: string; text: string; kept?: ChatCard[] }[]).at(-1)!;
    expect(line).toMatchObject({ who: "mada", text: "Faisal at Mada found 2 rooms. Pick the one you like." });
    const kept = line.kept![0]!;
    expect(kept.type).toBe("stay_quote");
    if (kept.type !== "stay_quote") return;
    expect(kept.options.map((o) => [o.id, o.hotel, o.nights, o.room, o.board, o.total, o.freeCancelUntil])).toEqual([
      ["h1", "Shangri-La Bosphorus", 4, "Deluxe room, Bosphorus view", "BB", sell1, "2027-03-08T18:00"], ["h2", "Pera Palace", 4, "Superior room", "RO", 340_000, null],
    ]);
    expect(JSON.stringify((await db.select().from(appAskThreads).where(eq(appAskThreads.id, other.id)))[0]!.transcript)).not.toContain("stay_quote");
    const pushes = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, ownerId), eq(appNotifications.kind, "agent_reply")));
    expect(pushes.map((n) => [n.title, n.href])).toEqual([["Rooms ready to book", `/ask/${asked.id}`]]);
    expect(pushes[0]!.body).toBe(`2 rooms in Istanbul, from SAR ${(Math.min(sell1, 340_000) / 100).toLocaleString("en-US")}.`);

    // What the app reads: the chat (the card comes back when it's opened again) and the request. No net, no supplier.
    const chat = await get(threadGet, token, { id: asked.id });
    expect(chat.status).toBe(200);
    const lines = AskThreadResponse.parse(chat.json).lines;
    expect(lines.at(-1)!.kept?.[0]?.type).toBe("stay_quote");
    const req = await get(requestGet, token, { id: r0.id });
    for (const body of [chat.json, req.json, scrubResponse(chat.json, "https://x")]) {
      expect(scanJson(body)).toEqual([]);
      const text = JSON.stringify(body);
      for (const secret of ["812.4", "3100.00", "hotelbeds_portal", "hotel_direct", "1-2345678", "wholesale", "netAmount", "costHalalas", "marginHalalas", "member rate"]) expect(text, secret).not.toContain(secret);
    }

    // Book the Shangri-La and pay: priced as a stay, the request goes to the desk as its order.
    const draft: OrderDraft = { kind: "quote", requestId: r0.id, optionId: "h1" };
    const pv = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: false })).json).preview;
    expect(pv).toMatchObject({ kind: "stay", agent: true, title: "Shangri-La Bosphorus", total: { amount: sell1 }, stay: { name: "Shangri-La Bosphorus", checkIn: IN, nights: 4, freeCancelUntil: "2027-03-08", refundable: true } });
    expect(pv.lines.map((l) => [l.key, l.amount])).toEqual([["stay", sell1]]);
    expect(pv.rule).toContain("18:00 hotel time");
    expect(scanJson(pv)).toEqual([]);
    expect((await post(previewPost, token, { draft: { ...draft, optionId: "h9" }, useCredit: false })).status).toBe(404);
    const out = CreateOrderResponse.parse((await post(ordersPost, token, { draft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: pv.total.amount, idempotencyKey: `hq-${Date.now()}` })).json);
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.order).toMatchObject({ kind: "stay", status: "pending_agent", requestId: r0.id });
    expect((await db.select().from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.status).toBe("with_agent");
    expect((await db.select().from(appQuotes).where(eq(appQuotes.id, sent.quote.id)))[0]!.status).toBe("accepted");
    const paid = (await getRequestFull(r0.id))!;
    expect(paid).toMatchObject({ isOrder: true, stage: "awaiting" });

    // Paid · confirm on the portal: the issuing right, the hotel's reference, then the stay is on the trip.
    await expect(confirmHandStay(support, r0.id, { hotelRef: "HTL-48213" })).rejects.toThrow(/access/);
    await expect(confirmHandStay(agent, r0.id, { hotelRef: "" })).rejects.toThrow(/hotel's confirmation number/);
    const done = await confirmHandStay(agent, r0.id, { hotelRef: "HTL-48213", supplierRef: "1-2345678" });
    expect(done.ok).toBe(true);
    await expect(confirmHandStay(agent, r0.id, { hotelRef: "HTL-48213" })).rejects.toThrow(/Already confirmed/);
    const ov = OrderResponse.parse((await get(orderGet, token, { id: out.order.id })).json).order;
    expect(ov).toMatchObject({ status: "confirmed", confirmedBy: { name: "Faisal" } });
    const tripRes = await get(tripGet, token, { id: ov.tripId! });
    const trip = TripDetail.parse(tripRes.json.trip);
    expect(trip).toMatchObject({ city: "Istanbul", startDate: IN, endDate: OUT, status: "booked" });
    expect(trip.stays.map((s) => [s.name, s.status, s.confirmation, s.checkIn, s.nights, s.roomType])).toEqual([["Shangri-La Bosphorus", "booked", "HTL-48213", IN, 4, "Deluxe room, Bosphorus view · Breakfast included"]]);
    expect(JSON.stringify(tripRes.json)).not.toContain("1-2345678");
    expect(scanJson(tripRes.json)).toEqual([]);
    const [stayRow] = await db.select().from(appStays).where(eq(appStays.tripId, ov.tripId!));
    expect(stayRow).toMatchObject({ supplier: "desk", supplierRef: "1-2345678", confirmation: "HTL-48213" });
    expect((await db.select().from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.status).toBe("confirmed");

    // Finance: the line's cost is what the agent entered, from the option booked.
    const [pay] = await db.select().from(appPayments).where(eq(appPayments.id, (await getRequestFull(r0.id))!.order!.paymentId!));
    expect(pay!.status).toBe("captured");
    const { lines: costs } = await costLinesFor(db, pay!);
    expect(costs.map((c) => [c.product, c.supplier, c.supplierRef, c.netAmount, c.currency, c.basis])).toEqual([["stay", "hotelbeds", "1-2345678", "812.40", "EUR", "supplier"]]);
  });

  it("refuses a hotel quote on anything but a stay request, and once it's paid", async () => {
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token } = await signIn();
    const me = ((await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
    const visa = RequestResponse.parse((await post(requestsPost, token, { kind: "visa", query: "UK visa", travellerIds: [me] })).json).request;
    await expect(sendHotelQuote(agent, visa.id, { options: [hotel()] })).rejects.toThrow(/stay request/);
    const stay = RequestResponse.parse((await post(requestsPost, token, { kind: "stay", query: "Rooms in Baku", travellerIds: [me], search: { destination: null, destinationName: "Baku", from: null, depart: IN, return: OUT, cabin: null, carrier: null } })).json).request;
    await db.update(appRequests).set({ status: "with_agent" }).where(eq(appRequests.id, stay.id));
    await expect(sendHotelQuote(agent, stay.id, { options: [hotel({ city: "Baku" })] })).rejects.toThrow(/already paid or closed/);
    await expect(confirmHandStay(agent, stay.id, { hotelRef: "HTL-1" })).rejects.toThrow(/no paid hotel quote/);
  });
});
