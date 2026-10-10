import "server-only";
import { and, eq } from "drizzle-orm";
import {
  SWITCH_OFFERS, addDays, applyChange, changeOptions, dayLabel, fareRulesFor, formatSar, homePickup, liveStay, moveNeeded, nameDistance, nightPrice, outSegment,
  stayEnd, switchCredit, timing, zonedToInstant, type ChangeFlightRequest, type TripDetail, type TripRequestView,
} from "@mada/shared";
import { db, type Tx } from "@/db";
import { appPickups, appSegments, appStays } from "@/db/app-schema";
import { appTripFacts } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { addCredit } from "../credit";
import { supplierMode } from "../config";
import { AppError } from "../http";
import { factsOf } from "./core";
import { partialRefund } from "./money";
import { insertRequest, once, toRequestView } from "./requests";

/*
 * Changing a flight. The price is worked out here from the fare rules (change fee per person plus the fare difference),
 * never taken from the phone. Nothing to pay: the change is made (mock desk) or sent to the desk (live). Something to pay:
 * a quote the traveller pays from Requests, then the desk makes the change.
 */

const ESCORT = 350_00;
const deskIsMock = () => { try { return supplierMode("flights") === "mock"; } catch { return false; } };
const dl = (d: string) => dayLabel(d, { today: d });

export type ChangeResult = { result: "done" | "quoted" | "sent"; say: string; total: number; request: TripRequestView };

async function patchSegment(tx: Tx, trip: TripDetail, segmentId: string, patch: Partial<{ flightNumber: string; departLocal: string; arriveLocal: string }>) {
  await tx.update(appSegments).set({ ...(patch.flightNumber ? { flightNumber: patch.flightNumber } : {}), ...(patch.departLocal ? { departLocal: patch.departLocal.replace("T", " ") } : {}), ...(patch.arriveLocal ? { arriveLocal: patch.arriveLocal.replace("T", " ") } : {}), updatedAt: new Date() })
    .where(and(eq(appSegments.id, segmentId), eq(appSegments.tripId, trip.id)));
  const out = outSegment(trip);
  // A new time on the same day: the driver follows it. A new day: the hotel and pickup wait for the traveller to say.
  if (out && segmentId === out.id && patch.departLocal && patch.departLocal.slice(0, 10) === out.departLocal.slice(0, 10)) {
    const pk = homePickup(trip);
    if (pk) await tx.update(appPickups).set({ at: new Date(zonedToInstant(patch.departLocal, out.departTz).getTime() + (pk.offsetMin ?? -155) * 60_000), updatedAt: new Date() }).where(eq(appPickups.id, pk.id));
  }
}

export async function changeFlight(ownerId: string, trip: TripDetail, input: ChangeFlightRequest, ipHash: string | null): Promise<ChangeResult> {
  const tm = timing(trip.clock.phase);
  const out = outSegment(trip);
  if (!out) throw new AppError("VALIDATION", { message: "No flights on this trip." });
  if (tm.airlineCancelled) throw new AppError("VALIDATION", { message: `${out.carrierName} cancelled ${out.flightNumber}. You don’t pay anything to change: see your options on Today.` });
  if (tm.allUsed) throw new AppError("VALIDATION", { message: "Both flights are flown." });
  if (tm.within24) throw new AppError("VALIDATION", { message: `Less than a day to go: ${out.carrierName} only changes tickets by phone. Ask Mada to call you.` });
  if (tm.outUsed && (input.kind === "date" || input.kind === "time" || input.kind === "airline")) throw new AppError("VALIDATION", { message: "You’ve flown this one already." });
  const n = Math.max(1, trip.travellers.length);
  const R = trip.fare ?? fareRulesFor(out.carrier);

  return once(ownerId, "change", input.clientKey, async (tx) => {
    const base = { area: "change" as const, withWhom: "airline" as const, withName: out.carrierName, clientKey: input.clientKey };
    if (input.kind === "name") {
      const p = trip.travellers.find((x) => x.id === input.travellerId);
      if (!p) throw new AppError("NOT_FOUND");
      const after = `${input.givenNames} ${input.surname}`.toUpperCase().replace(/\s+/g, " ").trim();
      const before = p.fullName.toUpperCase();
      const d = nameDistance(before, after);
      if (d === 0) throw new AppError("VALIDATION", { message: "That’s the name on the ticket now." });
      const small = d <= 3;
      const r = await insertRequest(tx, {
        ownerId, tripId: trip.id, kind: "change", summary: small ? `Name fix for ${p.firstName}` : `Name change for ${p.firstName}`, ipHash, agentName: trip.agent.name,
        details: { ...base, askKind: "name", short: small ? "Name fixed" : "Name change", detail: `${before} → ${after}${small ? "" : " · needs a new ticket"}`, scriptedOutcome: small ? "yes" : "no", yesText: "New ticket number in your Wallet", alt: "Mada will call you with the price of a new ticket.", withWhom: small ? "airline" : "faisal" },
      });
      return { result: "sent", say: r.summary, total: 0, request: toRequestView(r) } as unknown as Record<string, unknown>;
    }
    if (input.kind === "airline") {
      const o = SWITCH_OFFERS.find((x) => x.key === input.offerKey && x.carrier !== out.carrier);
      if (!o) throw new AppError("NOT_FOUND");
      const net = Math.max(0, o.perPerson * n - switchCredit(trip));
      const r = await insertRequest(tx, {
        ownerId, tripId: trip.id, kind: "change", summary: `Switch to ${o.carrierName}`, ipHash, agentName: trip.agent.name,
        details: { ...base, withWhom: "faisal", withName: null, askKind: "airline", short: "airline switch", detail: `${o.code} · ${o.depart} · ${n} travellers`, quote: net || null, quoteText: `We can hold ${n} seats on ${o.code} at ${o.depart}. After your ${out.carrierName} refund, the difference is ${formatSar(net)}. Pay and we’ll swap the tickets.`, scriptedOutcome: "yes" },
      });
      return { result: net ? "quoted" : "sent", say: r.summary, total: net, request: toRequestView(r) } as unknown as Record<string, unknown>;
    }
    const count = input.kind === "one" ? 1 : n;
    const opt = changeOptions(input.kind, trip, count).find((o) => o.id === input.optionId);
    if (!opt) throw new AppError("NOT_FOUND");
    if (opt.soldOut) throw new AppError("VALIDATION", { message: opt.sub });
    const who = input.kind === "one" ? trip.travellers.find((p) => p.id === input.travellerId) : null;
    if (input.kind === "one" && !who) throw new AppError("NOT_FOUND");
    const kid = who?.birthYear && who.birthYear > new Date(trip.clock.now).getUTCFullYear() - 12;
    const total = R.changeFee * count + opt.diffPerPerson * count + (kid ? ESCORT : 0);
    const say = input.kind === "one" ? `${who!.firstName} flies home ${opt.say}` : opt.say;
    const details = { ...base, askKind: input.kind, change: { kind: input.kind, optionId: input.optionId, travellerId: who?.id ?? null }, short: "Flight changed", detail: total < 0 ? `${formatSar(-total)} back as Mada credit` : total > 0 ? formatSar(total) : "No cost", scriptedOutcome: "yes" as const };
    if (total > 0) {
      const r = await insertRequest(tx, { ownerId, tripId: trip.id, kind: "change", summary: say, ipHash, agentName: trip.agent.name, details: { ...details, quote: total, quoteText: `${say}. Change fee and price difference: ${formatSar(total)}. Pay and we change it with ${out.carrierName}.` }, status: "awaiting_payment" });
      return { result: "quoted", say, total, request: toRequestView(r) } as unknown as Record<string, unknown>;
    }
    const applyNow = deskIsMock() && input.kind !== "one";
    const r = await insertRequest(tx, { ownerId, tripId: trip.id, kind: "change", summary: say, ipHash, agentName: trip.agent.name, details: { ...details, outcome: applyNow ? "yes" : null }, status: applyNow ? "done" : "sent" });
    if (applyNow) {
      const patch = applyChange(input.kind, input.optionId, trip);
      if (patch) await patchSegment(tx, trip, patch.segmentId, patch.patch as { flightNumber?: string; departLocal?: string; arriveLocal?: string });
      if (total < 0) await addCredit(tx, { userId: ownerId, amount: -total, kind: "refund", note: `Flight change · ${say}`, actor: { kind: "user", id: ownerId }, ipHash });
      await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "trip.flight_changed", entityType: "app_trip", entityId: trip.id, summary: `Changed the flight: ${say}`, data: { kind: input.kind, optionId: input.optionId, total }, ipHash });
    }
    return { result: applyNow ? "done" : "sent", say, total, request: toRequestView(r) } as unknown as Record<string, unknown>;
  }) as unknown as Promise<ChangeResult>;
}

/** After a date change: move the hotel and the home pickup to the new day. Extra nights need the hotel's yes (a quote). */
export async function moveToFlightDay(ownerId: string, trip: TripDetail, want: { hotel: boolean; pickup: boolean }, ipHash: string | null): Promise<{ say: string; back: number; quoted: TripRequestView | null }> {
  const m = moveNeeded(trip);
  if (!m) throw new AppError("VALIDATION", { message: "Everything is already on the flight’s day." });
  return db.transaction(async (tx) => {
    let back = 0;
    let quoted: TripRequestView | null = null;
    const moved: string[] = [];
    if (want.pickup && m.pickup) {
      const pk = trip.pickups.find((p) => p.id === m.pickup!.pickupId)!;
      const out = outSegment(trip)!;
      await tx.update(appPickups).set({ at: new Date(zonedToInstant(out.departLocal, out.departTz).getTime() + (pk.offsetMin ?? -155) * 60_000), updatedAt: new Date() }).where(eq(appPickups.id, pk.id));
      moved.push("pickup");
    }
    if (want.hotel && m.hotel) {
      const st = trip.stays.find((s) => s.id === m.hotel!.stayId)!;
      if (m.hotel.diff <= 0) {
        back = m.hotel.back;
        await tx.update(appStays).set({ checkIn: m.to, nights: m.hotel.newNights, price: st.price.amount - back, updatedAt: new Date() }).where(eq(appStays.id, st.id));
        if (back) await partialRefund(tx, ownerId, trip, "stay", back, `${st.name} · ${-(m.hotel.newNights - st.nights) === 1 ? "one night" : `${st.nights - m.hotel.newNights} nights`} less`, `move-${trip.id}-${m.to}`, ipHash);
        moved.push("hotel");
      } else {
        const extra = m.hotel.newNights - st.nights;
        const r = await insertRequest(tx, {
          ownerId, tripId: trip.id, kind: "stay", summary: `Check in on ${dl(m.to)} instead`, ipHash, agentName: trip.agent.name,
          details: { area: "hotel", askKind: "nights", short: "earlier check-in", detail: `${st.name} · ${extra === 1 ? "one more night" : `${extra} more nights`}`, withWhom: "hotel", quote: m.hotel.diff, quoteText: `The hotel can take you from ${dl(m.to)}. ${extra === 1 ? "One more night" : `${extra} more nights`}, ${formatSar(m.hotel.diff)}.`, scriptedOutcome: "yes" },
        });
        quoted = toRequestView(r);
      }
    }
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "trip.moved", entityType: "app_trip", entityId: trip.id, summary: `Moved ${moved.join(" and ") || "nothing yet"} to ${m.to}`, data: { back, quoted: !!quoted }, ipHash });
    const say = back ? `Moved. ${formatSar(back)} is on its way back.` : quoted ? "Pickup moved. The extra night is with Mada." : "Moved. No cost.";
    return { say, back, quoted };
  });
}

/** Leave a night sooner: free inside the hotel's window (the night comes back), after it the hotel keeps that night. */
export async function shortenStay(ownerId: string, trip: TripDetail, clientKey: string, ipHash: string | null): Promise<{ say: string; back: number }> {
  const st = liveStay(trip);
  if (!st) throw new AppError("VALIDATION", { message: "No hotel on this trip." });
  const tm = timing(trip.clock.phase);
  if (st.nights <= 1 || (tm.outUsed && st.nights <= 2)) throw new AppError("VALIDATION", { message: "That’s the shortest this stay can be." });
  const night = nightPrice(st);
  const back = tm.early ? night : 0;
  return once(ownerId, "ask", clientKey, async (tx) => {
    const last = stayEnd(st);
    await tx.update(appStays).set({ nights: st.nights - 1, price: st.price.amount - back, updatedAt: new Date() }).where(eq(appStays.id, st.id));
    if (back) await partialRefund(tx, ownerId, trip, "stay", back, `${st.name} · one night less`, `cut-${clientKey}`, ipHash);
    await insertRequest(tx, {
      ownerId, tripId: trip.id, kind: "stay", summary: `Leave on ${dl(addDays(last, -1))}`, ipHash, agentName: trip.agent.name,
      details: { area: "hotel", askKind: "nights", short: "One night less", detail: back ? `${formatSar(back)} back to your card` : "The hotel keeps the night", withWhom: "hotel", outcome: "yes", scriptedOutcome: "yes" },
      status: "confirmed",
    });
    return { say: back ? `Shortened. ${formatSar(back)} is on its way back.` : "Shortened. The hotel keeps that night, as per the rule.", back };
  }) as unknown as Promise<{ say: string; back: number }>;
}

/** Edits that cost nothing: an address for the driver, the pickup time, a bag reference, the rating, first-evening picks. */
export async function patchTrip(ownerId: string, trip: TripDetail, patch: import("@mada/shared").PatchTripRequest, ipHash: string | null) {
  await factsOf(trip.id);
  await db.transaction(async (tx) => {
    const set: Partial<typeof appTripFacts.$inferInsert> = { updatedAt: new Date() };
    if (patch.noStay !== undefined) set.noStay = patch.noStay;
    if (patch.bagReport) set.bagReport = patch.bagReport;
    if (patch.picks) set.picks = patch.picks;
    if (patch.rating) set.rating = { hotel: patch.rating.hotel, driver: patch.rating.driver, agent: patch.rating.agent, note: patch.rating.note, sentAt: patch.rating.send ? new Date().toISOString() : null };
    if (patch.pickupOffsetMin !== undefined) {
      const pk = homePickup(trip);
      const out = outSegment(trip);
      if (!pk || !out) throw new AppError("VALIDATION", { message: "No pickup on this trip." });
      const [f] = await tx.select({ pickups: appTripFacts.pickups }).from(appTripFacts).where(eq(appTripFacts.tripId, trip.id));
      set.pickups = { ...(f?.pickups ?? {}), [pk.id]: { ...(f?.pickups?.[pk.id] ?? {}), offsetMin: patch.pickupOffsetMin } };
      await tx.update(appPickups).set({ at: new Date(zonedToInstant(out.departLocal, out.departTz).getTime() + patch.pickupOffsetMin * 60_000), updatedAt: new Date() }).where(eq(appPickups.id, pk.id));
    }
    await tx.update(appTripFacts).set(set).where(eq(appTripFacts.tripId, trip.id));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "trip.updated", entityType: "app_trip", entityId: trip.id, summary: `Updated the trip: ${Object.keys(patch).join(", ")}`, data: { fields: Object.keys(patch) }, ipHash });
  });
}
