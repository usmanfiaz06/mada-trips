import { beforeAll, describe, expect, it } from "vitest";
import { sql as rawSql } from "drizzle-orm";
import {
  DEMO_PHASE_HEADER, DisruptionResponse, InvoiceResponse, ItineraryResponse, PaymentsResponse, RefundQuoteResponse, RefundResponse, SignInResponse, TrackedResponse,
  TripResponse, TripsResponse, ChangeOptionsResponse, ChangeFlightResponse, TripAskResponse, MoveResponse, DisruptionChoiceResponse, TripRefreshResponse, FlightStatusResponse,
} from "@mada/shared";
import { db } from "@/db";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as tripsGet } from "@/app/api/app/v1/trips/route";
import { POST as demoPost } from "@/app/api/app/v1/trips/demo/route";
import { GET as tripGet, PATCH as tripPatch } from "@/app/api/app/v1/trips/[id]/route";
import { GET as itinGet } from "@/app/api/app/v1/trips/[id]/itinerary/route";
import { POST as refreshPost } from "@/app/api/app/v1/trips/[id]/refresh/route";
import { GET as paymentsGet } from "@/app/api/app/v1/trips/[id]/payments/route";
import { GET as quoteGet } from "@/app/api/app/v1/trips/[id]/refunds/quote/route";
import { GET as tripRefundsGet, POST as refundPost } from "@/app/api/app/v1/trips/[id]/refunds/route";
import { POST as cancelStayPost } from "@/app/api/app/v1/trips/[id]/stay/cancel/route";
import { GET as changesGet, POST as changesPost } from "@/app/api/app/v1/trips/[id]/changes/route";
import { POST as movePost } from "@/app/api/app/v1/trips/[id]/move/route";
import { GET as asksGet, POST as asksPost } from "@/app/api/app/v1/trips/[id]/requests/route";
import { GET as dzGet, POST as dzPost } from "@/app/api/app/v1/trips/[id]/disruption/route";
import { GET as refundsGet } from "@/app/api/app/v1/refunds/route";
import { GET as refundGet } from "@/app/api/app/v1/refunds/[id]/route";
import { GET as invoiceGet } from "@/app/api/app/v1/invoices/[id]/route";
import { GET as invoiceDocGet } from "@/app/api/app/v1/invoices/[id]/document/route";
import { POST as companyPost } from "@/app/api/app/v1/invoices/[id]/company/route";
import { POST as issuePost } from "@/app/api/app/v1/invoices/[id]/issue/route";
import { GET as trackedGet, POST as trackedPost } from "@/app/api/app/v1/tracked/route";
import { DELETE as trackedDelete } from "@/app/api/app/v1/tracked/[id]/route";
import { POST as trackedImport } from "@/app/api/app/v1/tracked/import/route";
import { GET as statusGet } from "@/app/api/app/v1/flights/[flightNo]/status/route";
import { POST as alertsPost } from "@/app/api/app/v1/flights/alerts/route";
import { GET as notesGet, PATCH as notesPatch } from "@/app/api/app/v1/notifications/route";
import { PATCH as noteOnePatch } from "@/app/api/app/v1/notifications/[id]/route";
import { DELETE as devicesDelete, POST as devicesPost } from "@/app/api/app/v1/devices/route";
import { getBalance } from "@/lib/app/credit";
import { pushOutbox } from "@/lib/app/push";
import { call, freshIp, newPhone, type Handler } from "./helpers";

type P = Record<string, string>;
const withP = <T extends P>(h: (req: Request, ctx: { params: Promise<T> }) => Promise<Response>, params: T): Handler => (req) => h(req, { params: Promise.resolve(params) });

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, userId: r.user.id };
}

/** Calls with an optional demo phase header. */
async function callP(handler: Handler, o: { method?: string; path?: string; body?: unknown; token?: string; phase?: string }) {
  if (!o.phase) return call(handler, o);
  const wrapped: Handler = (req) => {
    const h = new Headers(req.headers);
    h.set(DEMO_PHASE_HEADER, o.phase!);
    return handler(new Request(req.url, { method: req.method, headers: h, body: o.body === undefined ? undefined : JSON.stringify(o.body) }));
  };
  return call(wrapped, { ...o, raw: undefined });
}

const key = () => `k-${Math.random().toString(36).slice(2, 12)}`;

let A: { token: string; userId: string };
let tripId: string;

beforeAll(async () => {
  A = await signIn();
  const r = await call(demoPost, { token: A.token });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  tripId = r.json.tripId;
});

describe("trips: auth and ownership", () => {
  it("needs a signed-in caller everywhere", async () => {
    expect((await call(tripsGet, { method: "GET" })).status).toBe(401);
    expect((await call(withP(tripGet, { id: tripId }), { method: "GET" })).status).toBe(401);
    expect((await call(notesGet, { method: "GET" })).status).toBe(401);
    expect((await call(devicesPost, { body: { pushToken: "ExponentPushToken[abcdefghijkl]", platform: "ios" } })).status).toBe(401);
  });

  it("keeps each trip private: another account gets 404, never the trip", async () => {
    const B = await signIn();
    for (const [h, method] of [[tripGet, "GET"], [itinGet, "GET"], [paymentsGet, "GET"], [quoteGet, "GET"]] as const) {
      const r = await call(withP(h as never, { id: tripId }), { method, token: B.token });
      expect(r.status).toBe(404);
      expect(JSON.stringify(r.json)).not.toContain("Istanbul");
    }
    expect((await call(withP(refundPost, { id: tripId }), { token: B.token, body: { paymentIds: [tripId], reason: "plans", destination: "credit", clientKey: key() } })).status).toBe(404);
    const list = TripsResponse.parse((await call(tripsGet, { method: "GET", token: B.token })).json);
    expect(list.upcoming).toHaveLength(0);
    expect(list.currentId).toBeNull();
  });
});

describe("GET /trips and /trips/{id}", () => {
  it("lists the Istanbul trip as current and Baku as past", async () => {
    const r = TripsResponse.parse((await call(tripsGet, { method: "GET", token: A.token })).json);
    expect(r.currentId).toBe(tripId);
    expect(r.upcoming[0]).toMatchObject({ city: "Istanbul", travellerCount: 4, flight: { code: "SV263", depart: "09:40", oneWay: false } });
    expect(r.past.map((p) => p.city)).toEqual(["Baku"]);
    expect(r.clock.phase).toBe("booked");
  });

  it("is the one source of truth for seats, gate, drivers and the hotel address", async () => {
    const { trip } = TripResponse.parse((await call(withP(tripGet, { id: tripId }), { method: "GET", token: A.token })).json);
    const out = trip.segments.find((s) => s.direction === "out")!;
    expect(out).toMatchObject({ flightNumber: "SV263", terminal: "Terminal 3", gate: "B12", seats: ["14A", "14B", "14C", "14D"] });
    expect(trip.pickups.find((p) => p.direction === "to_airport")).toMatchObject({ driverName: "Khalid", offsetMin: -155 });
    expect(trip.stays[0]).toMatchObject({ name: "Rooms near Galata Tower", address: expect.stringContaining("Galata Kulesi"), phone: "+90 212 000 0000" });
    expect(trip.agent).toMatchObject({ name: "Faisal", initial: "F", online: true });
    expect(trip.prices.total.amount).toBe(8640_00 + 5880_00 + 440_00);
    expect(JSON.stringify(trip)).not.toMatch(/passport_number|numberMasked/);
  });

  it("follows the demo phase header in mock mode: virtual clock and the airline's state", async () => {
    const day = TripResponse.parse((await callP(withP(tripGet, { id: tripId }), { method: "GET", token: A.token, phase: "daybefore" })).json).trip;
    expect(day.clock).toMatchObject({ phase: "daybefore", today: "2027-03-08", demo: true });
    const travel = TripResponse.parse((await callP(withP(tripGet, { id: tripId }), { method: "GET", token: A.token, phase: "travelday" })).json).trip;
    expect(travel.clock.today).toBe("2027-03-09");
    // 42 minutes before Khalid comes at 07:05 Riyadh.
    expect(new Date(travel.clock.now).toISOString()).toBe("2027-03-09T03:23:00.000Z");
    const cancelled = TripResponse.parse((await callP(withP(tripGet, { id: tripId }), { method: "GET", token: A.token, phase: "cancelled" })).json).trip;
    expect(cancelled.segments[0]!.status).toBe("cancelled");
    const bogus = TripResponse.parse((await callP(withP(tripGet, { id: tripId }), { method: "GET", token: A.token, phase: "party" })).json).trip;
    expect(bogus.clock.demo).toBe(false);
  });

  it("PATCH saves the driver's address and the pickup time; rejects nonsense", async () => {
    let r = await call(withP(tripPatch, { id: tripId }), { method: "PATCH", token: A.token, body: { pickupOffsetMin: -140 } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const trip = TripResponse.parse(r.json).trip;
    expect(trip.pickups.find((p) => p.direction === "to_airport")).toMatchObject({ offsetMin: -140, at: "2027-03-09T04:20:00.000Z" });
    r = await call(withP(tripPatch, { id: tripId }), { method: "PATCH", token: A.token, body: { pickupOffsetMin: -60 } });
    expect(r.status).toBe(400);
    r = await call(withP(tripPatch, { id: tripId }), { method: "PATCH", token: A.token, body: { bagReport: "nope" } });
    expect(r.status).toBe(400);
    r = await call(withP(tripPatch, { id: tripId }), { method: "PATCH", token: A.token, body: { bagReport: "ISTSV12345", rating: { hotel: "yes", driver: "great", agent: "great", note: "The kids loved the ferry", send: true } } });
    expect(TripResponse.parse(r.json).trip).toMatchObject({ bagReport: "ISTSV12345", rating: { hotel: "yes", note: "The kids loved the ferry" } });
    await call(withP(tripPatch, { id: tripId }), { method: "PATCH", token: A.token, body: { pickupOffsetMin: -155 } });
  });
});

describe("itinerary", () => {
  it("lays the trip out day by day, with calendar events and a share text without private details", async () => {
    const r = ItineraryResponse.parse((await call(withP(itinGet, { id: tripId }), { method: "GET", token: A.token })).json);
    expect(r.days.map((d) => d.date)).toEqual(["2027-03-09", "2027-03-10", "2027-03-11", "2027-03-12", "2027-03-13", "2027-03-14", "2027-03-15"]);
    const first = r.days[0]!;
    expect(first.title).toBe("You fly to Istanbul");
    expect(first.items.map((i) => i.time)).toEqual(["07:05", "09:40", "14:40", "15:40"]);
    expect(first.items[1]).toMatchObject({ kind: "flight", title: "Riyadh → Istanbul · SV263" });
    expect(r.days[3]!.items[0]!.title).toMatch(/Jumu/); // 12 Mar 2027 is a Friday
    expect(r.events.filter((e) => e.key).length).toBeGreaterThanOrEqual(6);
    expect(r.shareText).toContain("SV263");
    expect(r.shareText).not.toMatch(/X7K2QD|SAR|A08/);
    expect(r.sameTimeAsHome).toBe(true);
  });
});

describe("payments, invoices and company tax invoices", () => {
  it("lists the three payments with their simplified VAT invoices; air fares are zero-rated", async () => {
    const r = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tripId }), { method: "GET", token: A.token })).json);
    expect(r.payments.map((p) => p.item)).toEqual(["flight", "stay", "pickup"]);
    expect(r.payments[1]!.plan).toHaveLength(4);
    expect(r.payments[1]!.plan!.filter((i) => i.paid)).toHaveLength(1);
    const inv = InvoiceResponse.parse((await call(withP(invoiceGet, { id: r.payments[0]!.invoiceId! }), { method: "GET", token: A.token })).json);
    expect(inv.invoice.kind).toBe("simplified");
    expect(inv.invoice.number).toMatch(/^MT-27-\d{6}$/); // paid in 2027 (the demo's booking date)
    const air = inv.invoice.lines[0]!;
    expect(air).toMatchObject({ vatRateBps: 0, vat: 0, gross: 8640_00 - 100_00 });
    expect(inv.invoice.lines[1]).toMatchObject({ text: "Mada service fee", vatRateBps: 1500, gross: 100_00, vat: 13_04 });
    expect(inv.invoice.vat.amount).toBe(13_04);
    expect(Buffer.from(inv.invoice.qr, "base64")[0]).toBe(1);
    expect(inv.html).toContain("Simplified tax invoice");
    const stay = InvoiceResponse.parse((await call(withP(invoiceGet, { id: r.payments[1]!.invoiceId! }), { method: "GET", token: A.token })).json);
    expect(stay.invoice.vat.amount).toBe(766_96); // 15% inside SAR 5,880
    const res = await withP(invoiceDocGet, { id: r.payments[2]!.invoiceId! })(new Request("http://localhost/x", { headers: { authorization: `Bearer ${A.token}` } }));
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Private transfers, 4 rides");
  });

  it("drafts a company tax invoice, validates the VAT number, then issues it with the next TI number", async () => {
    const pays = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tripId }), { method: "GET", token: A.token })).json).payments;
    const id = pays[2]!.invoiceId!;
    let r = await call(withP(companyPost, { id }), { token: A.token, body: { company: { name: "Alharbi Trading", vat: "123", cr: "1010101010", address: "King Fahd Rd, Olaya, Riyadh" } } });
    expect(r.status).toBe(400);
    expect(r.json.error.fields["company.vat"]).toBeTruthy();
    r = await call(withP(companyPost, { id }), { token: A.token, body: { company: { name: "Alharbi Trading", vat: "300000000000003", cr: "1010101010", address: "King Fahd Rd, Olaya, Riyadh" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const draft = InvoiceResponse.parse(r.json).invoice;
    expect(draft).toMatchObject({ kind: "tax", status: "draft", company: { name: "Alharbi Trading" } });
    expect(draft.number).toMatch(/^DRAFT-/);
    r = await call(withP(issuePost, { id: draft.id }), { token: A.token });
    const issued = InvoiceResponse.parse(r.json).invoice;
    expect(issued).toMatchObject({ status: "issued" });
    expect(issued.number).toMatch(/^TI-\d{2}-000001$/);
    expect((await call(withP(issuePost, { id: draft.id }), { token: A.token })).status).toBe(400);
    expect((await call(withP(companyPost, { id }), { token: A.token, body: { company: { name: "Other Co", vat: "300000000000003", cr: "1010101010", address: "King Fahd Rd, Olaya, Riyadh" } } })).status).toBe(400);
    const B = await signIn();
    expect((await call(withP(invoiceGet, { id }), { method: "GET", token: B.token })).status).toBe(404);
  });
});

describe("refunds", () => {
  it("quotes by the fare and hotel rules", async () => {
    const q = RefundQuoteResponse.parse((await call(withP(quoteGet, { id: tripId }), { method: "GET", token: A.token })).json);
    const flight = q.items.find((i) => i.item === "flight")!;
    expect(flight.back.amount).toBe(8640_00 - 400_00 * 4);
    expect(flight.rule).toContain("refund minus SAR 400 per person");
    const stay = q.items.find((i) => i.item === "stay")!;
    // Paid 1 of 4 Tabby instalments: what was paid comes back, the rest is cancelled.
    expect(stay).toMatchObject({ back: { amount: 5880_00 }, cash: { amount: 1470_00 }, cancelled: { count: 3, amount: { amount: 4410_00 } } });
    const cancelled = RefundQuoteResponse.parse((await callP(withP(quoteGet, { id: tripId }), { method: "GET", token: A.token, phase: "cancelled" })).json);
    expect(cancelled.items.find((i) => i.item === "flight")).toMatchObject({ back: { amount: 8640_00 }, law: true });
    const inside = RefundQuoteResponse.parse((await callP(withP(quoteGet, { id: tripId }), { method: "GET", token: A.token, phase: "daybefore" })).json);
    expect(inside.items.find((i) => i.item === "pickup")).toMatchObject({ back: { amount: 0 }, askAnyway: true });
  });

  it("refunds to Mada credit instantly, once per client key, with a credit note", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const pays = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tid }), { method: "GET", token: C.token })).json).payments;
    const pickup = pays.find((p) => p.item === "pickup")!;
    const k = key();
    const r = await call(withP(refundPost, { id: tid }), { token: C.token, body: { paymentIds: [pickup.id], reason: "plans", destination: "credit", clientKey: k } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const refund = RefundResponse.parse(r.json).refund;
    expect(refund).toMatchObject({ amount: { amount: 440_00 }, stage: "sent", destination: "credit" });
    expect(await getBalance(C.userId)).toBe(440_00);
    const again = RefundResponse.parse((await call(withP(refundPost, { id: tid }), { token: C.token, body: { paymentIds: [pickup.id], reason: "plans", destination: "credit", clientKey: k } })).json).refund;
    expect(again.id).toBe(refund.id);
    expect(await getBalance(C.userId)).toBe(440_00);
    expect((await call(withP(refundPost, { id: tid }), { token: C.token, body: { paymentIds: [pickup.id], reason: "plans", destination: "credit", clientKey: key() } })).status).toBe(400);
    const after = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tid }), { method: "GET", token: C.token })).json).payments.find((p) => p.item === "pickup")!;
    expect(after.refunded?.amount).toBe(440_00);
    const cn = InvoiceResponse.parse((await call(withP(invoiceGet, { id: after.creditNoteId! }), { method: "GET", token: C.token })).json).invoice;
    expect(cn).toMatchObject({ kind: "credit_note", againstNumber: after.invoiceNumber });
    expect(cn.number).toMatch(/^CN-\d{2}-\d{6}$/);
    expect(RefundResponse.parse((await call(withP(refundGet, { id: refund.id }), { method: "GET", token: C.token })).json).refund.id).toBe(refund.id);
    expect((await call(withP(refundGet, { id: refund.id }), { method: "GET", token: A.token })).status).toBe(404);
    const audit = await db.execute<{ action: string }>(rawSql`SELECT action FROM app_audit WHERE actor_id = ${C.userId} AND action LIKE 'refund.%'`);
    expect(audit.length).toBeGreaterThan(0);
  });

  it("asks anyway when the rules give nothing back, then the desk answers with a reason", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const pays = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tid }), { method: "GET", token: C.token })).json).payments;
    const pickup = pays.find((p) => p.item === "pickup")!;
    const r = await callP(withP(refundPost, { id: tid }), { token: C.token, phase: "daybefore", body: { paymentIds: [pickup.id], reason: "plans", destination: "credit", clientKey: key() } });
    const refund = RefundResponse.parse(r.json).refund;
    expect(refund).toMatchObject({ anyway: true, stage: "requested", reject: null });
    await db.execute(rawSql`UPDATE app_refund_groups SET created_at = now() - interval '10 seconds' WHERE id = ${refund.id}`);
    const later = RefundResponse.parse((await call(withP(refundGet, { id: refund.id }), { method: "GET", token: C.token })).json).refund;
    expect(later.stage).toBe("rejected");
    expect(later.reject).toContain("Khalid");
    expect(await getBalance(C.userId)).toBe(0);
  });

  it("cancels the stay: Tabby payments stop, the stay shows cancelled, and the tracker starts", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const r = await call(withP(cancelStayPost, { id: tid }), { token: C.token, body: { clientKey: key() } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(RefundResponse.parse(r.json).refund).toMatchObject({ destination: "instalments", amount: { amount: 1470_00 }, cancelledInstalments: { count: 3 } });
    const { trip } = TripResponse.parse((await call(withP(tripGet, { id: tid }), { method: "GET", token: C.token })).json);
    expect(trip.stays[0]!.status).toBe("cancelled");
    expect((await call(withP(cancelStayPost, { id: tid }), { token: C.token, body: { clientKey: key() } })).status).toBe(400);
    expect((await call(withP(tripRefundsGet, { id: tid }), { method: "GET", token: C.token })).json.refunds).toHaveLength(1);
    expect((await call(refundsGet, { method: "GET", token: C.token })).json.refunds).toHaveLength(1);
  });
});

describe("changing a flight and moving the hotel and pickup", () => {
  it("offers days around the booked dates and moves the flight a day later at no cost", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const opts = ChangeOptionsResponse.parse((await call(withP(changesGet, { id: tid }), { method: "GET", path: "/api/app/v1/trips/x/changes?kind=date", token: C.token })).json);
    expect(opts.options.map((o) => o.id)).toEqual(["dm1", "dp1", "dp2"]);
    expect(opts.fare.changeFee).toBe(300_00);
    // A day later: fare the same, but the change fee is SAR 300 × 4 → a quote.
    let r = ChangeFlightResponse.parse((await call(withP(changesPost, { id: tid }), { token: C.token, body: { kind: "date", optionId: "dp1", clientKey: key() } })).json);
    expect(r).toMatchObject({ result: "quoted", total: 1200_00 });
    expect(r.request.status).toBe("awaiting_payment");
    // An earlier, cheaper time on the same day: the difference comes back as credit and the driver follows.
    r = ChangeFlightResponse.parse((await call(withP(changesPost, { id: tid }), { token: C.token, body: { kind: "time", optionId: "t1", clientKey: key() } })).json);
    expect(r.result).toBe("done");
    expect(r.total).toBe(300_00 * 4 - 380_00 * 4);
    expect(await getBalance(C.userId)).toBe(320_00);
    expect(r.trip.segments[0]).toMatchObject({ flightNumber: "SV261", departLocal: "2027-03-09T06:30" });
    expect(r.trip.pickups.find((p) => p.direction === "to_airport")!.at).toBe("2027-03-09T00:55:00.000Z");
    expect((await call(withP(changesPost, { id: tid }), { token: C.token, body: { kind: "date", optionId: "dp2", clientKey: key() } })).status).toBe(400);
  });

  it("refuses changes inside 24 hours (Mada calls instead) and when the airline cancelled", async () => {
    const r = await callP(withP(changesPost, { id: tripId }), { token: A.token, phase: "travelday", body: { kind: "time", optionId: "t2", clientKey: key() } });
    expect(r.status).toBe(400);
    expect(r.json.error.message).toContain("by phone");
    expect((await callP(withP(changesPost, { id: tripId }), { token: A.token, phase: "cancelled", body: { kind: "time", optionId: "t2", clientKey: key() } })).status).toBe(400);
  });

  it("after a date change, moves the hotel and pickup to the new day (fewer nights come back)", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    await db.execute(rawSql`UPDATE app_segments SET depart_local = depart_local + interval '1 day', arrive_local = arrive_local + interval '1 day' WHERE trip_id = ${tid} AND direction = 'out'`);
    const before = TripResponse.parse((await call(withP(tripGet, { id: tid }), { method: "GET", token: C.token })).json);
    expect(before.move).toMatchObject({ from: "2027-03-09", to: "2027-03-10", hotel: { newNights: 5, diff: -980_00, back: 980_00 }, pickup: { driver: "Khalid" } });
    const r = MoveResponse.parse((await call(withP(movePost, { id: tid }), { token: C.token, body: { hotel: true, pickup: true } })).json);
    expect(r.back).toBe(980_00);
    expect(r.move).toBeNull();
    expect(r.trip.stays[0]).toMatchObject({ checkIn: "2027-03-10", nights: 5 });
    expect((await call(withP(movePost, { id: tid }), { token: C.token, body: { hotel: true, pickup: true } })).status).toBe(400);
  });
});

describe("special requests and hotel options", () => {
  it("prices on the server, moves through the mock desk, and is sent once per key", async () => {
    const k = key();
    let r = await call(withP(asksPost, { id: tripId }), { token: A.token, body: { area: "special", kind: "wheelchair", option: "gate", clientKey: k } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const req = TripAskResponse.parse(r.json).request!;
    expect(req).toMatchObject({ title: "Wheelchair to the gate", withWhom: "airline", withName: "Saudia", status: "sent" });
    r = await call(withP(asksPost, { id: tripId }), { token: A.token, body: { area: "special", kind: "wheelchair", option: "gate", clientKey: k } });
    expect(TripAskResponse.parse(r.json).request!.id).toBe(req.id);
    await db.execute(rawSql`UPDATE app_requests SET created_at = now() - interval '13 seconds' WHERE id = ${req.id}`);
    const list = (await call(withP(asksGet, { id: tripId }), { method: "GET", token: A.token })).json.requests as { id: string; status: string; outcome: string }[];
    expect(list.find((x) => x.id === req.id)).toMatchObject({ status: "confirmed", outcome: "yes" });
    const bags = TripAskResponse.parse((await call(withP(asksPost, { id: tripId }), { token: A.token, body: { area: "special", kind: "bags", count: 2, clientKey: key() } })).json).request!;
    expect(bags).toMatchObject({ status: "quoted", quote: { amount: 250_00 * 2 * 2 } });
    expect((await call(withP(asksPost, { id: tripId }), { token: A.token, body: { area: "special", kind: "bassinet", clientKey: key() } })).status).toBe(400);
    expect((await call(withP(asksPost, { id: tripId }), { token: A.token, body: { area: "special", kind: "rocket", clientKey: key() } })).status).toBe(400);
  });

  it("leaves a night sooner inside the free window and the night comes back", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const r = TripAskResponse.parse((await call(withP(asksPost, { id: tid }), { token: C.token, body: { area: "hotel", kind: "nights", option: "cut", clientKey: key() } })).json);
    expect(r.say).toContain("SAR 980");
    expect(r.trip.stays[0]!.nights).toBe(5);
  });
});

describe("travel day: status refresh, disruption, notifications and devices", () => {
  it("moves the gate on a demo travel day, tells the traveller once, and pushes to the phone", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    expect((await call(devicesPost, { token: C.token, body: { pushToken: "not-a-token-at-all", platform: "ios" } })).status).toBe(400);
    const d = await call(devicesPost, { token: C.token, body: { pushToken: `ExponentPushToken[${C.userId.slice(0, 12)}]`, platform: "ios", name: "Test phone" } });
    expect(d.status, JSON.stringify(d.json)).toBe(201);
    const r = TripRefreshResponse.parse((await callP(withP(refreshPost, { id: tid }), { token: C.token, phase: "travelday" })).json);
    expect(r.changes).toEqual([expect.objectContaining({ kind: "gate", from: "B12", to: "C4" })]);
    expect(r.trip.segments[0]).toMatchObject({ gate: "C4", bookedGate: "B12" });
    const again = TripRefreshResponse.parse((await callP(withP(refreshPost, { id: tid }), { token: C.token, phase: "travelday" })).json);
    expect(again.changes).toHaveLength(0);
    await new Promise((res) => setTimeout(res, 50));
    expect(pushOutbox.some((p) => p.to.includes(C.userId.slice(0, 12)) && p.title === "Gate changed to C4")).toBe(true);
    const inbox = (await call(notesGet, { method: "GET", token: C.token })).json;
    expect(inbox.unread).toBe(1);
    expect(inbox.items[0]).toMatchObject({ kind: "gate_change", title: "Gate changed to C4" });
    const one = await call(withP(noteOnePatch, { id: inbox.items[0].id }), { method: "PATCH", token: C.token, body: { read: true } });
    expect(one.json.notification.readAt).toBeTruthy();
    expect((await call(withP(noteOnePatch, { id: inbox.items[0].id }), { method: "PATCH", token: A.token, body: { read: true } })).status).toBe(404);
    const all = await call(notesPatch, { method: "PATCH", token: C.token, body: { all: true } });
    expect(all.json.unread).toBe(0);
    expect((await call(devicesDelete, { method: "DELETE", token: C.token, body: { pushToken: `ExponentPushToken[${C.userId.slice(0, 12)}]` } })).status).toBe(200);
  });

  it("offers rebooking or a refund on a cancellation; a rebooking moves the flight and pickups, once", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const opts = DisruptionResponse.parse((await callP(withP(dzGet, { id: tid }), { method: "GET", path: "/api/app/v1/trips/x/disruption?kind=cancel", token: C.token, phase: "cancelled" })).json);
    expect(opts.headline).toBe("Saudia cancelled SV263.");
    expect(opts.options.map((o) => o.id)).toEqual(["next", "xy", "refund"]);
    expect(opts.refundAmount.amount).toBe(14_960_00);
    const k = key();
    const r = DisruptionChoiceResponse.parse((await callP(withP(dzPost, { id: tid }), { token: C.token, phase: "cancelled", body: { kind: "cancel", optionId: "xy", clientKey: k } })).json);
    expect(r).toMatchObject({ kind: "rebook", headline: "Done. All 4 of you are on XY125." });
    expect(r.trip!.segments[0]).toMatchObject({ flightNumber: "XY125", to: "SAW", departLocal: "2027-03-09T10:25" });
    expect(r.trip!.rebooked).toBe(true);
    expect(r.trip!.pickups.find((p) => p.direction === "to_airport")!.at).toBe("2027-03-09T04:50:00.000Z");
    const again = DisruptionChoiceResponse.parse((await callP(withP(dzPost, { id: tid }), { token: C.token, phase: "cancelled", body: { kind: "cancel", optionId: "xy", clientKey: k } })).json);
    expect(again.headline).toBe(r.headline);
    expect((await call(withP(dzGet, { id: tripId }), { method: "GET", token: A.token })).status).toBe(404);
  });

  it("takes the whole trip back as a refund at the night desk under GACA rules", async () => {
    const C = await signIn();
    const tid = (await call(demoPost, { token: C.token })).json.tripId;
    const opts = DisruptionResponse.parse((await callP(withP(dzGet, { id: tid }), { method: "GET", path: "/api/app/v1/trips/x/disruption?kind=night", token: C.token, phase: "cancelled" })).json);
    expect(opts.agent.line).toContain("night desk");
    expect(opts.tonight).toHaveLength(3);
    const r = DisruptionChoiceResponse.parse((await callP(withP(dzPost, { id: tid }), { token: C.token, phase: "cancelled", body: { kind: "night", optionId: "refund", clientKey: key() } })).json);
    expect(r.kind).toBe("refund");
    expect(r.refund).toMatchObject({ law: true, amount: { amount: 8640_00 + 1470_00 + 440_00 } });
    const list = TripsResponse.parse((await call(tripsGet, { method: "GET", token: C.token })).json);
    expect(list.currentId).toBeNull();
  });
});

describe("tracked flights", () => {
  it("tracks a flight with alerts, carries guest flights over at sign-up, and stops", async () => {
    const C = await signIn();
    const r = await call(trackedPost, { token: C.token, body: { flightNumber: "SV263", date: "2027-01-05", alerts: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    expect(r.json.flight).toMatchObject({ flightNumber: "SV263", from: "RUH", to: "IST", known: true, alerts: true });
    expect((await call(trackedPost, { token: C.token, body: { flightNumber: "SV263", date: "2020-01-05", alerts: true } })).status).toBe(400);
    expect((await call(trackedPost, { token: C.token, body: { flightNumber: "nope", date: "2027-01-05", alerts: true } })).status).toBe(400);
    const imported = TrackedResponse.parse((await call(trackedImport, { token: C.token, body: { flights: [{ flightNumber: "XY125", date: "2027-01-06", alerts: false }, { flightNumber: "ZZ9", date: "2027-01-06", alerts: false }] } })).json);
    expect(imported.flights.map((f) => f.flightNumber)).toEqual(["SV263", "XY125", "ZZ9"]);
    expect(imported.flights[2]!.known).toBe(false);
    const B = await signIn();
    expect((await call(withP(trackedDelete, { id: imported.flights[0]!.id }), { method: "DELETE", token: B.token })).status).toBe(404);
    expect((await call(withP(trackedDelete, { id: imported.flights[0]!.id }), { method: "DELETE", token: C.token })).status).toBe(200);
    expect(TrackedResponse.parse((await call(trackedGet, { method: "GET", token: C.token })).json).flights).toHaveLength(2);
  });

  it("looks up a flight's status for guests, limited per network", async () => {
    const st = (no: string, ip?: string, token?: string) => call(withP(statusGet, { flightNo: no }), { method: "GET", path: `/api/app/v1/flights/${no}/status?date=2027-01-05`, ip, token });
    const r = FlightStatusResponse.parse((await st("SV263", freshIp())).json);
    expect(r.flight).toMatchObject({ from: "RUH", to: "IST", departLocal: "2027-01-05T09:40", durationMin: 255 });
    expect(FlightStatusResponse.parse((await st("ZZ12", freshIp())).json).flight).toBeNull();
    expect((await st("bad!", freshIp())).status).toBe(400);
    const ip = freshIp();
    let last = 200;
    for (let i = 0; i < 31; i += 1) last = (await st("SV263", ip)).status;
    expect(last).toBe(429);
  });

  it("takes FlightAware alerts only with the shared secret, and applies them to trips and tracked flights", async () => {
    const prev = process.env.FLIGHT_ALERTS_SECRET;
    delete process.env.FLIGHT_ALERTS_SECRET;
    expect((await call(alertsPost, { body: { flightNumber: "SV263", date: "2027-03-09", gate: "A1" } })).status).toBe(501);
    process.env.FLIGHT_ALERTS_SECRET = "s3cret-for-the-alerts-relay";
    try {
      const send = (secret: string, b: unknown) => call((req) => { const h = new Headers(req.headers); h.set("x-mada-alerts-secret", secret); return alertsPost(new Request(req.url, { method: "POST", headers: h, body: JSON.stringify(b) })); }, { body: b });
      expect((await send("wrong-secret-value-here", { flightNumber: "SV263", date: "2027-03-09", gate: "A1" })).status).toBe(401);
      const C = await signIn();
      const tid = (await call(demoPost, { token: C.token })).json.tripId;
      const r = await send("s3cret-for-the-alerts-relay", { flightNumber: "SV263", date: "2027-03-09", status: "delayed", delayMin: 95, gate: "D7" });
      expect(r.status, JSON.stringify(r.json)).toBe(200);
      expect(r.json.segments).toBeGreaterThanOrEqual(1);
      const { trip } = TripResponse.parse((await call(withP(tripGet, { id: tid }), { method: "GET", token: C.token })).json);
      expect(trip.segments[0]).toMatchObject({ gate: "D7", status: "delayed", delayMin: 95 });
      const notes = (await call(notesGet, { method: "GET", token: C.token })).json.items as { kind: string }[];
      expect(notes.map((n) => n.kind).sort()).toEqual(["flight_delayed", "gate_change"]);
    } finally {
      process.env.FLIGHT_ALERTS_SECRET = prev;
    }
  });
});
