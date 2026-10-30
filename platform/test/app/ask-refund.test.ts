import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { ChatCard, PaymentsResponse, RefundQuoteResponse, RefundResponse, SignInResponse, type RefundQuoteItem } from "@mada/shared";
import { db } from "@/db";
import { appNotifications, appTrips } from "@/db/app-schema";
import { appPlanChangeRequests, appRefundGroups, appTripTravellers } from "@/db/app-schema-trips";
import { appPlans } from "@/db/app-schema-plans";
import { POST as otpStart } from "@/app/api/app/v1/auth/otp/start/route";
import { POST as otpVerify } from "@/app/api/app/v1/auth/otp/verify/route";
import { GET as paymentsGet } from "@/app/api/app/v1/trips/[id]/payments/route";
import { GET as quoteGet } from "@/app/api/app/v1/trips/[id]/refunds/quote/route";
import { POST as refundPost } from "@/app/api/app/v1/trips/[id]/refunds/route";
import { REFUND_RUN, REFUNDY, paymentsFor, refundKey } from "@/lib/app/ask-chat/tools-refund";
import { LEAN_TOOLS, TOOLS, compactPromptFor, leanToolsFor } from "@/lib/app/ask-chat/prompt";
import { EVAL_CASES, checkTurn } from "@/lib/app/ask-chat/evals";
import type { ToolCtx } from "@/lib/app/ask-chat/tools";
import { seedDemoTrip } from "@/lib/app/trips/seed";
import { call, freshIp, newPhone, type Handler } from "./helpers";
// The same denylist the app's web export is scanned with (plain ESM, shared with apps/mobile).
import { scanJson, scanText } from "../../../tools/leak-scan/denylist.mjs";

/*
 * Cancel and refund in Ask (docs/app/ASK-REFUND.md): refund_quote reads the refund screen's own numbers and auto rule,
 * cancels nothing, and its card's slide calls the refund screen's POST with a key that makes a second slide (or a
 * retried turn) find the same refund. Only the trip's owner gets a quote; a companion's ask goes to the owner.
 */

type P = Record<string, string>;
const withP = <T extends P>(h: (req: Request, ctx: { params: Promise<T> }) => Promise<Response>, params: T): Handler => (req) => h(req, { params: Promise.resolve(params) });
type QuoteCard = Extract<ChatCard, { type: "refund_quote" }>;

async function signIn() {
  const phone = newPhone();
  const ip = freshIp();
  await call(otpStart, { body: { phone }, ip });
  const r = SignInResponse.parse((await call(otpVerify, { body: { phone, code: "123456" }, ip })).json);
  return { token: r.tokens.accessToken, userId: r.user.id };
}

/** The Istanbul demo trip, early: the pickup is free to cancel (SAR 440), the flights keep a fee, the stay is on Tabby. */
async function withTrip() {
  const u = await signIn();
  const tripId = await seedDemoTrip(u.userId);
  const pays = PaymentsResponse.parse((await call(withP(paymentsGet, { id: tripId }), { method: "GET", token: u.token })).json).payments;
  const screen = RefundQuoteResponse.parse((await call(withP(quoteGet, { id: tripId }), { method: "GET", token: u.token })).json);
  return { ...u, tripId, pays, screen };
}
const ctxOf = (userId: string, lang: "en" | "ar" = "en"): ToolCtx => ({ ownerId: userId, people: [], today: "2026-10-28", lang, ipHash: null, demo: new Set() });
const quote = (userId: string, a: Record<string, unknown>, lang: "en" | "ar" = "en") => REFUND_RUN.refund_quote!(ctxOf(userId, lang), { trip_id: null, city: null, items: ["stay"], reason: "plans", ...a });
const cardOf = (out: { cards?: ChatCard[] }) => ChatCard.parse(out.cards?.find((c) => c.type === "refund_quote")) as QuoteCard;
const slide = (t: { tripId: string; token: string }, c: QuoteCard, destination: "credit" | "original") =>
  call(withP(refundPost, { id: t.tripId }), { token: t.token, body: { paymentIds: c.paymentIds, reason: c.reason, destination, clientKey: c.clientKey } });
const groups = (userId: string) => db.select().from(appRefundGroups).where(eq(appRefundGroups.ownerId, userId));

afterEach(() => { delete process.env.APP_REFUND_AUTO_MAX; });

describe("refund_quote: the refund screen's numbers", () => {
  it("each item comes back as the refund screen says, with what is kept and whether the Mada Wallet is instant", async () => {
    const t = await withTrip();
    const screenOf = (item: string) => t.screen.items.find((i) => i.item === item) as RefundQuoteItem;
    for (const item of ["pickup", "flight", "stay"] as const) {
      const out = await quote(t.userId, { trip_id: t.tripId, items: [item] });
      const c = cardOf(out);
      const s = screenOf(item);
      expect(c.paymentIds).toEqual([s.paymentId]);
      expect(c.back.amount).toBe(s.cash.amount);
      expect(c.paid.amount).toBe(s.paid.amount);
      expect(c.kept?.amount ?? 0).toBe(s.paid.amount - s.back.amount);
      expect(c.card).toBe(t.screen.card);
      expect(c.refund).toBeNull();
      expect(out.text).toContain("Nothing is cancelled or refunded yet");
    }
    // Free, SAR 440, within the auto limit: the Wallet is instant. The flights keep a fee: a person checks.
    const pickup = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["pickup"] }));
    expect(pickup).toMatchObject({ walletInstant: true, kept: null, keptBy: null, anyway: false, instalments: null });
    const flight = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["flight"] }));
    expect(flight).toMatchObject({ walletInstant: false, keptBy: "airline" });
    expect(cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["stay"] }))).toMatchObject({ instalments: "tabby", walletInstant: false });
    // Found by the city when no id is given; read only: nothing was asked for.
    expect(cardOf(await quote(t.userId, { city: "Istanbul", items: ["pickup"] })).tripId).toBe(t.tripId);
    expect(await groups(t.userId)).toHaveLength(0);
  });

  it("names: an eSIM and an activity are both extras, told apart by the title; everything is every payment", () => {
    const p = (item: string, title: string) => ({ id: title, item, title }) as never;
    const pays = [p("stay", "Garden hotel"), p("extra", "eSIM 10 GB"), p("extra", "Bosphorus cruise"), p("flight", "Flights")];
    expect(paymentsFor(pays, ["esim"]).map((x) => x.title)).toEqual(["eSIM 10 GB"]);
    expect(paymentsFor(pays, ["activity"]).map((x) => x.title)).toEqual(["Bosphorus cruise"]);
    expect(paymentsFor(pays, ["everything"])).toHaveLength(4);
    expect(refundKey("u", "t", ["b", "a"])).toBe(refundKey("u", "t", ["a", "b"]));
  });
});

describe("the card's slide: the refund screen's POST, once", () => {
  it("auto: a second slide and a retried turn find the same refund; one group, one push, the card shows the tracker", async () => {
    const t = await withTrip();
    const c = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["pickup"] }));
    const first = await slide(t, c, "credit");
    expect(first.status).toBe(201);
    const r = RefundResponse.parse(first.json).refund;
    expect(r).toMatchObject({ stage: "sent", destination: "credit", auto: true, amount: { amount: c.back.amount } });
    const again = RefundResponse.parse((await slide(t, c, "credit")).json).refund;
    expect(again.id).toBe(r.id);
    // The turn retried: the same card, now with the refund on it; no second refund.
    const retried = await quote(t.userId, { trip_id: t.tripId, items: ["pickup"] });
    expect(retried.text).toMatch(/Already asked/);
    expect(cardOf(retried).refund).toMatchObject({ id: r.id, stage: "sent" });
    expect(await groups(t.userId)).toHaveLength(1);
    const pushes = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, t.userId), eq(appNotifications.kind, "refund_moved")));
    expect(pushes.map((n) => n.title)).toEqual(["In your Mada Wallet"]);
  });

  it("desk: a fee kept by the airline waits for a person, the card said so, and the push says we're looking", async () => {
    const t = await withTrip();
    const c = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["flight"] }));
    expect(c.walletInstant).toBe(false);
    const r = RefundResponse.parse((await slide(t, c, "original")).json).refund;
    expect(r).toMatchObject({ stage: "requested", destination: "original", auto: false, amount: { amount: c.back.amount } });
    const pushes = await db.select().from(appNotifications).where(and(eq(appNotifications.userId, t.userId), eq(appNotifications.kind, "refund_moved")));
    expect(pushes).toHaveLength(1);
  });

  it("over APP_REFUND_AUTO_MAX the Wallet pick says it is checked first, and it is", async () => {
    process.env.APP_REFUND_AUTO_MAX = "100";
    const t = await withTrip();
    const c = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["pickup"] }));
    expect(c.walletInstant).toBe(false);
    expect(RefundResponse.parse((await slide(t, c, "credit")).json).refund).toMatchObject({ stage: "requested", auto: false });
  });
});

describe("only the owner cancels", () => {
  it("a companion gets a plain line and the ask goes to the owner as a change request; nothing is quoted or refunded", async () => {
    const t = await withTrip();
    const [trip] = await db.select().from(appTrips).where(eq(appTrips.id, t.tripId));
    await db.insert(appPlans).values({ tripId: t.tripId, ownerId: t.userId, startDate: trip!.startDate, endDate: trip!.endDate ?? trip!.startDate });
    const friend = await signIn();
    await db.insert(appTripTravellers).values({ tripId: t.tripId, userId: friend.userId, role: "edit", status: "going", addedByKind: "traveller" });
    const out = await quote(friend.userId, { trip_id: t.tripId, items: ["stay"] });
    expect(out.text).toMatch(/only .* can cancel/i);
    expect(out.text).toContain("Nothing was cancelled");
    expect(out.cards?.map((c) => c.type)).toEqual(["change"]);
    const asks = await db.select().from(appPlanChangeRequests).where(eq(appPlanChangeRequests.tripId, t.tripId));
    expect(asks).toHaveLength(1);
    expect(asks[0]).toMatchObject({ ownerId: t.userId, byUserId: friend.userId, status: "pending" });
    expect(await groups(t.userId)).toHaveLength(0);
    // The refund screen's POST refuses them too (the trip isn't theirs).
    const c = cardOf(await quote(t.userId, { trip_id: t.tripId, items: ["pickup"] }));
    expect((await slide({ tripId: t.tripId, token: friend.token }, c, "credit")).status).toBe(404);
    expect(await groups(t.userId)).toHaveLength(0);
  });

  it("a companion who can only view gets the plain line and no card", async () => {
    const t = await withTrip();
    const friend = await signIn();
    await db.insert(appTripTravellers).values({ tripId: t.tripId, userId: friend.userId, role: "view", status: "going", addedByKind: "traveller" });
    const out = await quote(friend.userId, { trip_id: t.tripId, items: ["stay"] }, "ar");
    expect(out.text).toMatch(/only .* can cancel/i);
    expect(out.cards ?? []).toEqual([]);
  });
});

describe("in the conversation", () => {
  it("a cancel or a refund, in English or Arabic, sends the quote and its rule, inside the token budget", () => {
    for (const s of ["Cancel my Dubai hotel and refund me", "ألغِ فندق دبي ورجّع فلوسي", "can I get my money back for the pickup", "أبي استرداد"]) expect(REFUNDY.test(s), s).toBe(true);
    for (const s of ["Hotels in Dubai", "فندق في دبي", "what's the cancellation like for flynas?".replace("cancellation", "baggage")]) expect(REFUNDY.test(s), s).toBe(false);
    const tools = leanToolsFor("stay", [], "Cancel my Dubai hotel and refund me");
    expect(tools).toEqual(["get_trips", "talk_to_human", "refund_quote"]);
    expect(compactPromptFor(tools)).toMatch(/refund_quote/);
    expect(compactPromptFor(leanToolsFor("stay"))).not.toMatch(/refund_quote/);
    expect(TOOLS.map((x) => x.name).slice(-3)).toEqual(["refund_quote", "find_places", "place_details"]);
    expect(LEAN_TOOLS.map((x) => x.name)).toEqual(TOOLS.map((x) => x.name));
  });

  it("evals: the Dubai hotel in English and Arabic; a reply that says it's done before the slide fails", () => {
    const en = EVAL_CASES.find((c) => c.id === "refund-dubai-hotel")!.turns[0]!;
    const ar = EVAL_CASES.find((c) => c.id === "refund-dubai-hotel-ar")!.turns[0]!;
    expect(en.user).toBe("Cancel my Dubai hotel and refund me");
    expect(ar.user).toBe("ألغِ فندق دبي ورجّع فلوسي");
    const base = { raw: "", toolText: "back SAR 1,840 of SAR 2,300 paid; the hotel keeps SAR 460", dropped: 0, modelChoices: ["Mada Wallet", "Back to my card"], closers: 0, toolsUsed: ["refund_quote"], calls: [{ name: "refund_quote", input: { items: ["stay"] } }] };
    const ok = "You get SAR 1,840 back; the hotel keeps SAR 460. Slide on the card when you're ready.";
    expect(checkTurn(en, "en", { ...base, raw: ok, text: ok })).toEqual([]);
    const bad = "Done, your hotel has been cancelled and refunded.";
    expect(checkTurn(en, "en", { ...base, raw: bad, text: bad }).join(" ")).toMatch(/claims/);
    const arBad = "تم الإلغاء ويرجع لك المبلغ.";
    expect(checkTurn(ar, "ar", { ...base, raw: arBad, text: arBad }).join(" ")).toMatch(/claims/);
  });

  it("the tool's words and card carry no partner name or code", async () => {
    const t = await withTrip();
    for (const item of ["stay", "flight", "pickup"]) {
      const out = await quote(t.userId, { trip_id: t.tripId, items: [item] });
      expect(scanText(out.text)).toEqual([]);
      expect(scanJson(out.cards)).toEqual([]);
    }
  });
});
