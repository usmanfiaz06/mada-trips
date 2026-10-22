import "server-only";
import {
  DESTINATIONS, MemoryKind, ageOn, formatSar, landmarkById, nameIn, parseStayWishes, refineStays, isIsoDay,
  type ChatCard, type ChatPay, type DemoFlag, type EsimPlan, type FlightOption, type Person, type StayOption,
} from "@mada/shared";
import { AppError } from "../http";
import { checkEntry, searchFlights, searchStays } from "../booking/search";
import { hotelTitle, nameQuery, nameScore, namedHotels } from "../booking/named-hotel";
import { REQUEST_PROMISE_MIN, createRequest } from "../booking/requests";
import { flightsMode } from "../switches";
import { priceDraft } from "../booking/pricing";
import { esimPlans } from "../esim/service";
import { hotelContent } from "../suppliers/hotelbeds/content";
import { overview } from "../trips/overview";
import { tripDetail } from "../trips/core";
import { openThread, sendMessage } from "../support/threads";
import { presenceFor } from "../desk/agents";
import { redact } from "./guard";
import { isSensitive, saveFact, unkeepable } from "./memory";
import { PEOPLE_RUN, peopleStatus } from "./tools-people";
import { PLAN_RUN, PLAN_STATUS } from "./tools-plan";
import { esimOffer, priceItems, resolveItemIds } from "../plans/booking";
import { homeAirport } from "../plans/plans";
import { DOC_RUN } from "./tools-docs";

/*
 * The tools, run on the server as the signed-in traveller, through the same functions the app's own routes call (so
 * the same checks hold: offers belong to the caller, people to the household). Each returns a short text the model
 * reads (prices formatted exactly as the cards show them) plus what the app draws: cards, a pay sheet, a handoff.
 * Nothing here charges, books or cancels.
 * What the model reads is kept short (tokens per minute are the limit on free tiers): at most 3 options, each with
 * only what a reply says (the cards carry the rest). Sample fares say `demo: true`; flights by request
 * (APP_FLIGHTS_MODE=request) return `{"mode":"request"}` and no prices at all.
 */

export type ToolCtx = {
  ownerId: string; people: Person[]; today: string; lang: "en" | "ar"; ipHash: string | null; demo: Set<DemoFlag>;
  /** For `remember`: Mada's last reply asked to remember something, and this message says yes (memory.ts consentOf). */
  consent?: { asked: boolean; yes: boolean };
  /** The chat and the trip it's about (tools-plan.ts): a plan made here attaches the chat to its trip; a change a companion
   * asks for updates this chat later (tools-people.ts). */
  threadId?: string | null;
  tripId?: string | null;
};
export type ToolOut = { text: string; cards?: ChatCard[]; pay?: ChatPay; handoff?: { threadId: string; agent: string | null }; status?: string; isError?: boolean; mode?: "request"; /** A fact was saved (the reply says so once). */ remembered?: string };

const sar = (h: number) => formatSar(h);
const hm = (min: number) => `${Math.floor(min / 60)}h${String(min % 60).padStart(2, "0")}m`;
const destName = (k: string) => DESTINATIONS[k]?.name ?? k;
const iso = (d: unknown) => (typeof d === "string" && isIsoDay(d) ? d : null);

/** Ids the model gave, kept only when they are this household's; the account holder when none are left. */
export function whoOf(ctx: ToolCtx, ids: unknown): string[] {
  const list = Array.isArray(ids) ? ids.filter((x): x is string => typeof x === "string") : [];
  const ok = [...new Set(list)].filter((id) => ctx.people.some((p) => p.id === id));
  if (ok.length) return ok;
  const self = ctx.people.find((p) => p.isSelf) ?? ctx.people[0];
  return self ? [self.id] : [];
}

/** One flight as the model reads it: what a reply names (airline, times, stops, refundable, the total). Dates and who are in the header. */
export const flightLine = (f: FlightOption, i: number) =>
  `${i + 1}. id=${f.id} · ${f.label} · ${f.airline} ${f.out.flightNumber} · ${f.out.from} ${f.out.dep} → ${f.out.arr} (${hm(f.out.durationMin)})${f.back ? ` · back ${f.back.dep} → ${f.back.arr}` : ""} · ${f.stop ?? "direct"} · ${f.refundable ? "refundable" : "not refundable"} · ${sar(f.total.amount)} all in`;

/** One stay as the model reads it; nights, check-in and who are in the header. */
export const stayLine = (s: StayOption, i: number, ev: string[] = []) =>
  `${i + 1}. id=${s.id}${s.hotel ? ` · hotel_code=${s.hotel.code}` : ""} · ${s.name} · ${s.area}${s.facts?.stars ? ` · ${s.facts.stars} stars` : ""} · ${sar(s.total.amount)} all in · ${s.freeCancelUntil ? `free cancellation until ${s.freeCancelUntil}` : s.cancellation}${ev.length ? ` · fits: ${ev.join("; ")}` : s.facts?.amenities.length ? ` · has ${s.facts.amenities.slice(0, 4).join(", ")}` : ""}`;

/** "18:40" (today) or "18:40 on 2026-10-21", Riyadh time: what the reply says the team answers by. */
export function riyadhClock(iso: string, today: string): string {
  const d = new Date(iso);
  const day = d.toLocaleDateString("en-CA", { timeZone: "Asia/Riyadh" });
  const time = d.toLocaleTimeString("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", minute: "2-digit", hour12: false });
  return day === today ? time : `${time} on ${day}`;
}

/** Said first when the fares are samples, so the model can't present them as real (prompt.ts "Truth"). */
const DEMO = "demo: true (sample fares from a test catalogue: not real, not bookable)";

/** "15–22 Nov" (or "28 Nov–3 Dec"): the stay's dates as a reply says them. */
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
function stayDates(checkIn: string, nights: number): string {
  const out = new Date(Date.parse(`${checkIn}T00:00:00Z`) + nights * 86_400_000).toISOString().slice(0, 10);
  const d = (x: string) => ({ day: Number(x.slice(8, 10)), mon: MONTHS[Number(x.slice(5, 7)) - 1]! });
  const a = d(checkIn), b = d(out);
  return a.mon === b.mon ? `${a.day}–${b.day} ${a.mon}` : `${a.day} ${a.mon}–${b.day} ${b.mon}`;
}

/** A named hotel we hold, with nothing we can book for these dates: said plainly, no other hotel in its place. */
export const noRoomsText = (names: string[], checkIn: string, nights: number) =>
  `${names.join("; ")}: no rooms we can book online for ${stayDates(checkIn, nights)} (only ${names.length > 1 ? "these hotels were" : "this hotel was"} checked). Say exactly that, plainly. Next step: other dates, or create_request kind stay so the team at Mada asks the hotel directly. Never present another hotel as this one; any other hotel you offer is an alternative and is called one.`;

/** A name we hold no hotel under: we can't find it online, which never means it doesn't exist. */
export const unknownHotelText = (named: string, where: string) =>
  `"${named}" is not among the hotels we can book online in ${where}. Say we can't find it online here (never that it doesn't exist) and offer create_request kind stay: the team at Mada books it by hand. Other hotels only if offered as alternatives, called so.`;

/** Flights by request: no prices, and what to offer instead, with the desk's promise (booking/requests.ts). */
export const requestModeText = (to: string, depart: string, ret: string | null) =>
  `{"mode":"request"} Flights to ${to} (${depart}${ret ? ` to ${ret}` : ", one way"}) are found by hand: there are no fares, prices, times or flight numbers here. Confirm the trip back in one line (where, when, who), say the team at Mada finds the fares and gets back within ${REQUEST_PROMISE_MIN / 60} hours, any time of day, and ask how to reach them: <next>WhatsApp | Call me | Here in the app</next>. When they answer, call create_request with kind flight, the destination name, the dates and contact_preference.`;

const planLine = (p: EsimPlan, i: number) => `${i + 1}. id=${p.id} · ${p.gb == null ? "unlimited" : `${p.gb} GB${p.daily ? " a day" : ""}`} · ${p.days} days · ${p.coverage.name} · ${sar(p.price.amount)} each eSIM · ${p.fits ? "lasts the trip" : "a top-up covers the rest"}`;

/** Any object as short, private-free JSON: no photos, links, passport or eSIM codes, then redacted again. */
function compact(v: unknown, max = 2500): string {
  // First names only reach any provider: surnames, full names, birthdays, contacts and documents never do.
  const drop = /photo|image|url|focal|brand|passport|iccid|activation|lpa|qr|smdp|matching|document|file|token|secret|surname|givenNames|lastName|familyName|fullName|legalName|dateOfBirth|dob|email|phone|mobile|card|iban|nationalId|iqama/i;
  const s = JSON.stringify(v, (k, x) => (drop.test(k) || x === null || (Array.isArray(x) && !x.length) ? undefined : x));
  return redact(s.length > max ? `${s.slice(0, max)}…` : s).text;
}

type Run = (ctx: ToolCtx, input: Record<string, unknown>) => Promise<ToolOut>;

const RUN: Record<string, Run> = {
  async search_flights(ctx, a) {
    const destination = String(a.destination);
    const depart = iso(a.depart);
    if (!DESTINATIONS[destination] || !depart) return { text: "Not searched: need a destination key and a departure day (YYYY-MM-DD).", isError: true };
    if (depart < ctx.today) return { text: `Not searched: ${depart} is in the past (today is ${ctx.today}).`, isError: true };
    // Not said: the remembered home airport (memory → origin), else Riyadh.
    const from: "RUH" | "JED" | "DMM" = a.from === "RUH" || a.from === "JED" || a.from === "DMM" ? a.from : await homeAirport(ctx.ownerId);
    const ret = iso(a.return);
    // Flights by request (switches.ts): the same answer the app's own flows give, never a price.
    if (flightsMode() === "request") return { text: requestModeText(destName(destination), depart, ret && ret > depart ? ret : null), mode: "request" };
    const travellerIds = whoOf(ctx, a.traveller_ids);
    const r = await searchFlights(ctx.ownerId, {
      from, destination, depart, return: ret && ret > depart ? ret : null, travellerIds,
      infants: Number.isInteger(a.infants) ? Math.min(4, Math.max(0, a.infants as number)) : 0,
      cabin: a.cabin === "premium" || a.cabin === "business" ? a.cabin : "economy",
    }, ctx.demo);
    const options = r.options.slice(0, 3);
    const search = { destination, destinationName: r.destinationName, from, depart, return: r.return, travellerIds };
    if (!options.length) return { text: `No flights found ${from} → ${r.destinationName} on ${depart} (outcome ${r.outcome}; checked ${r.checked}).${r.unavailable.length ? ` Not answering: ${r.unavailable.map((u) => u.airline).join(", ")}.` : ""}` };
    const demo = options.some((o) => o.demo);
    return {
      text: `${demo ? `${DEMO}\n` : ""}Flights ${from} → ${r.destinationName}, ${depart}${r.return ? ` to ${r.return}` : " one way"}, checked ${r.checked}, for ${travellerIds.length} people:\n${options.map(flightLine).join("\n")}${r.bundle ? `\nHotel and pickup can be added: ${r.bundle.hotelName}, ${r.bundle.nights} nights, ${sar(r.bundle.total.amount)} more.` : ""}`,
      cards: [{ type: "flights", search, options }],
    };
  },

  async search_stays(ctx, a) {
    const destination = String(a.destination);
    const checkIn = iso(a.check_in);
    const nights = Number.isInteger(a.nights) ? Math.min(60, Math.max(1, a.nights as number)) : 0;
    if (!DESTINATIONS[destination] || !checkIn || !nights) return { text: "Not searched: need a destination key, a check-in day and nights.", isError: true };
    if (checkIn < ctx.today) return { text: `Not searched: ${checkIn} is in the past (today is ${ctx.today}).`, isError: true };
    const travellerIds = whoOf(ctx, a.traveller_ids);
    // A hotel they named: only that hotel (or the few under that name) is searched, and nothing else stands in for it.
    const named = typeof a.hotel_name === "string" ? a.hotel_name.trim().slice(0, 80) : "";
    const query = named ? nameQuery(named, destination) : [];
    const held = query.length ? await namedHotels(destination, query) : null;
    if (held?.known && !held.hotels.length) return { text: unknownHotelText(named, destName(destination)) };
    const codes = (held?.hotels ?? []).map((h) => h.code).filter((c): c is number => c != null);
    const r = await searchStays(ctx.ownerId, { destination, checkIn, nights, travellerIds }, ctx.demo, codes.length ? { hotelCodes: codes } : {});
    const options = held ? r.options.filter((o) => (o.hotel?.code && codes.includes(Number(o.hotel.code))) || nameScore(query, o.name) > 0) : r.options;
    if (held && !options.length) {
      return { text: held.known ? noRoomsText(held.hotels.map((h) => hotelTitle(h.name)), checkIn, nights) : unknownHotelText(named, r.destinationName) };
    }
    const wishes = typeof a.wishes === "string" && a.wishes.trim() ? parseStayWishes(a.wishes, destination).wishes : [];
    const refined = wishes.length ? refineStays(options, wishes, ctx.lang) : null;
    const picked = refined ? (refined.matches.length ? refined.matches : refined.closest) : options.map((option) => ({ option, ev: [] as string[] }));
    const top = picked.slice(0, 3);
    const nearWish = wishes.find((w) => w.k === "near");
    const near = nearWish && nearWish.k === "near" ? landmarkById(nearWish.id)?.name ?? null : null;
    const search = { destination, destinationName: r.destinationName, from: null, depart: checkIn, return: null, travellerIds };
    if (!top.length) return { text: `No stays found in ${r.destinationName} from ${checkIn} for ${nights} nights (outcome ${r.outcome}).` };
    return {
      text: `${held ? `The hotel they named ("${named}"): only ${top.length > 1 ? "these hotels by that name were" : "this hotel was"} searched; say it is the one they asked for.\n` : ""}Stays in ${r.destinationName}, ${nights} nights from ${checkIn}, for ${travellerIds.length} people${r.shape ? ` (ranked for ${r.shape.shape})` : ""}${refined ? `; wishes: ${refined.matches.length ? "these fit" : "none of these is confirmed for every wish in our hotel details (they may just not list it); these are closest. Say that, never that no such hotel exists"}` : ""}:\n${top.map((x, i) => stayLine(x.option, i, x.ev)).join("\n")}`,
      cards: [{ type: "stays", search, nights, options: top.map((x) => x.option), near }],
    };
  },

  async get_hotel(_ctx, a) {
    const code = Number(a.hotel_code);
    if (!Number.isInteger(code) || code <= 0) return { text: "No such hotel code.", isError: true };
    const h = await hotelContent(code);
    if (!h) return { text: "We hold no details for this hotel beyond its card." };
    return { text: compact({ name: h.name, category: h.category, address: h.address, city: h.city, facilities: h.facilities?.map((f) => f.name).slice(0, 30), description: h.description?.slice(0, 700) }) };
  },

  async esim_plans(ctx, a) {
    const days = Number.isInteger(a.days) ? Math.min(90, Math.max(1, a.days as number)) : 7;
    const trip = typeof a.trip_id === "string" ? a.trip_id : undefined;
    const r = await esimPlans(ctx.ownerId, { destination: String(a.where).slice(0, 40), days: String(days), ...(trip ? { tripId: trip } : {}) });
    const where = r.plans[0]?.coverage.name ?? String(a.where).slice(0, 40);
    if (!r.plans.length) return { text: `No eSIM plans for ${where} (outcome ${r.outcome}).` };
    return { text: `eSIM plans for ${where}, ${r.days} days:\n${r.plans.slice(0, 3).map(planLine).join("\n")}`, cards: [{ type: "esim", where, days: r.days, plans: r.plans.slice(0, 3) }] };
  },

  async plan_car_now(_ctx, a) {
    const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim().slice(0, 80) : null);
    const card: ChatCard = { type: "car", city: s(a.city), from: s(a.from), to: s(a.to), when: a.when === "in15" ? "in15" : "now" };
    return { text: `Car card shown: ${card.when}${card.city ? `, in ${card.city}` : ""}${card.from ? `, from ${card.from}` : ""}${card.to ? `, to ${card.to}` : ""}. The traveller confirms the meeting point in the app; no price or driver yet.`, cards: [card] };
  },

  async get_trips(ctx) {
    const r = await overview(ctx.ownerId, null);
    const line = (t: (typeof r.upcoming)[number]) => `id=${t.id} · ${t.city} · ${t.startDate}${t.endDate ? ` to ${t.endDate}` : ""} · ${t.status} · ${t.travellerNames.join(", ")}${t.flight ? ` · ${t.flight.code} ${t.flight.date} ${t.flight.depart}` : ""}${t.stayName ? ` · ${t.stayName}` : ""}`;
    const text = [`Upcoming: ${r.upcoming.length ? "" : "none"}`, ...r.upcoming.slice(0, 6).map(line), `Past: ${r.past.length ? "" : "none"}`, ...r.past.slice(0, 4).map(line)].join("\n");
    return { text, cards: r.upcoming.length ? [{ type: "trips", trips: r.upcoming.slice(0, 4) }] : undefined };
  },

  async get_trip(ctx, a) {
    const t = await tripDetail(ctx.ownerId, String(a.trip_id), null);
    return { text: compact(t, 1500) };
  },

  async get_household(ctx) {
    return { text: ctx.people.map((p) => personLine(p, ctx.today)).join("\n") || "Nobody saved yet." };
  },

  async entry_rules(ctx, a) {
    const destination = String(a.destination);
    const depart = iso(a.depart);
    if (!DESTINATIONS[destination] || !depart) return { text: "Not checked: need a destination key and an arrival day.", isError: true };
    const r = await checkEntry(ctx.ownerId, { destination, travellerIds: whoOf(ctx, a.traveller_ids), depart, return: iso(a.return) }, ctx.demo);
    const checks = r.checks.map((c) => `- ${c.name ?? "everyone"}: ${c.key}${c.need ? ` (${c.need})` : ""}${c.blocking ? ", needed before travel" : ""}${c.done ? ", done" : ""}: ${c.text}${c.service ? ` · Mada can arrange it (${c.service})` : ""}${c.renewal ? ` · renewal fee ${sar(c.renewal.fee)}, by ${c.renewal.by}` : ""}`);
    return { text: `${r.countryName} for ${r.nationalities.join(" and ")} passports, checked ${r.checkedOn}.${r.okText ? ` ${r.okText}` : ""}\n${checks.join("\n")}`, cards: [{ type: "entry", destination, entry: r }] };
  },

  async create_request(ctx, a) {
    const kind = String(a.kind) as "visa" | "umrah" | "car" | "food" | "todo" | "flight" | "stay" | "general" | "car_rental" | "driver";
    const summary = redact(String(a.summary ?? "")).text.slice(0, 500);
    // The team gets only complete requests: where and when for anything that happens somewhere, and how to reach them.
    const where = typeof a.destination_name === "string" && a.destination_name.trim() ? a.destination_name.trim() : "";
    const missing = [
      !where && kind !== "visa" && kind !== "general" ? "where (the city or area)" : null,
      !iso(a.depart) && kind !== "visa" && kind !== "general" ? "when (the date)" : null,
      a.contact_preference !== "call" && a.contact_preference !== "whatsapp" && a.contact_preference !== "in_app" ? "how to reach them" : null,
    ].filter(Boolean);
    if (missing.length) return { text: `Not sent yet. Still needed: ${missing.join(", ")}. Ask for the first missing one in one short question with choices in <next>, then call create_request again with everything.${missing.includes("how to reach them") && missing.length === 1 ? " <next>WhatsApp | Call me | Here in the app</next>" : ""}`, isError: true };
    const isSearch = kind === "flight" || kind === "stay";
    const travellerIds = whoOf(ctx, a.traveller_ids);
    // For an item on the plan (U7): the item reads "With the team · back by …"; a car or a driver carries where and when.
    const [planItemId] = await resolveItemIds(ctx.ownerId, ctx.tripId ?? null, a.item_id);
    const car = kind === "car_rental" || kind === "driver"
      ? { pickup: where.slice(0, 80) || null, dropoff: null, from: iso(a.depart), to: iso(a.return), driverAge: null, size: null }
      : null;
    const r = await createRequest(ctx.ownerId, {
      kind, query: summary, travellerIds, note: "",
      contactPreference: a.contact_preference === "call" || a.contact_preference === "whatsapp" || a.contact_preference === "in_app" ? a.contact_preference : null,
      contactWindow: typeof a.contact_window === "string" && a.contact_window.trim() ? redact(a.contact_window).text.slice(0, 60) : null,
      ...(isSearch ? { search: { destination: null, destinationName: typeof a.destination_name === "string" ? a.destination_name.slice(0, 60) : null, from: kind === "flight" ? await homeAirport(ctx.ownerId) : null, depart: iso(a.depart), return: iso(a.return), cabin: null, carrier: null } } : {}),
      ...(planItemId ? { planItemId } : ctx.tripId ? { tripId: ctx.tripId } : {}), ...(car ? { car } : {}),
    } as Parameters<typeof createRequest>[1], ctx.ipHash);
    const by = r.promisedBy ? riyadhClock(r.promisedBy, ctx.today) : null;
    const how = r.contact ? ({ call: `by a call${r.contact.window ? ` (${r.contact.window})` : ""}`, whatsapp: "on WhatsApp", in_app: "here in the app" } as const)[r.contact.preference] : "here in the app";
    return { text: `Request ${r.id} noted for the team at Mada: ${r.title}${r.summary ? ` (${r.summary})` : ""}. The team gets back to the traveller ${how}${by ? ` by ${by}` : ""}. Say it in one line: "We've noted it and the team will get back to you by ${by ?? "then"}".`, cards: [requestCard(ctx, r, travellerIds, { where: where || null, depart: iso(a.depart), return: iso(a.return) })] };
  },

  async price_quote_for_pay(ctx, a) {
    const travellerIds = whoOf(ctx, a.traveller_ids);
    const id = typeof a.offer_id === "string" ? a.offer_id : null;
    let draft: ChatPay["draft"];
    if (a.kind === "flight" && id) draft = { kind: "trip", flightOfferId: id, bundle: false, travellerIds };
    else if (a.kind === "stay" && id) draft = { kind: "stay", stayOfferId: id, travellerIds };
    else if (a.kind === "esim" && typeof a.package_id === "string") draft = { kind: "esim", count: Math.max(1, travellerIds.length), packageId: a.package_id, travellerIds };
    else return { text: "Need the option id from a search this conversation (or the eSIM plan id).", isError: true };
    const { preview } = await priceDraft(ctx.ownerId, { draft, useCredit: true }, { demo: ctx.demo });
    // For items on the plan (U7): the choice prices them, and the order books them onto the plan's trip.
    const itemIds = await resolveItemIds(ctx.ownerId, ctx.tripId ?? null, a.item_ids);
    if (itemIds.length) {
      const offer = draft.kind === "esim"
        ? await esimOffer(ctx.ownerId, { packageId: draft.packageId!, count: draft.count, where: null, tripId: ctx.tripId ?? null, travellerIds, total: preview.subtotal.amount, demo: !!preview.demoFare })
        : id!;
      const priced = await priceItems(ctx.ownerId, itemIds, offer);
      if (priced.itemIds.length) draft = { ...draft, planItemIds: priced.itemIds, ...(priced.tripId ? { tripId: priced.tripId } : {}) } as ChatPay["draft"];
    }
    return {
      text: `${preview.demoFare ? `${DEMO}. Say this is a sample fare for testing. ` : ""}Pay sheet opened in the app: ${preview.title}, ${sar(preview.total.amount)} all in${preview.credit.used.amount ? ` after ${sar(preview.credit.used.amount)} Mada credit` : ""}. ${preview.rule}. Nothing is charged until the traveller slides to pay.`,
      pay: { draft, title: preview.title },
      status: "pay",
    };
  },

  async talk_to_human(ctx, a) {
    const th = await openThread(ctx.ownerId);
    const summary = redact(String(a.summary ?? "")).text.slice(0, 900);
    await sendMessage(ctx.ownerId, th.id, { body: `${a.urgent ? "[Urgent] " : ""}${summary}` }, ctx.ipHash);
    const p = await presenceFor(ctx.ownerId, null).catch(() => null);
    const agent = p?.online && p.agent ? p.agent.name : null;
    return { text: `Handed to the desk${agent ? `: ${agent} is on duty and has the summary` : ": the team has the summary"}. Say that ${agent ? `${agent} at Mada` : "the team at Mada"} can take it from here, in one sentence.`, handoff: { threadId: th.id, agent } };
  },

  // A lasting preference or need, kept for next time (memory.ts). Sensitive ones only after a yes in this message.
  async remember(ctx, a) {
    const kind = MemoryKind.safeParse(a.kind).data ?? "other";
    const text = String(a.text ?? "").replace(/\s+/g, " ").trim();
    if (!text) return { text: "Not saved: there was nothing to remember.", isError: true };
    const why = unkeepable(text);
    if (why) return { text: `Not saved: ${why}. Never remember passport, card, phone or document details. Carry on without it.` };
    if ((a.sensitive === true || isSensitive(kind, text)) && !ctx.consent?.yes) {
      return { text: "Not saved yet: this is about health, mobility or religion. Use it for this trip, and ask in one short question whether to remember it for next time (in English \"Shall we remember that for next time?\", in Arabic «نتذكرها للمرة الجاية؟»). Call remember again only after they say yes." };
    }
    const f = await saveFact(ctx.ownerId, kind, text, "chat");
    return { text: `Saved for next time: ${f.text}. The app tells them it is remembered; don't say it again.`, remembered: f.text };
  },

  // The living plan (tools-plan.ts).
  ...PLAN_RUN,
  // Documents in chat (ASK-INTEGRATED.md §6): read-only, or a card that waits for the traveller's tap.
  ...DOC_RUN,
  // Companions: who goes, and changes asked by them (tools-people.ts).
  ...PEOPLE_RUN,
};

export function personLine(p: Person, today: string): string {
  const age = ageOn(p, today);
  return `${p.id}: ${p.firstName || (p.isSelf ? "the account holder" : "unnamed")} (${p.isSelf ? "account holder" : p.relation}${age != null ? `, ${age}` : ""}${p.nationality ? `, ${p.nationality} passport` : ""})`;
}

/** A place's name for a status line, in the reader's language ("istanbul" → «إسطنبول»; "pakistan" → «باكستان»). */
const placeName = (raw: string, lang: "en" | "ar") => {
  const en = DESTINATIONS[raw]?.name ?? raw.trim().replace(/\b\p{L}/gu, (c) => c.toUpperCase());
  return nameIn(en, lang);
};

/** The status line while a tool runs ("Checking flights to Istanbul"), in the traveller's language. */
/**
 * The request as a card: what (each part said once, and never only the travellers' names, which the card writes out
 * as "who"), where, the days, who, when the team gets back and how.
 */
export function requestCard(ctx: ToolCtx, r: { id: string; kind: string; title: string; summary: string; detail: string; promisedBy: string | null; contact?: { preference: "call" | "whatsapp" | "in_app" } | null },
  travellerIds: string[], at: { where: string | null; depart: string | null; return: string | null }): ChatCard {
  const who = travellerIds.map((id) => ctx.people.find((p) => p.id === id)).filter((p): p is Person => !!p).map((p) => ({ name: p.firstName, self: !!p.isSelf }));
  const names = new Set(["you", "me", ...who.map((w) => w.name.toLowerCase())]);
  const onlyNames = (part: string) => part.split(/,|\band\b|&|\+/i).map((x) => x.trim().toLowerCase()).filter(Boolean).every((x) => names.has(x));
  const parts = [r.summary, r.detail].flatMap((x) => (x ?? "").split(" · ")).map((x) => x.trim()).filter(Boolean);
  const what = [...new Set(parts)].filter((x) => !onlyNames(x) && x !== r.title && x !== at.where);
  return {
    type: "request", requestId: r.id, kind: r.kind, title: r.title, detail: what.join(" · "), promisedBy: r.promisedBy, contact: r.contact?.preference ?? null,
    where: at.where, depart: at.depart, return: at.return, who,
  };
}

export function statusFor(name: string, input: Record<string, unknown>, lang: "en" | "ar"): string {
  const city = placeName(typeof input.destination === "string" ? input.destination : typeof input.where === "string" ? input.where : "", lang);
  const en: Record<string, string> = {
    search_flights: `Checking flights to ${city}`, search_stays: `Checking places to stay in ${city}`, esim_plans: `Checking internet plans for ${city}`,
    entry_rules: `Checking entry rules for ${city}`, get_trips: "Looking at your trips", get_trip: "Looking at your trip", price_quote_for_pay: "Checking the price again",
    create_request: "Sending it to the desk", talk_to_human: "Passing it to the desk", plan_car_now: "Setting up the car", get_hotel: "Reading about the hotel", get_household: "Looking at who travels",
    remember: "Noting that for next time",
    documents_on_file: "Looking at your documents", use_document: "Looking at your documents", request_document_share: "Setting up the request",
  };
  const ar: Record<string, string> = {
    search_flights: `نشوف الرحلات لـ${city}`, search_stays: `نشوف السكن في ${city}`, esim_plans: `نشوف باقات النت لـ${city}`,
    entry_rules: `نشوف شروط الدخول لـ${city}`, get_trips: "نشوف رحلاتك", get_trip: "نشوف رحلتك", price_quote_for_pay: "نتأكد من السعر",
    create_request: "نرسلها للفريق", talk_to_human: "نحوّلها للفريق", plan_car_now: "نجهّز السيارة", get_hotel: "نقرأ عن الفندق", get_household: "نشوف مين مسافر",
    remember: "نسجّلها للمرة الجاية",
    documents_on_file: "نشوف مستنداتك", use_document: "نشوف مستنداتك", request_document_share: "نجهّز الطلب",
  };
  return (lang === "ar" ? ar : en)[name] ?? (PLAN_STATUS[lang] as Record<string, string>)[name] ?? peopleStatus(name, input, lang) ?? (lang === "ar" ? "لحظة" : "One moment");
}

/** Run one tool call. Expected failures (a gone offer, a person not in the household) come back as a sentence. */
export async function runTool(name: string, input: unknown, ctx: ToolCtx): Promise<ToolOut> {
  const run = RUN[name];
  if (!run) return { text: `There is no tool called ${name}.`, isError: true };
  if (!input || typeof input !== "object" || Array.isArray(input)) return { text: "The input must be an object.", isError: true };
  try {
    return await run(ctx, input as Record<string, unknown>);
  } catch (e) {
    if (e instanceof AppError) return { text: `Could not do it: ${e.code}. ${e.message}`, isError: true };
    console.error("[ask-chat] tool", name, e instanceof Error ? e.message : "");
    return { text: "The system behind this did not answer. Say so plainly and offer the next step.", isError: true };
  }
}

export const TOOL_NAMES = Object.keys(RUN);
