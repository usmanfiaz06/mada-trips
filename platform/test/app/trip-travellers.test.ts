import { beforeAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  AskThreadResponse, ChangeRequestResponse, LivingPlanResponse, SharedTripResponse, SharedTripsResponse, TripInviteResponse, TripTravellersResponse, nameKey,
  type ChatCard, type Plan,
} from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appPeople, appTrips } from "@/db/app-schema";
import { appCircleInvites, appFriendships } from "@/db/app-schema-circles";
import { appPlanChangeRequests, appTripTravellers } from "@/db/app-schema-trips";
import { POST as createPost } from "@/app/api/app/v1/trips/plan/route";
import { GET as planGet } from "@/app/api/app/v1/trips/[id]/plan/route";
import { GET as travellersGet, PATCH as travellersPatch, POST as travellersPost } from "@/app/api/app/v1/trips/[id]/travellers/route";
import { DELETE as travellerDelete, PATCH as travellerPatch } from "@/app/api/app/v1/trips/[id]/travellers/[travellerId]/route";
import { POST as invitePost } from "@/app/api/app/v1/trips/[id]/travellers/invite/route";
import { GET as changeGet } from "@/app/api/app/v1/trips/[id]/change-requests/[changeId]/route";
import { POST as decidePost } from "@/app/api/app/v1/trips/[id]/change-requests/[changeId]/decide/route";
import { GET as sharedList } from "@/app/api/app/v1/trips/shared/route";
import { GET as sharedGet } from "@/app/api/app/v1/trips/shared/[tripId]/route";
import { POST as sharedAnswer } from "@/app/api/app/v1/trips/shared/invites/[inviteId]/[answer]/route";
import { GET as threadGet } from "@/app/api/app/v1/ask/threads/[id]/route";
import { householdOf } from "@/lib/app/booking/common";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { newThread } from "@/lib/app/ask-chat/store";
import { changeRequestsJob } from "@/lib/app/trips/change-requests";
import { findMatches, listTravellers } from "@/lib/app/trips/travellers";
import { outbox } from "@/lib/app/suppliers";
import { call } from "./helpers";
import { person, withParams, type Who } from "./circles-helpers";

/*
 * Companions (docs/app/ASK-INTEGRATED.md §5, §5.5, U5): "Which Abdullah?" is asked, never guessed; nobody found is an
 * invite card; a circle member picked is invited in his app and, once he says yes, sees the trip without prices; a
 * companion with "Can suggest" asks for a change that waits for the owner, and both chats update when he decides.
 */

const START = "2027-12-12";
const ctxOf = async (who: Who, threadId: string | null = null): Promise<ToolCtx> =>
  ({ ownerId: who.id, people: await householdOf(who.id), today: "2026-10-21", lang: "en", ipHash: null, demo: new Set(), threadId });

let omar: Who;
let abdallah: Who;
let tripId: string;
let plan: Plan;

const befriend = (a: string, b: string) => db.insert(appFriendships).values({ requesterId: a, addresseeId: b, status: "accepted", acceptedAt: new Date() });
const readPlan = async () => LivingPlanResponse.parse((await call(withParams(planGet, { id: tripId }), { token: omar.token })).json).plan;

describe("nameKey", () => {
  it("folds the ways one name is written, Arabic and Latin alike", () => {
    const k = nameKey("Abdullah");
    for (const v of ["Abdallah", "abdulla", "Abd Allah", "عبدالله", "عبد الله", "Abdullāh"]) expect(nameKey(v), v).toBe(k);
    expect(nameKey("Mohammed")).toBe(nameKey("Muhammad"));
    expect(nameKey("محمد")).toBe(nameKey("Mohamed"));
    expect(nameKey("Sara")).toBe(nameKey("Sarah"));
    expect(nameKey("Omar")).not.toBe(nameKey("Abdullah"));
    expect(nameKey("Hessa")).not.toBe(nameKey("Sara"));
  });
});

describe("companions on a trip", () => {
  beforeAll(async () => {
    omar = await person("Omar");
    abdallah = await person("Abdallah");
    await befriend(omar.id, abdallah.id);
    // His brother in the household, also an Abdullah; and Hessa.
    await db.insert(appPeople).values([{ ownerId: omar.id, givenNames: "Abdullah", relation: "family" }, { ownerId: omar.id, givenNames: "Hessa", relation: "spouse" }]);
    const r = await call(createPost, { token: omar.token, body: { stops: [{ place: { name: "Melaka" }, nights: 1 }, { place: { name: "Penang" }, nights: 2 }], origin: { name: "Riyadh" }, start: START, travelMode: "mixed" } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    plan = LivingPlanResponse.parse(r.json).plan;
    tripId = plan.tripId;
  });

  it("the trip's cached travellers have rows, the account holder as the owner", async () => {
    const list = TripTravellersResponse.parse((await call(withParams(travellersGet, { id: tripId }), { token: omar.token })).json);
    expect(list.canManage).toBe(true);
    expect(list.travellers).toHaveLength(1);
    expect(list.travellers[0]).toMatchObject({ owner: true, role: null, status: "going" });
  });

  it("two Abdullahs: a choice card with both, and nobody added", async () => {
    const before = (await db.select().from(appTrips).where(eq(appTrips.id, tripId)))[0]!.travellerIds;
    const r = await runTool("add_traveller", { trip_id: tripId, name: "Abdullah", relation: null }, await ctxOf(omar));
    expect(r.isError).toBeFalsy();
    const card = r.cards?.[0] as Extract<ChatCard, { type: "people" }>;
    expect(card.type).toBe("people");
    expect(card.options.map((o) => o.ref.kind).sort()).toEqual(["person", "user"]);
    expect(card.options.map((o) => o.how)).toEqual(expect.arrayContaining(["Your household · Family", "Friend on Mada"]));
    expect(r.text).toMatch(/Never pick one yourself/);
    expect(r.text).toMatch(/Which Abdullah\?/);
    expect((await db.select().from(appTrips).where(eq(appTrips.id, tripId)))[0]!.travellerIds).toEqual(before);
    // The same in Arabic letters.
    expect(await findMatches(omar.id, "عبدالله", { tripId, lang: "en" })).toHaveLength(2);
  });

  it("one person in the household is added straight away, and traveller_ids follows", async () => {
    const r = await runTool("add_traveller", { trip_id: tripId, name: "Hessa", relation: "wife" }, await ctxOf(omar));
    expect(r.text).toMatch(/Added Hessa/);
    expect(r.cards).toBeUndefined();
    const [hessa] = await db.select().from(appPeople).where(and(eq(appPeople.ownerId, omar.id), eq(appPeople.givenNames, "Hessa")));
    expect((await db.select().from(appTrips).where(eq(appTrips.id, tripId)))[0]!.travellerIds).toContain(hessa!.id);
  });

  it("nobody by that name: an invite card, and nothing sent until the tap", async () => {
    const sent = outbox.length;
    const r = await runTool("add_traveller", { trip_id: tripId, name: "Faisal", relation: null }, await ctxOf(omar));
    expect(r.cards?.[0]).toMatchObject({ type: "invite", tripId, name: "Faisal" });
    expect(r.text).toMatch(/isn't in their circle/);
    expect(outbox.length).toBe(sent);
    // The tap: an SMS naming the trip, and Faisal on the plan as invited.
    const phone = "+966551112233";
    const inv = TripInviteResponse.parse((await call(withParams(invitePost, { id: tripId }), { token: omar.token, body: { name: "Faisal", phone, channel: "sms" } })).json);
    expect(inv.result).toBe("sent");
    expect(inv.traveller).toMatchObject({ name: "Faisal", status: "invited", kind: "invite" });
    expect(outbox[0]).toMatchObject({ channel: "sms", to: phone });
    expect(outbox[0]!.body).toMatch(/Omar invited you to Riyadh → .*Penang on Mada/);
    const [row] = await db.select().from(appCircleInvites).where(eq(appCircleInvites.id, (await db.select().from(appTripTravellers).where(eq(appTripTravellers.id, inv.traveller!.id)))[0]!.inviteId!));
    expect(row).toMatchObject({ kind: "trip", channel: "sms", status: "pending" });
  });

  it("the friend picked from the card is invited in his app; after his yes he sees the trip, without prices", async () => {
    const r = await call(withParams(travellersPost, { id: tripId }), { token: omar.token, body: { userId: abdallah.id } });
    expect(r.status, JSON.stringify(r.json)).toBe(201);
    const list = TripTravellersResponse.parse(r.json);
    expect(list.travellers.find((x) => x.name === "Abdallah")).toMatchObject({ status: "invited", role: "suggest", kind: "user" });
    const shared = SharedTripsResponse.parse((await call(sharedList, { token: abdallah.token })).json).trips;
    expect(shared).toHaveLength(1);
    expect(shared[0]).toMatchObject({ tripId, status: "invited", ownerName: "Omar" });
    // Not yet his: the plan isn't shown before he says yes.
    expect(SharedTripResponse.parse((await call(withParams(sharedGet, { tripId }), { token: abdallah.token })).json).trip.items).toEqual([]);
    const yes = await call(withParams(sharedAnswer, { inviteId: shared[0]!.inviteId!, answer: "accept" }), { method: "POST", token: abdallah.token });
    expect(yes.status, JSON.stringify(yes.json)).toBe(200);
    expect(SharedTripsResponse.parse(yes.json).trips[0]).toMatchObject({ status: "going", role: "suggest" });
    const view = await call(withParams(sharedGet, { tripId }), { token: abdallah.token });
    const trip = SharedTripResponse.parse(view.json).trip;
    expect(trip.items.some((i) => i.kind === "stay" && i.place === "Melaka")).toBe(true);
    expect(trip.people.map((p) => p.name)).toEqual(expect.arrayContaining(["Omar", "Hessa", "Abdallah"]));
    // No prices, payment or documents anywhere in what he gets.
    expect(JSON.stringify(view.json)).not.toMatch(/SAR|amount|price|total|passport|payment/i);
    // Omar hears it; Abdallah's household row in Omar's account is linked to him, and counted.
    const [linked] = await db.select().from(appPeople).where(and(eq(appPeople.ownerId, omar.id), eq(appPeople.linkedUserId, abdallah.id)));
    expect((await db.select().from(appTrips).where(eq(appTrips.id, tripId)))[0]!.travellerIds).toContain(linked!.id);
    expect((await db.select().from(appNotifications).where(eq(appNotifications.userId, omar.id))).some((n) => n.title === "Abdallah joined your trip")).toBe(true);
    // Someone else can't read it.
    const stranger = await person("Noor");
    expect((await call(withParams(sharedGet, { tripId }), { token: stranger.token })).status).toBe(404);
    expect((await call(withParams(travellersGet, { id: tripId }), { token: abdallah.token })).status).toBe(404);
  });

  it("a suggestion waits for Omar; both chats update on approve", async () => {
    const melaka = plan.items.find((i) => i.kind === "stay" && i.place?.name === "Melaka")!;
    const penang = plan.items.find((i) => i.kind === "stay" && i.place?.name === "Penang")!;
    const histhread = await newThread(abdallah.id, "en", null);
    const version = (await readPlan()).version;
    const r = await runTool("request_change", {
      trip_id: tripId, summary: "Two nights in Melaka, one in Penang",
      ops: [{ op: "update", item_id: melaka.id, nights: 2, day: null, title: null, kind: null }, { op: "update", item_id: penang.id, nights: 1, day: null, title: null, kind: null }],
    }, await ctxOf(abdallah, histhread.id));
    expect(r.isError, r.text).toBeFalsy();
    expect(r.text).toMatch(/We’ll ask Omar to confirm/);
    const card = r.cards?.[0] as Extract<ChatCard, { type: "change" }>;
    expect(card.change).toMatchObject({ status: "pending", byName: "Abdallah", ownerName: "Omar", mine: false, costs: false });
    expect(card.change.lines.map((l) => l.text)).toEqual(["Stay in Melaka: 1 → 2 nights", "Stay in Penang: 2 → 1 nights"]);
    // Nothing changed yet.
    expect((await readPlan()).version).toBe(version);
    // Omar's chat for the trip has the same card, and his phone a push.
    const [row] = await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.id, card.change.id));
    expect(row!.ownerThreadId).toBeTruthy();
    const ownerThread = AskThreadResponse.parse((await call(withParams(threadGet, { id: row!.ownerThreadId! }), { token: omar.token })).json);
    const line = ownerThread.lines.at(-1)!;
    expect(line.text).toBe("Abdallah suggests a change to " + card.change.tripTitle + ": Two nights in Melaka, one in Penang");
    expect(line.kept?.[0]).toMatchObject({ type: "change", change: { id: card.change.id, mine: true } });
    expect((await db.select().from(appNotifications).where(eq(appNotifications.userId, omar.id))).some((n) => n.title === "Abdallah suggests a change")).toBe(true);
    // Only Omar decides.
    expect((await call(withParams(decidePost, { id: tripId, changeId: card.change.id }), { token: abdallah.token, body: { decision: "approve" } })).status).toBe(403);
    const ok = ChangeRequestResponse.parse((await call(withParams(decidePost, { id: tripId, changeId: card.change.id }), { token: omar.token, body: { decision: "approve" } })).json).change;
    expect(ok.status).toBe("approved");
    const after = await readPlan();
    expect(after.version).toBe(version + 1);
    expect(after.items.find((i) => i.id === melaka.id)?.nights).toBe(2);
    expect(after.items.find((i) => i.id === penang.id)?.nights).toBe(1);
    // His chat says so, with the card; his live read agrees.
    const his = AskThreadResponse.parse((await call(withParams(threadGet, { id: histhread.id }), { token: abdallah.token })).json);
    expect(his.lines.at(-1)).toMatchObject({ who: "mada", text: "Omar approved: Two nights in Melaka, one in Penang" });
    expect(his.lines.at(-1)?.kept?.[0]).toMatchObject({ type: "change", change: { status: "approved" } });
    expect(ChangeRequestResponse.parse((await call(withParams(changeGet, { id: tripId, changeId: ok.id }), { token: abdallah.token })).json).change.status).toBe("approved");
    // A second tap changes nothing.
    expect(ChangeRequestResponse.parse((await call(withParams(decidePost, { id: tripId, changeId: ok.id }), { token: omar.token, body: { decision: "decline" } })).json).change.status).toBe("approved");
  });

  it("declined with a reason: the plan stays, and his chat says why", async () => {
    const histhread = await newThread(abdallah.id, "en", null);
    const r = await runTool("request_change", { trip_id: tripId, summary: "A stop in Ipoh", ops: [{ op: "add", item_id: null, day: 2, nights: null, title: "Ipoh old town", kind: "activity" }] }, await ctxOf(abdallah, histhread.id));
    const id = (r.cards?.[0] as Extract<ChatCard, { type: "change" }>).change.id;
    const version = (await readPlan()).version;
    const no = ChangeRequestResponse.parse((await call(withParams(decidePost, { id: tripId, changeId: id }), { token: omar.token, body: { decision: "decline", reason: "Too much driving that day" } })).json).change;
    expect(no).toMatchObject({ status: "declined", reason: "Too much driving that day" });
    expect((await readPlan()).version).toBe(version);
    const his = AskThreadResponse.parse((await call(withParams(threadGet, { id: histhread.id }), { token: abdallah.token })).json);
    expect(his.lines.at(-1)?.text).toBe("Omar kept it as it is: Too much driving that day");
  });

  it("roles: view only asks questions; edit changes ideas at once", async () => {
    const list = await listTravellers(omar.id, tripId);
    const him = list.travellers.find((x) => x.name === "Abdallah")!;
    expect((await call(withParams(travellerPatch, { id: tripId, travellerId: him.id }), { method: "PATCH", token: omar.token, body: { role: "view" } })).status).toBe(200);
    const op = { op: "add", item_id: null, day: 1, nights: null, title: "Jonker Street at night", kind: "activity" };
    const v = await runTool("request_change", { trip_id: tripId, summary: "Jonker Street", ops: [op] }, await ctxOf(abdallah));
    expect(v.isError).toBe(true);
    expect(v.text).toMatch(/can view this trip/);
    // He can't set roles himself.
    expect((await call(withParams(travellerPatch, { id: tripId, travellerId: him.id }), { method: "PATCH", token: abdallah.token, body: { role: "edit" } })).status).toBe(404);
    await call(withParams(travellerPatch, { id: tripId, travellerId: him.id }), { method: "PATCH", token: omar.token, body: { role: "edit" } });
    const version = (await readPlan()).version;
    const e = await runTool("request_change", { trip_id: tripId, summary: "Jonker Street", ops: [op] }, await ctxOf(abdallah));
    expect(e.isError, e.text).toBeFalsy();
    expect(e.text).toMatch(/Done/);
    const p = await readPlan();
    expect(p.version).toBe(version + 1);
    expect(p.items.some((i) => i.title === "Jonker Street at night")).toBe(true);
    // Prices: off unless Omar shares them.
    const shared = TripTravellersResponse.parse((await call(withParams(travellersPatch, { id: tripId }), { method: "PATCH", token: omar.token, body: { sharePrices: true } })).json);
    expect(shared.sharePrices).toBe(true);
    await call(withParams(travellerPatch, { id: tripId, travellerId: him.id }), { method: "PATCH", token: omar.token, body: { role: "suggest" } });
  });

  it("the owner's own trip goes to the plan tools, not a request", async () => {
    const r = await runTool("request_change", { trip_id: tripId, summary: "x", ops: [{ op: "add", item_id: null, day: 0, nights: null, title: "Dinner", kind: "meal" }] }, await ctxOf(omar));
    expect(r.isError).toBe(true);
    expect(r.text).toMatch(/own trip/);
  });

  it("48 hours: a reminder at 24, then it closes and his chat says so", async () => {
    const histhread = await newThread(abdallah.id, "en", null);
    const r = await runTool("request_change", { trip_id: tripId, summary: "Breakfast on day 2", ops: [{ op: "add", item_id: null, day: 1, nights: null, title: "Breakfast at Nancy's", kind: "meal" }] }, await ctxOf(abdallah, histhread.id));
    const id = (r.cards?.[0] as Extract<ChatCard, { type: "change" }>).change.id;
    await db.update(appPlanChangeRequests).set({ createdAt: new Date(Date.now() - 25 * 3_600_000) }).where(eq(appPlanChangeRequests.id, id));
    const first = await changeRequestsJob();
    expect(first.changeReminded).toBeGreaterThanOrEqual(1);
    expect((await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.id, id)))[0]!.remindedAt).toBeTruthy();
    expect((await changeRequestsJob()).changeReminded).toBe(0);
    await db.update(appPlanChangeRequests).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(appPlanChangeRequests.id, id));
    expect((await changeRequestsJob()).changeExpired).toBe(1);
    expect((await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.id, id)))[0]!.status).toBe("expired");
    const his = AskThreadResponse.parse((await call(withParams(threadGet, { id: histhread.id }), { token: abdallah.token })).json);
    expect(his.lines.at(-1)?.text).toMatch(/didn’t answer within 48 hours/);
  });

  it("an invite link used again never moves the place someone already took", async () => {
    const [row] = await db.select().from(appTripTravellers).where(and(eq(appTripTravellers.tripId, tripId), eq(appTripTravellers.userId, abdallah.id)));
    const other = await person("Majed");
    const { joinFromInvite } = await import("@/lib/app/trips/travellers");
    await joinFromInvite(row!.inviteId!, other.id);
    const [after] = await db.select().from(appTripTravellers).where(eq(appTripTravellers.id, row!.id));
    expect(after!.userId).toBe(abdallah.id);
    expect(SharedTripsResponse.parse((await call(sharedList, { token: other.token })).json).trips).toEqual([]);
  });

  it("a companion can't flood the owner: five open requests at a time", async () => {
    const op = { op: "add", item_id: null, day: 1, nights: null, title: "Coffee", kind: "meal" };
    const ctx = await ctxOf(abdallah);
    const outs = [];
    for (let i = 0; i < 6; i++) outs.push(await runTool("request_change", { trip_id: tripId, summary: `Coffee ${i}`, ops: [op] }, ctx));
    expect(outs.slice(0, 5).every((o) => !o.isError)).toBe(true);
    expect(outs[5]!.isError).toBe(true);
    await db.update(appPlanChangeRequests).set({ status: "cancelled" }).where(and(eq(appPlanChangeRequests.tripId, tripId), eq(appPlanChangeRequests.status, "pending")));
  });

  it("an older writer's traveller_ids still counts: the rows catch up on the next read", async () => {
    const [sara] = await db.insert(appPeople).values({ ownerId: omar.id, givenNames: "Sara", relation: "child" }).returning();
    const [t] = await db.select().from(appTrips).where(eq(appTrips.id, tripId));
    await db.update(appTrips).set({ travellerIds: [...t!.travellerIds, sara!.id] }).where(eq(appTrips.id, tripId));
    const list = await listTravellers(omar.id, tripId);
    expect(list.travellers.some((x) => x.personId === sara!.id)).toBe(true);
    // Removing her through the Travellers screen takes her off the cache too.
    const her = list.travellers.find((x) => x.personId === sara!.id)!;
    const r = await call(withParams(travellerDelete, { id: tripId, travellerId: her.id }), { method: "DELETE", token: omar.token });
    expect(r.status, JSON.stringify(r.json)).toBe(200);
    expect((await db.select().from(appTrips).where(eq(appTrips.id, tripId)))[0]!.travellerIds).not.toContain(sara!.id);
    // The owner stays.
    const me = list.travellers.find((x) => x.owner)!;
    expect((await call(withParams(travellerDelete, { id: tripId, travellerId: me.id }), { method: "DELETE", token: omar.token })).status).toBe(400);
  });
});
