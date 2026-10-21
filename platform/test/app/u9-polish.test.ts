import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { LivingPlanResponse, TodayPlanResponse, addDays, type ChatCard, type Plan } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appPeople, appQuotes, appRequests, appStays } from "@/db/app-schema";
import { appAskMemory, appAskThreads } from "@/db/app-schema-ask";
import { appPlanItems, appPlans } from "@/db/app-schema-plans";
import { appTripTravellers } from "@/db/app-schema-trips";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planToday } from "@/app/api/app/v1/trips/plan-today/route";
import { householdOf } from "@/lib/app/booking/common";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { newThread } from "@/lib/app/ask-chat/store";
import { decideChange, requestChange } from "@/lib/app/trips/change-requests";
import { syncTripBookings } from "@/lib/app/plans/plans";
import { todayFromPlan } from "@/lib/app/plans/today";
import { newlyAmber, planChecksJob, quietHours, quoteReady } from "@/lib/app/plans/nudges";
import { listAskThreads } from "@/lib/app/desk/ask";
import { planState } from "@/lib/app/desk/plans";
import { call } from "./helpers";
import { person, type Who } from "./circles-helpers";

/*
 * U9 (docs/app/ASK-INTEGRATED.md §11): Today's cards from the plan, the payer's card for a companion's change that
 * costs money, the pushes for a price on a plan item and a check turning amber, the home airport as a search's start,
 * and the desk's "Has a plan".
 */

const START = "2027-12-12";
const DAY = 86_400_000;
const midday = new Date("2027-11-20T09:00:00Z"); // 12:00 in Riyadh

async function makePlan(who: Who): Promise<Plan> {
  const r = await call(createPost, { token: who.token, body: { stops: [{ place: { name: "Melaka" }, nights: 1 }, { place: { name: "Penang" }, nights: 2 }], origin: { name: "Riyadh" }, start: START, travelMode: "mixed" } });
  expect(r.status, JSON.stringify(r.json)).toBe(201);
  return LivingPlanResponse.parse(r.json).plan;
}

/** The plan's Melaka stay booked on the trip, as the pay sheet would leave it. */
async function bookMelaka(plan: Plan) {
  const melaka = plan.items.find((i) => i.kind === "stay" && i.place?.name === "Melaka")!;
  await db.insert(appStays).values({ tripId: plan.tripId, name: "Casa del Rio Melaka", checkIn: addDays(START, melaka.day!), nights: melaka.nights ?? 1, price: 900_00, status: "booked" });
  await syncTripBookings(plan.tripId);
  return melaka;
}

describe("Today from the plan", () => {
  let omar: Who;
  let plan: Plan;
  let melaka: Plan["items"][number];
  beforeAll(async () => {
    omar = await person("Omar");
    plan = await makePlan(omar);
    melaka = await bookMelaka(plan);
    // The drive to Penang as U4 measured it, leaving at 10:00.
    const drive = plan.items.find((i) => i.kind === "leg" && i.mode === "drive" && i.to?.name === "Penang")!;
    await db.update(appPlanItems).set({ drive: { km: 395, minutes: 250, tolls: true, borders: [], source: "map", asOf: new Date().toISOString(), estimate: false }, startsAt: `${addDays(START, drive.day!)}T10:00` }).where(eq(appPlanItems.id, drive.id));
  });

  it("nothing a month out; the day before, the check-in; on the day, the drive with its time, never a made-up one", async () => {
    expect((await todayFromPlan(omar.id, addDays(START, -40))).cards).toEqual([]);
    const before = await todayFromPlan(omar.id, addDays(START, melaka.day! - 1));
    expect(before.trip).toMatchObject({ id: plan.tripId, startDate: START });
    expect(before.cards).toContainEqual(expect.objectContaining({ kind: "checkin", when: "tomorrow", hotel: "Casa del Rio Melaka" }));
    const driveDay = plan.items.find((i) => i.kind === "leg" && i.mode === "drive" && i.to?.name === "Penang")!.day!;
    const on = await todayFromPlan(omar.id, addDays(START, driveDay));
    expect(on.cards).toContainEqual(expect.objectContaining({ kind: "drive", when: "today", minutes: 250, to: "Penang", leaveBy: "10:00" }));
    // A drive nobody measured (no source) says nothing.
    expect(on.cards.filter((c) => c.kind === "drive")).toHaveLength(1);
  });

  it("what's left shows from 7 days before, through the endpoint", async () => {
    const r = await todayFromPlan(omar.id, addDays(START, -3));
    expect(r.cards.some((c) => c.kind === "todo")).toBe(true);
    const api = await call(planToday, { method: "GET", token: omar.token });
    expect(api.status).toBe(200);
    // On the real date this trip is over a month away: nothing yet.
    expect(TodayPlanResponse.parse(api.json)).toEqual({ trip: null, cards: [] });
  });

  it("the desk sees the plan's state and finds its chat under Has a plan", async () => {
    const s = planState(plan);
    expect(s.ideas + s.booked + s.priced + s.requested).toBeGreaterThan(0);
    const t = await newThread(omar.id, "en", plan.tripId);
    await db.update(appAskThreads).set({ title: plan.title, titledBy: "route" }).where(eq(appAskThreads.id, t.id));
    const actor = { id: "00000000-0000-0000-0000-000000000000", permissions: new Set(["desk.view", "desk.ask.read", "desk.ask.read_all"]) } as never;
    const all = await listAskThreads(actor, { plan: true, q: "Omar", limit: 200 });
    const row = all.rows.find((x) => x.id === t.id);
    expect(row?.plan).toMatchObject({ booked: 1 });
    expect(all.rows.every((x) => x.plan)).toBe(true);
  });
});

describe("a companion's change that costs money", () => {
  let omar: Who, abdallah: Who;
  let plan: Plan;
  let melaka: Plan["items"][number];
  beforeAll(async () => {
    omar = await person("Omar");
    abdallah = await person("Abdallah");
    plan = await makePlan(omar);
    melaka = await bookMelaka(plan);
    await db.insert(appTripTravellers).values({ tripId: plan.tripId, userId: abdallah.id, role: "suggest", status: "going", addedByKind: "traveller" });
  });

  it("approved, the team prices it; once priced, the payer's chat gets Book · Not now and one push", async () => {
    const asked = await requestChange(abdallah.id, plan.tripId, { summary: "Two nights in Melaka", ops: [{ op: "update", itemId: melaka.id, item: { nights: 2 } }] });
    expect(asked.change?.costs).toBe(true);
    await decideChange(omar.id, plan.tripId, asked.change!.id, { decision: "approve" });
    const [req] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, omar.id), eq(appRequests.tripId, plan.tripId)));
    expect(req?.planItemId).toBeTruthy();
    expect((req!.details as { changeId?: string }).changeId).toBe(asked.change!.id);
    const cardsOf = async () => {
      const threads = await db.select().from(appAskThreads).where(eq(appAskThreads.ownerId, omar.id));
      return threads.flatMap((t) => (t.transcript as { text?: string; kept?: ChatCard[] }[]).flatMap((l) => (l.kept ?? []).map((c) => ({ c, text: l.text }))))
        .filter((x) => x.c.type === "pay_change");
    };
    const pricing = await cardsOf();
    expect(pricing).toHaveLength(1);
    expect(pricing[0]!.c).toMatchObject({ byName: "Abdallah", amount: null, requestId: req!.id });
    expect(pricing[0]!.text).toBe("Abdallah’s change needs booking. We’re getting the price.");
    // Nothing for Abdallah to pay: no card in his chats.
    expect((await db.select().from(appAskThreads).where(eq(appAskThreads.ownerId, abdallah.id))).some((t) => JSON.stringify(t.transcript).includes("pay_change"))).toBe(false);

    await db.insert(appQuotes).values({ requestId: req!.id, lines: [{ label: "One more night", amount: 650_00, kind: "other" }], total: 650_00, status: "open" });
    expect(await quoteReady(req!.id)).toBe(true);
    expect(await quoteReady(req!.id)).toBe(false);
    const priced = await cardsOf();
    expect(priced.at(-1)!.c).toMatchObject({ amount: 650_00 });
    const pushes = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, omar.id), eq(appNotifications.kind, "plan")));
    expect(pushes).toHaveLength(1);
    expect(pushes[0]!.title).toBe("Abdallah’s change needs booking");
    expect(pushes[0]!.href).toMatch(/^\/ask\//);
  });

  it("a price on a plain plan item: one push that opens the plan at the item", async () => {
    const penang = plan.items.find((i) => i.kind === "stay" && i.place?.name === "Penang")!;
    const [r] = await db.insert(appRequests).values({ ownerId: omar.id, kind: "stay", summary: "Rooms in Penang", tripId: plan.tripId, planItemId: penang.id, details: { source: "ask" } }).returning();
    await db.insert(appQuotes).values({ requestId: r!.id, lines: [{ label: "Rooms", amount: 1200_00, kind: "other" }], total: 1200_00, status: "open" });
    expect(await quoteReady(r!.id)).toBe(true);
    const [n] = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, omar.id), eq(appNotifications.title, "Price ready")));
    expect(n?.href).toBe(`/trip/${plan.tripId}/plan?item=${penang.id}`);
    expect(n?.body).toContain("SAR");
  });
});

describe("a check turning amber", () => {
  it("is pushed once, in the day only", async () => {
    expect(quietHours(new Date("2027-11-20T21:00:00Z"))).toBe(true); // 00:00 Riyadh
    expect(quietHours(midday)).toBe(false);
    expect(newlyAmber([{ key: "passports", state: "todo" }], [{ key: "passports", state: "warn", text: "", who: [], nights: [], days: [] }])).toHaveLength(1);
    expect(newlyAmber([{ key: "passports", state: "warn" }], [{ key: "passports", state: "warn", text: "", who: [], nights: [], days: [] }])).toHaveLength(0);

    const sara = await person("Sara");
    // A passport that ends before the trip's end + 6 months.
    await db.update(appPeople).set({ givenNames: "Sara", passportNumberMasked: "A0•••41", passportExpiry: "2028-02-01", passportIssuingCountry: "SAU", passportNationality: "SAU" })
      .where(and(eq(appPeople.ownerId, sara.id), eq(appPeople.isSelf, true)));
    const made = await call(createPost, { token: sara.token, body: { stops: [{ place: { name: "Istanbul" }, nights: 3 }], origin: { name: "Riyadh" }, start: START } });
    const plan = LivingPlanResponse.parse(made.json).plan;
    expect(plan.checks.find((c) => c.key === "passports")?.state).toBe("warn");
    expect((await planChecksJob(new Date("2027-11-20T21:00:00Z"))).planChecks).toBe(0);
    await planChecksJob(midday);
    await planChecksJob(new Date(midday.getTime() + DAY / 24));
    const told = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, sara.id), eq(appNotifications.kind, "plan")));
    expect(told).toHaveLength(1);
    expect(told[0]!.body).toMatch(/^Sara: passport to renew for /);
    expect(told[0]!.href).toBe(`/trip/${plan.tripId}/plan`);
    const [row] = await db.select({ checks: appPlans.checks }).from(appPlans).where(eq(appPlans.id, plan.id));
    expect(row!.checks).toContainEqual({ key: "passports", state: "warn" });
  });
});

describe("memory → origin", () => {
  it("a flight search nobody gave a start leaves from the remembered home airport", async () => {
    const huda = await person("Huda");
    await db.insert(appAskMemory).values({ ownerId: huda.id, kind: "home_airport", text: "Flies from Jeddah" });
    const ctx: ToolCtx = { ownerId: huda.id, people: await householdOf(huda.id), today: "2026-10-21", lang: "en", ipHash: null, demo: new Set(), threadId: null };
    const r = await runTool("search_flights", { destination: "istanbul", depart: "2026-12-10", return: null, from: null, cabin: null, infants: null, traveller_ids: null }, ctx);
    expect(r.text).toMatch(/JED|Jeddah|by hand|request/);
    if (r.cards?.[0]?.type === "flights") expect(r.cards[0].search.from).toBe("JED");
    // A plan without a start takes it too.
    const p = await call(createPost, { token: huda.token, body: { stops: [{ place: { name: "AlUla" }, nights: 2 }], start: "2027-01-14" } });
    expect(LivingPlanResponse.parse(p.json).plan.origin).toMatchObject({ code: "JED", source: "memory" });
  });
});
