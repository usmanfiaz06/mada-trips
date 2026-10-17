import { z } from 'zod';
import { t, type CopyKey, type Vars } from '../copy';
import { addMinutes, zonedToInstant } from '../dates';
import type { Lang } from '../locale';
import { BarcodeFormat } from './bcbp';
import { AirportCode, FlightNumber, Id, IsoDateTime, LocalDateTime } from './common';
import { arriveInstant, boardsAt, departInstant, hhmm, pickupPlan } from './trips-logic';
import type { SegmentDetail, TripDetail } from './trips';

/*
 * Boarding passes from the airline, the lock-screen flight (Live Activity on iPhone, an ongoing notification on
 * Android) and Apple Wallet passes. NATIVE.md has what the owner sets up for each.
 */

/* ───────── boarding passes ───────── */

/** One traveller's boarding pass for one flight, as the airline issued it. `message` is the barcode's own text. */
export const BoardingPassView = z.object({
  id: Id,
  tripId: Id,
  segmentId: Id,
  /** The traveller it belongs to; null when the printed name didn't match anyone on the trip (the desk sorts it). */
  travellerId: Id.nullable(),
  /** As the airline printed it: "ALHARBI/OMAR MR". */
  name: z.string(),
  flightNumber: FlightNumber,
  from: AirportCode,
  to: AirportCode,
  departLocal: LocalDateTime,
  seat: z.string(),
  sequence: z.string(),
  pnr: z.string(),
  compartment: z.string(),
  format: BarcodeFormat,
  message: z.string().min(20).max(2000),
  /** The barcode drawn by the server from `message`, so the phone shows it offline at full size. */
  svg: z.string().nullable(),
  source: z.enum(['traveller', 'desk']),
  addedAt: IsoDateTime,
});
export type BoardingPassView = z.infer<typeof BoardingPassView>;

/** When online check-in opens for a flight, and where. */
export const CheckInWindow = z.object({
  segmentId: Id,
  airline: z.string(),
  opensAt: IsoDateTime,
  /** "09:25", at the departure airport. */
  opensLocal: z.string(),
  url: z.string().url().nullable(),
  open: z.boolean(),
});
export type CheckInWindow = z.infer<typeof CheckInWindow>;

export const BoardingPassesResponse = z.object({
  passes: z.array(BoardingPassView),
  checkIn: z.array(CheckInWindow),
  /** Apple Wallet passes can be made (the server has its Pass Type ID certificate). */
  appleWallet: z.boolean(),
});
export type BoardingPassesResponse = z.infer<typeof BoardingPassesResponse>;

export const ImportBoardingPassResponse = z.object({
  added: z.array(BoardingPassView),
  /** Passes in the file for a flight or a name that isn't on this trip. */
  unmatched: z.array(z.object({ name: z.string(), flight: z.string() })),
});
export type ImportBoardingPassResponse = z.infer<typeof ImportBoardingPassResponse>;

/** A short-lived link the phone opens so Safari offers "Add to Apple Wallet". */
export const WalletLinkResponse = z.object({ url: z.string().url(), expiresAt: IsoDateTime });
export type WalletLinkResponse = z.infer<typeof WalletLinkResponse>;

/*
 * Online check-in, per airline: hours before departure it opens, and the airline's page. Opening hours are each
 * airline's published rule as read in October 2026 (ASSUMED where marked; the desk can correct them here).
 */
export const CHECK_IN: Readonly<Record<string, { name: string; hours: number; url: string }>> = {
  SV: { name: 'Saudia', hours: 24, url: 'https://www.saudia.com/' },
  XY: { name: 'flynas', hours: 48, url: 'https://www.flynas.com/' }, // ASSUMED 48 h
  F3: { name: 'flyadeal', hours: 48, url: 'https://www.flyadeal.com/' }, // ASSUMED 48 h
  TK: { name: 'Turkish Airlines', hours: 24, url: 'https://www.turkishairlines.com/' },
  EK: { name: 'Emirates', hours: 48, url: 'https://www.emirates.com/' },
  QR: { name: 'Qatar Airways', hours: 48, url: 'https://www.qatarairways.com/' }, // ASSUMED 48 h
};

export function checkInWindow(seg: Pick<SegmentDetail, 'id' | 'carrier' | 'carrierName' | 'departLocal' | 'departTz' | 'delayMin'>, now: number): CheckInWindow {
  const rule = CHECK_IN[seg.carrier];
  const hours = rule?.hours ?? 24;
  const dep = zonedToInstant(seg.departLocal, seg.departTz).getTime();
  const opens = dep - hours * 3_600_000;
  const opensLocal = addMinutes(hhmm(seg.departLocal), -hours * 60);
  return { segmentId: seg.id, airline: rule?.name ?? seg.carrierName, opensAt: new Date(opens).toISOString(), opensLocal, url: rule?.url ?? null, open: now >= opens };
}

/* ───────── the lock-screen flight ───────── */

export const LiveFlightStatus = z.enum(['on_time', 'delayed', 'boarding', 'gate_changed', 'departed', 'landed', 'cancelled']);
export type LiveFlightStatus = z.infer<typeof LiveFlightStatus>;

/**
 * What the Live Activity shows, in the traveller's language. The Swift side (targets/live) decodes exactly these
 * keys; epochs are seconds since 1970 so neither side has to agree on a date format.
 */
export const LiveFlightState = z.object({
  flight: z.string(),
  from: z.string(),
  to: z.string(),
  gate: z.string().nullable(),
  seat: z.string().nullable(),
  boards: z.string(),
  departs: z.string(),
  departEpoch: z.number(),
  arriveEpoch: z.number(),
  status: LiveFlightStatus,
  statusText: z.string(),
  delayMin: z.number().int(),
  leave: z.string().nullable(),
  leaveText: z.string().nullable(),
  labels: z.object({ gate: z.string(), seat: z.string(), boards: z.string(), departs: z.string() }),
  updatedEpoch: z.number(),
});
export type LiveFlightState = z.infer<typeof LiveFlightState>;

/** The parts of a Live Activity that never change: who it's for and the airline's colour. */
export const LiveFlightAttributes = z.object({ tripId: Id, segmentId: Id, airline: z.string(), brand: z.string() });
export type LiveFlightAttributes = z.infer<typeof LiveFlightAttributes>;

export const RegisterLiveActivityRequest = z.object({
  tripId: Id,
  segmentId: Id,
  activityId: z.string().min(1).max(120),
  /** The ActivityKit push token (hex). Null on Android or before iOS hands one over. */
  pushToken: z.string().regex(/^[0-9a-f]{32,512}$/i).nullable(),
  platform: z.enum(['ios', 'android']),
  locale: z.enum(['en', 'ar']).optional(),
});
export type RegisterLiveActivityRequest = z.infer<typeof RegisterLiveActivityRequest>;

/** The lock screen starts this long before departure, by itself, unless the traveller turned it off. */
export const LIVE_START_BEFORE_MS = 4 * 3_600_000;
/** And ends this long after landing. */
export const LIVE_END_AFTER_MS = 30 * 60_000;

/** The flight the lock screen follows: the first one that hasn't landed yet (out, then back). */
export function liveSegment(trip: Pick<TripDetail, 'segments'>, now: number): SegmentDetail | null {
  const segs = [...trip.segments].sort((a, b) => departInstant(a).getTime() - departInstant(b).getTime());
  return segs.find((s) => arriveInstant(s).getTime() + LIVE_END_AFTER_MS > now) ?? null;
}

/** Whether the lock screen should be showing this flight now (from 4 h before take-off to 30 min after landing). */
export function liveWindow(seg: SegmentDetail, now: number): 'before' | 'live' | 'over' {
  const dep = departInstant(seg).getTime();
  if (now < dep - LIVE_START_BEFORE_MS) return 'before';
  if (seg.status === 'cancelled' && now > dep) return 'over';
  return now > arriveInstant(seg).getTime() + LIVE_END_AFTER_MS ? 'over' : 'live';
}

/** When to leave for the airport: the driver's time, or 2 h 35 min before take-off (3 h 30 min from a hotel abroad). */
export function leaveFor(trip: Pick<TripDetail, 'segments' | 'pickups'>, seg: SegmentDetail): string | null {
  if (seg.direction === 'connection') return null;
  if (seg.direction === 'out') return pickupPlan(trip)?.time ?? addMinutes(hhmm(seg.departLocal), -155);
  return addMinutes(hhmm(seg.departLocal), -210);
}

export function liveStatus(seg: SegmentDetail, now: number): LiveFlightStatus {
  const dep = departInstant(seg).getTime();
  if (seg.status === 'cancelled') return 'cancelled';
  if (seg.status === 'landed' || now >= arriveInstant(seg).getTime()) return 'landed';
  if (seg.status === 'departed' || seg.status === 'in_air' || now >= dep) return 'departed';
  if (seg.status === 'boarding' || now >= dep - 45 * 60_000) return 'boarding';
  if (seg.bookedGate && seg.gate && seg.gate !== seg.bookedGate) return 'gate_changed';
  if ((seg.delayMin ?? 0) >= 15 || seg.status === 'delayed') return 'delayed';
  return 'on_time';
}

/** Everything the lock screen shows for this trip's next flight, now, in `locale`. Null when nothing is flying. */
export function liveFlightState(trip: Pick<TripDetail, 'segments' | 'pickups' | 'travellers'>, now: number, locale?: Lang, seg = liveSegment(trip, now)): LiveFlightState | null {
  if (!seg) return null;
  const tl = (key: string, vars?: Vars) => t(key as CopyKey, vars, locale);
  const status = liveStatus(seg, now);
  const delay = seg.delayMin ?? 0;
  const statusText = status === 'delayed' ? tl('live.status.delayed', { minutes: delay })
    : status === 'gate_changed' ? tl('live.status.gate', { gate: seg.gate ?? '' })
    : tl(`live.status.${status}`);
  const leave = status === 'on_time' || status === 'delayed' || status === 'gate_changed' ? leaveFor(trip, seg) : null;
  const leaveAt = leave ? zonedToInstant(`${seg.departLocal.slice(0, 10)}T${leave}`, seg.departTz).getTime() : 0;
  // Once it's time to have left, the line stops telling them to leave.
  const leaveLive = leave && leaveAt > now - 15 * 60_000 ? leave : null;
  const seats = seg.seats.length ? (seg.seats.length > 1 ? `${seg.seats[0]}–${seg.seats[seg.seats.length - 1]}` : seg.seats[0]!) : null;
  return {
    flight: seg.flightNumber, from: seg.from, to: seg.to, gate: seg.gate, seat: seats,
    boards: boardsAt(seg), departs: delay ? addMinutes(hhmm(seg.departLocal), delay) : hhmm(seg.departLocal),
    departEpoch: Math.round(departInstant(seg).getTime() / 1000), arriveEpoch: Math.round(arriveInstant(seg).getTime() / 1000),
    status, statusText, delayMin: delay,
    leave: leaveLive, leaveText: leaveLive ? tl('live.leave', { time: leaveLive }) : null,
    labels: { gate: tl('live.label.gate'), seat: tl(seg.seats.length > 1 ? 'live.label.seats' : 'live.label.seat'), boards: tl('live.label.boards'), departs: tl('live.label.departs') },
    updatedEpoch: Math.round(now / 1000),
  };
}
