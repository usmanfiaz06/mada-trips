import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq, isNull } from "drizzle-orm";
import { addDays, readSseFrames, todayIn, type AskChatEvent, type ChatCard } from "@mada/shared";
import type Anthropic from "@anthropic-ai/sdk";
import { db } from "@/db";
import { appPlanItems, appPlans } from "@/db/app-schema-plans";
import { POST as chatPost } from "@/app/api/app/v1/ask/chat/route";
import { GET as threadGet } from "@/app/api/app/v1/ask/threads/[id]/route";
import { setChatApi } from "@/lib/app/ask-chat/engine";
import { EVAL_CASES, PLAN_EVAL_IDS, checkTurn, runEvals } from "@/lib/app/ask-chat/evals";
import { unbacked } from "@/lib/app/ask-chat/guard";
import { kindFor, leanToolsFor } from "@/lib/app/ask-chat/prompt";
import { runTool, type ToolCtx } from "@/lib/app/ask-chat/tools";
import { saveFact } from "@/lib/app/ask-chat/memory";
import { householdOf } from "@/lib/app/booking/common";
import { applyOps } from "@/lib/app/plans/ops";
import { readPlan } from "@/lib/app/plans/plans";
import { fakeApi, userText, type Reply } from "./ask-chat-fake";
import { freshIp } from "./helpers";
import { callP, signIn } from "./wallet-helpers";

/*
 * Ask's tools for the living plan (docs/app/ASK-INTEGRATED.md §11 U3): a road trip made in a chat with drive legs and
 * no time nobody measured, the chat attached to its trip and titled by its route, the start moved and the legs and title
 * rebuilt, a manual edit told to the next turn, and the eight conversations of "never say we don't do it" (mocked).
 */

async function chat(token: string, body: Record<string, unknown>) {
  const req = new Request("http://localhost/api/app/v1/ask/chat", {
    method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, "x-forwarded-for": freshIp(), "user-agent": "vitest" }, body: JSON.stringify(body),
  });
  const events = readSseFrames(await (await chatPost(req)).text()).events;
  const thread = events.find((e): e is Extract<AskChatEvent, { type: "thread" }> => e.type === "thread") ?? null;
  const cards = events.flatMap((e) => (e.type === "cards" ? e.cards : []));
  const done = events.find((e): e is Extract<AskChatEvent, { type: "done" }> => e.type === "done");
  return { events, threadId: thread?.threadId ?? null, cards, text: done?.text ?? null };
}

const START = addDays(todayIn(), 45);
const ROAD = {
  trip_id: null, template_id: null, origin: null, return_to: null, start: START, days: 7, traveller_ids: [], pace: "normal", must: [], travel_mode: "mixed",
  stops: [{ place: "Singapore", nights: 2 }, { place: "Melaka", nights: 1 }, { place: "Kuala Lumpur", nights: 2 }, { place: "Penang", nights: 1 }],
};

/** The words the traveller said last (the second text block of the last user message with text). */
const said = (p: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
  const m = [...p.messages].reverse().find((x) => x.role === "user" && Array.isArray(x.content) && x.content.some((b) => b.type === "text"));
  return m && Array.isArray(m.content) ? ((m.content.at(-1) as { text?: string }).text ?? "") : "";
};
const afterTool = (p: Anthropic.Beta.MessageCreateParamsNonStreaming) => {
  const last = p.messages.at(-1)!;
  return Array.isArray(last.content) && last.content.some((b) => b.type === "tool_result");
};

beforeEach(() => { process.env.ASK_CHAT = "on"; process.env.ANTHROPIC_API_KEY = "test-key-not-real"; });
afterEach(() => { setChatApi(null); delete process.env.ASK_CHAT; delete process.env.ANTHROPIC_API_KEY; });

describe("a road trip made in a chat", () => {
  it("builds the plan with ≥ 3 drive legs and no time, starts from the remembered airport, attaches and titles the chat", async () => {
    const me = await signIn();
    await saveFact(me.user.id, "home_airport", "Flies from Riyadh");
    const api = fakeApi((p) => (afterTool(p)
      ? { blocks: [{ type: "text", text: "Here's your 7-day plan from Riyadh through Melaka and Kuala Lumpur to Penang. Review it. <next>Book a car for the drives | Find stays | Start in Singapore</next>" }] }
      : { blocks: [{ type: "tool_use", name: "create_plan", input: ROAD }] }));
    setChatApi(api);
    const r = await chat(me.token, { text: "7-day road trip from Singapore to Malaysia" });

    const card = r.cards.find((c): c is Extract<ChatCard, { type: "plan" }> => c.type === "plan")!;
    expect(card).toBeTruthy();
    expect(card.origin).toMatchObject({ name: "Riyadh", code: "RUH", source: "memory" });
    const rows = card.days.flatMap((d) => d.items);
    const drives = rows.filter((x) => x.kind === "leg" && x.mode === "drive");
    expect(drives.length).toBeGreaterThanOrEqual(3);
    // No router in the tests: a straight-line distance at most, never a drive time, no time of day on any leg.
    for (const x of drives) expect(x).toMatchObject({ minutes: null, at: null });
    expect(rows.find((x) => x.mode === "flight")).toMatchObject({ from: "Riyadh", to: "Singapore", at: null });

    // The model read the gist, with the rule about drive times, and the plan's own words are what it said.
    const gist = JSON.stringify(api.requests.at(-1)!.messages.at(-1)!.content);
    expect(gist).toContain("Drive km and times only as written here");
    expect(gist).toMatch(/\[[0-9a-f]{8}\] drive Singapore→Melaka/);
    expect(gist).not.toMatch(/\d+ ?h\b|\d+h\d\dm/);
    expect(r.text).toContain("Review it");

    // The plan is real: a planning trip, the legs in the database without times.
    const plan = await readPlan(me.user.id, card.tripId);
    expect(plan.items.filter((i) => i.kind === "leg" && i.mode === "drive")).toHaveLength(3);
    expect(plan.items.filter((i) => i.kind === "leg").every((i) => i.startsAt === null)).toBe(true);
    expect(plan.items.filter((i) => i.mode === "drive").every((i) => i.drive === null || (i.drive.estimate === true && i.drive.minutes === null))).toBe(true);

    // The chat is now this trip's chat, titled by its route.
    const t = await callP(threadGet, { id: r.threadId! }, { token: me.token });
    expect(t.json.thread.tripId).toBe(card.tripId);
    expect(t.json.thread.title).toMatch(/^Riyadh → Singapore → Penang · /);
  });

  it("a manual move shows up in the next turn's context once; set_origin rebuilds the legs and the title", async () => {
    const me = await signIn();
    let n = 0;
    const api = fakeApi((p): Reply => {
      const words = said(p);
      if (afterTool(p)) return { blocks: [{ type: "text", text: "Done. <next>Review the plan | Find stays</next>" }] };
      if (/road trip/.test(words)) return { blocks: [{ type: "tool_use", name: "create_plan", input: { ...ROAD, origin: "RUH" } }] };
      if (/Jeddah/.test(words)) return { blocks: [{ type: "tool_use", name: "set_origin", input: { plan_id: null, origin: "Jeddah", return_to: null } }] };
      n += 1;
      return { blocks: [{ type: "text", text: "Melaka is on day 4 now. <next>Find stays | Book a car</next>" }] };
    });
    setChatApi(api);
    const a = await chat(me.token, { text: "7-day road trip from Singapore to Malaysia" });
    const card = a.cards.find((c): c is Extract<ChatCard, { type: "plan" }> => c.type === "plan")!;
    const plan = await readPlan(me.user.id, card.tripId);
    const melaka = plan.items.find((i) => i.kind === "stay" && i.title.includes("Melaka"))!;

    // On the plan screen: the traveller moves the Melaka stay to day 4.
    await applyOps(me.user.id, card.tripId, { version: plan.version, ops: [{ op: "move", itemId: melaka.id, day: 3 }] }, "traveller");
    await chat(me.token, { text: "Is that fine?", threadId: a.threadId });
    const ctx = userText(api.requests.at(-1)!);
    expect(ctx).toContain(`plan_id=${plan.id}`);
    expect(ctx).toMatch(/Since the last message the traveller changed the plan: moved Stay in Melaka to day 4/);
    // Told once: the next turn doesn't hear it again.
    await chat(me.token, { text: "And the hotels?", threadId: a.threadId });
    expect(userText(api.requests.at(-1)!).match(/moved Stay in Melaka/g)).toHaveLength(1);
    expect(n).toBe(2);

    // "Start from Jeddah": the first and last legs and the title follow.
    const j = await chat(me.token, { text: "Start from Jeddah instead", threadId: a.threadId });
    const diff = j.cards.find((c): c is Extract<ChatCard, { type: "plan_diff" }> => c.type === "plan_diff")!;
    expect(diff.changes[0]).toMatchObject({ op: "origin" });
    expect(diff.changes.some((c) => c.row.from === "Jeddah" && c.row.to === "Singapore")).toBe(true);
    const after = await readPlan(me.user.id, card.tripId);
    expect(after.title).toBe("Jeddah → Singapore → Penang");
    expect(after.items.find((i) => i.kind === "leg" && i.day === 0)).toMatchObject({ title: "Jeddah → Singapore" });
    const t = await callP(threadGet, { id: a.threadId! }, { token: me.token });
    expect(t.json.thread.title).toMatch(/^Jeddah → Singapore → Penang · /);
  });
});

describe("the plan tools", () => {
  async function ctxFor() {
    const me = await signIn();
    const people = await householdOf(me.user.id);
    const ctx: ToolCtx = { ownerId: me.user.id, people, today: todayIn(), lang: "en", ipHash: null, demo: new Set(), threadId: null, tripId: null };
    return { me, ctx };
  }

  it("the AlUla weekend from Jeddah: the first leg is Jeddah → AlUla with no time; unknown start asks once", async () => {
    const { ctx } = await ctxFor();
    const r = await runTool("create_plan", { ...ROAD, stops: [], template_id: "alula2", origin: "JED", travel_mode: null }, ctx);
    expect(r.isError).toBeFalsy();
    const card = r.cards![0] as Extract<ChatCard, { type: "plan" }>;
    expect(card.title).toBe("Jeddah → AlUla");
    expect(card.days[0]!.items[0]).toMatchObject({ kind: "leg", from: "Jeddah", to: "AlUla", at: null });

    const { ctx: fresh } = await ctxFor();
    const u = await runTool("create_plan", { ...ROAD, stops: [{ place: "Istanbul", nights: 3 }] }, fresh);
    expect((u.cards![0] as Extract<ChatCard, { type: "plan" }>).originNeeded).toBe(true);
    expect(u.text).toContain("Start unknown");
    expect(u.text).toContain("<next>Riyadh | Jeddah | Somewhere else</next>");
  });

  it("refuses a stale version and an item that isn't on the plan; the gist stays short; ids are the caller's", async () => {
    const { me, ctx } = await ctxFor();
    const made = await runTool("create_plan", { ...ROAD, origin: "RUH" }, ctx);
    const planId = (made.cards![0] as Extract<ChatCard, { type: "plan" }>).planId;
    const gist = await runTool("get_plan", { plan_id: planId }, ctx);
    expect(gist.text.length).toBeLessThan(900);
    const ref = /\[([0-9a-f]{8})\] stay Melaka/.exec(gist.text)![1]!;

    const stale = await runTool("update_plan", { plan_id: planId, version: 99, ops: [{ op: "remove", item: ref, day: null, after: null, what: null }] }, ctx);
    expect(stale).toMatchObject({ isError: true });
    expect(stale.text).toMatch(/changed since you read it/);
    const version = Number(/version=(\d+)/.exec(gist.text)![1]);
    const missing = await runTool("update_plan", { plan_id: planId, version, ops: [{ op: "remove", item: "deadbeef", day: null, after: null, what: null }] }, ctx);
    expect(missing).toMatchObject({ isError: true });
    const ok = await runTool("update_plan", { plan_id: planId, version, ops: [{ op: "add", item: null, day: 2, after: null, what: { kind: "activity", mode: null, title: "Jonker Street", place: "Melaka", from: null, to: null, at: null, nights: null } }] }, ctx);
    expect(ok.isError).toBeFalsy();
    expect(ok.cards![0]).toMatchObject({ type: "plan_diff", changes: [{ op: "add", day: 1, row: { title: "Jonker Street" } }] });

    // Someone else's plan id reads as no plan at all.
    const { ctx: other } = await ctxFor();
    expect(await runTool("get_plan", { plan_id: planId }, other)).toMatchObject({ isError: true });
    void me;
  });

  it("find_for_item: a drive leg and a stay where nothing is sold live go to the team; open_in_app shows a button", async () => {
    const { ctx } = await ctxFor();
    const made = await runTool("create_plan", { ...ROAD, origin: "RUH" }, ctx);
    const card = made.cards![0] as Extract<ChatCard, { type: "plan" }>;
    const gist = (await runTool("get_plan", { plan_id: card.planId }, ctx)).text;
    const drive = /\[([0-9a-f]{8})\] drive/.exec(gist)![1]!;
    const car = await runTool("find_for_item", { plan_id: card.planId, item: drive }, ctx);
    expect(car.text).toMatch(/create_request kind car/);
    expect(car.text).toContain("WhatsApp | Call me | Here in the app");
    const stay = /\[([0-9a-f]{8})\] stay Melaka/.exec(gist)![1]!;
    expect((await runTool("find_for_item", { plan_id: card.planId, item: stay }, ctx)).text).toMatch(/create_request kind stay/);
    const link = await runTool("open_in_app", { screen: "plan", id: card.planId }, ctx);
    expect(link.cards).toEqual([{ type: "link", screen: "plan", id: card.tripId }]);
  });

  it("an item booked elsewhere can't be removed by Mada", async () => {
    const { me, ctx } = await ctxFor();
    const made = await runTool("create_plan", { ...ROAD, origin: "RUH" }, ctx);
    const card = made.cards![0] as Extract<ChatCard, { type: "plan" }>;
    const [plan] = await db.select().from(appPlans).where(eq(appPlans.tripId, card.tripId));
    const [stay] = await db.select().from(appPlanItems).where(and(eq(appPlanItems.planId, plan!.id), eq(appPlanItems.kind, "stay"), isNull(appPlanItems.deletedAt))).limit(1);
    // A rental the plan can't read yet keeps its cached status: booked.
    await db.update(appPlanItems).set({ status: "booked", bookingKind: "rental", bookingId: stay!.id }).where(eq(appPlanItems.id, stay!.id));
    const r = await runTool("update_plan", { plan_id: card.planId, version: plan!.version, ops: [{ op: "remove", item: stay!.id.slice(0, 8), day: null, after: null, what: null }] }, ctx);
    expect(r).toMatchObject({ isError: true });
    expect(r.text).toMatch(/booked/);
    void me;
  });
});

describe("the sentence gate: distances and drive times only from a tool", () => {
  it("holds a km or a duration no tool returned, keeps one it did, and a promise of when the team answers", () => {
    expect(unbacked("Melaka is 240 km away, about 3 h.", "drive Singapore→Melaka")).toEqual(["240 km", "about 3 h"]);
    expect(unbacked("Melaka is 240 km away, about 3h05m.", "drive Singapore→Melaka 240 km 3h05m")).toEqual([]);
    expect(unbacked("It's a 2 hours 10 min drive.", "120 km 2h10m")).toEqual([]);
    expect(unbacked("«٢٤٠ كم» تقريبًا", "")).toEqual(["240 كم"]);
    expect(unbacked("The team gets back within 2 hours.", "")).toEqual([]);
    expect(unbacked("Seven days, three cities.", "")).toEqual([]);
  });
});

describe("the eight conversations (mocked)", () => {
  it("never-no catches a bare \"we don't do that\", and passes one that sends it to the team", () => {
    const t = EVAL_CASES.find((c) => c.id === "rent-car-langkawi")!.turns[0]!;
    const no = checkTurn(t, "en", { raw: "We don't offer car rentals in Langkawi.", text: "We don't offer car rentals in Langkawi.", toolsUsed: [], toolText: "", dropped: 0, modelChoices: ["Flights to Langkawi", "Hotels"], closers: 0 });
    expect(no.some((p) => p.startsWith("never-no"))).toBe(true);
    const yes = checkTurn(t, "en", { raw: "The team at Mada arranges cars in Langkawi. How should they reach you?", text: "The team at Mada arranges cars in Langkawi. How should they reach you?", toolsUsed: [], toolText: "", dropped: 0, modelChoices: ["WhatsApp", "Call me", "Here in the app"], closers: 0 });
    expect(yes).toEqual([]);
  });

  it("road trips and plan changes reach the plan tools on every provider", () => {
    expect(kindFor("7-day road trip from Singapore to Malaysia", "flight")).toBe("plan");
    expect(kindFor("رحلة برية ٧ أيام من سنغافورة لماليزيا", "flight")).toBe("plan");
    expect(kindFor("Flights to Dubai", "flight")).toBe("flight");
    expect(kindFor("Is that fine?", "general", true)).toBe("plan");
    expect(leanToolsFor("plan")).toEqual(expect.arrayContaining(["create_plan", "set_origin", "create_request"]));
    expect(leanToolsFor("flight", ["create_plan"])).toEqual(expect.arrayContaining(["get_plan", "update_plan", "set_origin", "find_for_item"]));
  });

  it("all eight pass every check, never-no included", async () => {
    const AR = /[؀-ۿ]/;
    const reach = (ar: boolean) => (ar ? "<next>واتساب | اتصلوا علي | هنا في التطبيق</next>" : "<next>WhatsApp | Call me | Here in the app</next>");
    const api = fakeApi((p): Reply => {
      const w = said(p);
      const ar = AR.test(w);
      if (afterTool(p)) {
        const tool = JSON.stringify(p.messages.at(-1)!.content);
        if (/Start changed/.test(tool)) return { blocks: [{ type: "text", text: "Now starting from Jeddah, the flights need checking again. <next>Find Jeddah flights | Review the plan</next>" }] };
        if (/Not sold live/.test(tool)) return { blocks: [{ type: "text", text: `The team at Mada arranges the car for the drive days, picked up in Singapore. How should they reach you? ${reach(false)}` }] };
        if (ar) return { blocks: [{ type: "text", text: "هذي خطتك من الرياض لسنغافورة وملقا وكوالالمبور وبينانغ، شوفها. <next>احجز سيارة | دوّر فنادق | ابدأ من سنغافورة</next>" }] };
        if (/AlUla/.test(tool)) return { blocks: [{ type: "text", text: "Here's your AlUla weekend from Riyadh with Hessa. Review it. <next>Find flights | Add a car | Start from Jeddah</next>" }] };
        return { blocks: [{ type: "text", text: "Here's your 7-day plan from Riyadh through Melaka and Kuala Lumpur to Penang. Starting from Riyadh. Review it. <next>Book a car for the drives | Find stays | Start in Singapore</next>" }] };
      }
      if (/road trip|رحلة برية/i.test(w)) return { blocks: [{ type: "tool_use", name: "create_plan", input: ROAD }] };
      if (/AlUla for me/.test(w)) return { blocks: [{ type: "tool_use", name: "create_plan", input: { ...ROAD, stops: [{ place: "AlUla", nights: 1 }], days: 2, travel_mode: null } }] };
      if (/Jeddah/.test(w)) return { blocks: [{ type: "tool_use", name: "set_origin", input: { plan_id: null, origin: "Jeddah", return_to: null } }] };
      if (/car for the drives/.test(w)) return { blocks: [{ type: "tool_use", name: "find_for_item", input: { plan_id: null, item: "c3d4e5f6" } }] };
      if (/Langkawi/.test(w)) return { blocks: [{ type: "text", text: `The team at Mada arranges a car in Langkawi for 3 days from 12 Dec. How should they reach you? ${reach(false)}` }] };
      if (/driver/.test(w)) return { blocks: [{ type: "text", text: `The team at Mada books a driver in AlUla for 20 Nov. How should they reach you? ${reach(false)}` }] };
      if (/Train/.test(w)) return { blocks: [{ type: "text", text: `The team at Mada books the KL to Penang train on 15 Dec for you and Hessa. How should they reach you? ${reach(false)}` }] };
      return { blocks: [{ type: "text", text: `فريق مادا يتأكد لك من تصريح السيارة لسنغافورة ويرتّب الإيجار. كيف نوصل لك؟ ${reach(true)}` }] };
    });
    const v = await runEvals(api, { only: PLAN_EVAL_IDS });
    expect(new Set(v.map((x) => x.case))).toEqual(new Set(PLAN_EVAL_IDS));
    expect(v.filter((x) => x.problems.length).map((x) => `${x.case}#${x.turn}: ${x.problems.join("; ")}`)).toEqual([]);
    expect(v.find((x) => x.case === "road-trip-sg-my")!.tools).toEqual(["create_plan"]);
    expect(v.find((x) => x.case === "start-jeddah" && x.turn === 2)!.tools).toEqual(["set_origin"]);
  });
});
