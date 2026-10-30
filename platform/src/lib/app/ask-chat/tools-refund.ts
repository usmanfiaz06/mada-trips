import "server-only";
import { createHash } from "node:crypto";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import type Anthropic from "@anthropic-ai/sdk";
import { formatSar, RefundReason, refundQuoteItems, t, timing, type ChatCard, type RefundQuoteItem, type TripDetail, type TripPayment } from "@mada/shared";
import { db } from "@/db";
import { appRefundGroups, appRefundItems } from "@/db/app-schema-trips";
import { clearOf, decideAuto } from "../finance/auto-approve";
import { ensureCharges, listPayments, toRefundView } from "../trips/money";
import { overview } from "../trips/overview";
import { tripDetail } from "../trips/core";
import { roleOf, sharedTrips } from "../trips/travellers";
import { changeCard, requestChange } from "../trips/change-requests";
import type { ToolCtx, ToolOut } from "./tools";

/*
 * Cancel and refund in Ask (docs/app/ASK-REFUND.md). One read-only tool, refund_quote: for the items the traveller names
 * (the stay, the flights, the pickup, an eSIM or activity), what comes back under the same rules as the refund screen
 * (refundQuoteItems: GACA and fare rules, the free-cancellation window), what the hotel or airline keeps, and whether
 * the Mada Wallet pick is approved at once (the same auto-approval rule, decideAuto). It never cancels anything: the
 * `refund_quote` card does, only on the traveller's slide, through the refund screen's own POST /trips/{id}/refunds,
 * with a client key made from the trip and the payments, so a second slide or a retried turn finds the same refund.
 * Only the trip's owner gets a quote. A companion's ask goes to the owner as a change request (trips/change-requests).
 */

const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const ITEMS = ["stay", "flight", "pickup", "esim", "activity", "everything"] as const;
type Want = (typeof ITEMS)[number];

export const REFUND_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "refund_quote",
    description: "Cancel and refund part of a trip: what comes back now under the fare and hotel rules, what the hotel or airline keeps, and whether it's approved at once. Shows a card; nothing is cancelled until the traveller slides on it.",
    strict: true,
    input_schema: obj({
      trip_id: nullable("string", { description: "The trip id from the context; null: found by city." }),
      city: nullable("string", { description: "The trip's city in English when no id, e.g. 'Dubai'." }),
      items: { type: "array", items: { type: "string", enum: [...ITEMS] }, description: "What they want cancelled: the stay (hotel), flight, pickup, esim, activity, or everything." },
      reason: { type: "string", enum: [...RefundReason.options], description: "plans unless they said: ill, docs (visa or passport), airline, else (found something else), other." },
    }),
  },
];
export const REFUND_TOOL_NAMES = new Set(REFUND_TOOLS.map((x) => x.name));

export const REFUND_LEAN: Record<string, { d: string; p?: Record<string, string | null> }> = {
  refund_quote: { d: "Cancel and refund: what comes back by the rules, what's kept, instant or not (card). Cancels nothing.", p: { trip_id: null, city: "English; null with an id.", items: "What to cancel.", reason: "plans unless said." } },
};

export const REFUND_STATUS = { en: { refund_quote: t("chat.refund.status", undefined, "en") }, ar: { refund_quote: t("chat.refund.status", undefined, "ar") } } as const;

/** Read before a cancel or a refund is promised (prompt.ts adds it to a turn that reads as one). */
export const REFUNDY = /\b(?:cancel|cancell?ing|cancell?ation|refund|money back)\b|ألغ|إلغاء|الغاء|الغي|كنسل|رجّع|رجع (?:لي )?(?:فلوس|المبلغ)|فلوسي|استرداد|استرجاع/i;

/* ───────────── which trip, whose ───────────── */

const words = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const sameCity = (a: string, b: string) => { const x = words(a), y = words(b); return !!x && !!y && (x === y || x.includes(y) || y.includes(x)); };

type Found = { own: TripDetail } | { shared: { tripId: string; title: string; ownerName: string; role: string } } | null;

/** The trip it's about: the id given, the chat's, then theirs in the city said (their own first, then one shared with them). */
async function tripOf(ctx: ToolCtx, tripId: string | null, city: string | null): Promise<Found> {
  for (const id of [tripId, ctx.tripId]) {
    if (!id) continue;
    const who = await roleOf(ctx.ownerId, id).catch(() => null);
    if (!who) continue;
    if (who.role === "owner") {
      const tr = await tripDetail(ctx.ownerId, id, null).catch(() => null);
      if (tr && (!city || sameCity(tr.city, city))) return { own: tr };
    } else if (!city || sameCity(who.trip.city, city)) {
      const s = (await sharedTrips(ctx.ownerId)).find((x) => x.tripId === id);
      return { shared: { tripId: id, title: s?.title ?? who.trip.city, ownerName: s?.ownerName ?? "", role: who.role } };
    }
  }
  const r = await overview(ctx.ownerId, null).catch(() => null);
  const mine = r?.upcoming.find((x) => (city ? sameCity(x.city, city) : true));
  if (mine) { const tr = await tripDetail(ctx.ownerId, mine.id, null).catch(() => null); if (tr) return { own: tr }; }
  const shared = (await sharedTrips(ctx.ownerId).catch(() => [])).find((x) => (city ? sameCity(x.title, city) : true));
  if (shared) {
    const who = await roleOf(ctx.ownerId, shared.tripId);
    if (who) return { shared: { tripId: shared.tripId, title: shared.title, ownerName: shared.ownerName, role: who.role } };
  }
  return null;
}

/** The payments the words name. An eSIM and an activity are both extras; the eSIM is told apart by its title. */
export function paymentsFor(pays: readonly TripPayment[], want: readonly Want[]): TripPayment[] {
  if (want.includes("everything")) return [...pays];
  const esim = (p: TripPayment) => /\besim\b|data/i.test(p.title);
  return pays.filter((p) => want.some((w) => (w === "esim" ? p.item === "extra" && esim(p) : w === "activity" ? p.item === "extra" && !esim(p) : p.item === w)));
}

/** One key for these payments on this trip: a second slide, or the card from a retried turn, finds the same refund. */
export const refundKey = (ownerId: string, tripId: string, paymentIds: readonly string[]) =>
  `ask-${createHash("sha256").update(`${ownerId}|${tripId}|${[...paymentIds].sort().join(",")}`).digest("hex").slice(0, 40)}`;

/** The live refund already asked for any of these payments (not declined or taken back), newest first. */
async function askedBefore(ownerId: string, paymentIds: readonly string[]) {
  const [g] = await db.select({ g: appRefundGroups }).from(appRefundItems).innerJoin(appRefundGroups, eq(appRefundGroups.id, appRefundItems.groupId))
    .where(and(inArray(appRefundItems.chargeId, [...paymentIds]), eq(appRefundGroups.ownerId, ownerId), ne(appRefundGroups.stage, "rejected"), ne(appRefundGroups.stage, "withdrawn")))
    .orderBy(desc(appRefundGroups.createdAt)).limit(1);
  return g?.g ?? null;
}

const KEPT_BY: Record<string, "hotel" | "airline" | "driver"> = { stay: "hotel", flight: "airline", pickup: "driver" };
const NO_CLAIM = "Nothing is cancelled or refunded yet: only their slide on the card does that. Never say it is cancelled or refunded.";

/* ───────────── the quote ───────────── */

export type RefundQuote = {
  trip: TripDetail; chosen: TripPayment[]; quotes: RefundQuoteItem[]; card: Extract<ChatCard, { type: "refund_quote" }>;
  cardInstant: boolean;
};

/** What the card shows: the refund screen's own numbers for these payments, and whether each pick is approved at once. */
export async function quoteFor(ownerId: string, trip: TripDetail, chosen: TripPayment[], reason: RefundReason, all: readonly TripPayment[]): Promise<RefundQuote | null> {
  const quotes = refundQuoteItems(trip, chosen).filter((q) => q.back.amount > 0 || q.askAnyway);
  if (!quotes.length) return null;
  const used = all.filter((p) => quotes.some((q) => q.paymentId === p.id));
  const paid = quotes.reduce((a, q) => a + q.paid.amount, 0);
  const cash = quotes.reduce((a, q) => a + q.cash.amount, 0);
  const backTotal = quotes.reduce((a, q) => a + q.back.amount, 0);
  const kept = quotes.reduce((a, q) => a + (q.paid.amount - q.back.amount), 0);
  const anyway = backTotal === 0;
  const instal = quotes.filter((q) => q.method === "tabby" || q.method === "tamara");
  const allInstal = instal.length > 0 && instal.length === quotes.length;
  const clear = clearOf(quotes, timing(trip.clock.phase).airlineCancelled);
  // The same decision createRefund makes for each pick (read only: nothing is written).
  const [wallet, toCard] = anyway || instal.length ? [{ ok: false }, { ok: false }] : await Promise.all((["credit", "original"] as const).map((destination) => decideAuto(db, { userId: ownerId, clear, destination, amount: cash })));
  const kinds = [...new Set(quotes.map((q) => q.item))];
  const label = used.find((p) => p.method !== "tabby" && p.method !== "tamara")?.label ?? used[0]?.label ?? "your card";
  const paymentIds = quotes.map((q) => q.paymentId);
  // A refund for these that was declined or taken back keeps its key: a new ask gets its own.
  let clientKey = refundKey(ownerId, trip.id, paymentIds);
  const [old] = await db.select({ id: appRefundGroups.id, stage: appRefundGroups.stage }).from(appRefundGroups).where(and(eq(appRefundGroups.ownerId, ownerId), eq(appRefundGroups.clientKey, clientKey)));
  if (old && (old.stage === "rejected" || old.stage === "withdrawn")) clientKey = refundKey(ownerId, trip.id, [...paymentIds, old.id]);
  return {
    trip, chosen: used, quotes, cardInstant: !!toCard?.ok,
    card: {
      type: "refund_quote", tripId: trip.id, title: used.map((p) => p.title).join(" · ").slice(0, 200), city: trip.city, paymentIds, items: kinds, reason,
      clientKey, paid: { amount: paid, currency: "SAR" }, back: { amount: cash, currency: "SAR" },
      kept: kept > 0 && !anyway ? { amount: kept, currency: "SAR" } : null, keptBy: kept > 0 && !anyway ? (kinds.length === 1 ? KEPT_BY[kinds[0]!] ?? "supplier" : "supplier") : null,
      rule: quotes.map((q) => q.rule).filter(Boolean).join(" · ").slice(0, 300), anyway,
      instalments: allInstal ? (instal[0]!.method as "tabby" | "tamara") : null, card: label, walletInstant: !!wallet?.ok, refund: null,
    },
  };
}

const sar = (h: number) => formatSar(h);

export const REFUND_RUN: Record<string, (ctx: ToolCtx, a: Record<string, unknown>) => Promise<ToolOut>> = {
  async refund_quote(ctx, a) {
    const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
    const want = (Array.isArray(a.items) ? a.items : []).filter((x): x is Want => ITEMS.includes(x as Want));
    const reason = RefundReason.options.find((r) => r === a.reason) ?? "plans";
    const found = await tripOf(ctx, str(a.trip_id), str(a.city));
    if (!found) return { text: `No trip of theirs${str(a.city) ? ` to ${str(a.city)}` : ""} that we know. Say so in one line and ask which trip.`, isError: true };

    // A companion: only the organiser cancels and gets the money back. Their ask goes to the organiser as a change.
    if ("shared" in found) {
      const s = found.shared;
      const owner = s.ownerName || "the organiser";
      if (s.role === "view") return { text: `${s.title} is ${owner}'s booking: only ${owner} can cancel it and get a refund. Say that in one plain line and suggest they ask ${owner}. Nothing was cancelled.` };
      const what = want.includes("everything") || !want.length ? "the trip" : want.map((w) => (w === "stay" ? "the hotel" : w === "flight" ? "the flights" : `the ${w}`)).join(" and ");
      try {
        const r = await requestChange(ctx.ownerId, s.tripId, { summary: `Cancel ${what} and refund`, ops: [{ op: "add", day: null, item: { kind: "note", title: `Cancel ${what} and refund` } }] }, { threadId: ctx.threadId ?? null, ask: true });
        return {
          text: `${s.title} is ${owner}'s booking: only ${owner} can cancel and refund it. Asked ${owner} as a change request. Say in one plain line that only ${owner} can cancel it and you've asked them ("${t("people.line.waiting", { owner }, ctx.lang)}"). Nothing was cancelled.`,
          cards: r.change ? [changeCard(r.change)] : [],
        };
      } catch {
        return { text: `${s.title} is ${owner}'s booking: only ${owner} can cancel it and get a refund. Say that in one plain line and suggest they ask ${owner}. Nothing was cancelled.` };
      }
    }

    const trip = found.own;
    await ensureCharges(trip);
    const all = await listPayments(trip);
    if (!all.length) return { text: `Nothing paid on the ${trip.city} trip (trip_id=${trip.id}) through Mada, so nothing to refund here. Say so and offer talk_to_human if they booked another way.` };
    const chosen = paymentsFor(all, want.length ? want : ["everything"]);
    if (!chosen.length) return { text: `The ${trip.city} trip has no ${want.join(" or ")} paid through Mada. What is paid: ${all.map((p) => p.title).join("; ")}. Ask which they mean.` };

    // Asked before (a second ask, a retried turn): the card shows where that refund stands, never a second one.
    const before = chosen.some((p) => p.refunded) ? await askedBefore(ctx.ownerId, chosen.map((p) => p.id)) : null;
    if (before) {
      const v = toRefundView(before);
      const q = await quoteFor(ctx.ownerId, trip, chosen, reason, all).catch(() => null);
      const where = v.destination === "credit" ? (v.stage === "sent" ? "in their Mada Wallet" : "for the Mada Wallet, with the team to check") : v.stage === "requested" ? "with the team to check" : v.stage === "approved" ? `approved, on its way to ${v.card}` : `sent to ${v.card}`;
      const card: ChatCard | null = q ? { ...q.card, refund: v } : null;
      return { text: `Already asked: ${v.title}, ${sar(v.amount.amount)}, ${where}. No second refund. Say where it stands in one line; the card shows the tracker.`, cards: card ? [card] : [] };
    }

    const q = await quoteFor(ctx.ownerId, trip, chosen, reason, all);
    if (!q) {
      const rules = refundQuoteItems(trip, chosen).map((x) => `${x.title}: ${x.rule}${x.why ? ` (${x.why})` : ""}`).join("; ");
      return { text: `Nothing comes back for ${chosen.map((p) => p.title).join(", ")} under the rules: ${rules || "it can't be refunded"}. Say it plainly in their words, with the rule, and offer talk_to_human only if they want a person to look.` };
    }
    const c = q.card;
    const lines = q.quotes.map((x) => `- ${x.title}: paid ${sar(x.paid.amount)}, back ${sar(x.cash.amount)} (${x.rule}${x.why ? `; ${x.why}` : ""})`);
    const wallet = c.walletInstant ? "approved at once" : "after the team checks it, usually within a day";
    const card = q.cardInstant ? "approved at once, in the bank in 5–10 working days" : "after the team checks it, then 5–10 working days";
    const where = c.anyway ? `Nothing comes back by the rules; the slide asks the team anyway.`
      : c.instalments ? `It goes back through ${c.instalments === "tamara" ? "Tamara" : "Tabby"} (instalments), after the team checks it.`
      : `To the Mada Wallet (bookings only, never expires, Recommended): ${wallet}. Back to ${c.card}: ${card}. They choose on the card.`;
    return {
      text: [
        `Cancelling on the ${trip.city} trip (trip_id=${trip.id}): back ${sar(c.back.amount)} of ${sar(c.paid.amount)} paid${c.kept ? `; the ${c.keptBy === "supplier" ? "suppliers" : c.keptBy} keep ${sar(c.kept.amount)}` : ", all of it"}.`,
        ...lines, where, NO_CLAIM,
        `Say what comes back and what's kept in one or two lines and point to the card (slide "Cancel and refund"). If they're unsure, explain the rule plainly. Don't push the Mada Wallet beyond the Recommended tag.`,
      ].join("\n"),
      cards: [c],
    };
  },
};
