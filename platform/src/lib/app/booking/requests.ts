import "server-only";
import { progressOfRequest, resultOfRequest } from "../outcomes";
import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  CreateRequestBody, DESTINATIONS, commaList, wordFor, mockFareOptions, tn, NEED_LABELS, OTHER_CITY_BY_HAND, CATALOGUE_FLIGHTS, deskFirstReply, deskQuote, deskReply, money, personName, rangeLabel, requestText, requestTitle, sarToHalalas, t,
  type BookingRequestView, type CopyKey, type CreateRequestBody as CreateRequestInput, type NeedKey, type Person, type RequestQuote, type ThreadMessage,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appMessages, appNotifications, appQuotes, appRequests } from "@/db/app-schema";
import { appAuditLog } from "../audit";
import { messageAttachment } from "../file-links";
import { withCopy, type VarRef } from "../notify-copy";
import { AppError } from "../http";
import { agentFor, autopilotOn, isUuid, today, travellersOf } from "./common";
import { flightQuoteOf, flightSummary, flightTitle, isFlightAsk, isFlightRequest, type FlightSearch } from "./flight-requests";
import { flightsMode } from "../switches";

/*
 * Requests a person at Mada completes (visa, Umrah, car, a table, things to do, flights and rooms searched by hand,
 * services from the entry check). One pipe, app_requests, which the desk in Ops works from; quotes in app_quotes with
 * a per-person breakdown; the thread in app_messages. In mock mode a scripted desk moves them on by age, quoting from
 * the desk's price table (never from the model): sent → reviewing at 4 s → quoted at 9 s; paid → done at 15 s.
 */

type RequestRow = typeof appRequests.$inferSelect;
export type AskDetails = {
  source: "ask"; askKind: string; title: string; detail: string; summaryLine: string; note: string | null; query: string;
  answers: Record<string, string[]>; needs: Record<string, NeedKey[]>; search?: CreateRequestInput["search"] | null;
  service?: string | null; serviceFor?: { personId: string | null; need: string | null; destination: string | null } | null; clientId?: string | null;
  flightRequest?: boolean;
  // Read by Trips → Requests (lib/app/trips/requests.ts): one line, and the quote once there is one.
  short?: string; quote?: number | null; quoteText?: string | null; withWhom?: "faisal";
  // A service title as its copy key and parameters, so it reads in the reader's language (readTitle).
  titleCopy?: [string, Record<string, string>] | null;
};

const M0_KIND: Record<string, string> = { visa: "visa", umrah: "umrah", car: "car", food: "restaurant", todo: "activity", flight: "flight", stay: "stay", general: "general" };
const SHORT: Record<string, string> = { visa: "visa", umrah: "Umrah trip", car: "car", food: "table", todo: "plans", flight: "flights", stay: "rooms", general: "request" };
// "your table", "your flights": the thing the desk replied about, as a copy key so it reads in the reader's language.
const WHAT: Record<string, string> = { visa: "visa", umrah: "umrah", car: "car", food: "table", todo: "plans", flight: "flights", stay: "rooms", general: "request" };
export const whatKey = (kind: string | undefined) => `td.req.what.${WHAT[kind ?? "general"] ?? "request"}` as CopyKey;

/** The title of a search by hand: the city and the dates, in the reader's language. */
function searchTitle(kind: string, s: NonNullable<CreateRequestInput["search"]>): string {
  const city = (s.destination && DESTINATIONS[s.destination]?.name) || s.destinationName || "";
  const dates = s.depart ? (s.return ? rangeLabel(s.depart, s.return) : t("beta.fr.oneWay", { date: rangeLabel(s.depart) })) : t("request.datesLater");
  return kind === "stay" ? t("request.title.staysIn", { city }) : s.carrier ? t("request.title.airlineByHand", { airline: s.carrier === "SV" ? "Saudia" : s.carrier, city, dates }) : t("request.title.flightsTo", { city, dates });
}

/**
 * A request's title in the reader's language, worded from what was asked (a service's key, a search's city and
 * dates, the form's answers) rather than the words stored when it was sent; undefined for rows without those parts.
 */
export function readTitle(d: Partial<AskDetails>): string | undefined {
  if (d.titleCopy) return t(d.titleCopy[0] as CopyKey, d.titleCopy[1]);
  // A car, an outing or a destination asked from its own screen keeps the title it was sent with (older rows had no titleCopy).
  if (["transfer", "ride", "activity", "place"].some((k) => (d as Record<string, unknown>)[k])) return undefined;
  if (d.search && d.askKind && !d.service) return searchTitle(d.askKind, d.search);
  if (d.source === "ask" && d.askKind && d.answers && typeof d.query === "string" && !d.service) return requestTitle(d.askKind, d.answers, d.query);
  return undefined;
}

/** "table", "flights": the short name of what was asked, in the reader's language. */
export const readShort = (d: Partial<AskDetails>) => (d.service ? readTitle(d) ?? d.short ?? "" : t(whatKey(d.askKind)));
/** The same, as a parameter an inbox line renders when read. */
const whatRef = (d: Partial<AskDetails>): VarRef => (d.service && d.titleCopy ? { k: d.titleCopy[0] as CopyKey, v: d.titleCopy[1] } : { k: whatKey(d.askKind) });

const VIEW_STATUS: Record<string, BookingRequestView["status"]> = {
  queued: "queued", sent: "sent", reviewing: "reviewing", needs_answer: "reviewing", quoted: "quoted", awaiting_payment: "quoted", with_agent: "paid", confirmed: "paid", done: "done", cancelled: "cancelled",
};

function quoteView(q: typeof appQuotes.$inferSelect | undefined): RequestQuote | null {
  if (!q) return null;
  const s = (q.offerSnapshot ?? {}) as { breakdown?: RequestQuote["breakdown"]; text?: string; lead?: string | null; needLines?: string[] };
  const flight = flightQuoteOf(q.offerSnapshot);
  // A hold that has passed reads as expired at once, before the scheduled job marks it (jobs.ts).
  const status = q.status === "open" && q.expiresAt && q.expiresAt.getTime() <= Date.now() ? "expired" : q.status;
  return { id: q.id, total: money(q.total), breakdown: s.breakdown ?? [], text: s.text ?? "", lead: s.lead ?? null, needLines: s.needLines ?? [], expiresAt: q.expiresAt?.toISOString() ?? null, status: status as RequestQuote["status"], flight };
}

export function requestView(r: RequestRow, q?: typeof appQuotes.$inferSelect): BookingRequestView {
  const d = (r.details ?? {}) as Partial<AskDetails>;
  // Flight requests are worded when read, so dates and words follow the reader's language (not the sender's).
  const flight = isFlightAsk(d) && d.search ? d.search as FlightSearch : null;
  return {
    id: r.id, kind: (d.askKind ?? "general") as BookingRequestView["kind"], status: VIEW_STATUS[r.status] ?? "sent",
    title: flight ? flightTitle(flight) : readTitle(d) ?? d.title ?? r.summary, summary: flight && d.flightRequest ? flightSummary(flight, r.travellerIds.length) : d.summaryLine ?? "",
    detail: d.detail ?? "", note: d.note ?? null, travellerIds: r.travellerIds, agent: r.agentName ? { name: r.agentName } : null, quote: quoteView(q),
    promisedBy: r.promisedBy?.toISOString() ?? null, result: resultOfRequest(r), progress: progressOfRequest(r), createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString(),
  };
}

async function latestQuote(requestId: string, tx: Tx | typeof db = db) {
  const [q] = await tx.select().from(appQuotes).where(eq(appQuotes.requestId, requestId)).orderBy(desc(appQuotes.createdAt)).limit(1);
  return q;
}

export async function ownRequest(ownerId: string, id: string): Promise<RequestRow> {
  if (!isUuid(id)) throw new AppError("NOT_FOUND");
  const [r] = await db.select().from(appRequests).where(and(eq(appRequests.id, id), eq(appRequests.ownerId, ownerId)));
  if (!r) throw new AppError("NOT_FOUND");
  return r;
}

const names = (ps: Person[]) => commaList(ps.map((p) => personName(p)));

export async function createRequest(ownerId: string, input: CreateRequestInput, ipHash: string | null): Promise<BookingRequestView> {
  const b = CreateRequestBody.parse(input);
  if (b.clientId) {
    const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'clientId' = ${b.clientId}`));
    if (seen) return requestView(seen, await latestQuote(seen.id));
  }
  const travellers = await travellersOf(ownerId, b.travellerIds);
  const needSummary = travellers.filter((p) => (b.needs[p.id] ?? []).length).map((p) => `${personName(p)}: ${commaList((b.needs[p.id] ?? []).map((k) => wordFor(NEED_LABELS[k]).toLowerCase()))}`).join(" · ");
  // Each thing said once: the title, a summary of the answers, the note only when it adds something (shared requestText).
  const words = requestText({ kind: b.kind, answers: b.answers, query: b.query, names: names(travellers), needSummary, note: b.note });
  const summaryLine = words.summary;
  let title = words.title;
  let detail = words.detail;
  let titleCopy: [string, Record<string, string>] | null = null;
  // Every price, quote or set of options found by hand: within 2 hours, as the app promises (copy/words.ts).
  const promisedMin = 120;
  if (b.service) {
    const who = b.serviceFor?.personId ? travellers.find((p) => p.id === b.serviceFor!.personId) ?? null : null;
    const name = who ? personName(who) : "";
    const dest = b.serviceFor?.destination ? DESTINATIONS[b.serviceFor.destination] : null;
    const ref: [CopyKey, Record<string, string>] = b.service === "uk_eta" ? ["request.title.eta", {}] : b.service === "evisa" ? ["request.title.evisa", { need: b.serviceFor?.need ?? "Visa", name }]
      : b.service === "reentry" ? ["request.title.reentry", { name }] : ["request.title.renewal", { name }];
    titleCopy = ref;
    title = t(ref[0], ref[1]);
    detail = [dest ? dest.name : "", names(travellers)].filter(Boolean).join(" · ");
  } else if (b.search) {
    const s = b.search;
    const dates = s.depart ? (s.return ? rangeLabel(s.depart, s.return) : t("beta.fr.oneWay", { date: rangeLabel(s.depart) })) : t("request.datesLater");
    title = searchTitle(b.kind, s);
    detail = b.kind === "stay" ? `${dates} · ${names(travellers)}` : `${t("dq.from", { from: s.from ?? "RUH" })} · ${names(travellers)}${s.cabin ? ` · ${t(`cal.cabin.${s.cabin}` as never)}` : ""}`;
  }
  const agentName = await agentFor(ownerId);
  // Flights by request (switches.ts): the desk sends fare options, and the request reads as the form's answers.
  const flightRequest = b.kind === "flight" && !!b.search && (flightsMode() === "request" || b.search.flexDays !== undefined || !!b.search.bags || !!b.search.prefs?.length);
  const details: AskDetails = {
    source: "ask", askKind: b.kind, title, detail, summaryLine: flightRequest ? flightSummary(b.search as FlightSearch, travellers.length) : summaryLine, note: words.note, query: b.query, answers: b.answers, needs: b.needs, flightRequest,
    search: b.search ?? null, service: b.service ?? null, serviceFor: b.serviceFor ?? null, clientId: b.clientId ?? null,
    short: b.service ? title : SHORT[b.kind], quote: null, quoteText: null, withWhom: "faisal", titleCopy,
  };
  const r = await db.transaction(async (tx) => {
    const [row] = await tx.insert(appRequests).values({
      ownerId, kind: M0_KIND[b.kind] ?? "general", status: "sent", summary: title, travellerIds: travellers.map((p) => p.id),
      agentName, promisedBy: new Date(Date.now() + promisedMin * 60_000), details,
    }).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.created", entityType: "app_request", entityId: row!.id, summary: `Sent a request: ${title}`, data: { kind: b.kind }, ipHash });
    return row!;
  });
  return requestView(r);
}

/* ───────────── the mock desk ───────────── */

async function quoteFor(r: RequestRow): Promise<{ total: number; snapshot: Record<string, unknown>; lines: { label: string; amount: number; kind: string }[] } | null> {
  const d = r.details as AskDetails;
  // An airport pickup picked from Hotelbeds: the price is the one the traveller saw (suppliers/hotelbeds).
  const tr = (r.details as { transfer?: { total: number; vehicle: string } }).transfer;
  if (tr) return { total: tr.total, snapshot: { source: "hotelbeds-transfer", breakdown: [], text: t("dq.transfer.allIn", { vehicle: tr.vehicle }), lead: null, needLines: [] }, lines: [{ label: d.title, amount: tr.total, kind: "service" }] };
  const travellers = r.travellerIds.length ? await travellersOf(r.ownerId, r.travellerIds) : [];
  let byHand: { ppSar: number; text: string; cabin: "economy" | "premium" | "business"; oneway: boolean } | null = null;
  if (d.search && d.askKind === "flight") {
    const dest = d.search.destination ? DESTINATIONS[d.search.destination] : null;
    const sv = d.search.carrier === "SV" && dest ? CATALOGUE_FLIGHTS[dest.key]?.find((f) => f.carrier === "SV") : null;
    const hand = sv ? { ppSar: sv.ppSar, text: t("dq.hand.sv", { flight: sv.number, time: sv.dep }) } : dest?.byHand ?? OTHER_CITY_BY_HAND;
    byHand = { ...hand, cabin: (d.search.cabin === "first" ? "business" : d.search.cabin) ?? "economy", oneway: !d.search.return };
  }
  const q = deskQuote({ kind: d.askKind, answers: d.answers, travellers, needs: d.needs, note: d.note ?? "", today: today(), service: d.service ?? null, serviceNeed: d.serviceFor?.need ?? null, byHand });
  if (!q) return null;
  const breakdown = q.breakdown.map((b) => ({ personId: b.personId, name: b.name, lines: b.lines.map((l) => ({ label: l.label, amount: sarToHalalas(l.sar) })) }));
  const total = sarToHalalas(q.totalSar);
  return {
    total, snapshot: { source: "desk-price-table", breakdown, text: q.text, lead: q.lead, needLines: q.needLines },
    lines: breakdown.length ? breakdown.flatMap((b) => b.lines.map((l) => ({ label: `${b.name}: ${l.label}`, amount: l.amount, kind: "service" }))) : [{ label: d.title, amount: total, kind: "service" }],
  };
}

/** Moves this traveller's requests on by age (mock desk only). `now` is injectable for tests. */
/** Moves the mock desk on. True when it changed something (callers that read alongside it read again). */
export async function progressRequests(ownerId: string, now = Date.now()): Promise<boolean> {
  if (!autopilotOn()) return false;
  const rows = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'source' = 'ask'`, sql`${appRequests.status} IN ('sent','reviewing','confirmed')`));
  // Only what is due moves; nothing due, nothing written.
  const due = rows.filter((r) => (r.status === "sent" && now - r.createdAt.getTime() > 4000) || (r.status === "reviewing" && now - r.createdAt.getTime() > 9000)
    || (r.status === "confirmed" && now - r.updatedAt.getTime() > 15_000 && (r.details as AskDetails).askKind !== "package"));
  if (!due.length) return false;
  for (const r of due) {
    const age = now - r.createdAt.getTime();
    if (r.status === "sent" && age > 4000) {
      await db.update(appRequests).set({ status: "reviewing", updatedAt: new Date(now) }).where(and(eq(appRequests.id, r.id), eq(appRequests.status, "sent")));
      r.status = "reviewing";
    }
    if (r.status === "reviewing" && age > 9000 && isFlightRequest(r.details)) {
      await mockFlightQuote(r, now);
      continue;
    }
    if (r.status === "reviewing" && age > 9000) {
      const q = await quoteFor(r);
      const d = r.details as AskDetails;
      await db.transaction(async (tx) => {
        const [cur] = await tx.select().from(appRequests).where(eq(appRequests.id, r.id)).for("update");
        if (!cur || cur.status !== "reviewing") return;
        if (q) {
          await tx.insert(appQuotes).values({ requestId: r.id, lines: q.lines, total: q.total, status: "open", expiresAt: new Date(now + 24 * 3_600_000), offerSnapshot: q.snapshot });
          await tx.update(appRequests).set({ status: "quoted", updatedAt: new Date(now), details: { ...d, quote: q.total, quoteText: String(q.snapshot.text ?? "") } }).where(eq(appRequests.id, r.id));
        } else {
          // Nothing to price yet (a table, anything else): the agent answers in the thread.
          await tx.update(appRequests).set({ status: "quoted", updatedAt: new Date(now), details: { ...d, quote: null, quoteText: null } }).where(eq(appRequests.id, r.id));
          await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "agent", authorName: cur.agentName, body: deskFirstReply(d.askKind, d.answers, Math.max(1, cur.travellerIds.length, Number(d.answers.party?.[0]) || 0)) });
        }
        await tx.insert(appNotifications).values({
          userId: r.ownerId, kind: "agent_reply", level: "active", title: t("notify.replied.title").slice(0, 32),
          body: t("notify.replied.body", { agent: cur.agentName ?? "Mada", what: readShort(d) }).slice(0, 90), href: `/ask/request/${r.id}`,
          data: withCopy({ requestId: r.id }, { title: ["notify.replied.title"], body: ["notify.replied.body", { agent: cur.agentName ?? "Mada", what: whatRef(d) }] }),
        });
      });
    }
    if (r.status === "confirmed" && now - r.updatedAt.getTime() > 15_000 && (r.details as AskDetails).askKind !== "package") {
      await db.update(appRequests).set({ status: "done", updatedAt: new Date(now) }).where(and(eq(appRequests.id, r.id), eq(appRequests.status, "confirmed")));
    }
  }
  return true;
}

export async function listBookingRequests(ownerId: string): Promise<BookingRequestView[]> {
  const mine = and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'source' = 'ask'`);
  // The requests and each one's latest quote, side by side (was one query per request).
  const read = () => Promise.all([
    db.select().from(appRequests).where(mine).orderBy(desc(appRequests.createdAt)).limit(100),
    db.selectDistinctOn([appQuotes.requestId]).from(appQuotes)
      .where(sql`${appQuotes.requestId} IN (SELECT ${appRequests.id} FROM ${appRequests} WHERE ${mine})`)
      .orderBy(appQuotes.requestId, desc(appQuotes.createdAt)),
  ]);
  // The mock desk moves on alongside the read; when it moved something, read again (rare: a few times a request).
  const [moved, first] = await Promise.all([progressRequests(ownerId), read()]);
  const [rows, quotes] = moved ? await read() : first;
  const latest = new Map(quotes.map((q) => [q.requestId, q]));
  return rows.map((r) => requestView(r, latest.get(r.id)));
}

export async function getBookingRequest(ownerId: string, id: string): Promise<BookingRequestView> {
  await progressRequests(ownerId);
  const r = await ownRequest(ownerId, id);
  return requestView(r, await latestQuote(r.id));
}

/* ───────────── the thread ───────────── */

const REPLY_MS = 1600;

function messageView(m: typeof appMessages.$inferSelect): ThreadMessage {
  const card = (m.card ?? null) as { offer?: { label: string; perPerson: number; accepted?: boolean } } | null;
  return {
    id: m.id, from: m.authorKind === "user" ? "me" : m.authorKind === "agent" ? "agent" : "mada", authorName: m.authorName, text: m.body,
    offer: card?.offer ? { label: card.offer.label, perPerson: money(card.offer.perPerson), accepted: !!card.offer.accepted } : null,
    attachment: messageAttachment(m.card), createdAt: m.createdAt.toISOString(),
  };
}

export async function threadOf(ownerId: string, id: string, now = Date.now()): Promise<{ messages: ThreadMessage[]; agentTyping: boolean }> {
  const r = await ownRequest(ownerId, id);
  let rows = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "request"), eq(appMessages.threadId, r.id))).orderBy(asc(appMessages.createdAt));
  const last = rows[rows.length - 1];
  let typing = false;
  if (autopilotOn() && last?.authorKind === "user") {
    if (now - last.createdAt.getTime() >= REPLY_MS) {
      const reply = deskReply((r.details as AskDetails).askKind ?? "general", last.body, Math.max(1, r.travellerIds.length));
      await db.insert(appMessages).values({
        threadKind: "request", threadId: r.id, authorKind: "agent", authorName: r.agentName, body: reply.text,
        card: reply.offer ? { offer: { label: reply.offer.label, perPerson: sarToHalalas(reply.offer.perPersonSar), accepted: false } } : null,
      });
      rows = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "request"), eq(appMessages.threadId, r.id))).orderBy(asc(appMessages.createdAt));
    } else typing = true;
  }
  return { messages: rows.map(messageView), agentTyping: typing };
}

export async function postMessage(ownerId: string, id: string, text: string): Promise<{ messages: ThreadMessage[]; agentTyping: boolean }> {
  const r = await ownRequest(ownerId, id);
  await db.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "user", authorUserId: ownerId, body: text.trim() });
  await db.update(appRequests).set({ updatedAt: new Date() }).where(eq(appRequests.id, r.id));
  return threadOf(ownerId, id);
}

/* ───────────── quotes ───────────── */

export async function ownQuote(ownerId: string, quoteId: string) {
  if (!isUuid(quoteId)) throw new AppError("NOT_FOUND");
  const [q] = await db.select().from(appQuotes).where(eq(appQuotes.id, quoteId));
  if (!q) throw new AppError("NOT_FOUND");
  const r = await ownRequest(ownerId, q.requestId);
  return { q, r };
}

export async function getQuote(ownerId: string, quoteId: string): Promise<RequestQuote> {
  const { q } = await ownQuote(ownerId, quoteId);
  return quoteView(q)!;
}

const NEAR = "Room steps from the Haram";
/** The line the offer replaces, as the desk wrote it (dq.umrah.near, in the traveller's language or in English). */
const isNear = (label: string) => label === NEAR || label === t("dq.umrah.near");
const isLap = (label: string) => /^On a lap/.test(label) || label.startsWith(t("dq.umrah.lap"));

/** "Switch it": the agent's offer in the thread replaces the room on everyone's line, and the total follows. */
export async function acceptThreadOffer(ownerId: string, quoteId: string, messageId: string): Promise<{ request: BookingRequestView; messages: ThreadMessage[] }> {
  const { q, r } = await ownQuote(ownerId, quoteId);
  if (q.status !== "open" || !isUuid(messageId)) throw new AppError("VALIDATION");
  const [m] = await db.select().from(appMessages).where(and(eq(appMessages.id, messageId), eq(appMessages.threadKind, "request"), eq(appMessages.threadId, r.id)));
  const card = (m?.card ?? null) as { offer?: { label: string; perPerson: number; accepted?: boolean } } | null;
  if (!m || !card?.offer || card.offer.accepted) throw new AppError("VALIDATION");
  const offer = card.offer;
  const snap = (q.offerSnapshot ?? {}) as { breakdown?: RequestQuote["breakdown"]; text?: string; lead?: string | null; needLines?: string[] };
  const breakdown = (snap.breakdown ?? []).map((b) => {
    if (isLap(b.lines[0]?.label ?? "")) return b;
    const had = b.lines.find((l) => isNear(l.label));
    return { ...b, lines: [...b.lines.filter((l) => !isNear(l.label)), { label: offer.label, amount: offer.perPerson + (had?.amount ?? 0) }] };
  });
  const total = breakdown.length ? breakdown.reduce((a, b) => a + b.lines.reduce((x, l) => x + l.amount, 0), 0) : q.total + offer.perPerson * Math.max(1, r.travellerIds.length);
  const fmt = (h: number) => Math.round(h / 100).toLocaleString("en-US");
  await db.transaction(async (tx) => {
    await tx.update(appQuotes).set({
      total, lines: breakdown.flatMap((b) => b.lines.map((l) => ({ label: `${b.name}: ${l.label}`, amount: l.amount, kind: "service" }))),
      offerSnapshot: { ...snap, breakdown, text: `${snap.text ?? ""} ${t("dq.offer.quoteAdd")} ${t("dq.offer.newTotal", { price: `SAR ${fmt(total)}` })}`.trim(), lead: snap.lead ? `${snap.lead} ${t("dq.offer.quoteAdd")}` : null },
    }).where(eq(appQuotes.id, q.id));
    await tx.update(appMessages).set({ card: { offer: { ...offer, accepted: true } } }).where(eq(appMessages.id, m.id));
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "user", authorUserId: ownerId, body: t("request.switchYes") });
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "agent", authorName: r.agentName, body: t("dq.offer.done", { price: `SAR ${fmt(total)}` }), createdAt: new Date(Date.now() + 5) });
    await tx.update(appRequests).set({ details: { ...(r.details as AskDetails), quote: total }, updatedAt: new Date() }).where(eq(appRequests.id, r.id));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "quote.offer_accepted", entityType: "app_quote", entityId: q.id, summary: `Accepted ${offer.label}; new total ${total} halalas` });
  });
  const [q2] = await db.select().from(appQuotes).where(eq(appQuotes.id, q.id));
  const msgs = await db.select().from(appMessages).where(and(eq(appMessages.threadKind, "request"), eq(appMessages.threadId, r.id))).orderBy(asc(appMessages.createdAt));
  return { request: requestView(r, q2), messages: msgs.map(messageView) };
}


/** The mock desk's answer to a flight request: two fares from the catalogue, held for 24 hours (mock mode only). */
async function mockFlightQuote(r: RequestRow, now: number): Promise<void> {
  const d = r.details as AskDetails;
  const s = d.search as FlightSearch;
  const travellers = r.travellerIds.length ? await travellersOf(r.ownerId, r.travellerIds) : [];
  const options = mockFareOptions({ destination: s.destination, destinationName: s.destinationName, from: s.from, depart: s.depart ?? today(), return: s.return, cabin: s.cabin, travellers });
  const total = Math.min(...options.map((o) => o.total.amount));
  await db.transaction(async (tx) => {
    const [cur] = await tx.select().from(appRequests).where(eq(appRequests.id, r.id)).for("update");
    if (!cur || cur.status !== "reviewing") return;
    const lead = tn("beta.fq.lead", options.length);
    const [q] = await tx.insert(appQuotes).values({
      requestId: r.id, total, status: "open", expiresAt: new Date(now + 24 * 3_600_000),
      lines: options.flatMap((o) => o.prices.map((p) => ({ label: `${o.airline}: ${p.name}`, amount: p.amount.amount, kind: "flight" }))),
      offerSnapshot: { kind: "flight", source: "mock-desk", options, text: lead, lead, breakdown: [], needLines: [] },
    }).returning({ id: appQuotes.id });
    await tx.update(appRequests).set({ status: "quoted", updatedAt: new Date(now), details: { ...d, quote: total, quoteText: lead } }).where(eq(appRequests.id, r.id));
    await tx.insert(appMessages).values({ threadKind: "request", threadId: r.id, authorKind: "agent", authorName: cur.agentName, body: lead, card: { quoteId: q!.id, flight: true } });
    await tx.insert(appNotifications).values({
      userId: r.ownerId, kind: "agent_reply", level: "active", title: t("notify.replied.title").slice(0, 32),
      body: t("notify.replied.body", { agent: cur.agentName ?? "Mada", what: readShort(d) }).slice(0, 90), href: `/ask/request/${r.id}`,
      data: withCopy({ requestId: r.id }, { title: ["notify.replied.title"], body: ["notify.replied.body", { agent: cur.agentName ?? "Mada", what: whatRef(d) }] }),
    });
  });
}
