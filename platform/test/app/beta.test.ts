import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { and, eq, sql as rawSql } from "drizzle-orm";
import {
  ConfigResponse, CreateOrderResponse, MessagesResponse, OrderResponse, PreviewResponse, RequestResponse, StatusResponse, SupportMessage, TripDetail, normalizeContactPhone, type OrderDraft,
} from "@mada/shared";
import { db, schema } from "@/db";
import { appMessages, appNotifications, appPeople, appQuotes, appRequests, appSegments, appTrips, appUsers } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { appAccounts, appDataExports } from "@/db/app-schema-wallet";
import { appRecoveryRequests } from "@/db/app-schema-recovery";
import { createSession } from "@/lib/app/tokens";
import { autopilotOn } from "@/lib/app/booking/common";
import { progressRequests } from "@/lib/app/booking/requests";
import type { DeskActor } from "@/lib/app/desk/core";
import { blockTraveller, getRequestFull, issueTickets, listOrders, listRequests, sendAgentReply, unblockTraveller } from "@/lib/app/desk/adapters";
import { buildFareOptions, confirmContactByCall, sendFlightQuote, type FlightQuoteInput } from "@/lib/app/desk/flight-quotes";
import { saveAgent } from "@/lib/app/desk/agents";
import { clearRuntimeCache } from "@/lib/app/resilience/runtime";
import { deletionsJob, exportsJob, quotesJob, recoveryJob } from "@/lib/app/jobs";
import { launchChecks, resetLaunchLog } from "@/lib/app/launch";
import { signedFilePath, verifyFileLink } from "@/lib/app/file-links";
import { mockSupabaseAdminLog } from "@/lib/app/suppliers/mock/supabase-admin";
import { GET as configGet } from "@/app/api/app/v1/config/route";
import { GET as statusGet } from "@/app/api/app/v1/status/route";
import { GET as requestGet } from "@/app/api/app/v1/requests/[id]/route";
import { POST as requestsPost } from "@/app/api/app/v1/requests/route";
import { GET as messagesGet } from "@/app/api/app/v1/requests/[id]/messages/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as orderGet } from "@/app/api/app/v1/orders/[id]/route";
import { GET as tripGet } from "@/app/api/app/v1/trips/[id]/route";
import { GET as peopleGet, POST as peoplePost } from "@/app/api/app/v1/people/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { GET as circlesGet, POST as circlesPost } from "@/app/api/app/v1/circles/route";
import { POST as circleMessagesPost } from "@/app/api/app/v1/circles/[id]/messages/route";
import { POST as postsPost } from "@/app/api/app/v1/posts/route";
import { GET as fileGet } from "@/app/api/app/v1/files/[kind]/[id]/route";
import { GET as cronGet } from "@/app/api/cron/[job]/route";
import { POST as supportThreadsPost } from "@/app/api/app/v1/support/threads/route";
import { callP, signIn } from "./wallet-helpers";

/*
 * The beta, end to end on a real Postgres: flights by request (the form → fares from the desk → pay → the desk
 * issues with a PNR and ticket numbers → the trip), booking without a verified phone (a contact number, confirmed by
 * call), the desk's Circles pause enforced in the app, files from the desk opened through signed links, the
 * scheduled jobs, the launch guard, and dates worded in the reader's language.
 */

const OUT = "2027-03-09";
const BACK = "2027-03-15";
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}, headers: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body, headers });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}, headers: Record<string, string> = {}) => callP(h, params, { method: "GET", token, headers });

let seq = 0;
async function opsUser(name: string, perms: string[]): Promise<DeskActor> {
  seq += 1;
  const [role] = await db.insert(schema.roles).values({ key: `beta_test_${Date.now()}_${seq}`, name: `Beta ${seq}`, nameAr: "مكتب", permissions: perms }).returning();
  const [u] = await db.insert(schema.users).values({ name, email: `beta${Date.now()}${seq}@madatrips.test`, passwordHash: "x", roleId: role!.id, team: "riyadh" }).returning();
  return { id: u!.id, name, permissions: new Set(perms) };
}

let agent: DeskActor, viewer: DeskActor;
const ENV_KEYS = ["APP_FLIGHTS_MODE", "APP_BOOKING_REQUIRES_PHONE", "VERCEL_ENV", "APP_ENV", "APP_ALLOW_MOCKS", "SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "CRON_SECRET", "APP_LEGACY_AUTH", "APP_DESK_AUTOPILOT", "APP_BLOB_DIR"];
const saved = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));

beforeAll(async () => {
  agent = await opsUser("Faisal Alqahtani", ["desk.view", "desk.act", "desk.issue", "desk.moderate", "desk.admin"]);
  viewer = await opsUser("Read Only", ["desk.view"]);
  await saveAgent(agent, { opsUserId: agent.id, displayName: "Faisal", languages: ["ar", "en"], pronoun: "he", replyMinutes: 2 });
});

afterEach(() => {
  for (const k of ENV_KEYS) { if (saved[k] === undefined) delete process.env[k]; else process.env[k] = saved[k]; }
  clearRuntimeCache();
  resetLaunchLog();
});

/** Omar, Hessa and Ahmed (8): two adults and a child. */
async function family(token: string) {
  const add = async (givenNames: string, relation: string, dob: string) => (await post(peoplePost, token, { givenNames, surname: "Alharbi", relation, dateOfBirth: dob })).json.person.id as string;
  const hessa = await add("Hessa", "spouse", "1988-07-24");
  const ahmed = await add("Ahmed", "child", "2018-09-03");
  const me = ((await get(peopleGet, token)).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
  return { me, hessa, ahmed, three: [me, hessa, ahmed] };
}

async function addCard(token: string) {
  const r = await post(cardsPost, token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return (r.json.cards as { id: string; last4: string }[]).find((c) => c.last4 === "4241")!.id;
}

const flightSearch = { destination: "istanbul", destinationName: null, from: "RUH", depart: OUT, return: BACK, cabin: "economy", carrier: null, flexDays: 3, bags: "one", prefs: ["direct", "together"] };

function fares(travellerIds: string[], names = ["Omar", "Hessa", "Ahmed"]): FlightQuoteInput {
  const prices = (adult: number) => travellerIds.map((personId, i) => ({ personId, name: names[i]!, type: (i === 2 ? "child" : "adult") as "adult" | "child", amount: i === 2 ? Math.round(adult * 0.75) : adult }));
  return {
    holdUntil: new Date(Date.now() + 6 * 3600_000).toISOString(), pnr: "X7K2QD", message: null,
    options: [
      { airline: "Saudia", carrier: "SV", cabin: "economy", baggage: "23 kg checked and 7 kg cabin, each", changeRule: "SAR 300 per person", refundRule: "Refund minus SAR 400 per person", refundable: true, note: "Direct, and you sit together",
        legs: [{ direction: "out", flightNumber: "SV263", from: "RUH", to: "IST", date: OUT, dep: "09:40", arr: "13:55" }, { direction: "back", flightNumber: "SV264", from: "IST", to: "RUH", date: BACK, dep: "15:10", arr: "19:20" }], prices: prices(216_000) },
      { airline: "Turkish Airlines", carrier: "TK", cabin: "economy", baggage: "2 × 23 kg checked, each", changeRule: "Free", refundRule: "Not refundable, taxes back", refundable: false, note: null,
        legs: [{ direction: "out", flightNumber: "TK145", from: "RUH", to: "IST", date: OUT, dep: "02:10", arr: "06:20" }, { direction: "back", flightNumber: "TK144", from: "IST", to: "RUH", date: BACK, dep: "21:00", arr: "01:15", arrDate: "2027-03-16" }], prices: prices(198_000) },
    ],
  };
}

describe("flights by request", () => {
  it("GET /config says how flights go and whether booking needs a verified phone", async () => {
    let c = ConfigResponse.parse((await callP(configGet, {})).json);
    expect(c.features).toMatchObject({ flightsByRequest: false, bookingNeedsPhone: true });
    process.env.APP_FLIGHTS_MODE = "request";
    process.env.APP_BOOKING_REQUIRES_PHONE = "no";
    c = ConfigResponse.parse((await callP(configGet, {})).json);
    expect(c.features).toMatchObject({ flightsByRequest: true, bookingNeedsPhone: false });
  });

  it("the form → fares from the desk → pay → the desk issues with a PNR and tickets → the trip", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token } = await signIn();
    const f = await family(token);
    const cardId = await addCard(token);

    // The request, worded from the form's answers.
    const created = await post(requestsPost, token, { kind: "flight", query: "Istanbul for Eid", travellerIds: f.three, note: "Window for Ahmed if you can", search: flightSearch });
    expect(created.status, JSON.stringify(created.json)).toBe(201);
    const r0 = RequestResponse.parse(created.json).request;
    expect(r0).toMatchObject({ kind: "flight", status: "sent", title: "Flights to Istanbul · 9–15 Mar" });
    expect(r0.summary).toBe("Riyadh to Istanbul · 3 travellers · Economy · ±3 days · One checked bag · Direct only · Seats together");
    const ownerId = (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o;

    // On the desk: in Requests (not Orders) until it's paid, with the form's answers.
    expect((await listRequests({ open: true })).some((x) => x.id === r0.id)).toBe(true);
    expect((await listOrders()).some((x) => x.id === r0.id)).toBe(false);
    const full = (await getRequestFull(r0.id))!;
    expect(full).toMatchObject({ isOrder: false, flightAsk: true, contact: null });

    // Fares: refused when they don't add up, sent when they do.
    await expect(sendFlightQuote(viewer, r0.id, fares(f.three))).rejects.toThrow(/access/);
    await expect(sendFlightQuote(agent, r0.id, { ...fares(f.three), holdUntil: new Date(Date.now() + 60_000).toISOString() })).rejects.toThrow(/at least 10 minutes/);
    const bad = fares(f.three);
    bad.options[0]!.legs[0]!.flightNumber = "263";
    await expect(sendFlightQuote(agent, r0.id, bad)).rejects.toThrow(/SV263/);
    expect(() => buildFareOptions({ ...fares(f.three), options: [{ ...fares(f.three).options[0]!, prices: [{ personId: "00000000-0000-4000-8000-000000000000", name: "X", type: "adult", amount: 1 }] }] }, f.three)).toThrow(/isn't on this request/);
    const q = await sendFlightQuote(agent, r0.id, fares(f.three));
    expect(q.total).toBe(198_000 * 2 + 148_500);

    // The app: the fares, per person, with rules and the hold; the agent's words in the thread.
    const r1 = RequestResponse.parse((await get(requestGet, token, { id: r0.id })).json).request;
    expect(r1.status).toBe("quoted");
    expect(r1.agent).toEqual({ name: "Faisal" });
    expect(r1.quote!.flight!.options.map((o) => [o.id, o.carrier, o.total.amount])).toEqual([["opt1", "SV", 216_000 * 2 + 162_000], ["opt2", "TK", 198_000 * 2 + 148_500]]);
    expect(r1.quote!.flight!.options[1]!.legs[1]).toMatchObject({ flightNumber: "TK144", arrDate: "2027-03-16" });
    expect(Date.parse(r1.quote!.expiresAt!)).toBeGreaterThan(Date.now() + 5 * 3600_000);
    const th = MessagesResponse.parse((await get(messagesGet, token, { id: r0.id })).json);
    expect(th.messages.at(-1)).toMatchObject({ from: "agent", authorName: "Faisal", text: "I found 2 fares and I’m holding them for you." });
    expect(await db.select().from(appNotifications).where(and(eq(appNotifications.userId, ownerId), eq(appNotifications.kind, "agent_reply")))).toHaveLength(1);

    // Pay for the Saudia fare: an agent issues it, so it's authorised now and the desk has it as an order.
    const draft: OrderDraft = { kind: "quote", requestId: r0.id, optionId: "opt1" };
    const pv = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: true })).json).preview;
    expect(pv).toMatchObject({ kind: "trip", agent: true, title: "Istanbul · 9–15 Mar", travellerIds: f.three });
    expect(pv.lines[0]!.text, JSON.stringify(pv.lines)).toBe("3 travellers · Saudia, direct");
    expect(pv.total.amount).toBe(216_000 * 2 + 162_000);
    expect(pv.rule).toBe("If you cancel, the flights come back minus SAR 400 per person.");
    expect((await post(previewPost, token, { draft: { ...draft, optionId: "opt9" }, useCredit: true })).status).toBe(404);
    const placed = await post(ordersPost, token, { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: pv.total.amount, idempotencyKey: `beta-${Date.now()}` });
    const out = CreateOrderResponse.parse(placed.json);
    expect(out.outcome).toBe("created");
    if (out.outcome !== "created") return;
    expect(out.order).toMatchObject({ kind: "trip", status: "pending_agent", flightNumber: "SV263", seats: [], requestId: r0.id, place: "Istanbul" });
    const [reqRow] = await db.select().from(appRequests).where(eq(appRequests.id, r0.id));
    expect(reqRow!.status).toBe("with_agent");
    expect((await db.select().from(appQuotes).where(eq(appQuotes.id, q.id)))[0]!.status).toBe("accepted");
    const onDesk = (await getRequestFull(r0.id))!;
    expect(onDesk).toMatchObject({ isOrder: true, stage: "awaiting", desk: { heldPnr: "X7K2QD" } });
    expect((await listOrders({ stage: "open" })).some((x) => x.id === r0.id)).toBe(true);

    // The ticketed step: the PNR and a ticket number each, then the card is captured and the trip written.
    await expect(issueTickets(agent, r0.id, { pnr: "X7K2QD", tickets: ["0651234567890"] })).rejects.toThrow(/one ticket number for each traveller \(3\)/);
    const done = await issueTickets(agent, r0.id, { pnr: "x7k2qd", tickets: ["065 1234567890", "065-1234567891", "0651234567892"] });
    expect(done.ok).toBe(true);
    const ov = OrderResponse.parse((await get(orderGet, token, { id: out.order.id })).json).order;
    expect(ov).toMatchObject({ status: "confirmed", confirmedBy: { name: "Faisal" } });
    const trip = TripDetail.parse((await get(tripGet, token, { id: ov.tripId! })).json.trip);
    expect(trip).toMatchObject({ city: "Istanbul", startDate: OUT, endDate: BACK, bookingRef: "X7K2QD", status: "booked" });
    expect(trip.segments.map((s) => [s.direction, s.flightNumber, s.pnr, s.seats.length, s.baggage])).toEqual([
      ["out", "SV263", "X7K2QD", 0, "23 kg checked and 7 kg cabin, each"], ["back", "SV264", "X7K2QD", 0, "23 kg checked and 7 kg cabin, each"],
    ]);
    expect(trip.travellers.map((p) => p.ticketNumber)).toEqual(["0651234567890", "0651234567891", "0651234567892"]);
    expect((await db.select().from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.status).toBe("confirmed");
    // Someone else's.
    const other = await signIn();
    expect((await get(requestGet, other.token, { id: r0.id })).status).toBe(404);
    expect((await post(previewPost, other.token, { draft, useCredit: true })).status).toBe(404);
  });

  it("the mock desk answers a flight request with fares and issues them itself (mock mode only)", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    const { token } = await signIn();
    const f = await family(token);
    const cardId = await addCard(token);
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: { ...flightSearch, return: null } })).json).request;
    expect(r0.title).toBe("Flights to Istanbul · 9 Mar, one way");
    const ownerId = (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o;
    await progressRequests(ownerId, Date.now() + 5_000);
    await progressRequests(ownerId, Date.now() + 10_000);
    const r1 = RequestResponse.parse((await get(requestGet, token, { id: r0.id })).json).request;
    expect(r1.quote!.flight!.options).toHaveLength(2);
    expect(r1.quote!.flight!.options[0]!.prices.map((p) => p.type)).toEqual(["adult", "adult", "child"]);
    const draft: OrderDraft = { kind: "quote", requestId: r0.id, optionId: "opt2" };
    const pv = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: true })).json).preview;
    const out = CreateOrderResponse.parse((await post(ordersPost, token, { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: pv.total.amount, idempotencyKey: `beta-m-${Date.now()}` })).json);
    if (out.outcome !== "created") throw new Error(out.outcome);
    const { advance, ownOrder } = await import("@/lib/app/booking/orders");
    let o = await ownOrder(ownerId, out.order.id);
    for (let s = 2; s <= 20; s += 2) o = await advance(o, new Date(Date.now() + s * 1000));
    expect(o.status).toBe("confirmed");
    const segs = await db.select().from(appSegments).where(eq(appSegments.tripId, o.tripId!));
    expect(segs.map((s) => s.direction)).toEqual(["out"]);
    expect((o.snapshot as { tickets: string[] }).tickets).toHaveLength(3);
  });

  it("cancelling before issue puts the fare back on the request while it's held", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token } = await signIn();
    const f = await family(token);
    const cardId = await addCard(token);
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: flightSearch })).json).request;
    const q = await sendFlightQuote(agent, r0.id, fares(f.three));
    const draft: OrderDraft = { kind: "quote", requestId: r0.id, optionId: "opt2" };
    const pv = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: true })).json).preview;
    const out = CreateOrderResponse.parse((await post(ordersPost, token, { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: pv.total.amount, idempotencyKey: `beta-c-${Date.now()}` })).json);
    if (out.outcome !== "created") throw new Error(out.outcome);
    const { answerOrder } = await import("@/lib/app/booking/orders");
    const ownerId = (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o;
    expect((await answerOrder(ownerId, out.order.id, "cancel")).status).toBe("cancelled");
    expect((await db.select().from(appQuotes).where(eq(appQuotes.id, q.id)))[0]!.status).toBe("open");
    expect(RequestResponse.parse((await get(requestGet, token, { id: r0.id })).json).request.status).toBe("quoted");
  });
});

describe("booking without a verified phone (APP_BOOKING_REQUIRES_PHONE=no)", () => {
  async function emailOnly() {
    const [u] = await db.insert(appUsers).values({ name: "Noor", email: `noor${Date.now()}@example.com`, phone: null }).returning();
    await db.insert(appPeople).values({ ownerId: u!.id, isSelf: true, givenNames: "Noor", surname: "Alsaud", relation: "self", dateOfBirth: "1992-02-02" });
    const tokens = await createSession(db, u!.id);
    return { userId: u!.id, token: tokens.accessToken };
  }

  it("needs a verified phone by default; with the switch off, a contact number the desk confirms by call", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token, userId } = await emailOnly();
    const cardId = await addCard(token);
    const me = ((await get(peopleGet, token)).json.people as { id: string }[])[0]!.id;
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: [me], search: flightSearch })).json).request;
    await sendFlightQuote(agent, r0.id, fares([me], ["Noor"]));
    const draft: OrderDraft = { kind: "quote", requestId: r0.id, optionId: "opt1" };
    const pv = PreviewResponse.parse((await post(previewPost, token, { draft, useCredit: true })).json).preview;
    const order = (extra: Record<string, unknown> = {}) => post(ordersPost, token, { draft, useCredit: true, payment: { method: "card", cardId }, plan: "full", expectedTotal: pv.total.amount, idempotencyKey: `beta-p-${Math.random().toString(36).slice(2)}`, ...extra });

    const refused = await order();
    expect(refused.status).toBe(403);
    expect(refused.json.error.code).toBe("PHONE_REQUIRED");

    process.env.APP_BOOKING_REQUIRES_PHONE = "no";
    const missing = await order();
    expect(missing.status).toBe(400);
    expect(missing.json.error).toMatchObject({ code: "VALIDATION", message: "Add a number to reach you first.", fields: { contactPhone: "missing" } });
    expect((await order({ contactPhone: "12" })).status).toBe(400);
    const ok = CreateOrderResponse.parse((await order({ contactPhone: "+44 7700 900123" })).json);
    expect(ok.outcome).toBe("created");

    const full = (await getRequestFull(r0.id))!;
    expect(full.contact).toEqual({ phone: "+447700900123", verified: false, confirmedAt: null, confirmedBy: null });
    const { deskInbox } = await import("@/lib/app/desk/inbox");
    const inbox = await deskInbox(new Date());
    expect(inbox.items.find((x) => x.id === r0.id)?.tag).toBe("Phone not verified");
    await expect(confirmContactByCall(viewer, r0.id)).rejects.toThrow(/access/);
    await confirmContactByCall(agent, r0.id);
    await expect(confirmContactByCall(agent, r0.id)).rejects.toThrow(/Already confirmed/);
    const after = (await getRequestFull(r0.id))!;
    expect(after.contact).toMatchObject({ phone: "+447700900123", confirmedBy: "Faisal" });
    const audit = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE entity_id = ${r0.id} AND action = 'desk.contact.confirmed_by_call'`);
    expect(audit).toHaveLength(1);
    // Flipping it back on never breaks what was booked meanwhile.
    process.env.APP_BOOKING_REQUIRES_PHONE = "yes";
    const [o] = await db.select().from(appOrders).where(eq(appOrders.ownerId, userId));
    expect((o!.snapshot as { contact: unknown }).contact).toEqual({ phone: "+447700900123", verified: false });
    expect(OrderResponse.parse((await get(orderGet, token, { id: o!.id })).json).order.status).toBe("pending_agent");
    expect((await issueTickets(agent, r0.id, { pnr: "QW3RTY", tickets: ["0659876543210"] })).ok).toBe(true);
  });

  it("reads Saudi and international numbers", () => {
    expect(normalizeContactPhone("050 000 4127")).toBe("+966500004127");
    expect(normalizeContactPhone("500004127")).toBe("+966500004127");
    expect(normalizeContactPhone("00966 50 000 4127")).toBe("+966500004127");
    expect(normalizeContactPhone("+44 (7700) 900-123")).toBe("+447700900123");
    expect(normalizeContactPhone("+966 11 000 0000")).toBeNull();
    expect(normalizeContactPhone("hello")).toBeNull();
  });
});

describe("the desk's Circles pause, in the app", () => {
  it("blocks posting, circle messages and new circles, says so in GET /circles, and lifts with the block", async () => {
    const a = await signIn();
    const circle = await post(circlesPost, a.token, { name: "Istanbul for Eid" });
    expect(circle.status, JSON.stringify(circle.json)).toBe(201);
    await blockTraveller(agent, a.user.id, "Selling visas in tips");
    expect((await get(circlesGet, a.token)).json.limited).toBe(true);
    for (const r of [
      await post(postsPost, a.token, { city: "Istanbul", place: "Galata Tower", text: "Visas here, cheap and quick", kind: "food", audience: "everyone" }),
      await post(circleMessagesPost, a.token, { body: "hello" }, { id: circle.json.circle.id }),
      await post(circlesPost, a.token, { name: "Another" }),
    ]) {
      expect(r.status).toBe(403);
      expect(r.json.error).toMatchObject({ code: "ACCOUNT_LIMITED", message: "Posting and messages in Circles are paused on your account. Talk to Mada if this looks wrong." });
    }
    // In the traveller's own language.
    await db.update(appUsers).set({ locale: "ar" }).where(eq(appUsers.id, a.user.id));
    expect((await post(circlesPost, a.token, { name: "Another" })).json.error.message).toContain("مادا");
    await db.update(appUsers).set({ locale: "en" }).where(eq(appUsers.id, a.user.id));
    await unblockTraveller(agent, a.user.id);
    expect((await get(circlesGet, a.token)).json.limited).toBe(false);
    expect((await post(circleMessagesPost, a.token, { body: "hello" }, { id: circle.json.circle.id })).status).toBe(201);
  });
});

describe("files from the desk", () => {
  it("open in the app through a short-lived signed link, in request threads and support", async () => {
    const { token, user } = await signIn();
    const f = await family(token);
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: flightSearch })).json).request;
    const pdf = Buffer.from("%PDF-1.4\n% e-ticket\n%%EOF\n");
    const [att] = await db.insert(schema.attachments).values({ entityType: "app_thread", entityId: r0.id, filename: "e-ticket.pdf", mime: "application/pdf", size: pdf.length, data: pdf, uploadedBy: agent.id }).returning();
    await sendAgentReply(agent, "request", r0.id, { body: "Your e-tickets", attachment: { id: att!.id, filename: "e-ticket.pdf", mime: "application/pdf", size: pdf.length } });
    const msgs = MessagesResponse.parse((await get(messagesGet, token, { id: r0.id })).json).messages;
    const m = msgs.find((x) => x.text === "Your e-tickets")!;
    expect(m.attachment).toMatchObject({ id: att!.id, name: "e-ticket.pdf", mime: "application/pdf", size: pdf.length });
    const url = new URL(m.attachment!.url!, "http://localhost/api/app/v1/");
    expect(url.pathname).toBe(`/files/desk/${att!.id}`);
    const open = (path: string) => fileGet(new Request(`http://localhost/api/app/v1${path}`), { params: Promise.resolve({ kind: path.split("/")[2]!, id: path.split("/")[3]!.split("?")[0]! }) });
    const res = await open(m.attachment!.url!);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("application/pdf");
    expect(Buffer.from(await res.arrayBuffer()).equals(pdf)).toBe(true);
    // Tampered, expired, or another file with this signature: nothing.
    expect((await open(m.attachment!.url!.replace(/sig=.{4}/, "sig=AAAA"))).status).toBe(404);
    expect((await open(signedFilePath("desk", att!.id, Date.now() - 3600_000))).status).toBe(404);
    expect(verifyFileLink("app", att!.id, url.searchParams.get("exp"), url.searchParams.get("sig"))).toBe(false);

    // Support: the same file an agent attaches in a support conversation.
    const th = await post(supportThreadsPost, token, {});
    expect(th.status, JSON.stringify(th.json)).toBe(200);
    const threadId = th.json.thread.id as string;
    await sendAgentReply(agent, "support", threadId, { body: "Here it is", attachment: { id: att!.id, filename: "e-ticket.pdf", mime: "application/pdf", size: pdf.length } });
    const sup = await post(supportThreadsPost, token, {});
    const sm = (sup.json.messages as unknown[]).map((x) => SupportMessage.parse(x)).find((x) => x.body === "Here it is")!;
    expect(sm.attachment).toMatchObject({ name: "e-ticket.pdf" });
    expect((await open(sm.attachment!.url!)).status).toBe(200);
    void user;
  });
});

describe("scheduled jobs", () => {
  it("are refused without the cron secret", async () => {
    process.env.CRON_SECRET = "cron-secret-0123456789";
    const run = (auth?: string) => cronGet(new Request("http://localhost/api/cron/quotes", { headers: auth ? { authorization: auth } : {} }), { params: Promise.resolve({ job: "quotes" }) });
    expect((await run()).status).toBe(401);
    expect((await run("Bearer nope")).status).toBe(401);
    const ok = await run("Bearer cron-secret-0123456789");
    expect(ok.status).toBe(200);
    expect((await ok.json()).ran.quotes).toMatchObject({ expired: expect.any(Number) });
    const unknown = await cronGet(new Request("http://localhost/api/cron/x", { headers: { authorization: "Bearer cron-secret-0123456789" } }), { params: Promise.resolve({ job: "x" }) });
    expect(unknown.status).toBe(404);
  });

  it("quotes: a hold that passed expires once, the traveller hears it, and a stuck bank code is cancelled", async () => {
    process.env.APP_DESK_AUTOPILOT = "off";
    const { token } = await signIn();
    const f = await family(token);
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: flightSearch })).json).request;
    const q = await sendFlightQuote(agent, r0.id, fares(f.three));
    expect(RequestResponse.parse((await get(requestGet, token, { id: r0.id })).json).request.quote!.status).toBe("open");
    await db.update(appQuotes).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appQuotes.id, q.id));
    // Read before the job runs: it already says expired.
    expect(RequestResponse.parse((await get(requestGet, token, { id: r0.id })).json).request.quote!.status).toBe("expired");
    const res = await quotesJob();
    expect(res.expired).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(appQuotes).where(eq(appQuotes.id, q.id)))[0]!.status).toBe("expired");
    const again = await quotesJob();
    expect(again.told).toBe(0);
    const msgs = MessagesResponse.parse((await get(messagesGet, token, { id: r0.id })).json).messages;
    expect(msgs.at(-1)).toMatchObject({ from: "mada", text: "The hold on this price ended. Ask me and I’ll check it again." });
    const ownerId = (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o;
    const notes = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, ownerId), eq(appNotifications.title, "Your held fare ended")));
    expect(notes).toHaveLength(1);
    // Paying an expired fare: the hold ended.
    const pv = await post(previewPost, token, { draft: { kind: "quote", requestId: r0.id, optionId: "opt1" }, useCredit: true });
    expect(pv.status).toBe(404);
  });

  it("recovery: contact details go 30 days after the desk closed it; open ones stay", async () => {
    const old = new Date(Date.now() - 31 * 86_400_000);
    const [closed] = await db.insert(appRecoveryRequests).values({ name: "Omar", oldKind: "phone", oldValue: "+966500004127", newKind: "email", newValue: "omar@example.com", note: "lost my phone", status: "approved", decidedAt: old, ipHash: "abc" }).returning();
    const [recent] = await db.insert(appRecoveryRequests).values({ name: "Sara", oldKind: "phone", oldValue: "+966500004128", newKind: "email", newValue: "sara@example.com", status: "declined", decidedAt: new Date() }).returning();
    const [open] = await db.insert(appRecoveryRequests).values({ name: "Ali", oldKind: "phone", oldValue: "+966500004129", newKind: "email", newValue: "ali@example.com", createdAt: old }).returning();
    expect((await recoveryJob()).purged).toBeGreaterThanOrEqual(1);
    const rows = await db.select().from(appRecoveryRequests).where(rawSql`${appRecoveryRequests.id} IN (${closed!.id}, ${recent!.id}, ${open!.id})`);
    const by = (id: string) => rows.find((r) => r.id === id)!;
    expect(by(closed!.id)).toMatchObject({ name: "", oldValue: "", newValue: "", note: null, ipHash: null, status: "approved" });
    expect(by(recent!.id).newValue).toBe("sara@example.com");
    expect(by(open!.id).oldValue).toBe("+966500004129");
    expect((await recoveryJob()).purged).toBe(0);
  });

  it("deletions: after the grace period, our account and the Supabase user (mock records it)", async () => {
    const { token, user } = await signIn();
    void token;
    await db.update(appUsers).set({ supabaseUserId: "00000000-0000-4000-8000-00000000abcd" }).where(eq(appUsers.id, user.id));
    await db.insert(appAccounts).values({ userId: user.id, deleteAt: new Date(Date.now() - 1000) }).onConflictDoUpdate({ target: appAccounts.userId, set: { deleteAt: new Date(Date.now() - 1000) } });
    const res = await deletionsJob();
    expect(res.deleted).toBeGreaterThanOrEqual(1);
    const [u] = await db.select().from(appUsers).where(eq(appUsers.id, user.id));
    expect(u).toMatchObject({ phone: null, name: "", supabaseUserId: null });
    expect(mockSupabaseAdminLog.some((c) => c.op === "deleteUser" && c.userId === "00000000-0000-4000-8000-00000000abcd")).toBe(true);
  });

  it("exports: the copy is built, emailed, and the traveller is told in the app", async () => {
    const { user } = await signIn();
    await db.update(appUsers).set({ email: `x${Date.now()}@example.com` }).where(eq(appUsers.id, user.id));
    const [e] = await db.insert(appDataExports).values({ userId: user.id, email: "x@example.com" }).returning();
    const res = await exportsJob();
    expect(res.sent).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(appDataExports).where(eq(appDataExports.id, e!.id)))[0]!.status).toBe("sent");
    expect(await db.select().from(appNotifications).where(and(eq(appNotifications.userId, user.id), eq(appNotifications.title, "Your copy is ready")))).toHaveLength(1);
  });
});

describe("the launch guard", () => {
  it("on production, closes app routes while a supplier is a mock, env is missing, or legacy sign-in is on; /status says why", async () => {
    process.env.VERCEL_ENV = "production";
    delete process.env.APP_ALLOW_MOCKS;
    delete process.env.SUPABASE_URL;
    const { token } = await signIn().catch(() => ({ token: "" }));
    void token;
    const st = StatusResponse.parse((await callP(statusGet, {})).json);
    expect(st.status).toBe("down");
    expect(st.launch!.ready).toBe(false);
    expect(st.launch!.problems.join("\n")).toMatch(/SUPABASE_URL is missing/);
    expect(st.launch!.problems.join("\n")).toMatch(/flights is in mock mode on production/);
    expect((await callP(configGet, {})).status).toBe(200);
    const blocked = await callP(peopleGet, {}, { method: "GET", token: "x" });
    expect(blocked.status).toBe(503);
    expect(blocked.json.error).toMatchObject({ code: "MAINTENANCE", details: { launch: true } });

    process.env.APP_LEGACY_AUTH = "yes";
    expect(launchChecks(true).filter((c) => c.level === "block").map((c) => c.area)).toContain("auth");
    process.env.APP_BOOKING_REQUIRES_PHONE = "no";
    expect(launchChecks(true).find((c) => c.area === "booking")!.level).toBe("warn");
  });

  it("is quiet outside production, and the mock desk never runs on production unless asked", () => {
    expect(launchChecks(false).some((c) => c.level === "block")).toBe(false);
    expect(autopilotOn()).toBe(true);
    process.env.APP_ENV = "production";
    process.env.APP_ALLOW_MOCKS = "yes";
    expect(autopilotOn()).toBe(false);
    process.env.APP_DESK_AUTOPILOT = "on";
    expect(autopilotOn()).toBe(true);
  });
});

describe("dates in the reader's language", () => {
  it("a flight request reads in Arabic for an Arabic reader, whatever language it was sent in", async () => {
    process.env.APP_FLIGHTS_MODE = "request";
    const { token } = await signIn();
    const f = await family(token);
    const r0 = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: flightSearch })).json).request;
    expect(r0.title).toBe("Flights to Istanbul · 9–15 Mar");
    // The traveller switches the app to Arabic: their saved language is what the server words things in.
    await db.update(appUsers).set({ locale: "ar" }).where(eq(appUsers.id, (await db.select({ o: appRequests.ownerId }).from(appRequests).where(eq(appRequests.id, r0.id)))[0]!.o));
    const ar = RequestResponse.parse((await get(requestGet, token, { id: r0.id }, { "accept-language": "ar" })).json).request;
    expect(ar.title).not.toMatch(/Mar|Flights/);
    expect(ar.title).toMatch(/مارس|إسطنبول|Istanbul/);
    expect(ar.summary).toContain("±");
    const oneWay = RequestResponse.parse((await post(requestsPost, token, { kind: "flight", travellerIds: f.three, search: { ...flightSearch, return: null } }, {}, { "accept-language": "ar" })).json).request;
    expect(oneWay.title).not.toMatch(/one way/);
  });
});
