import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { CreateOrderResponse, FlightSearchResponse, PreviewResponse, StaySearchResponse, type OrderDraft } from "@mada/shared";
import { db } from "@/db";
import { appSegments, appStays, appTrips } from "@/db/app-schema";
import { appOrders } from "@/db/app-schema-booking";
import { advance, ownOrder } from "@/lib/app/booking/orders";
import { POST as searchFlights } from "@/app/api/app/v1/search/flights/route";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as previewPost } from "@/app/api/app/v1/orders/preview/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { GET as peopleGet } from "@/app/api/app/v1/people/route";
import { callP, signIn } from "./wallet-helpers";

/* The way home on its own: a one-way search from the destination (direction "back"), a different airline or day than
   the way out, booked as its own order; the flight out, the hotel and the way home land in one trip. */

const OUT = "2027-04-08";
const HOME = "2027-04-13";
const post = (h: Parameters<typeof callP>[0], token: string, body: unknown) => callP(h, {}, { method: "POST", token, body });

async function book(token: string, draft: OrderDraft, n: number) {
  const p = PreviewResponse.parse((await post(previewPost, token, { draft })).json).preview;
  const r = await post(ordersPost, token, { draft, payment: { method: "applepay", token: `applepay_mock_token_h${n}` }, plan: "full", expectedTotal: p.total.amount, idempotencyKey: `home-${n}-${Math.random().toString(36).slice(2)}` });
  const out = CreateOrderResponse.parse(r.json);
  if (out.outcome !== "created") throw new Error(out.outcome);
  return { preview: p, order: out.order };
}

async function runDesk(orderId: string) {
  const owner = (await db.select({ o: appOrders.ownerId }).from(appOrders).where(eq(appOrders.id, orderId)))[0]!.o;
  let o = await ownOrder(owner, orderId);
  for (let s = 2; s <= 30; s += 2) o = await advance(o, new Date(Date.now() + s * 1000));
  return o;
}

describe("one way home, from the destination", () => {
  it("searches home from the destination, refuses a return with it, and books out, hotel and home into one trip", async () => {
    const { token } = await signIn();
    const me = ((await callP(peopleGet, {}, { method: "GET", token })).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;

    const outR = await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: OUT, return: null, travellerIds: [me] });
    expect(outR.status, JSON.stringify(outR.json)).toBe(200);
    const out = FlightSearchResponse.parse(outR.json);
    expect(out.options[0]!.out).toMatchObject({ from: "RUH", to: "IST" });
    expect(out.options[0]!.back).toBeNull();

    const homeR = await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: HOME, return: null, direction: "back", travellerIds: [me] });
    expect(homeR.status, JSON.stringify(homeR.json)).toBe(200);
    const home = FlightSearchResponse.parse(homeR.json);
    expect(home.direction).toBe("back");
    expect(home.options.length).toBeGreaterThan(1);
    for (const o of home.options) { expect(o.out.to).toBe("RUH"); expect(o.out.date).toBe(HOME); expect(o.back).toBeNull(); }
    expect(home.options.map((o) => o.out.from).sort()).toEqual(expect.arrayContaining(["IST"]));

    const bad = await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: OUT, return: HOME, direction: "back", travellerIds: [me] });
    expect(bad.status).toBe(400);

    // Out on Saudia, home on the other airline.
    const outOffer = out.options.find((o) => o.carrier === "SV")!;
    const homeOffer = home.options.find((o) => o.carrier !== "SV")!;
    const a = await book(token, { kind: "trip", flightOfferId: outOffer.id, bundle: false, travellerIds: [me] }, 1);
    const b = await book(token, { kind: "trip", flightOfferId: homeOffer.id, bundle: false, travellerIds: [me] }, 2);
    expect(b.preview.title).toContain("Istanbul");
    const st = StaySearchResponse.parse((await post(searchStays, token, { destination: "istanbul", checkIn: OUT, nights: 5, travellerIds: [me] })).json);
    const c = await book(token, { kind: "stay", stayOfferId: st.options[0]!.id, travellerIds: [me] }, 3);

    const done = [await runDesk(a.order.id), await runDesk(b.order.id), await runDesk(c.order.id)];
    expect(done.map((o) => o.status)).toEqual(["confirmed", "confirmed", "confirmed"]);
    expect(new Set(done.map((o) => o.tripId)).size).toBe(1);

    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, done[0]!.tripId!));
    expect(trip).toMatchObject({ city: "Istanbul", startDate: OUT, endDate: HOME, status: "booked" });
    const segs = await db.select().from(appSegments).where(eq(appSegments.tripId, trip!.id));
    expect(segs.map((x) => [x.direction, x.toAirport]).sort()).toEqual([["back", "RUH"], ["out", "IST"]]);
    expect(segs.find((x) => x.direction === "back")!.carrier).not.toBe("SV");
    expect(await db.select().from(appStays).where(eq(appStays.tripId, trip!.id))).toHaveLength(1);
  });

  it("keeps an unrelated trip apart: another city, or dates that don't meet", async () => {
    const { token } = await signIn();
    const me = ((await callP(peopleGet, {}, { method: "GET", token })).json.people as { id: string; isSelf: boolean }[]).find((p) => p.isSelf)!.id;
    const first = FlightSearchResponse.parse((await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: "2027-05-02", return: "2027-05-06", travellerIds: [me] })).json);
    const later = FlightSearchResponse.parse((await post(searchFlights, token, { from: "RUH", destination: "istanbul", depart: "2027-06-10", return: "2027-06-14", travellerIds: [me] })).json);
    const x = await book(token, { kind: "trip", flightOfferId: first.options[0]!.id, bundle: false, travellerIds: [me] }, 4);
    const y = await book(token, { kind: "trip", flightOfferId: later.options[0]!.id, bundle: false, travellerIds: [me] }, 5);
    const [ox, oy] = [await runDesk(x.order.id), await runDesk(y.order.id)];
    expect(ox.tripId).not.toBe(oy.tripId);
  });
});
