import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { AskThreadResponse, AskThreadsResponse, LivingPlanResponse, PlanChangeAskResponse, PlanChangeResponse, TripChatResponse, type Plan } from "@mada/shared";
import { db } from "@/db";
import { appRequests } from "@/db/app-schema";
import { appAskThreads } from "@/db/app-schema-ask";
import { appPlanChangeRequests } from "@/db/app-schema-trips";
import { appFriendships } from "@/db/app-schema-circles";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planGet } from "@/app/api/app/v1/trips/[id]/plan/route";
import { POST as opsPost } from "@/app/api/app/v1/trips/[id]/plan/ops/route";
import { PATCH as itemPatch } from "@/app/api/app/v1/trips/[id]/plan/items/[itemId]/route";
import { POST as changeAsk } from "@/app/api/app/v1/trips/[id]/change-requests/route";
import { POST as decidePost } from "@/app/api/app/v1/trips/[id]/change-requests/[changeId]/decide/route";
import { POST as travellersPost } from "@/app/api/app/v1/trips/[id]/travellers/route";
import { GET as sharedList } from "@/app/api/app/v1/trips/shared/route";
import { POST as sharedAnswer } from "@/app/api/app/v1/trips/shared/invites/[inviteId]/[answer]/route";
import { DELETE as chatOff, GET as chatGet, POST as chatOn } from "@/app/api/app/v1/trips/[id]/chat/route";
import { GET as threadsGet } from "@/app/api/app/v1/ask/threads/route";
import { GET as threadGet, PATCH as threadPatch } from "@/app/api/app/v1/ask/threads/[id]/route";
import { householdOf } from "@/lib/app/booking/common";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { appendLineTo, newThread } from "@/lib/app/ask-chat/store";
import { planContext } from "@/lib/app/ask-chat/tools-plan";
import { pivotPlace } from "@/lib/app/ask-chat/attach";
import { tripChatContext } from "@/lib/app/ask-chat/trip-chat";
import { customerPlans, linkRequestToItem, requestPlan } from "@/lib/app/desk/plans";
import { call } from "./helpers";
import { person, withParams, type Who } from "./circles-helpers";

/*
 * U8 (docs/app/ASK-INTEGRATED.md §3.6, §5.5, §9.3, §10): the plan screen's writes and what flows from them. A reorder by
 * hand reaches the chat's next context; a write against an old version is refused with the latest; a companion who can
 * suggest has his edit turned into a change request; the shared trip chat holds the owner, the companion and Mada, with
 * the change approved in place; the desk reads the plan and links a request to an item.
 */

const START = "2027-11-20";
let omar: Who;
let abdallah: Who;
let plan: Plan;
let tripId: string;

const read = async (who: Who) => LivingPlanResponse.parse((await call(withParams(planGet, { id: tripId }), { token: who.token })).json);
const ctxOf = async (who: Who, threadId: string | null = null): Promise<ToolCtx> =>
  ({ ownerId: who.id, people: await householdOf(who.id), today: "2026-10-21", lang: "en", ipHash: null, demo: new Set(), threadId });

describe("the plan screen and the trip chat", () => {
  beforeAll(async () => {
    omar = await person("Omar");
    abdallah = await person("Abdallah");
    await db.insert(appFriendships).values({ requesterId: omar.id, addresseeId: abdallah.id, status: "accepted", acceptedAt: new Date() });
    const r = await call(createPost, { token: omar.token, body: { templateId: "alula2", origin: { name: "Riyadh", code: "RUH", kind: "airport" }, start: START } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    plan = LivingPlanResponse.parse(r.json).plan;
    tripId = plan.tripId;
  });

  it("the owner reads the plan with full access", async () => {
    const out = await read(omar);
    expect(out.access).toMatchObject({ role: "owner", prices: true });
    expect(out.plan.title).toMatch(/Riyadh → AlUla/);
  });

  it("a reorder by hand is in the chat's next context, and a write on an old version gets the latest", async () => {
    const day1 = plan.items.filter((i) => i.day === 0 && i.kind === "activity");
    expect(day1.length).toBeGreaterThan(1);
    const last = day1.at(-1)!;
    const r = await call(withParams(itemPatch, { id: tripId, itemId: last.id }), { method: "PATCH", token: omar.token, body: { version: plan.version, day: 0, first: true } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    const after = PlanChangeResponse.parse(r.json).plan;
    const firstOfDay = after.items.filter((i) => i.day === 0).sort((a, b) => a.sort - b.sort)[0]!;
    expect(firstOfDay.id).toBe(last.id);
    const ctx = await planContext(omar.id, tripId);
    expect(ctx.lines.join("\n")).toMatch(new RegExp(`the traveller changed the plan: moved ${last.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")} to day 1`));
    // The same edit from a phone that still has the old version: refused, with the version to read again.
    const stale = await call(withParams(opsPost, { id: tripId }), { token: omar.token, body: { version: plan.version, ops: [{ op: "remove", itemId: day1[0]!.id }] } });
    expect(stale.status).toBe(409);
    expect((stale.json as { error: { code: string; details: { version: number } } }).error).toMatchObject({ code: "PLAN_CHANGED", details: { version: after.version } });
    plan = after;
  });

  it("a companion who can suggest reads it without prices, and his edit becomes a change request", async () => {
    await call(withParams(travellersPost, { id: tripId }), { token: omar.token, body: { userId: abdallah.id } }).then((r) => expect(r.status, JSON.stringify(r.json)).toBe(201));
    // Friends first: the circle lets Omar pick him. Not on the trip yet: no plan for him.
    const shared = (await call(sharedList, { token: abdallah.token })).json as { trips: { inviteId: string | null }[] };
    if (shared.trips[0]?.inviteId) await call(withParams(sharedAnswer, { inviteId: shared.trips[0].inviteId, answer: "accept" }), { method: "POST", token: abdallah.token });
    const his = await read(abdallah);
    expect(his.access).toMatchObject({ role: "suggest", prices: false, ownerName: "Omar" });
    expect(his.plan.totals ?? null).toBeNull();
    expect(his.plan.items.every((i) => !i.price && !i.quote)).toBe(true);
    const item = his.plan.items.find((i) => i.kind === "activity")!;
    // The plan's own write is the owner's: refused for him.
    const direct = await call(withParams(opsPost, { id: tripId }), { token: abdallah.token, body: { version: his.plan.version, ops: [{ op: "skip", itemId: item.id }] } });
    expect(direct.status).toBe(404);
    const r = await call(withParams(changeAsk, { id: tripId }), { token: abdallah.token, body: { summary: `Skip ${item.title}`, ops: [{ op: "skip", itemId: item.id }] } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const asked = PlanChangeAskResponse.parse(r.json);
    expect(asked.applied).toBe(false);
    expect(asked.changeId).toBeTruthy();
    const [row] = await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.id, asked.changeId!));
    expect(row).toMatchObject({ status: "pending", byUserId: abdallah.id, ownerId: omar.id });
    // Nothing changed on the plan until Omar says so.
    expect((await read(omar)).plan.items.find((i) => i.id === item.id)!.status).not.toBe("skipped");
  });

  it("the shared trip chat: the owner turns it on, both see it with Mada, and a change is approved in place", async () => {
    expect(TripChatResponse.parse((await call(withParams(chatGet, { id: tripId }), { token: abdallah.token })).json)).toMatchObject({ on: false, canManage: false });
    expect((await call(withParams(chatOn, { id: tripId }), { method: "POST", token: abdallah.token })).status).toBe(403);
    const on = TripChatResponse.parse((await call(withParams(chatOn, { id: tripId }), { method: "POST", token: omar.token })).json);
    expect(on.on).toBe(true);
    expect(on.members.map((m) => m.name)).toEqual(["Omar", "Abdallah"]);
    const threadId = on.threadId!;
    // Abdallah's list has it, with both people on the row; it isn't his to rename.
    const list = AskThreadsResponse.parse((await call(threadsGet, { token: abdallah.token })).json).threads;
    const row = list.find((x) => x.id === threadId)!;
    expect(row).toMatchObject({ kind: "trip", mine: false, tripId });
    expect(row.members?.map((m) => m.initial)).toEqual(["O", "A"]);
    expect((await call(withParams(threadPatch, { id: threadId }), { method: "PATCH", token: abdallah.token, body: { title: "Mine" } })).status).toBe(404);
    // He writes; the model hears who it is from (the context names everyone and their role).
    await appendLineTo(threadId, { who: "me", text: "Can we skip the viewpoint?", by: abdallah.id, name: "Abdallah", at: new Date().toISOString() });
    const words = await tripChatContext({ tripId, title: on.members.length ? "Riyadh → AlUla" : null }, omar.id, abdallah.id);
    expect(words).toMatch(/Omar \(organiser\), Abdallah \(can suggest\)/);
    expect(words).toMatch(/this one is from Abdallah/);
    const item = (await read(omar)).plan.items.filter((i) => i.kind === "activity").at(-1)!;
    const asked = await runTool("request_change", { trip_id: tripId, summary: `Skip ${item.title}`, ops: [{ op: "skip", item_id: item.id, day: null, nights: null, title: null, kind: null }] }, await ctxOf(abdallah, threadId));
    expect(asked.isError, asked.text).toBeFalsy();
    // The card went into the trip chat itself, not a private chat of Omar's.
    const forOmar = AskThreadResponse.parse((await call(withParams(threadGet, { id: threadId }), { token: omar.token })).json);
    const card = forOmar.lines.flatMap((l) => l.kept ?? []).find((c) => c.type === "change");
    expect(card && card.type === "change" && card.change.mine).toBe(true);
    expect(forOmar.lines.find((l) => l.text === "Can we skip the viewpoint?")).toMatchObject({ who: "member", by: "Abdallah" });
    const forHim = AskThreadResponse.parse((await call(withParams(threadGet, { id: threadId }), { token: abdallah.token })).json);
    expect(forHim.lines.find((l) => l.text === "Can we skip the viewpoint?")).toMatchObject({ who: "me" });
    const hisCard = forHim.lines.flatMap((l) => l.kept ?? []).find((c) => c.type === "change");
    expect(hisCard && hisCard.type === "change" && hisCard.change.mine).toBe(false);
    // Omar approves in place: the plan changes and the line lands in the same chat.
    const changeId = card!.type === "change" ? card!.change.id : "";
    const d = await call(withParams(decidePost, { id: tripId, changeId }), { token: omar.token, body: { decision: "approve" } });
    expect(d.status, JSON.stringify(d.json)).toBe(200);
    expect((await read(omar)).plan.items.find((i) => i.id === item.id)!.status).toBe("skipped");
    const after = AskThreadResponse.parse((await call(withParams(threadGet, { id: threadId }), { token: abdallah.token })).json);
    expect(after.lines.at(-1)!.text).toMatch(/Omar approved/);
    // Off: archived, kept, and gone from his list.
    expect(TripChatResponse.parse((await call(withParams(chatOff, { id: tripId }), { method: "DELETE", token: omar.token })).json).on).toBe(false);
    expect(AskThreadsResponse.parse((await call(threadsGet, { token: abdallah.token })).json).threads.some((x) => x.id === threadId)).toBe(false);
  });

  it("a chat a booking's trip came from is attached to it; a new place in a trip's chat is offered a chat of its own", async () => {
    const th = await newThread(omar.id, "en");
    await appendLineTo(th.id, { who: "me", text: "A hotel in AlUla" });
    const r = await call(withParams(threadPatch, { id: th.id }), { method: "PATCH", token: omar.token, body: { tripId } });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await db.select({ tripId: appAskThreads.tripId }).from(appAskThreads).where(eq(appAskThreads.id, th.id)))[0]!.tripId).toBe(tripId);
    // Someone else's trip: refused.
    const other = await newThread(abdallah.id, "en");
    expect((await call(withParams(threadPatch, { id: other.id }), { method: "PATCH", token: abdallah.token, body: { tripId } })).status).toBe(404);
    const intent = (destination: string | null, destinationName: string | null) => ({ destination, destinationName }) as never;
    expect(await pivotPlace(tripId, intent("istanbul", null), "en")).toBe("Istanbul");
    expect(await pivotPlace(tripId, intent("alula", null), "en")).toBeNull();
    expect(await pivotPlace(tripId, intent(null, null), "en")).toBeNull();
  });

  it("the desk reads the plan and links a request to an item", async () => {
    const plans = await customerPlans(omar.id);
    expect(plans[0]).toMatchObject({ tripId, title: expect.stringMatching(/AlUla/) });
    expect(plans[0]!.threads.length).toBeGreaterThan(0);
    const [req] = await db.insert(appRequests).values({ ownerId: omar.id, kind: "car_rental", summary: "A car in AlUla", tripId }).returning();
    const view = await requestPlan(req!.id);
    expect(view!.linked).toBeNull();
    const target = view!.candidates[0]!;
    const actor = { id: "00000000-0000-4000-8000-000000000001", name: "Noura", permissions: new Set(["desk.view", "desk.act"]) };
    await expect(linkRequestToItem({ ...actor, permissions: new Set(["desk.view"]) }, req!.id, target.itemId)).rejects.toThrow();
    await linkRequestToItem(actor, req!.id, target.itemId).catch(async (e) => {
      // The Ops audit row needs a real Ops user: the link itself is what this test checks.
      if (!/audit|foreign key|violates/i.test(String(e))) throw e;
    });
    const [after] = await db.select({ planItemId: appRequests.planItemId }).from(appRequests).where(and(eq(appRequests.id, req!.id)));
    expect(after!.planItemId).toBe(target.itemId);
    expect((await read(omar)).plan.items.find((i) => i.id === target.itemId)!.status).toBe("requested");
  });
});
