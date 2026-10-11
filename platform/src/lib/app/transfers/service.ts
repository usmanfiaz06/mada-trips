import "server-only";
import { and, desc, eq, inArray, sql } from "drizzle-orm";
import { AIRPORT_NAME, AIRPORT_CITY, ChooseTransferBody, DESTINATIONS, money, t, type ChooseTransferBody as ChooseInput, type TransferOption, type TransferOptionsResponse, type TripDetail } from "@mada/shared";
import { db } from "@/db";
import { appRequests } from "@/db/app-schema";
import { appOffers, appOrders, appTripBookings } from "@/db/app-schema-booking";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { agentFor, isUuid } from "../booking/common";
import { requestView } from "../booking/requests";
import { HB_PLACES, decodeOfferId, parseRateKey } from "../suppliers/hotelbeds/hotels";
import { hotelbedsTransfers, toAppError } from "../suppliers/hotelbeds/app";
import type { TransferDetails } from "../suppliers/hotelbeds/bookings";
import type { TransferQuote, TransferQuery } from "../suppliers/hotelbeds/transfers";

/*
 * Airport pickups for a trip (docs/app/HOTELBEDS.md §Transfers). GET lists Hotelbeds transfers from the airport the
 * trip lands at to the hotel, at landing time, for everyone on the trip; each option is held as an offer (20 minutes).
 * POST turns one into a request for the desk (the beta): the request carries the rate key, so the desk can book it on
 * Hotelbeds in one click, then quotes it, and the traveller pays in the app.
 */

const HOLD_MS = 20 * 60_000;
const CACHE_MS = 10 * 60_000;
const g = globalThis as unknown as { __madaTransferCache?: Map<string, { at: number; value: TransferQuote[] }> };
const cache = (g.__madaTransferCache ??= new Map());
export const clearTransferCache = () => cache.clear();

type Arrival = { airport: string; arrival: string; flightNumber: string; carrier: string };

/** The leg that lands at the destination: the last outbound segment. */
function arrivalOf(trip: TripDetail): Arrival | null {
  const outs = trip.segments.filter((s) => s.direction === "out");
  const last = outs[outs.length - 1];
  if (!last) return null;
  return { airport: last.to, arrival: last.arriveLocal.slice(0, 16), flightNumber: last.flightNumber, carrier: last.carrierName };
}

/** The Hotelbeds hotel code for the trip's stay, when it was booked from Hotelbeds results. */
async function hotelCodeOf(tripId: string): Promise<number | null> {
  const rows = await db.select({ orderId: appTripBookings.orderId }).from(appTripBookings).where(eq(appTripBookings.tripId, tripId));
  const ids = rows.map((r) => r.orderId).filter((x): x is string => !!x);
  if (!ids.length) return null;
  const orders = await db.select({ draft: appOrders.draft }).from(appOrders).where(inArray(appOrders.id, ids));
  for (const o of orders) {
    const offerId = (o.draft as { stayOfferId?: string }).stayOfferId;
    if (!offerId || !isUuid(offerId)) continue;
    const [offer] = await db.select({ supplierOfferId: appOffers.supplierOfferId }).from(appOffers).where(eq(appOffers.id, offerId));
    const d = offer ? decodeOfferId(offer.supplierOfferId) : null;
    const k = d ? parseRateKey(d.rateKey) : null;
    if (k) return k.hotelCode;
  }
  return null;
}

/** Where the driver goes: the Hotelbeds hotel (ATLAS code) when we have it, else the city centre by GPS for the desk to refine. */
async function destinationOf(trip: TripDetail): Promise<{ end: TransferQuery["to"]; hotel: string | null; hotelCode: number | null } | null> {
  const stay = trip.stays.find((s) => s.status !== "cancelled");
  if (!stay && !trip.noStay) return null;
  const code = await hotelCodeOf(trip.id);
  if (code) return { end: { type: "ATLAS", code: String(code) }, hotel: stay?.name ?? null, hotelCode: code };
  const dest = Object.values(DESTINATIONS).find((d) => d.name === trip.city);
  const place = dest ? HB_PLACES[dest.key] : undefined;
  if (!place) return null;
  return { end: { type: "GPS", code: `${place.lat},${place.lng}` }, hotel: stay?.name ?? trip.noStay?.label ?? null, hotelCode: null };
}

/** Grown-ups, children (2 to 11) and babies, from birth years; anyone without one counts as an adult. */
function partyOf(trip: TripDetail, on: string) {
  const year = Number(on.slice(0, 4));
  let adults = 0, children = 0, infants = 0;
  for (const p of trip.travellers) {
    const age = p.birthYear ? year - p.birthYear : 30;
    if (age < 2) infants += 1; else if (age < 12) children += 1; else adults += 1;
  }
  if (!trip.travellers.length) adults = Math.max(1, trip.travellerIds.length);
  return { adults: Math.max(1, adults), children, infants, people: Math.max(1, adults) + children + infants };
}

async function openPickupRequest(ownerId: string, tripId: string) {
  const [r] = await db.select().from(appRequests)
    .where(and(eq(appRequests.ownerId, ownerId), eq(appRequests.tripId, tripId), sql`${appRequests.details} ? 'transfer'`, sql`${appRequests.status} NOT IN ('cancelled','done')`))
    .orderBy(desc(appRequests.createdAt)).limit(1);
  return r ?? null;
}

export async function transferOptions(ownerId: string, trip: TripDetail): Promise<TransferOptionsResponse> {
  const arr = arrivalOf(trip);
  const base = { airport: arr?.airport ?? null, airportName: arr ? AIRPORT_NAME[arr.airport] ?? AIRPORT_CITY[arr.airport] ?? arr.airport : null, hotel: null as string | null, arrival: arr?.arrival ?? null, people: trip.travellers.length, options: [] as TransferOption[], request: null };
  const open = await openPickupRequest(ownerId, trip.id);
  if (open) {
    const tr = (open.details as { transfer?: TransferDetails }).transfer;
    return { ...base, hotel: tr?.hotel ?? null, outcome: "requested", request: { id: open.id, status: open.status, vehicle: tr?.vehicle ?? "" } };
  }
  if (!arr) return { ...base, outcome: "no_flight" };
  const dest = await destinationOf(trip);
  if (!dest) return { ...base, outcome: "no_hotel" };
  const party = partyOf(trip, arr.arrival);
  const q: TransferQuery = { from: { type: "IATA", code: arr.airport }, to: dest.end, outbound: arr.arrival, adults: party.adults, children: party.children, infants: party.infants };
  const key = JSON.stringify(q);
  let quotes: TransferQuote[];
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) quotes = hit.value;
  else {
    try { quotes = await hotelbedsTransfers().quotes(q); } catch (e) { throw toAppError(e, "transfers"); }
    cache.set(key, { at: Date.now(), value: quotes });
  }
  const expiresAt = new Date(Date.now() + HOLD_MS);
  const options: TransferOption[] = [];
  for (const qt of quotes) {
    const details: Omit<TransferDetails, "offerId"> = {
      rateKey: qt.rateKey, total: qt.total, net: qt.net, currency: qt.currency, kind: qt.kind, vehicle: qt.vehicle, category: qt.category,
      airport: arr.airport, arrival: arr.arrival, flightNumber: arr.flightNumber, carrier: arr.carrier, hotel: dest.hotel, hotelCode: dest.hotelCode, freeCancelUntil: qt.freeCancelUntil, people: party.people,
    };
    const [row] = await db.insert(appOffers).values({
      ownerId, kind: "transfer", supplier: "hotelbeds", supplierOfferId: qt.rateKey, search: { kind: "transfer", tripId: trip.id, ...q } as unknown as Record<string, unknown>,
      payload: details as unknown as Record<string, unknown>, total: qt.total, expiresAt,
    }).returning({ id: appOffers.id });
    options.push({
      id: row!.id, kind: qt.kind, vehicle: qt.vehicle, category: qt.category, maxPax: qt.maxPax, minutes: qt.minutes, total: money(qt.total),
      freeCancelUntil: qt.freeCancelUntil, refundable: qt.refundable, pickupNote: qt.pickupNote, imageUrl: qt.imageUrl, expiresAt: expiresAt.toISOString(),
    });
  }
  return { ...base, hotel: dest.hotel, people: party.people, outcome: options.length ? "ok" : "none", options };
}

/** The traveller picks one: a request to the desk with the rate on it. Idempotent by clientKey. */
export async function chooseTransfer(ownerId: string, trip: TripDetail, input: ChooseInput, ipHash: string | null) {
  const b = ChooseTransferBody.parse(input);
  const [seen] = await db.select().from(appRequests).where(and(eq(appRequests.ownerId, ownerId), sql`${appRequests.details}->>'clientId' = ${b.clientKey}`));
  if (seen) return requestView(seen);
  const [offer] = await db.select().from(appOffers).where(and(eq(appOffers.id, b.optionId), eq(appOffers.ownerId, ownerId), eq(appOffers.kind, "transfer")));
  if (!offer || (offer.search as { tripId?: string }).tripId !== trip.id) throw new AppError("NOT_FOUND");
  if (offer.expiresAt.getTime() <= Date.now()) throw new AppError("VALIDATION", { message: t("hb.gone") });
  if (await openPickupRequest(ownerId, trip.id)) throw new AppError("VALIDATION", { message: t("pickup.withAgent", { agent: await agentFor(ownerId) }) });
  const tr = { ...(offer.payload as unknown as Omit<TransferDetails, "offerId">), offerId: offer.id } as TransferDetails;
  const agentName = await agentFor(ownerId);
  const title = t("request.title.pickup", { city: trip.city });
  const when = `${tr.arrival.slice(0, 10)} ${tr.arrival.slice(11, 16)}`;
  const detail = [`${tr.vehicle} · ${t(tr.kind === "private" ? "pickup.private" : "pickup.shared")}`, `${tr.airport} → ${tr.hotel ?? trip.city}`, when, tr.flightNumber].filter(Boolean).join(" · ");
  const row = await db.transaction(async (tx) => {
    const [r] = await tx.insert(appRequests).values({
      ownerId, kind: "car", status: "sent", summary: title, travellerIds: trip.travellerIds, tripId: trip.id, agentName, promisedBy: new Date(Date.now() + 60 * 60_000),
      details: {
        // Read by Ask's request screen (booking/requests.ts) and Trips → Requests (trips/requests.ts).
        source: "ask", askKind: "car", title, detail, summaryLine: detail, note: null, query: "", answers: {}, needs: {}, clientId: b.clientKey,
        short: "pickup", area: "other", quote: null, quoteText: null, withWhom: "faisal", transfer: tr,
      },
    }).returning();
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "request.created", entityType: "app_request", entityId: r!.id, summary: `Asked for an airport pickup (${tr.vehicle}, ${tr.total} halalas)`, data: { kind: "transfer", supplier: "hotelbeds" }, ipHash });
    return r!;
  });
  return requestView(row);
}
