import "server-only";
import type Anthropic from "@anthropic-ai/sdk";
import { and, eq } from "drizzle-orm";
import {
  DESTINATIONS, addDays, formatSar, isIsoDay, nameIn, planTitle, rangeLabel,
  type ChatCard, type ChatPlanRow, type Person, type Plan, type PlanChangeResponse, type PlanItem, type PlaceInput, type PlanOp,
} from "@mada/shared";
import { db } from "@/db";
import { appTrips } from "@/db/app-schema";
import { appPlans } from "@/db/app-schema-plans";
import { AppError } from "../http";
import { applyOps, createPlan, setOrigin } from "../plans/ops";
import { markEventsSeen, ownTrip, readPlan, unseenEvents } from "../plans/plans";
import { TEMPLATES } from "../plans/templates";
import { attachTrip } from "./store";
import type { ToolCtx, ToolOut } from "./tools";

/*
 * Ask's tools for the living plan (ASK-INTEGRATED.md §3.5, §8): create, read, change, move the start, find something
 * for one item, open a screen. They call the same plan functions as the app's plan routes (plans/ops.ts), as the
 * signed-in traveller, so a manual edit is never overwritten (versions) and a booked item is never moved by Mada.
 * The model proposes the shape; the server places it. What the model reads back is a short gist (item ids shortened
 * to 8 characters, statuses only when not an idea); what the traveller sees is the plan card or a diff card.
 * Nothing here prices, books or shares anything.
 */

/* ───────────── what the model reads ───────────── */

const ref = (id: string) => id.slice(0, 8);
const nm = (p: { name: string; city?: string | null } | null | undefined) => (p ? p.city || p.name : null);
const STATUS_WORD: Record<string, string> = { priced: "priced", requested: "with the team", held: "held", booked: "booked", confirmed: "confirmed", cancelled: "cancelled", skipped: "skipped" };

/** One item in a few words: "[a1b2c3d4] drive Singapore → Melaka 240 km 3h05m". */
function itemWords(it: PlanItem): string {
  const what = it.kind === "leg" ? `${it.mode ?? "leg"} ${nm(it.from) ?? "?"}→${nm(it.to) ?? "?"}`
    : it.kind === "stay" ? `stay ${nm(it.place) ?? it.title}${it.nights ? ` ${it.nights}n` : ""}`
    : `${it.kind} ${it.title}`;
  const at = it.startsAt ? ` ${it.startsAt.slice(11, 16)}` : "";
  // The drive interface's own line is the only km or time Mada may say (U4); an estimate never has a time.
  const d = it.drive?.line ? ` (${it.drive.line})` : it.drive && it.drive.km != null ? ` ${Math.round(it.drive.km)} km${it.drive.minutes != null && !it.drive.estimate ? ` ${hm(it.drive.minutes)}` : " (estimate, no time)"}` : "";
  // A price only as a tool, a quote or a booking gave it (U7); a price that ran out is checked again, never quoted.
  const price = it.status === "priced" && it.price ? `: ${formatSar(it.price.amount)}${it.price.demo ? " sample fare" : ""}` : it.quote ? `: quote ready ${formatSar(it.quote.amount)}` : "";
  const st = STATUS_WORD[it.status] ? ` (${STATUS_WORD[it.status]}${it.booking?.name ? `: ${it.booking.name}` : price})` : it.priceExpired ? " (price expired: offer to check it again)" : "";
  return `[${ref(it.id)}] ${what}${at}${d}${st}`;
}
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;

const ORIGIN_FROM: Record<string, string> = { said: "as they said", memory: "their remembered home airport", booking: "where their last trip left from", profile: "their profile", default: "a default" };
const START_CHIPS = "<next>Riyadh | Jeddah | Somewhere else</next>";

/** The plan as the model reads it (§3.5: ≤ 600 characters where it can, the days cut first). */
export function planGist(p: Plan, people: Person[]): string {
  const who = p.travellerIds.map((id) => people.find((x) => x.id === id)?.firstName).filter(Boolean).join(", ");
  const head = `plan_id=${p.id} version=${p.version} · "${p.title}" · ${p.startDate} to ${p.endDate}, ${p.days} days (D1 is the first; n = nights)${who ? ` · ${who}` : ""}`;
  const start = p.origin ? `Starts from ${nm(p.origin)} (${ORIGIN_FROM[p.origin.source] ?? "known"}).` : `Start unknown: ask where they leave from, one question, ${START_CHIPS}`;
  const days: string[] = [];
  for (let d = 0; d < p.days; d++) {
    const items = p.items.filter((i) => i.day === d && i.status !== "skipped");
    if (items.length) days.push(`D${d + 1}: ${items.map(itemWords).join("; ")}`);
  }
  const todo = p.checks.filter((c) => c.state === "todo" || c.state === "warn").map((c) => c.text);
  const drives = p.items.filter((i) => i.kind === "leg" && i.mode === "drive");
  const timed = drives.every((i) => i.drive?.minutes != null && !i.drive.estimate);
  const tail = [
    todo.length ? `To do: ${todo.slice(0, 3).join("; ")}.` : null,
    p.totals?.ready ? `Ready to book: ${p.totals.ready}, ${formatSar(p.totals.priced)} in all${p.totals.demo ? " (sample fares, not bookable)" : ""}; the card's Book what's ready opens the pay sheet.` : null,
    drives.length && !timed ? "Drive km and times only as written here; none written: never say one." : null,
  ].filter(Boolean).join(" ");
  let body = days.join("\n");
  const budget = 760 - head.length - start.length - tail.length;
  if (body.length > budget) body = `${body.slice(0, Math.max(120, budget - 40)).replace(/[^\n;]*$/, "")}… (the rest is on the plan card)`;
  return [head, start, body, tail].filter(Boolean).join("\n");
}

/* ───────────── what the traveller sees ───────────── */

export function planRow(it: Pick<PlanItem, "kind" | "mode" | "title" | "place" | "from" | "to" | "status" | "nights" | "startsAt" | "drive" | "booking">): ChatPlanRow {
  return {
    kind: it.kind, mode: it.mode, title: it.title, place: nm(it.place), from: nm(it.from), to: nm(it.to), status: it.status, nights: it.nights,
    at: it.startsAt ? it.startsAt.slice(11, 16) : null,
    km: it.drive?.km != null ? Math.round(it.drive.km) : null,
    // A straight-line estimate has a distance and never a time (§4.4).
    minutes: it.drive?.minutes != null && !it.drive.estimate ? it.drive.minutes : null,
    borders: (it.drive?.crossings?.length ? it.drive.crossings.map((c) => c.name ?? c.to ?? "").filter(Boolean) : []).slice(0, 4), booking: it.booking?.name ?? null,
  };
}

export function planCard(p: Plan, people: Person[]): ChatCard {
  const days: { day: number; items: ChatPlanRow[] }[] = [];
  for (let d = 0; d < Math.min(p.days, 7); d++) {
    const items = p.items.filter((i) => i.day === d && i.status !== "skipped");
    days.push({ day: d, items: items.slice(0, 5).map(planRow) });
  }
  return {
    type: "plan", planId: p.id, tripId: p.tripId, version: p.version, title: p.title, start: p.startDate, end: p.endDate,
    origin: p.origin ? { name: nm(p.origin)!, code: p.origin.code ?? null, source: p.origin.source } : null, originNeeded: p.originNeeded,
    travellers: p.travellerIds.map((id) => people.find((x) => x.id === id)).filter((x): x is Person => !!x).map((x) => ({ name: x.firstName, self: !!x.isSelf })),
    days, more: Math.max(0, p.days - 7),
    todo: p.checks.filter((c) => c.state === "todo" || c.state === "warn").slice(0, 3).map((c) => ({ key: c.key, state: c.state, days: c.days.length ? c.days : c.nights })),
    totals: p.totals ? { priced: p.totals.priced, booked: p.totals.booked, demo: p.totals.demo, ready: p.totals.ready } : null,
  };
}

export function diffCard(from: number, r: PlanChangeResponse): ChatCard {
  return {
    type: "plan_diff", planId: r.plan.id, tripId: r.plan.tripId, title: r.plan.title, from, to: r.plan.version,
    changes: r.changes.slice(0, 8).map((c) => {
      const it = c.itemId ? r.plan.items.find((i) => i.id === c.itemId) : null;
      const row = it ? planRow(it) : { kind: "note" as const, mode: null, title: c.title, place: c.op === "origin" ? c.title : null, from: null, to: null, status: "idea" as const, nights: null, at: null, km: null, minutes: null, borders: [], booking: null };
      return { op: c.op, day: c.day, row };
    }),
    untouched: r.untouched.slice(0, 4).map((u) => u.title),
  };
}

/* ───────────── inputs ───────────── */

const str = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);
/** "JED" or "Jeddah" as the plan functions take a place; the server resolves it. */
const placeOf = (v: unknown): PlaceInput | null => {
  const s = str(v)?.slice(0, 120);
  if (!s) return null;
  return /^[A-Z]{3}$/.test(s) ? { name: s, code: s, kind: "airport" } : { name: s };
};
/** Household ids the model gave, only this household's; the account holder when none are left. */
function who(ctx: ToolCtx, ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const ok = [...new Set(list)].filter((id) => ctx.people.some((p) => p.id === id));
  if (ok.length) return ok;
  const self = ctx.people.find((p) => p.isSelf) ?? ctx.people[0];
  return self ? [self.id] : [];
}

/** The trip a plan id (or a trip id) names, if it's the caller's. */
async function tripOfPlan(ctx: ToolCtx, v: unknown): Promise<string | null> {
  const id = str(v);
  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) return ctx.tripId ?? null;
  const [p] = await db.select({ tripId: appPlans.tripId }).from(appPlans).where(and(eq(appPlans.id, id), eq(appPlans.ownerId, ctx.ownerId)));
  if (p) return p.tripId;
  try { return (await ownTrip(ctx.ownerId, id)).id; } catch { return null; }
}

/** An item by the short id the gist showed (or the full one). */
function itemOf(p: Plan, v: unknown): PlanItem | null {
  const s = str(v)?.replace(/^\[|\]$/g, "").toLowerCase();
  if (!s || s.length < 6) return null;
  const hits = p.items.filter((i) => i.id.startsWith(s));
  return hits.length === 1 ? hits[0]! : null;
}

const NO_PLAN = "No plan found for that id. Use the plan_id from create_plan or get_plan, or create one.";
const why = (e: unknown, version?: number): ToolOut => {
  const details = e instanceof AppError ? e.extra.details : undefined;
  if (e instanceof AppError && e.code === "PLAN_CHANGED") return { text: `Not changed: the plan changed since you read it (now version ${(details as { version?: number } | undefined)?.version ?? version ?? "newer"}), maybe on the plan screen. Read it again with get_plan, then make the change on that version.`, isError: true };
  if (e instanceof AppError && e.code === "VALIDATION" && (details as { booked?: boolean } | undefined)?.booked) return { text: "Not changed: that item is booked, so Mada doesn't move or remove it here. Offer to change it through the booking (open_in_app with screen change) or to add something around it.", isError: true };
  if (e instanceof AppError && e.code === "VALIDATION") return { text: `Not changed: ${Object.values(e.extra.fields ?? {}).join("; ") || e.message}.`, isError: true };
  if (e instanceof AppError && e.code === "NOT_FOUND") return { text: NO_PLAN, isError: true };
  throw e;
};

/* ───────────── the tools ───────────── */

type Run = (ctx: ToolCtx, a: Record<string, unknown>) => Promise<ToolOut>;

export const PLAN_RUN: Record<string, Run> = {
  async create_plan(ctx, a) {
    const template = str(a.template_id);
    const stops = (Array.isArray(a.stops) ? a.stops : []).flatMap((s) => {
      const o = (s ?? {}) as Record<string, unknown>;
      const place = placeOf(o.place);
      return place ? [{ place, nights: Number.isInteger(o.nights) ? Math.min(30, Math.max(0, o.nights as number)) : 1 }] : [];
    }).slice(0, 12);
    if (!template && !stops.length) return { text: "Not made: name at least one place (stops), or a template_id.", isError: true };
    const start = str(a.start);
    if (start && (!isIsoDay(start) || start < ctx.today)) return { text: `Not made: the start ${start} is not a day from today (${ctx.today}) on, YYYY-MM-DD.`, isError: true };
    // The trip: the one named, else this chat's trip if it has no plan yet, else a new planning trip.
    let tripId: string | null = null;
    const named = str(a.trip_id);
    if (named) {
      try { tripId = (await ownTrip(ctx.ownerId, named)).id; } catch { return { text: "Not made: that trip id isn't one of theirs. Leave trip_id null for a new trip.", isError: true }; }
    } else if (ctx.tripId) {
      const [has] = await db.select({ id: appPlans.id }).from(appPlans).where(eq(appPlans.tripId, ctx.tripId));
      if (has) return { text: `This chat's trip already has a plan (plan_id=${has.id}). Change it with update_plan or set_origin after get_plan; a different trip belongs in a chat of its own.`, isError: true };
      tripId = ctx.tripId;
    }
    if (tripId) {
      const [has] = await db.select({ id: appPlans.id }).from(appPlans).where(eq(appPlans.tripId, tripId));
      if (has) return { text: `That trip already has a plan (plan_id=${has.id}). Read it with get_plan and change it with update_plan.`, isError: true };
    }
    const must = (Array.isArray(a.must) ? a.must : []).map(str).filter((x): x is string => !!x).map((x) => x.slice(0, 80)).slice(0, 6);
    const days = Number.isInteger(a.days) ? Math.min(30, Math.max(1, a.days as number)) : null;
    const plan = await createPlan(ctx.ownerId, {
      templateId: template && TEMPLATES[template] ? template : null,
      origin: placeOf(a.origin),
      returnTo: placeOf(a.return_to) ?? "same",
      ...(stops.length && !(template && TEMPLATES[template]) ? { stops } : {}),
      start: start ?? null, days, travellerIds: who(ctx, a.traveller_ids),
      pace: a.pace === "easy" || a.pace === "full" ? a.pace : "normal", must,
      travelMode: a.travel_mode === "fly" || a.travel_mode === "drive" || a.travel_mode === "mixed" ? a.travel_mode : null,
    }, { by: "ask", tripId });
    // The chat follows its plan: a chat about nothing yet becomes this trip's chat (§1.1, §2.2).
    if (ctx.threadId && !ctx.tripId) {
      await attachTrip(ctx.ownerId, ctx.threadId, plan.tripId);
      ctx.tripId = plan.tripId;
    }
    const startLine = plan.originNeeded ? "" : plan.origin && plan.origin.source !== "said" ? ` Say where it starts in a few words ("Starting from ${nm(plan.origin)}.") so they can change it.` : "";
    return {
      text: `Plan made and shown as a card. ${planGist(plan, ctx.people)}\nSay it in one sentence (the places in order, and "Review it").${startLine}${start ? "" : ` No start day was said: it starts ${plan.startDate} by default, say so in a few words.`}`,
      cards: [planCard(plan, ctx.people)],
    };
  },

  async get_plan(ctx, a) {
    const tripId = await tripOfPlan(ctx, a.plan_id);
    if (!tripId) return { text: NO_PLAN, isError: true };
    try {
      const plan = await readPlan(ctx.ownerId, tripId);
      return { text: planGist(plan, ctx.people) };
    } catch (e) { return why(e); }
  },

  async update_plan(ctx, a) {
    const tripId = await tripOfPlan(ctx, a.plan_id);
    if (!tripId) return { text: NO_PLAN, isError: true };
    let plan: Plan;
    try { plan = await readPlan(ctx.ownerId, tripId); } catch (e) { return why(e); }
    const version = Number.isInteger(a.version) ? (a.version as number) : plan.version;
    const ops: PlanOp[] = [];
    for (const raw of (Array.isArray(a.ops) ? a.ops : []).slice(0, 10)) {
      const o = (raw ?? {}) as Record<string, unknown>;
      const day = Number.isInteger(o.day) ? Math.max(0, (o.day as number) - 1) : null;
      const after = o.after ? itemOf(plan, o.after)?.id ?? null : null;
      const w = (o.what ?? null) as Record<string, unknown> | null;
      const item = w ? {
        ...(w.kind ? { kind: w.kind as "activity" } : {}), ...(w.mode !== undefined ? { mode: (w.mode ?? null) as "drive" | null } : {}),
        ...(str(w.title) ? { title: str(w.title)!.slice(0, 120) } : {}),
        ...(w.place !== undefined ? { place: placeOf(w.place) } : {}), ...(w.from !== undefined ? { from: placeOf(w.from) } : {}), ...(w.to !== undefined ? { to: placeOf(w.to) } : {}),
        ...(typeof w.at === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(w.at) ? { at: w.at } : {}),
        ...(Number.isInteger(w.nights) ? { nights: w.nights as number } : {}),
      } : null;
      if (o.op === "add") {
        if (!item?.title || !item.kind) return { text: "Not changed: an add needs what (kind and title).", isError: true };
        ops.push({ op: "add", day, afterItemId: after, item: { ...item, kind: item.kind, title: item.title } });
        continue;
      }
      const it = itemOf(plan, o.item);
      if (!it) return { text: `Not changed: no item "${String(o.item ?? "")}" on this plan. Use the ids in brackets from get_plan.`, isError: true };
      if (o.op === "update") ops.push({ op: "update", itemId: it.id, item: item ?? {} });
      else if (o.op === "move") ops.push({ op: "move", itemId: it.id, day: day ?? it.day, afterItemId: after });
      else if (o.op === "remove" || o.op === "skip" || o.op === "unskip") ops.push({ op: o.op, itemId: it.id });
    }
    if (!ops.length) return { text: "Not changed: no ops.", isError: true };
    try {
      const r = await applyOps(ctx.ownerId, tripId, { version, ops }, "ask");
      return { text: `Changed and shown as a card. ${planGist(r.plan, ctx.people)}\nSay what changed in a few words.`, cards: [diffCard(version, r)] };
    } catch (e) { return why(e, version); }
  },

  async set_origin(ctx, a) {
    const tripId = await tripOfPlan(ctx, a.plan_id);
    if (!tripId) return { text: NO_PLAN, isError: true };
    const origin = placeOf(a.origin);
    if (!origin) return { text: "Not changed: say the new start (a city or airport code).", isError: true };
    let before: Plan;
    try { before = await readPlan(ctx.ownerId, tripId); } catch (e) { return why(e); }
    try {
      const r = await setOrigin(ctx.ownerId, tripId, { origin, returnTo: placeOf(a.return_to) ?? "same" }, "ask");
      const repriced = before.items.some((i) => i.kind === "leg" && (i.status === "priced" || i.offerId) && r.changes.some((c) => c.itemId === i.id));
      const kept = r.untouched.length
        ? ` Booked and not changed: ${r.untouched.map((u) => u.title).join(", ")}. Say it plainly and offer, as choices: a connecting leg before it, changing the booking (open_in_app change), or keeping the old start.`
        : "";
      return {
        text: `Start changed and shown as a card. ${planGist(r.plan, ctx.people)}${repriced ? "\nPrices on the changed legs need checking again." : ""}${kept}\nSay the new start in a few words.`,
        cards: [diffCard(before.version, r)],
      };
    } catch (e) { return why(e, before.version); }
  },

  async find_for_item(ctx, a) {
    const tripId = await tripOfPlan(ctx, a.plan_id);
    if (!tripId) return { text: NO_PLAN, isError: true };
    let plan: Plan;
    try { plan = await readPlan(ctx.ownerId, tripId); } catch (e) { return why(e); }
    const it = itemOf(plan, a.item);
    if (!it) return { text: "No such item on this plan. Use the ids in brackets from get_plan.", isError: true };
    const day = it.day ?? 0;
    const date = addDays(plan.startDate, day);
    if (date < ctx.today) return { text: `That day (${date}) has passed.`, isError: true };
    const travellers = plan.travellerIds.length ? plan.travellerIds : who(ctx, null);
    const keyOf = (p: PlanItem["place"]) => (p?.code ? Object.values(DESTINATIONS).find((d) => d.code === p.code)?.key ?? null : null);
    const byHand = (kind: string, where: string | null, until: string | null) =>
      `Not sold live in the app: the team at Mada arranges it. Confirm in one line (${[where, date, until].filter(Boolean).join(", ")}, ${travellers.length} travellers), ask how to reach them (<next>WhatsApp | Call me | Here in the app</next>), then create_request kind ${kind} with destination_name ${where ?? "the place"} and depart ${date}${until ? ` and return ${until}` : ""}.`;
    const { runTool } = await import("./tools");
    if (it.kind === "leg" && it.mode === "flight") {
      const dest = keyOf(it.to);
      const from = it.from?.code;
      if (dest && (from === "RUH" || from === "JED" || from === "DMM")) {
        return runTool("search_flights", { destination: dest, from, depart: date, return: null, traveller_ids: travellers, infants: 0, cabin: null }, ctx);
      }
      return { text: byHand("flight", nm(it.to), null) };
    }
    if (it.kind === "stay") {
      const dest = keyOf(it.place);
      if (dest) return runTool("search_stays", { destination: dest, check_in: date, nights: it.nights ?? 1, traveller_ids: travellers, wishes: null }, ctx);
      // Anywhere else: the same instant search, by the place's name and its point when the plan knows it.
      const p = it.place;
      const name = p ? [p.city || p.name, p.country].filter(Boolean).join(", ") : "";
      if (name) {
        const point = p?.lat != null && p?.lng != null ? { lat: p.lat, lng: p.lng } : undefined;
        return runTool("search_stays", { destination: null, place: name, check_in: date, nights: it.nights ?? 1, traveller_ids: travellers, wishes: null, ...(point ? { _point: point } : {}) }, ctx);
      }
      return { text: byHand("stay", nm(it.place), addDays(date, it.nights ?? 1)) };
    }
    if (it.kind === "car" || (it.kind === "leg" && (it.mode === "drive" || it.mode === "transfer"))) {
      // A car for the drive days: from the first drive leg to the last, picked up where the first one starts.
      const drives = plan.items.filter((i) => i.kind === "leg" && i.mode === "drive" && i.day != null);
      const last = drives.length ? Math.max(...drives.map((i) => i.day!)) : day;
      return { text: `${byHand("car", nm(it.from) ?? nm(it.place), addDays(plan.startDate, last))} Ask where to pick the car up only if it isn't clear; a car crossing a border needs the team to confirm the rules.` };
    }
    if (it.kind === "leg") return { text: byHand("general", `${nm(it.from)} → ${nm(it.to)} by ${it.mode ?? "road"}`, null) };
    if (it.kind === "meal") return { text: byHand("food", nm(it.place), null) };
    return { text: byHand("todo", `${it.title}${nm(it.place) ? `, ${nm(it.place)}` : ""}`, null) };
  },

  async open_in_app(ctx, a) {
    const screen = String(a.screen) as Extract<ChatCard, { type: "link" }>["screen"];
    const needsTrip = ["plan", "trip", "money", "change", "refund"].includes(screen);
    let id: string | null = null;
    if (needsTrip) {
      id = await tripOfPlan(ctx, a.id);
      if (!id) return { text: "Which trip? Use a trip id from the context or the plan_id.", isError: true };
    }
    return { text: `A button to ${screen === "plan" ? "the plan" : screen} is shown. Say in one line what they'll find there.`, cards: [{ type: "link", screen, id }] };
  },
};

export const PLAN_STATUS = {
  en: { create_plan: "Putting the plan together", get_plan: "Reading your plan", update_plan: "Changing the plan", set_origin: "Moving the start", find_for_item: "Looking for options", open_in_app: "One moment" },
  ar: { create_plan: "نجهّز الخطة", get_plan: "نقرأ خطتك", update_plan: "نعدّل الخطة", set_origin: "نغيّر نقطة البداية", find_for_item: "ندوّر لك خيارات", open_in_app: "لحظة" },
} as const;

/* ───────────── the schemas ───────────── */

const nullable = (type: string, extra: Record<string, unknown> = {}) => ({ type: [type, "null"], ...extra });
const obj = (properties: Record<string, unknown>) => ({ type: "object" as const, additionalProperties: false, required: Object.keys(properties), properties });
const ids = { type: "array", items: { type: "string" }, description: "Person ids from the household list in the context. The account holder when unsaid." };
const planId = { type: ["string", "null"], description: "plan_id from the plan; null: this chat's trip." };
const KINDS = ["leg", "stay", "car", "activity", "meal", "note"];
const MODES = ["flight", "drive", "train", "ferry", "transfer", "walk", null];

export const PLAN_TOOLS: Anthropic.Beta.BetaTool[] = [
  {
    name: "create_plan",
    description: "Make a living plan for a trip of several days or places: the places in order with nights in each. The server builds the days, flights, drives, stays and checks, attaches this chat to the trip and shows the plan card. Free and reversible.",
    strict: true,
    input_schema: obj({
      trip_id: nullable("string", { description: "A trip id from the context the plan is for; else null." }),
      template_id: { type: ["string", "null"], enum: [...Object.keys(TEMPLATES), null] },
      origin: nullable("string", { description: "The start, only if said (city or airport code); null: what we know." }),
      return_to: nullable("string", { description: "Null: back to the start." }),
      stops: { type: "array", items: obj({ place: { type: "string" }, nights: { type: "integer" } }), description: "Places in order, in English, with nights (0 to pass through)." },
      start: nullable("string", { description: "First day YYYY-MM-DD if said; null: default." }),
      days: nullable("integer"),
      traveller_ids: ids,
      pace: { type: "string", enum: ["easy", "normal", "full"] },
      must: { type: "array", items: { type: "string" }, description: "Things they named to do (up to 6)." },
      travel_mode: { type: ["string", "null"], enum: ["fly", "drive", "mixed", null], description: "drive: road trip; mixed: fly there, drive between." },
    }),
  },
  {
    name: "get_plan",
    description: "Read the plan: days, items with their [ids] and statuses, what's left to do, the version.",
    strict: true,
    input_schema: obj({ plan_id: planId }),
  },
  {
    name: "update_plan",
    description: "Change up to 10 plan items at once, on the version you last read. Booked items can't be moved or removed. Times only as said or from a tool.",
    strict: true,
    input_schema: obj({
      plan_id: planId,
      version: { type: "integer" },
      ops: {
        type: "array",
        items: obj({
          op: { type: "string", enum: ["add", "update", "move", "remove", "skip", "unskip"] },
          item: nullable("string", { description: "[id] from the plan; null for add." }),
          day: nullable("integer", { description: "1 = first day." }),
          after: nullable("string"),
          what: {
            type: ["object", "null"], additionalProperties: false, required: ["kind", "mode", "title", "place", "from", "to", "at", "nights"],
            properties: {
              kind: { type: "string", enum: KINDS }, mode: { type: ["string", "null"], enum: MODES }, title: { type: "string" },
              place: nullable("string"), from: nullable("string"), to: nullable("string"), at: nullable("string"), nights: nullable("integer"),
            },
          },
        }),
      },
    }),
  },
  {
    name: "set_origin",
    description: "Move the plan's start (\"we're leaving from Jeddah\"): the first and last legs and the title are rebuilt; booked legs stay and are reported.",
    strict: true,
    input_schema: obj({
      plan_id: planId,
      origin: { type: "string", description: "City or airport code." },
      return_to: nullable("string", { description: "Null: back to the new start." }),
    }),
  },
  {
    name: "find_for_item",
    description: "Options for one plan item with the plan's dates, places and travellers: flights for a flight leg, stays for a stay; for what isn't sold live (a car, a driver, a train) it says what the team needs.",
    strict: true,
    input_schema: obj({ plan_id: planId, item: { type: "string", description: "[id] from the plan." } }),
  },
  {
    name: "open_in_app",
    description: "A button to a screen in the app: the plan, the trip, documents, the household, eSIMs, requests, money, change or refund a booking, support.",
    strict: true,
    input_schema: obj({
      screen: { type: "string", enum: ["plan", "trip", "documents", "household", "esim", "requests", "money", "change", "refund", "support"] },
      id: nullable("string", { description: "Trip or plan id for plan, trip, money, change, refund." }),
    }),
  },
];

/** The same tools in fewer words, for openai-compatible providers (prompt.ts LEAN). */
export const PLAN_LEAN: Record<string, { d: string; p?: Record<string, string | null> }> = {
  create_plan: { d: "A plan of several days or places: stops in order with nights. Builds legs, stays, checks; shows the card.", p: { trip_id: null, origin: "Only if said.", return_to: null, start: null, must: null, travel_mode: "drive: road trip." } },
  get_plan: { d: "Read the plan: [ids], statuses, version.", p: { plan_id: "Null: this chat's." } },
  update_plan: { d: "Change plan items on the version read. Booked items stay.", p: { plan_id: "Null: this chat's." } },
  set_origin: { d: "Move the plan's start; legs and title rebuilt.", p: { plan_id: "Null: this chat's.", return_to: null } },
  find_for_item: { d: "Options for one plan item; what isn't live goes to the team.", p: { plan_id: "Null: this chat's." } },
  open_in_app: { d: "A button to an app screen." },
};

/* ───────────── the chat around a plan ───────────── */

const SAID: Record<string, string> = { traveller: "the traveller", desk: "the team at Mada", system: "a booking" };

/** One change in a few words, for the context line (§3.6). */
function changeWords(e: { op: string; diff: Record<string, unknown> }): string | null {
  const d = e.diff ?? {};
  const title = String(d.title ?? "").slice(0, 60);
  const day = typeof d.day === "number" ? ` to day ${d.day + 1}` : "";
  switch (e.op) {
    case "move": return `moved ${title}${day}`;
    case "add": return `added ${title}${typeof d.day === "number" ? ` on day ${d.day + 1}` : ""}`;
    case "remove": return `removed ${title}`;
    case "update": return `changed ${title}`;
    case "status": return `${title} is now ${String(d.to ?? "changed")}`;
    case "origin": return `the start is now ${String(d.to ?? "")}`;
    case "create": return null;
    default: return null;
  }
}

/**
 * The context lines for a chat about a trip with a plan: the plan's id and version (so changes start from it), and what
 * others changed since Mada last spoke (§3.6). The events read are returned to be marked seen once the turn is done.
 */
export async function planContext(ownerId: string, tripId: string | null | undefined): Promise<{ lines: string[]; seen: string[] }> {
  if (!tripId) return { lines: [], seen: [] };
  const [p] = await db.select({ id: appPlans.id, version: appPlans.version }).from(appPlans).where(and(eq(appPlans.tripId, tripId), eq(appPlans.ownerId, ownerId)));
  if (!p) return { lines: [], seen: [] };
  const events = (await unseenEvents(ownerId, tripId)).filter((e) => e.byKind !== "ask");
  const lines = [`This chat's trip has a plan: plan_id=${p.id} version=${p.version}. Read it with get_plan before changing it.`];
  for (const by of ["traveller", "desk", "system"] as const) {
    const said = events.filter((e) => e.byKind === by).map((e) => changeWords({ op: e.op, diff: e.diff as Record<string, unknown> })).filter(Boolean);
    if (said.length) lines.push(`Since the last message ${SAID[by]} changed the plan: ${[...new Set(said)].slice(0, 8).join("; ")}. Use it; don't recite it.`);
  }
  return { lines, seen: events.map((e) => e.id) };
}

export async function markPlanSeen(ownerId: string, tripId: string | null | undefined, ids: string[]): Promise<void> {
  if (tripId && ids.length) await markEventsSeen(ownerId, tripId, ids);
}

/**
 * The chat's title from its plan (§2.3): "Riyadh → Singapore → Penang · 12–18 Dec", «الرياض ← سنغافورة ← بينانغ» in
 * Arabic; a renamed trip keeps its name. Null when the trip has no plan.
 */
export async function planTitleFor(ownerId: string, tripId: string | null | undefined, lang: "en" | "ar"): Promise<string | null> {
  if (!tripId) return null;
  const [p] = await db.select({ id: appPlans.id, renamed: appTrips.title }).from(appPlans).innerJoin(appTrips, eq(appTrips.id, appPlans.tripId))
    .where(and(eq(appPlans.tripId, tripId), eq(appPlans.ownerId, ownerId)));
  if (!p) return null;
  const plan = await readPlan(ownerId, tripId);
  const stops: { name: string; city?: string | null }[] = [];
  for (const it of plan.items) {
    if (it.status === "skipped") continue;
    const at = it.kind === "leg" && it.to && it.to.kind !== "place" && !(plan.origin && it.day === plan.days - 1 && nm(it.to) === nm(plan.returnTo)) ? it.to : it.kind === "stay" ? it.place : null;
    if (at && nm(at) !== nm(stops.at(-1))) stops.push(at);
  }
  const main = p.renamed ? plan.title : planTitle(plan.origin ? { name: nameIn(nm(plan.origin)!, lang) } : null, stops.map((s) => ({ name: nameIn(nm(s)!, lang) })), lang === "ar");
  return `${main} · ${rangeLabel(plan.startDate, plan.endDate, lang)}`;
}
