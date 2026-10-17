import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, gt, inArray } from "drizzle-orm";
import { AIRPORT_CITY, arriveInstant, boardsAt, departInstant, hhmm, addMinutes, type BarcodeFormat, type TripDetail } from "@mada/shared";
import { db } from "@/db";
import { appStays, appTrips } from "@/db/app-schema";
import { appBoardingPasses, appWalletPassVersions, appWalletRegistrations } from "@/db/app-schema-native";
import { pepper } from "../config";
import { AppError } from "../http";
import { pushWalletUpdate } from "../apns";
import { tripDetail } from "../trips/core";
import { passSigner, walletEnabled } from "./config";
import { buildPkpass, type FlightPass, type StayPass } from "./pkpass";

/*
 * Apple Wallet passes for a boarding pass ("bp-<pass id>") and a hotel stay ("stay-<stay id>"), the short-lived link
 * the app opens to add one, and the PassKit web service that keeps them current: a device registers, we push when
 * the gate or the time changes, it asks what changed and fetches the pass again.
 */

const b64u = (b: Buffer | string) => Buffer.from(b).toString("base64url");
const mac = (s: string) => createHmac("sha256", pepper()).update(s).digest();

/** The pass's own web-service token: derived from its serial, so nothing has to be stored. */
export const passAuthToken = (serial: string) => b64u(mac(`pkpass-auth:${serial}`)).slice(0, 32);

export function authTokenOk(serial: string, header: string | null): boolean {
  const given = /^ApplePass\s+(\S+)$/.exec(header ?? "")?.[1] ?? "";
  const want = passAuthToken(serial);
  return given.length === want.length && timingSafeEqual(Buffer.from(given), Buffer.from(want));
}

/** A link that downloads the pass for ten minutes, for Safari to offer "Add to Apple Wallet". */
export function passLink(serial: string, ttlMs = 10 * 60_000): { url: string; expiresAt: string } {
  const exp = Date.now() + ttlMs;
  const body = b64u(`${serial}.${exp}`);
  const sig = b64u(mac(`pkpass-link:${body}`)).slice(0, 32);
  return { url: `${apiBase()}/api/app/v1/wallet/pass/${body}.${sig}`, expiresAt: new Date(exp).toISOString() };
}

export function serialFromLink(token: string): string | null {
  const [body, sig] = token.replace(/\.pkpass$/, "").split(".");
  if (!body || !sig) return null;
  const want = b64u(mac(`pkpass-link:${body}`)).slice(0, 32);
  if (sig.length !== want.length || !timingSafeEqual(Buffer.from(sig), Buffer.from(want))) return null;
  const [serial, exp] = Buffer.from(body, "base64url").toString("utf8").split(".");
  return serial && Number(exp) > Date.now() ? serial : null;
}

const apiBase = () => (process.env.APP_PUBLIC_URL ?? "https://madatrips.sa").replace(/\/+$/, "");
const serviceUrl = () => { const b = apiBase(); return b.startsWith("https://") ? `${b}/api/app/v1/wallet/passkit/` : null; };
const uuidRe = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type Built = { pass: FlightPass | StayPass; fingerprint: string; ownerId: string };

/** What a serial's pass shows now, from the trip as it stands. Null when the pass or the trip is gone. */
export async function passFor(serial: string): Promise<Built | null> {
  const [kind, id] = [serial.slice(0, serial.indexOf("-")), serial.slice(serial.indexOf("-") + 1)];
  if (!uuidRe.test(id)) return null;
  const svc = { serial, authToken: passAuthToken(serial), webServiceURL: serviceUrl() };
  if (kind === "bp") {
    const [bp] = await db.select().from(appBoardingPasses).where(eq(appBoardingPasses.id, id));
    if (!bp) return null;
    const trip = await tripDetail(bp.ownerId, bp.tripId, null).catch(() => null);
    const seg = trip?.segments.find((s) => s.id === bp.segmentId);
    if (!trip || !seg) return null;
    const delay = seg.delayMin ?? 0;
    const pass: FlightPass = {
      ...svc, kind: "flight", airline: seg.carrierName, brand: seg.brand ?? "#1e352d", flightNumber: seg.flightNumber, carrierCode: seg.carrier,
      from: seg.from, to: seg.to, fromCity: AIRPORT_CITY[seg.from] ?? seg.from, toCity: AIRPORT_CITY[seg.to] ?? seg.to,
      departLocal: seg.departLocal, departIso: departInstant(seg).toISOString(), arriveIso: arriveInstant(seg).toISOString(),
      boards: boardsAt(seg), departs: delay ? addMinutes(hhmm(seg.departLocal), delay) : hhmm(seg.departLocal),
      gate: seg.gate, terminal: seg.terminal, seat: bp.seat, sequence: bp.sequence, pnr: bp.pnr, passenger: bp.passengerName,
      format: bp.format as BarcodeFormat, message: bp.message, cancelled: seg.status === "cancelled",
    };
    return { pass, ownerId: bp.ownerId, fingerprint: [pass.gate, pass.boards, pass.departs, pass.seat, pass.cancelled].join("|") };
  }
  if (kind === "stay") {
    const [row] = await db.select({ tripId: appStays.tripId, ownerId: appTrips.ownerId }).from(appStays).innerJoin(appTrips, eq(appTrips.id, appStays.tripId)).where(eq(appStays.id, id));
    if (!row) return null;
    const trip = await tripDetail(row.ownerId, row.tripId, null).catch(() => null);
    const st = trip?.stays.find((s) => s.id === id);
    if (!trip || !st || st.status === "cancelled") return null;
    const pass: StayPass = {
      ...svc, kind: "stay", hotel: st.name, checkIn: st.checkIn, nights: st.nights, rooms: st.rooms, confirmation: st.confirmation, address: st.address, city: trip.city,
      relevantIso: new Date(Date.parse(`${st.checkIn}T11:00:00Z`)).toISOString(),
    };
    return { pass, ownerId: row.ownerId, fingerprint: [st.name, st.checkIn, st.nights, st.rooms, st.confirmation].join("|") };
  }
  return null;
}

/** The signed .pkpass for a serial, and when it last changed. */
export async function pkpassFor(serial: string): Promise<{ bytes: Buffer; updatedAt: Date } | null> {
  const s = passSigner();
  if (!s || !walletEnabled()) throw new AppError("NOT_CONFIGURED");
  const built = await passFor(serial);
  if (!built) return null;
  const updatedAt = await touchVersion(serial, s.passTypeId, built.fingerprint);
  return { bytes: buildPkpass(built.pass, s).bytes, updatedAt };
}

async function touchVersion(serial: string, passTypeId: string, fingerprint: string): Promise<Date> {
  const [v] = await db.select().from(appWalletPassVersions).where(eq(appWalletPassVersions.serial, serial));
  if (v && v.fingerprint === fingerprint) return v.updatedAt;
  const now = new Date();
  await db.insert(appWalletPassVersions).values({ serial, passTypeId, fingerprint, updatedAt: now })
    .onConflictDoUpdate({ target: appWalletPassVersions.serial, set: { fingerprint, updatedAt: now } });
  return now;
}

/** The link for a boarding pass or a stay on this trip, checked against the owner. */
export async function walletLinkFor(ownerId: string, trip: TripDetail, ask: { passId?: string; stayId?: string }): Promise<{ url: string; expiresAt: string }> {
  if (!walletEnabled()) throw new AppError("NOT_CONFIGURED");
  if (ask.passId) {
    const [bp] = uuidRe.test(ask.passId) ? await db.select({ id: appBoardingPasses.id }).from(appBoardingPasses).where(and(eq(appBoardingPasses.id, ask.passId), eq(appBoardingPasses.ownerId, ownerId), eq(appBoardingPasses.tripId, trip.id))) : [];
    if (!bp) throw new AppError("NOT_FOUND");
    return passLink(`bp-${bp.id}`);
  }
  if (ask.stayId && trip.stays.some((s) => s.id === ask.stayId && s.status !== "cancelled")) return passLink(`stay-${ask.stayId}`);
  throw new AppError("NOT_FOUND");
}

/* ───────── the PassKit web service ───────── */

export async function register(deviceId: string, passTypeId: string, serial: string, pushToken: string): Promise<"created" | "exists"> {
  const key = and(eq(appWalletRegistrations.deviceId, deviceId), eq(appWalletRegistrations.passTypeId, passTypeId), eq(appWalletRegistrations.serial, serial));
  const [had] = await db.select({ id: appWalletRegistrations.id }).from(appWalletRegistrations).where(key);
  if (had) { await db.update(appWalletRegistrations).set({ pushToken }).where(key); return "exists"; }
  await db.insert(appWalletRegistrations).values({ deviceId, passTypeId, serial, pushToken }).onConflictDoNothing();
  return "created";
}

export async function unregister(deviceId: string, passTypeId: string, serial: string): Promise<void> {
  await db.delete(appWalletRegistrations).where(and(eq(appWalletRegistrations.deviceId, deviceId), eq(appWalletRegistrations.passTypeId, passTypeId), eq(appWalletRegistrations.serial, serial)));
}

/** Serials this device holds that changed after `since` (the tag we gave last time, ms since 1970). */
export async function updatedSince(deviceId: string, passTypeId: string, since: number | null): Promise<{ serials: string[]; lastUpdated: string } | null> {
  const regs = await db.select({ serial: appWalletRegistrations.serial }).from(appWalletRegistrations).where(and(eq(appWalletRegistrations.deviceId, deviceId), eq(appWalletRegistrations.passTypeId, passTypeId)));
  if (!regs.length) return null;
  const serials = regs.map((r) => r.serial);
  const rows = await db.select().from(appWalletPassVersions).where(and(inArray(appWalletPassVersions.serial, serials), ...(since ? [gt(appWalletPassVersions.updatedAt, new Date(since))] : [])));
  if (!rows.length) return { serials: [], lastUpdated: String(since ?? Date.now()) };
  return { serials: rows.map((r) => r.serial), lastUpdated: String(Math.max(...rows.map((r) => r.updatedAt.getTime()))) };
}

/**
 * After a gate, time or status change on these trips: every Wallet pass on them whose face changed gets a new
 * version and a push to each device that holds it. Never throws (a push is a nudge).
 */
export async function walletPassesChanged(tripIds: string[]): Promise<number> {
  const s = passSigner();
  if (!s || !tripIds.length) return 0;
  let pushed = 0;
  try {
    const bps = await db.select({ id: appBoardingPasses.id }).from(appBoardingPasses).where(inArray(appBoardingPasses.tripId, tripIds));
    const stays = await db.select({ id: appStays.id }).from(appStays).where(inArray(appStays.tripId, tripIds));
    const serials = [...bps.map((b) => `bp-${b.id}`), ...stays.map((x) => `stay-${x.id}`)];
    if (!serials.length) return 0;
    const regs = await db.select().from(appWalletRegistrations).where(inArray(appWalletRegistrations.serial, serials));
    for (const serial of new Set(regs.map((r) => r.serial))) {
      const built = await passFor(serial);
      if (!built) continue;
      const [v] = await db.select().from(appWalletPassVersions).where(eq(appWalletPassVersions.serial, serial));
      if (v?.fingerprint === built.fingerprint) continue;
      await touchVersion(serial, s.passTypeId, built.fingerprint);
      for (const r of regs.filter((x) => x.serial === serial)) {
        const res = await pushWalletUpdate(r.pushToken);
        if (res.status === 200) pushed += 1;
        // 410: the device removed the pass.
        if (res.status === 410) await unregister(r.deviceId, r.passTypeId, r.serial);
      }
    }
  } catch { /* the pass is still right the next time Wallet asks */ }
  return pushed;
}
