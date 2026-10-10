import "server-only";
import { eq } from "drizzle-orm";
import {
  addMinutes, arrivalPickup, disruptionOptions, formatSar, homePickup, hhmm, outSegment, rebookPatch, t, tripRefundAmount, zonedToInstant,
  type CopyKey, type DisruptionKind, type DisruptionResponse, type RefundView, type TripDetail, type Vars,
} from "@mada/shared";
import { db } from "@/db";
import { appPickups, appSegments, appStays, appTrips } from "@/db/app-schema";
import { appTripCharges, appTripFacts } from "@/db/app-schema-trips";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { factsOf } from "./core";
import { createRefund, ensureCharges } from "./money";
import { notify } from "./notify";
import { once } from "./requests";

/*
 * A delay, a cancellation, or a cancellation late at night at the airport (prototype Disruption.jsx).
 * Mada holds seats on other flights; the traveller picks one, stays put, or takes a refund. GACA rules apply when the
 * airline cancels: the full price back, care while waiting, and compensation Mada claims for them.
 */

const tk = (k: string, v?: Vars) => t(k as CopyKey, v);

export function disruptionKind(trip: TripDetail, asked: string | null): DisruptionKind | null {
  if (asked === "night" || asked === "cancel" || asked === "delay") return asked;
  if (trip.disruption) return trip.disruption.kind;
  if (trip.clock.phase === "cancelled") return "cancel";
  if (trip.clock.phase === "delayed") return "delay";
  return null;
}

export function disruptionFor(trip: TripDetail, kind: DisruptionKind): DisruptionResponse {
  const out = outSegment(trip);
  if (!out) throw new AppError("NOT_FOUND");
  const n = Math.max(1, trip.travellers.length);
  const everyone = n === 1 ? tk("dz.you") : tk("dz.allOf", { n });
  const code = out.flightNumber;
  const airline = out.carrierName;
  const night = kind === "night";
  const agent = night ? (trip.agent.covering ?? { name: "Noura", initial: "N" }) : { name: trip.agent.name, initial: trip.agent.initial };
  const vars = { airline, code, everyone, agent: agent.name };
  return {
    kind,
    headline: tk(`dz.${kind}.headline`, vars),
    sub: tk(`dz.${kind}.sub`, vars),
    options: disruptionOptions(kind, trip),
    tonight: night ? [
      { icon: "stay", title: tk("dz.night.hotel"), body: tk("dz.night.hotelBody") },
      { icon: "food", title: tk("dz.night.meals"), body: tk("dz.night.mealsBody", { everyone }) },
      { icon: "flight", title: tk("dz.night.next", { time: "07:15" }), body: tk("dz.night.nextBody", { airline, code: `${out.carrier}${Number(code.slice(2)) - 2}` }) },
    ] : [],
    agent: { name: agent.name, initial: agent.initial, line: tk(night ? "dz.agent.night" : "dz.agent.day", { agent: agent.name }) },
    source: trip.disruption?.source ?? tk(`dz.${kind}.source`, { airline }),
    refundAmount: { amount: tripRefundAmount(trip), currency: "SAR" },
    heldUntil: night ? "05:30" : "09:30",
  };
}

export type ChoiceResult = { optionId: string; kind: "rebook" | "stay" | "refund"; headline: string; body: string; agentLine: string; refund: RefundView | null };

export async function chooseDisruption(ownerId: string, trip: TripDetail, kind: DisruptionKind, optionId: string, clientKey: string, ipHash: string | null): Promise<ChoiceResult> {
  const opt = disruptionOptions(kind, trip).find((o) => o.id === optionId);
  if (!opt) throw new AppError("NOT_FOUND");
  const out = outSegment(trip)!;
  const n = Math.max(1, trip.travellers.length);
  const night = kind === "night";
  const agentName = night ? (trip.agent.covering?.name ?? "Noura") : trip.agent.name;
  await factsOf(trip.id);

  if (opt.kind === "refund") {
    await ensureCharges(trip);
    const charges = await db.select({ id: appTripCharges.id }).from(appTripCharges).where(eq(appTripCharges.tripId, trip.id));
    const refund = charges.length
      ? await createRefund(ownerId, trip, { paymentIds: charges.map((c) => c.id), reason: "airline", destination: "original", clientKey }, ipHash, { titleOverride: tk("dz.refundTitle", { code: out.flightNumber }) })
      : null;
    await db.transaction(async (tx) => {
      await tx.update(appTrips).set({ status: "cancelled", updatedAt: new Date() }).where(eq(appTrips.id, trip.id));
      await tx.update(appStays).set({ status: "cancelled", updatedAt: new Date() }).where(eq(appStays.tripId, trip.id));
      await tx.update(appPickups).set({ status: "cancelled", updatedAt: new Date() }).where(eq(appPickups.tripId, trip.id));
      await tx.update(appTripFacts).set({ disruption: { kind, segmentId: out.id, cause: null, source: tk(`dz.${kind}.source`, { airline: out.carrierName }), decided: "refund" }, updatedAt: new Date() }).where(eq(appTripFacts.tripId, trip.id));
      await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "trip.disruption_refund", entityType: "app_trip", entityId: trip.id, summary: `Took a refund after ${out.flightNumber} was ${kind === "delay" ? "delayed" : "cancelled"}`, data: { kind, amount: refund?.amount.amount ?? 0 }, ipHash });
    });
    const amount = formatSar(refund?.amount.amount ?? tripRefundAmount(trip));
    return {
      optionId, kind: "refund", headline: tk("dz.done.refund", { amount }), body: tk(night ? "dz.done.refundBodyNight" : "dz.done.refundBody", { card: refund?.card ?? "your card", airline: out.carrierName }),
      agentLine: tk("dz.done.refundLine", { airline: out.carrierName }), refund,
    };
  }

  return once(ownerId, "disruption", clientKey, async (tx) => {
    const [f] = await tx.select().from(appTripFacts).where(eq(appTripFacts.tripId, trip.id));
    const segFacts = { ...(f?.segments ?? {}) };
    let vouchers = f?.vouchers ?? [];
    if (opt.kind === "stay") {
      segFacts[out.id] = { ...(segFacts[out.id] ?? {}), delayMin: 180, predictedDelay: false, statusAt: new Date().toISOString() };
      await tx.update(appSegments).set({ status: "delayed", statusSource: "Live · airline", updatedAt: new Date() }).where(eq(appSegments.id, out.id));
    } else {
      const patch = rebookPatch(kind, optionId, trip)!;
      await tx.update(appSegments).set({
        carrier: patch.carrier!, carrierName: patch.carrierName!, flightNumber: patch.flightNumber!, toAirport: patch.to!, departLocal: patch.departLocal!.replace("T", " "), arriveLocal: patch.arriveLocal!.replace("T", " "),
        durationMin: patch.durationMin!, terminal: patch.terminal ?? null, gate: null, status: "scheduled", statusSource: null, updatedAt: new Date(),
      }).where(eq(appSegments.id, out.id));
      segFacts[out.id] = { bookedGate: null, delayMin: null, predictedDelay: false, statusAt: new Date().toISOString() };
      const dep = zonedToInstant(patch.departLocal!, out.departTz).getTime();
      const home = homePickup(trip);
      if (home) await tx.update(appPickups).set({ at: new Date(dep + (home.offsetMin ?? -155) * 60_000), updatedAt: new Date() }).where(eq(appPickups.id, home.id));
      const arr = arrivalPickup(trip);
      if (arr) await tx.update(appPickups).set({ at: zonedToInstant(patch.arriveLocal!, out.arriveTz), updatedAt: new Date() }).where(eq(appPickups.id, arr.id));
      if (night) {
        const code = `${out.carrier}${String(Date.now()).slice(-5)}`;
        vouchers = [
          { id: "v-hotel", kind: "hotel", title: tk("dz.voucher.hotel"), body: tk("dz.voucher.hotelBody", { airline: out.carrierName }), code: `${out.carrier}H-${code.slice(-5)}` },
          { id: "v-meal", kind: "meal", title: tk("dz.voucher.meal", { n }), body: tk("dz.voucher.mealBody"), code: `${out.carrier}M-${code.slice(-5)}` },
        ];
      }
    }
    await tx.update(appTripFacts).set({
      segments: segFacts, vouchers, rebooked: opt.kind === "rebook" || (f?.rebooked ?? false),
      disruption: { kind, segmentId: out.id, cause: null, source: tk(`dz.${kind}.source`, { airline: out.carrierName }), decided: optionId }, updatedAt: new Date(),
    }).where(eq(appTripFacts.tripId, trip.id));
    await appAuditLog(tx, { actorKind: "user", actorId: ownerId, action: "trip.disruption_choice", entityType: "app_trip", entityId: trip.id, summary: `Chose "${opt.title}" after ${out.flightNumber} was ${kind === "delay" ? "delayed" : "cancelled"}`, data: { kind, optionId }, ipHash });
    const flight = opt.title.split(" · ")[0]!.replace(/^\S+ /, "");
    const pickupAt = homePickup(trip) && opt.departs ? addMinutes(opt.departs, homePickup(trip)!.offsetMin ?? -155) : null;
    const driver = homePickup(trip)?.driverName ?? tk("trip.yourDriver");
    const result: ChoiceResult = opt.kind === "stay"
      ? { optionId, kind: "stay", headline: tk("dz.done.stay", { code: out.flightNumber }), body: tk("dz.done.stayBody", { airline: out.carrierName }), agentLine: tk("dz.done.line", { agent: agentName }), refund: null }
      : {
        optionId, kind: "rebook", headline: tk(n === 1 ? "dz.done.rebook.one" : "dz.done.rebook.other", { n, flight }),
        body: night ? tk("dz.done.nightBody", { time: optionId === "morning" ? "05:15" : "07:30" }) : pickupAt ? tk("dz.done.rebookBody", { driver, time: pickupAt }) : tk("dz.done.rebookBodyNoCar"),
        agentLine: tk(night ? "dz.done.nightLine" : "dz.done.line", { agent: agentName }), refund: null,
      };
    return result as unknown as Record<string, unknown>;
  }).then(async (r) => {
    const res = r as unknown as ChoiceResult;
    await notify(ownerId, { kind: "booking_confirmed", level: "active", copy: "notify.trip.rebooked", vars: { agent: agentName, what: res.kind === "stay" ? out.flightNumber : opt.title.split(" · ")[0]!, time: opt.departs ?? hhmm(out.departLocal) }, href: `/trip/${trip.id}` });
    return res;
  });
}
