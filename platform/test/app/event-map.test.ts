import { beforeAll, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { BookReadyResponse, CreateOrderResponse, LivingPlanResponse, StaySearchResponse, addDays, todayIn, type ChatCard, type OrderDraft, type Plan } from "@mada/shared";
import { db } from "@/db";
import { appAskThreads } from "@/db/app-schema-ask";
import { confirmOrder } from "@/lib/app/booking/desk";
import { householdOf } from "@/lib/app/booking/common";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { newThread } from "@/lib/app/ask-chat/store";
import { priceItems } from "@/lib/app/plans/booking";
import { todayFromPlan } from "@/lib/app/plans/today";
import { tripDetail } from "@/lib/app/trips/core";
import { listPeople } from "@/lib/app/people";
import { pageBoard } from "@/lib/app/desk/board";
import { customerPlans, planState } from "@/lib/app/desk/plans";
import { listAskThreads } from "@/lib/app/desk/ask";
import { GET as planGet } from "@/app/api/app/v1/trips/[id]/plan/route";
import { GET as readyGet } from "@/app/api/app/v1/trips/[id]/plan/ready/route";
import { POST as searchStays } from "@/app/api/app/v1/search/stays/route";
import { POST as ordersPost } from "@/app/api/app/v1/orders/route";
import { POST as cardsPost } from "@/app/api/app/v1/cards/route";
import { callP, signIn } from "./wallet-helpers";

/*
 * The event map, end to end on the server (docs/app/ASK-INTEGRATED.md §1.3, U9): a plan made in a chat → a stay
 * booked from it → the plan's day shows the hotel → the trip's timeline has the check-in → Today has the card the day
 * before → the desk's board has the order, the customer page the plan's state and the Ask list the plan chip. Each
 * screen reads the same rows; nothing is copied. The app's side of the same walk is apps/mobile/test/e2e-event-map.mjs.
 */

const post = (h: Parameters<typeof callP>[0], token: string, body: unknown, params: Record<string, string> = {}) => callP(h, params, { method: "POST", token, body });
const get = (h: Parameters<typeof callP>[0], token: string, params: Record<string, string> = {}) => callP(h, params, { method: "GET", token });
const START = addDays(todayIn(), 20);

let A: Awaited<ReturnType<typeof signIn>>;
let tripId = "";
let threadId = "";
let cardId = "";
let hotel = "";
const readPlan = async (): Promise<Plan> => LivingPlanResponse.parse((await get(planGet, A.token, { id: tripId })).json).plan;

describe("the event map, end to end", () => {
  beforeAll(async () => {
    A = await signIn();
    const c = await post(cardsPost, A.token, { token: "tok_mock_visa41", brand: "visa", last4: "4241", exp: "08/28", makeDefault: true });
    cardId = (c.json.cards as { id: string }[])[0]!.id;
  });

  it("a plan made in the chat: the chat holds its card, is on its trip and titled by its route", async () => {
    threadId = (await newThread(A.user.id, "en", null)).id;
    const ctx: ToolCtx = { ownerId: A.user.id, people: await householdOf(A.user.id), today: todayIn(), lang: "en", ipHash: null, demo: new Set(), threadId };
    const r = await runTool("create_plan", { trip_id: null, template_id: "istanbul3", origin: "Riyadh", return_to: null, start: START, days: null, traveller_ids: [], pace: null, must: [], travel_mode: null, stops: [] }, ctx);
    expect(r.isError, r.text).toBeFalsy();
    const card = r.cards?.find((x): x is Extract<ChatCard, { type: "plan" }> => x.type === "plan");
    expect(card?.title).toBe("Riyadh → Istanbul");
    tripId = card!.tripId;
    const [th] = await db.select().from(appAskThreads).where(eq(appAskThreads.id, threadId));
    expect(th!.tripId).toBe(tripId);
  });

  it("a stay booked from the plan: the day shows the hotel, the timeline the check-in", async () => {
    const me = (await listPeople(A.user.id)).find((p) => p.isSelf)!.id;
    const plan = await readPlan();
    const stay = plan.items.find((i) => i.kind === "stay")!;
    const st = StaySearchResponse.parse((await post(searchStays, A.token, { destination: "istanbul", checkIn: addDays(START, stay.day!), nights: stay.nights ?? 2, travellerIds: [me] })).json);
    hotel = st.options[0]!.name;
    await priceItems(A.user.id, [stay.id], st.options[0]!.id);
    const ready = BookReadyResponse.parse((await get(readyGet, A.token, { id: tripId })).json).items.find((i) => i.itemId === stay.id)!;
    const res = await post(ordersPost, A.token, { draft: ready.draft as OrderDraft, useCredit: false, payment: { method: "card", cardId }, plan: "full", expectedTotal: ready.total.amount, idempotencyKey: `em-${stay.id}` });
    const o = CreateOrderResponse.parse(res.json);
    expect(o.outcome).toBe("created");
    if (o.outcome === "created") await confirmOrder(o.order.id, { name: "Noura" });

    const after = await readPlan();
    const booked = after.items.find((i) => i.kind === "stay" && i.day === stay.day)!;
    expect(booked.status).toBe("booked");
    expect(booked.statusLine).toContain(hotel);
    const trip = await tripDetail(A.user.id, tripId, null);
    expect(trip.stays.some((s) => s.name === hotel && s.checkIn === addDays(START, stay.day!))).toBe(true);
  });

  it("Today: the day before, the check-in card for that hotel", async () => {
    const stayDay = (await readPlan()).items.find((i) => i.kind === "stay")!.day!;
    const r = await todayFromPlan(A.user.id, addDays(START, stayDay - 1));
    expect(r.trip?.id).toBe(tripId);
    expect(r.cards).toContainEqual(expect.objectContaining({ kind: "checkin", when: "tomorrow", hotel }));
  });

  it("the desk: the order on the board, the plan's state on the customer page, the plan chip on the Ask list", async () => {
    // Confirmed by the desk: the board's Confirmed tab has it (its lifecycle tab, §1.3 "Desk board (U4)").
    const confirmed = await pageBoard({ tab: "confirmed", limit: 200 });
    expect(confirmed.rows.some((r) => r.userId === A.user.id && r.product === "stay")).toBe(true);
    const plans = await customerPlans(A.user.id);
    expect(plans.find((x) => x.tripId === tripId)).toBeTruthy();
    expect(planState(plans.find((x) => x.tripId === tripId)!.plan).booked).toBeGreaterThanOrEqual(1);
    const actor = { id: "00000000-0000-0000-0000-000000000000", permissions: new Set(["desk.view", "desk.ask.read", "desk.ask.read_all"]) } as never;
    const list = await listAskThreads(actor, { plan: true, limit: 200 });
    expect(list.rows.find((x) => x.id === threadId)?.plan).toMatchObject({ booked: 1 });
  });
});
