import { afterEach, describe, expect, it } from "vitest";
import { RIDE_MATCH_MS, RideResponse } from "@mada/shared";
import { POST as ridesPost } from "@/app/api/app/v1/rides/route";
import { GET as rideGet } from "@/app/api/app/v1/rides/[id]/route";
import { POST as cancelPost } from "@/app/api/app/v1/rides/[id]/cancel/route";
import { call } from "./helpers";
import { callP, signIn } from "./wallet-helpers";

/* A car right now (critique 4): requesting → a driver with name, car, plate, meeting point and price → cancel; none where no car is free. */

afterEach(() => { delete process.env.SUPPLIER_MODE_RIDES; });
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const body = (over: Record<string, unknown> = {}) => ({ when: "now", city: "Riyadh", meetingPoint: "At the Rosewood lobby", clientKey: `ride-${crypto.randomUUID()}`, ...over });

describe("a car right now", () => {
  it("finds a driver, shows everything the traveller needs, and cancels for free", async () => {
    const { token } = await signIn();
    const b = body();
    const made = await call(ridesPost, { token, body: b });
    expect(made.status, JSON.stringify(made.json)).toBe(201);
    const { ride } = RideResponse.parse(made.json);
    expect(ride).toMatchObject({ status: "requesting", supplier: "mock", meetingPoint: "At the Rosewood lobby" });
    // A retry with the same key is the same car.
    expect(RideResponse.parse((await call(ridesPost, { token, body: b })).json).ride.id).toBe(ride.id);
    await wait(RIDE_MATCH_MS + 200);
    const got = RideResponse.parse((await callP(rideGet, { id: ride.id }, { token })).json).ride;
    expect(got.status).toBe("assigned");
    expect(got.driver).toMatchObject({ name: expect.any(String), plate: expect.any(String), car: expect.any(String) });
    expect(got.price?.amount).toBe(3800);
    expect(got.pickupAt).toBeTruthy();
    const other = await signIn();
    expect((await callP(rideGet, { id: ride.id }, { token: other.token })).status).toBe(404);
    const off = await callP(cancelPost, { id: ride.id }, { method: "POST", token, body: {} });
    expect(RideResponse.parse(off.json).ride.status).toBe("cancelled");
  }, 20_000);

  it("says no car is free where the supplier has none, and when no supplier is connected", async () => {
    const { token } = await signIn();
    const { ride } = RideResponse.parse((await call(ridesPost, { token, body: body({ city: "Abha", when: "in15" }) })).json);
    await wait(RIDE_MATCH_MS + 200);
    expect(RideResponse.parse((await callP(rideGet, { id: ride.id }, { token })).json).ride).toMatchObject({ status: "none", driver: null, cancellable: false });
    process.env.SUPPLIER_MODE_RIDES = "live";
    const live = RideResponse.parse((await call(ridesPost, { token, body: body() })).json).ride;
    expect(live).toMatchObject({ status: "none", supplier: "none" });
  }, 20_000);
});
