import "server-only";
import {
  DESTINATIONS, ageOn, formatSar, landmarkById, parseStayWishes, refineStays, isIsoDay,
  type ChatCard, type ChatPay, type DemoFlag, type EsimPlan, type FlightOption, type Person, type StayOption,
} from "@mada/shared";
import { AppError } from "../http";
import { checkEntry, searchFlights, searchStays } from "../booking/search";
import { createRequest } from "../booking/requests";
import { priceDraft } from "../booking/pricing";
import { esimPlans } from "../esim/service";
import { hotelContent } from "../suppliers/hotelbeds/content";
import { overview } from "../trips/overview";
import { tripDetail } from "../trips/core";
import { openThread, sendMessage } from "../support/threads";
import { presenceFor } from "../desk/agents";
import { redact } from "./guard";

/*
 * The tools, run on the server as the signed-in traveller, through the same functions the app's own routes call (so
 * the same checks hold: offers belong to the caller, people to the household). Each returns a short text the model
 * reads (prices formatted exactly as the cards show them) plus what the app draws: cards, a pay sheet, a handoff.
 * Nothing here charges, books or cancels.
 */

export type ToolCtx = { ownerId: string; people: Person[]; today: string; lang: "en" | "ar"; ipHash: string | null; demo: Set<DemoFlag> };
export type ToolOut = { text: string; cards?: ChatCard[]; pay?: ChatPay; handoff?: { threadId: string; agent: string | null }; status?: string; isError?: boolean };

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

const flightLine = (f: FlightOption, i: number) => {
  const leg = (l: FlightOption["out"]) => `${l.flightNumber} ${l.from} ${l.dep} → ${l.to} ${l.arr} on ${l.date} (${hm(l.durationMin)})`;
  return `${i + 1}. id=${f.id} · ${f.label} · ${f.airline} · out ${leg(f.out)}${f.back ? ` · back ${leg(f.back)}` : ""} · ${f.stop ?? "direct"} · bags ${f.bags} · ${f.refundable ? "refundable" : "not refundable"} · ${sar(f.total.amount)} all in for ${f.adults + f.infants} (${sar(f.pricePerPerson.amount)} each adult) · why: ${f.reason}`;
};

const stayLine = (s: StayOption, i: number, ev: string[] = []) =>
  `${i + 1}. id=${s.id}${s.hotel ? ` · hotel_code=${s.hotel.code}` : ""} · ${s.name} · ${s.area} · ${s.facts?.stars ? `${s.facts.stars} stars · ` : ""}${s.roomsLabel} · ${s.nights} nights from ${s.checkIn} · ${sar(s.total.amount)} all in · ${s.freeCancelUntil ? `free cancellation until ${s.freeCancelUntil}` : s.cancellation}${s.facts?.amenities.length ? ` · has ${s.facts.amenities.join(", ")}` : ""}${ev.length ? ` · fits: ${ev.join("; ")}` : ""}`;

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
    const from: "RUH" | "JED" | "DMM" = a.from === "JED" || a.from === "DMM" ? a.from : "RUH";
    const ret = iso(a.return);
    const travellerIds = whoOf(ctx, a.traveller_ids);
    const r = await searchFlights(ctx.ownerId, {
      from, destination, depart, return: ret && ret > depart ? ret : null, travellerIds,
      infants: Number.isInteger(a.infants) ? Math.min(4, Math.max(0, a.infants as number)) : 0,
      cabin: a.cabin === "premium" || a.cabin === "business" ? a.cabin : "economy",
    }, ctx.demo);
    const options = r.options.slice(0, 3);
    const search = { destination, destinationName: r.destinationName, from, depart, return: r.return, travellerIds };
    if (!options.length) return { text: `No flights found ${from} → ${r.destinationName} on ${depart} (outcome ${r.outcome}; checked ${r.checked}).${r.unavailable.length ? ` Not answering: ${r.unavailable.map((u) => u.airline).join(", ")}.` : ""}` };
    return {
      text: `Flights ${from} → ${r.destinationName}, ${depart}${r.return ? ` to ${r.return}` : " one way"}, checked ${r.checked}, for ${travellerIds.length} people:\n${options.map(flightLine).join("\n")}${r.bundle ? `\nHotel and pickup can be added: ${r.bundle.hotelName}, ${r.bundle.nights} nights, ${sar(r.bundle.total.amount)} more.` : ""}`,
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
    const r = await searchStays(ctx.ownerId, { destination, checkIn, nights, travellerIds }, ctx.demo);
    const wishes = typeof a.wishes === "string" && a.wishes.trim() ? parseStayWishes(a.wishes, destination).wishes : [];
    const refined = wishes.length ? refineStays(r.options, wishes, ctx.lang) : null;
    const picked = refined ? (refined.matches.length ? refined.matches : refined.closest) : r.options.map((option) => ({ option, ev: [] as string[] }));
    const top = picked.slice(0, 3);
    const nearWish = wishes.find((w) => w.k === "near");
    const near = nearWish && nearWish.k === "near" ? landmarkById(nearWish.id)?.name ?? null : null;
    const search = { destination, destinationName: r.destinationName, from: null, depart: checkIn, return: null, travellerIds };
    if (!top.length) return { text: `No stays found in ${r.destinationName} from ${checkIn} for ${nights} nights (outcome ${r.outcome}).` };
    return {
      text: `Stays in ${r.destinationName}, ${nights} nights from ${checkIn}, for ${travellerIds.length} people${r.shape ? ` (ranked for ${r.shape.shape})` : ""}${refined ? `; wishes: ${refined.matches.length ? "these fit" : "nothing fits every wish, these are closest"}` : ""}:\n${top.map((x, i) => stayLine(x.option, i, x.ev)).join("\n")}`,
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
    return { text: `eSIM plans for ${where}, ${r.days} days:\n${r.plans.map(planLine).join("\n")}`, cards: [{ type: "esim", where, days: r.days, plans: r.plans.slice(0, 3) }] };
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
    return { text: compact(t) };
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
    const kind = String(a.kind) as "visa" | "umrah" | "car" | "food" | "todo" | "flight" | "stay" | "general";
    const summary = redact(String(a.summary ?? "")).text.slice(0, 500);
    const isSearch = kind === "flight" || kind === "stay";
    const r = await createRequest(ctx.ownerId, {
      kind, query: summary, travellerIds: whoOf(ctx, a.traveller_ids), note: "",
      ...(isSearch ? { search: { destination: null, destinationName: typeof a.destination_name === "string" ? a.destination_name.slice(0, 60) : null, from: null, depart: iso(a.depart), return: iso(a.return), cabin: null, carrier: null } } : {}),
    } as Parameters<typeof createRequest>[1], ctx.ipHash);
    return { text: `Request ${r.id} sent to the desk: ${r.title} (${r.summary}).${r.promisedBy ? ` Mada answers by ${r.promisedBy}.` : ""}`, cards: [{ type: "request", requestId: r.id, kind: r.kind, title: r.title }] };
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
    return {
      text: `Pay sheet opened in the app: ${preview.title}, ${sar(preview.total.amount)} all in${preview.credit.used.amount ? ` after ${sar(preview.credit.used.amount)} Mada credit` : ""}. ${preview.rule}. Nothing is charged until the traveller slides to pay.`,
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
};

export function personLine(p: Person, today: string): string {
  const age = ageOn(p, today);
  return `${p.id}: ${p.firstName || (p.isSelf ? "the account holder" : "unnamed")} (${p.isSelf ? "account holder" : p.relation}${age != null ? `, ${age}` : ""}${p.nationality ? `, ${p.nationality} passport` : ""})`;
}

/** The status line while a tool runs ("Checking flights to Istanbul"), in the traveller's language. */
export function statusFor(name: string, input: Record<string, unknown>, lang: "en" | "ar"): string {
  const city = typeof input.destination === "string" ? destName(input.destination) : typeof input.where === "string" ? input.where : "";
  const en: Record<string, string> = {
    search_flights: `Checking flights to ${city}`, search_stays: `Checking places to stay in ${city}`, esim_plans: `Checking internet plans for ${city}`,
    entry_rules: `Checking entry rules for ${city}`, get_trips: "Looking at your trips", get_trip: "Looking at your trip", price_quote_for_pay: "Checking the price again",
    create_request: "Sending it to the desk", talk_to_human: "Passing it to the desk", plan_car_now: "Setting up the car", get_hotel: "Reading about the hotel", get_household: "Looking at who travels",
  };
  const ar: Record<string, string> = {
    search_flights: `نشوف الرحلات لـ${city}`, search_stays: `نشوف السكن في ${city}`, esim_plans: `نشوف باقات النت لـ${city}`,
    entry_rules: `نشوف شروط الدخول لـ${city}`, get_trips: "نشوف رحلاتك", get_trip: "نشوف رحلتك", price_quote_for_pay: "نتأكد من السعر",
    create_request: "نرسلها للفريق", talk_to_human: "نحوّلها للفريق", plan_car_now: "نجهّز السيارة", get_hotel: "نقرأ عن الفندق", get_household: "نشوف مين مسافر",
  };
  return (lang === "ar" ? ar : en)[name] ?? (lang === "ar" ? "لحظة" : "One moment");
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
