import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { LivingPlanResponse, PlanChangeResponse, SignInResponse, TripsResponse, type Person } from "@mada/shared";
import { db } from "@/db";
import { appPeople, appStays, appTrips } from "@/db/app-schema";
import { appPlanEvents, appPlanItems } from "@/db/app-schema-plans";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as tripsGet } from "@/app/api/app/v1/trips/route";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planGet, POST as planPost } from "@/app/api/app/v1/trips/[id]/plan/route";
import { POST as opsPost } from "@/app/api/app/v1/trips/[id]/plan/ops/route";
import { PUT as originPut } from "@/app/api/app/v1/trips/[id]/plan/origin/route";
import { POST as itemsPost } from "@/app/api/app/v1/trips/[id]/plan/items/route";
import { DELETE as itemDelete, PATCH as itemPatch } from "@/app/api/app/v1/trips/[id]/plan/items/[itemId]/route";
import { GET as eventsGet } from "@/app/api/app/v1/trips/[id]/plan/events/route";
import { computeChecks } from "@/lib/app/plans/checks";
import { emit } from "@/lib/app/plans/events";
import { buildFromShape, buildFromTemplate, deriveStatus, matchBookings, type Bookings } from "@/lib/app/plans/plans";
import { resolvePlace } from "@/lib/app/plans/places";
import { TEMPLATES } from "@/lib/app/plans/templates";
import { seedDemoTrip } from "@/lib/app/trips/seed";
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

const JED = resolvePlace({ name: "JED", code: "JED" })!;
const RUH = resolvePlace({ name: "Riyadh" })!;
const START = "2027-11-18";

/* ───────────── pure: building, statuses, checks ───────────── */

describe("building a plan", () => {
  it("a template from Jeddah: the first leg is JED → ULH, with no time (the sample's 07:30 was for Riyadh)", () => {
    const { items, days } = buildFromTemplate(TEMPLATES.alula2!, START, JED, JED);
    expect(days).toBe(2);
    const out = items.find((i) => i.originLeg === "out")!;
    expect(out).toMatchObject({ day: 0, kind: "leg", mode: "flight", title: "Jeddah → AlUla", startsAt: null, note: null });
    expect(out.fromPlace?.code).toBe("JED");
    expect(out.toPlace?.code).toBe("ULH");
    const home = items.find((i) => i.originLeg === "home")!;
    expect(home).toMatchObject({ day: 1, title: "AlUla → Jeddah", startsAt: null });
    // The day's own stops keep the sample's times: those are curated, not invented.
    expect(items.find((i) => i.title === "Hegra guided tour")?.startsAt).toBe("2027-11-19T09:00");
    expect(items[0]).toBe(out);
  });

  it("from Riyadh it keeps the sample's flight time and note", () => {
    const { items } = buildFromTemplate(TEMPLATES.alula2!, START, RUH, RUH);
    expect(items.find((i) => i.originLeg === "out")).toMatchObject({ title: "Riyadh → AlUla", startsAt: "2027-11-18T07:30" });
    expect(items.find((i) => i.originLeg === "home")).toMatchObject({ startsAt: "2027-11-19T19:40" });
  });

  it("a road trip from a shape: flights at the ends, drives between, no km or time invented, stays per stop", () => {
    const stops = [{ place: resolvePlace({ name: "Singapore" })!, nights: 2 }, { place: resolvePlace({ name: "Melaka" })!, nights: 1 }, { place: resolvePlace({ name: "Kuala Lumpur" })!, nights: 3 }];
    const { items, days, kind } = buildFromShape({ stops, start: START, origin: RUH, returnTo: RUH, travelMode: "mixed" });
    expect(days).toBe(7);
    expect(kind).toBe("road");
    const legs = items.filter((i) => i.kind === "leg");
    expect(legs.map((l) => [l.day, l.mode, l.title])).toEqual([[0, "flight", "Riyadh → Singapore"], [2, "drive", "Singapore → Melaka"], [3, "drive", "Melaka → Kuala Lumpur"], [6, "flight", "Kuala Lumpur → Riyadh"]]);
    expect(legs.every((l) => !l.startsAt && !l.drive)).toBe(true);
    expect(items.filter((i) => i.kind === "stay").map((s) => [s.day, s.nights])).toEqual([[0, 2], [2, 1], [3, 3]]);
  });

  it("no origin: no legs out or home (the plan asks where the trip starts)", () => {
    const { items } = buildFromTemplate(TEMPLATES.alula2!, START, null, null);
    expect(items.some((i) => i.originLeg)).toBe(false);
  });
});

const NO_BOOKINGS: Bookings = { stays: [], segments: [], pickups: [], esims: [], orders: new Map(), requests: new Map(), offers: new Map() };
const stayRow = (o: Partial<typeof appStays.$inferSelect>) => ({
  id: "00000000-0000-4000-8000-000000000001", tripId: "t", name: "Habitas AlUla", area: null, address: null, checkIn: START, nights: 1, rooms: 1, price: 0, cancellation: null,
  status: "booked", confirmation: "MT1234", supplier: null, supplierRef: null, createdAt: new Date(), updatedAt: new Date(), ...o,
}) as typeof appStays.$inferSelect;
const item = (o: Partial<typeof appPlanItems.$inferSelect>) => ({
  id: "00000000-0000-4000-8000-0000000000aa", kind: "stay", mode: null, day: 0, nights: 1, fromPlace: null, toPlace: null, bookingKind: null, bookingId: null, requestId: null, offerId: null,
  status: "idea", statusNote: null, deletedAt: null, ...o,
}) as typeof appPlanItems.$inferSelect;

describe("statuses read from bookings", () => {
  it("a stay on the item's nights links to it; the booking row decides booked, held, confirmed or cancelled", () => {
    const it0 = item({});
    const b = { ...NO_BOOKINGS, stays: [stayRow({})] };
    const links = matchBookings([it0], b, START);
    expect(links.get(it0.id)).toEqual({ kind: "stay", id: b.stays[0]!.id });
    const link = links.get(it0.id)!;
    expect(deriveStatus(it0, b, link)).toMatchObject({ status: "booked", line: "Booked · Habitas AlUla", booking: { kind: "stay", name: "Habitas AlUla", ref: "MT1234" } });
    expect(deriveStatus(it0, { ...b, stays: [stayRow({ status: "held" })] }, link).status).toBe("held");
    expect(deriveStatus(it0, { ...b, stays: [stayRow({ supplierRef: "HB-1" })] }, link).status).toBe("confirmed");
    expect(deriveStatus(it0, { ...b, stays: [stayRow({ status: "cancelled" })] }, link).status).toBe("cancelled");
  });

  it("a stay on other nights doesn't match; one booking fulfils one item", () => {
    const b = { ...NO_BOOKINGS, stays: [stayRow({ checkIn: "2027-11-25" })] };
    expect(matchBookings([item({})], b, START).size).toBe(0);
    const two = [item({ id: "00000000-0000-4000-8000-0000000000a1" }), item({ id: "00000000-0000-4000-8000-0000000000a2" })];
    expect(matchBookings(two, { ...NO_BOOKINGS, stays: [stayRow({})] }, START).size).toBe(1);
  });

  it("an item never claims more than its booking: priced needs a live offer, requested a live request", () => {
    const now = new Date("2027-01-01T10:00:00Z");
    const offerId = "00000000-0000-4000-8000-0000000000f1";
    const priced = item({ offerId, status: "priced" });
    expect(deriveStatus(priced, { ...NO_BOOKINGS, offers: new Map([[offerId, { expiresAt: new Date("2027-01-01T11:00:00Z") }]]) }, null, now).status).toBe("priced");
    expect(deriveStatus(priced, { ...NO_BOOKINGS, offers: new Map([[offerId, { expiresAt: new Date("2027-01-01T09:00:00Z") }]]) }, null, now)).toMatchObject({ status: "idea", line: "Price expired, check again" });
    expect(deriveStatus(item({ status: "confirmed" }), NO_BOOKINGS, null).status).toBe("confirmed"); // cached by the desk, kept
    expect(deriveStatus(item({ status: "requested" }), NO_BOOKINGS, null).status).toBe("idea");
    const requestId = "00000000-0000-4000-8000-0000000000e1";
    expect(deriveStatus(item({ requestId }), { ...NO_BOOKINGS, requests: new Map([[requestId, { status: "sent" }]]) }, null).status).toBe("requested");
    expect(deriveStatus(item({ requestId }), { ...NO_BOOKINGS, requests: new Map([[requestId, { status: "cancelled" }]]) }, null).status).toBe("idea");
    expect(deriveStatus(item({ status: "skipped", bookingKind: "stay", bookingId: "x" }), NO_BOOKINGS, null).status).toBe("skipped");
  });
});

const person = (o: Partial<Person>): Person => ({
  id: "00000000-0000-4000-8000-00000000000" + (o.firstName?.length ?? 1), isSelf: false, givenNames: o.firstName ?? "Omar", surname: "Alharbi", firstName: "Omar", relation: "spouse",
  dateOfBirth: null, sex: null, nationality: "SAU", passport: null, createdAt: new Date().toISOString(), ...o,
});
const passport = (expiry: string, nationality = "SAU") => ({ numberMasked: "•••482", issuingCountry: nationality, nationality, expiry, source: "manual" as const, updatedAt: new Date().toISOString() });

describe("whole-trip checks", () => {
  const base = { startDate: "2027-03-09", endDate: "2027-03-12", days: 4, countries: ["TR"], originCountry: "SA", esims: [], noStay: false };
  it("passports: missing, expiring before the destination's rule, or fine", () => {
    const omar = person({ firstName: "Omar", passport: passport("2031-06-22") });
    const sara = person({ firstName: "Sara", passport: passport("2027-07-02") });
    const ahmed = person({ firstName: "Ahmed" });
    const warn = computeChecks({ ...base, items: [], travellers: [omar, sara] }).find((c) => c.key === "passports")!;
    expect(warn.state).toBe("warn");
    expect(warn.who).toEqual([sara.id]);
    expect(warn.text).toContain("Sara's passport expires 2 Jul 2027");
    expect(computeChecks({ ...base, items: [], travellers: [omar, ahmed] }).find((c) => c.key === "passports")).toMatchObject({ state: "todo", text: "No passport on file for Ahmed." });
    expect(computeChecks({ ...base, items: [], travellers: [omar] }).find((c) => c.key === "passports")?.state).toBe("ok");
  });

  it("visa from the rule table: a Saudi passport to Türkiye is fine, a Philippine one needs an e-Visa, an unknown country is unknown", () => {
    const omar = person({ firstName: "Omar", passport: passport("2031-06-22") });
    const maria = person({ firstName: "Maria", relation: "helper", nationality: "PHL", passport: passport("2031-01-01", "PHL") });
    expect(computeChecks({ ...base, items: [], travellers: [omar] }).find((c) => c.key === "visa")?.state).toBe("ok");
    expect(computeChecks({ ...base, items: [], travellers: [omar, maria] }).find((c) => c.key === "visa")).toMatchObject({ state: "todo", who: [maria.id], text: "Maria: Türkiye e-Visa" });
    expect(computeChecks({ ...base, countries: ["MY"], items: [], travellers: [omar] }).find((c) => c.key === "visa")?.state).toBe("unknown");
    // At home: no passport or visa check, no eSIM.
    expect(computeChecks({ ...base, countries: ["SA"], items: [], travellers: [omar] }).map((c) => c.key)).toEqual(["stays"]);
  });

  it("stays per night, the car for drive days, and the eSIM", () => {
    const items = [
      { kind: "stay", mode: null, day: 0, nights: 1, status: "booked" as const },
      { kind: "leg", mode: "drive", day: 1, nights: null, status: "idea" as const },
      { kind: "leg", mode: "drive", day: 2, nights: null, status: "idea" as const },
      { kind: "car", mode: null, day: 2, nights: 1, status: "idea" as const },
    ];
    const checks = computeChecks({ ...base, items, travellers: [] });
    expect(checks.find((c) => c.key === "stays")).toMatchObject({ state: "todo", nights: [1, 2], text: "Nights 2–3: no stay yet." });
    expect(checks.find((c) => c.key === "car")).toMatchObject({ state: "todo", days: [1], text: "Car needed day 2." });
    expect(checks.find((c) => c.key === "esim")?.state).toBe("none");
    expect(computeChecks({ ...base, items, travellers: [], esims: [{ status: "installed" }] }).find((c) => c.key === "esim")?.state).toBe("ok");
    expect(computeChecks({ ...base, items, travellers: [], noStay: true }).find((c) => c.key === "stays")?.state).toBe("ok");
  });
});

/* ───────────── the API ───────────── */

let A: { token: string; userId: string };
beforeAll(async () => { A = await signIn(); });

describe("POST /trips/plan and GET /trips/{id}/plan", () => {
  let tripId: string;
  let version: number;

  it("creates a planning trip from a template with origin JED: first leg JED → ULH, titled Jeddah → AlUla", async () => {
    const r = await call(createPost, { token: A.token, body: { templateId: "alula2", origin: { name: "JED", code: "JED" }, start: START } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const { plan } = LivingPlanResponse.parse(r.json);
    tripId = plan.tripId;
    version = plan.version;
    expect(plan.title).toBe("Jeddah → AlUla");
    expect(plan.origin).toMatchObject({ code: "JED", source: "said" });
    expect(plan.originNeeded).toBe(false);
    expect(plan.items[0]).toMatchObject({ kind: "leg", mode: "flight", title: "Jeddah → AlUla", status: "idea", startsAt: null });
    expect(plan.items[0]!.from?.code).toBe("JED");
    expect(plan.items[0]!.to?.code).toBe("ULH");
    expect(plan.days).toBe(2);
    expect(plan.checks.find((c) => c.key === "stays")?.state).toBe("todo"); // planned, nothing booked
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, tripId));
    expect(trip).toMatchObject({ status: "planning", city: "AlUla", kind: "simple", startDate: START, endDate: "2027-11-19" });
    expect(trip!.origin).toMatchObject({ code: "JED" });
    // The Trips tab still lists it.
    expect(TripsResponse.safeParse((await call(tripsGet, { method: "GET", token: A.token })).json).success).toBe(true);
    expect((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json.plan.version).toBe(version);
  });

  it("is private: another account gets 404", async () => {
    const B = await signIn();
    expect((await call(withP(planGet, { id: tripId }), { method: "GET", token: B.token })).status).toBe(404);
    expect((await call(withP(opsPost, { id: tripId }), { token: B.token, body: { version, ops: [{ op: "skip", itemId: tripId }] } })).status).toBe(404);
  });

  it("edits with the version read; a stale version is refused and changes nothing", async () => {
    const r = await call(withP(itemsPost, { id: tripId }), { token: A.token, body: { version, day: 1, item: { kind: "activity", title: "Maraya", at: "17:00" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const c = PlanChangeResponse.parse(r.json);
    expect(c.plan.version).toBe(version + 1);
    const added = c.plan.items.find((i) => i.title === "Maraya")!;
    expect(added).toMatchObject({ day: 1, startsAt: "2027-11-19T17:00", status: "idea", source: "manual" });
    const stale = await call(withP(opsPost, { id: tripId }), { token: A.token, body: { version, ops: [{ op: "remove", itemId: added.id }] } });
    expect(stale.status).toBe(409);
    expect(stale.json.error).toMatchObject({ code: "PLAN_CHANGED", details: { version: version + 1 } });
    expect((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json.plan.items.some((i: { id: string }) => i.id === added.id)).toBe(true);
    version += 1;

    // Move to day 0 after Old Town, then skip, then remove: each a new version.
    const oldTown = c.plan.items.find((i) => i.title === "AlUla Old Town")!;
    const moved = PlanChangeResponse.parse((await call(withP(itemPatch, { id: tripId, itemId: added.id }), { method: "PATCH", token: A.token, body: { version, day: 0, afterItemId: oldTown.id } })).json);
    const day0 = moved.plan.items.filter((i) => i.day === 0).map((i) => i.title);
    expect(day0.indexOf("Maraya")).toBe(day0.indexOf("AlUla Old Town") + 1);
    expect(moved.plan.items.find((i) => i.id === added.id)?.startsAt).toBe("2027-11-18T17:00");
    version = moved.plan.version;
    const del = await call(withP(itemDelete, { id: tripId, itemId: added.id }), { method: "DELETE", path: `/x?version=${version}`, token: A.token });
    expect(del.status).toBe(200);
    version = del.json.plan.version;
    expect(del.json.plan.items.some((i: { id: string }) => i.id === added.id)).toBe(false);
    // A day past the end is refused.
    expect((await call(withP(opsPost, { id: tripId }), { token: A.token, body: { version, ops: [{ op: "add", day: 5, item: { kind: "note", title: "x" } }] } })).status).toBe(400);
  });

  it("changing the origin re-plans the legs out and home; the title follows", async () => {
    const r = await call(withP(originPut, { id: tripId }), { method: "PUT", token: A.token, body: { version, origin: { name: "Riyadh" } } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const c = PlanChangeResponse.parse(r.json);
    expect(c.plan.title).toBe("Riyadh → AlUla");
    const out = c.plan.items.find((i) => i.kind === "leg" && i.from?.code === "RUH")!;
    expect(out).toMatchObject({ title: "Riyadh → AlUla", startsAt: "2027-11-18T07:30" }); // the template's own airport: its time holds
    expect(c.plan.items.find((i) => i.title === "AlUla → Riyadh")).toBeTruthy();
    expect(c.plan.items.some((i) => i.title.includes("Jeddah"))).toBe(false);
    expect(c.changes[0]).toMatchObject({ op: "origin", title: "Riyadh" });
    expect(c.untouched).toEqual([]);
    version = c.plan.version;
  });

  it("booking a stay on the trip marks the matching item booked, and the trip booked; the booked item can't be moved", async () => {
    const before = LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json).plan;
    const stayItem = before.items.find((i) => i.kind === "stay")!;
    const [stay] = await db.insert(appStays).values({ tripId, name: "Habitas AlUla", checkIn: START, nights: 1, price: 2400_00, status: "booked", confirmation: "MT7Q2X" }).returning();
    // The read already derives it from the booking row, before any listener runs.
    const read = LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json).plan;
    expect(read.items.find((i) => i.id === stayItem.id)).toMatchObject({ status: "booked", statusLine: "Booked · Habitas AlUla", booking: { kind: "stay", id: stay!.id, name: "Habitas AlUla" } });
    // The listener links and caches it, writes the event and marks the trip booked.
    await emit({ kind: "order.confirmed", orderId: stay!.id, tripId, ownerId: A.userId });
    const [row] = await db.select().from(appPlanItems).where(eq(appPlanItems.id, stayItem.id));
    expect(row).toMatchObject({ bookingKind: "stay", bookingId: stay!.id, status: "booked" });
    const [trip] = await db.select({ status: appTrips.status }).from(appTrips).where(eq(appTrips.id, tripId));
    expect(trip!.status).toBe("booked");
    const after = LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json).plan;
    expect(after.version).toBe(read.version + 1);
    expect(after.checks.find((c) => c.key === "stays")).toMatchObject({ state: "ok" });
    const ev = (await call(withP(eventsGet, { id: tripId }), { method: "GET", token: A.token })).json.events as { op: string; by: string; diff: { to?: string } }[];
    expect(ev.some((e) => e.op === "status" && e.by === "system" && e.diff.to === "booked")).toBe(true);
    // Running it again changes nothing.
    await emit({ kind: "stay.changed", tripId });
    expect(LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json).plan.version).toBe(after.version);
    const refused = await call(withP(opsPost, { id: tripId }), { token: A.token, body: { version: after.version, ops: [{ op: "move", itemId: stayItem.id, day: 1 }] } });
    expect(refused.status).toBe(400);
    expect(refused.json.error.details).toMatchObject({ booked: true });
    // A note on it is fine.
    expect((await call(withP(opsPost, { id: tripId }), { token: A.token, body: { version: after.version, ops: [{ op: "update", itemId: stayItem.id, item: { note: "Late arrival" } }] } })).status).toBe(200);
    version = after.version + 1;
  });

  it("a booked leg out is never re-planned by an origin change: it comes back untouched", async () => {
    const plan = LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: A.token })).json).plan;
    const out = plan.items.find((i) => i.title === "Riyadh → AlUla")!;
    await db.update(appPlanItems).set({ status: "booked", bookingKind: "rental", bookingId: out.id }).where(eq(appPlanItems.id, out.id)); // a booking with no table yet: the cache stands
    const c = PlanChangeResponse.parse((await call(withP(originPut, { id: tripId }), { method: "PUT", token: A.token, body: { version: plan.version, origin: { name: "Jeddah" } } })).json);
    expect(c.untouched).toEqual([{ itemId: out.id, title: "Riyadh → AlUla" }]);
    expect(c.plan.items.find((i) => i.id === out.id)?.title).toBe("Riyadh → AlUla");
    expect(c.plan.items.find((i) => i.title === "AlUla → Jeddah")).toBeTruthy();
    expect(c.plan.title).toBe("Jeddah → AlUla");
  });

  it("without an origin anywhere, the plan asks for one; remembered home airport is the default", async () => {
    const C = await signIn();
    const r = LivingPlanResponse.parse((await call(createPost, { token: C.token, body: { stops: [{ place: { name: "Istanbul" }, nights: 3 }], start: START } })).json).plan;
    expect(r.originNeeded).toBe(true);
    expect(r.items.some((i) => i.kind === "leg")).toBe(false);
    expect(r.title).toBe("Istanbul");
    const { appAskMemory } = await import("@/db/app-schema-ask");
    await db.insert(appAskMemory).values({ ownerId: C.userId, kind: "home_airport", text: "Flies from Dammam" });
    const m = LivingPlanResponse.parse((await call(createPost, { token: C.token, body: { stops: [{ place: { name: "Istanbul" }, nights: 3 }], start: START } })).json).plan;
    expect(m.origin).toMatchObject({ code: "DMM", source: "memory" });
    expect(m.title).toBe("Dammam → Istanbul");
    // Setting it later adds the legs.
    const s = PlanChangeResponse.parse((await call(withP(originPut, { id: r.tripId }), { method: "PUT", token: C.token, body: { origin: { name: "JED", code: "JED" } } })).json);
    expect(s.plan.items.filter((i) => i.kind === "leg").map((i) => i.title)).toEqual(["Jeddah → Istanbul", "Istanbul → Jeddah"]);
  });
});

describe("a plan on the seeded Istanbul trip (checks on seed data)", () => {
  it("links the booked flights and hotel, and computes passport, visa and stay gaps", async () => {
    const D = await signIn();
    const tripId = await seedDemoTrip(D.userId);
    const people = await db.select().from(appPeople).where(eq(appPeople.ownerId, D.userId));
    const self = people.find((p) => p.isSelf)!;
    const sara = people.find((p) => p.givenNames === "Sara")!;
    // Two passports on file (the seed has expiries but no numbers): Sara's runs out before Türkiye's 150 days.
    const pp = { passportNumberEnc: "x", passportNumberMasked: "•••482", passportIssuingCountry: "SAU", passportNationality: "SAU" };
    await db.update(appPeople).set({ ...pp, passportExpiry: "2031-06-22" }).where(eq(appPeople.id, self.id));
    await db.update(appPeople).set({ ...pp, passportExpiry: "2027-06-01" }).where(eq(appPeople.id, sara.id));
    const [helper] = await db.insert(appPeople).values({ ownerId: D.userId, givenNames: "Maria", surname: "Santos", relation: "helper", nationality: "PHL", passportNumberEnc: "x", passportNumberMasked: "•••901", passportIssuingCountry: "PHL", passportNationality: "PHL", passportExpiry: "2030-01-01" }).returning();
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, tripId));
    await db.update(appTrips).set({ travellerIds: [...trip!.travellerIds, helper!.id] }).where(eq(appTrips.id, tripId));

    const r = await call(withP(planPost, { id: tripId }), { token: D.token, body: {} });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const plan = LivingPlanResponse.parse((await call(withP(planGet, { id: tripId }), { method: "GET", token: D.token })).json).plan;
    // The origin came from the booked flight out; the legs are the booked SV263 and SV264.
    expect(plan.origin).toMatchObject({ code: "RUH", source: "booking" });
    expect(plan.title).toBe("Riyadh → Istanbul");
    expect(plan.items.find((i) => i.title === "Riyadh → Istanbul")).toMatchObject({ status: "confirmed", booking: { kind: "segment", name: "Saudia SV263", ref: "X7K2QD" } });
    expect(plan.items.find((i) => i.title === "Istanbul → Riyadh")).toMatchObject({ status: "confirmed", day: 6 });
    expect(plan.items.find((i) => i.kind === "stay")).toMatchObject({ status: "booked", nights: 6, statusLine: "Booked · Bereketzade Hotel" });
    const checks = Object.fromEntries(plan.checks.map((c) => [c.key, c]));
    expect(checks.passports).toMatchObject({ state: "warn", who: [sara.id] });
    expect(checks.visa).toMatchObject({ state: "todo", who: [helper!.id], text: "Maria: Türkiye e-Visa" });
    expect(checks.stays).toMatchObject({ state: "ok" });
    expect(checks.esim).toMatchObject({ state: "none" });
    // Removing the hotel from the plan would be the change flow; skipping a night's stay shows the gap instead.
    const stay = plan.items.find((i) => i.kind === "stay")!;
    expect((await call(withP(opsPost, { id: tripId }), { token: D.token, body: { version: plan.version, ops: [{ op: "remove", itemId: stay.id }] } })).status).toBe(400);
    const events = await db.select().from(appPlanEvents).where(and(eq(appPlanEvents.planId, plan.id), eq(appPlanEvents.op, "create")));
    expect(events).toHaveLength(1);
    // One plan per trip.
    expect((await call(withP(planPost, { id: tripId }), { token: D.token, body: {} })).status).toBe(400);
  });
});
