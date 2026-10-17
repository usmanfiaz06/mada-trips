import "server-only";
import { and, asc, eq, inArray } from "drizzle-orm";
import {
  bcbpLegMatches, bcbpNameMatches, checkInWindow, parseBcbp, arriveInstant,
  type BarcodeFormat, type Bcbp, type BoardingPassView, type BoardingPassesResponse, type ImportBoardingPassResponse, type TripDetail,
} from "@mada/shared";
import { db } from "@/db";
import { appPeople } from "@/db/app-schema";
import { appBoardingPasses } from "@/db/app-schema-native";
import { appAuditLog } from "../audit";
import { AppError } from "../http";
import { storeFile } from "../documents/storage";
import { drawCode, readCodes, type Found } from "./barcode";
import { pdfImages } from "./pdf";
import { unzip } from "./zip";
import { walletEnabled } from "../wallet-pass/config";

/*
 * The airline's boarding passes (docs/app/NATIVE.md). The traveller adds the PDF, screenshot or .pkpass they got from
 * the airline's check-in, or the desk uploads it on the order; we read the IATA BCBP barcode in it, match each leg to
 * a flight on the trip and each name to a traveller, and keep the barcode's text so the phone can draw it again at
 * full size. Nothing here ever writes a barcode the airline didn't issue.
 */

export const MAX_PASS_FILE = 10 * 1024 * 1024;

type Kind = "pdf" | "image" | "pkpass";
export function kindOf(bytes: Buffer): Kind | null {
  if (bytes.subarray(0, 5).toString("latin1") === "%PDF-") return "pdf";
  if (bytes.readUInt32LE(0) === 0x04034b50) return "pkpass";
  const png = bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const jpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const gif = bytes.subarray(0, 4).toString("latin1") === "GIF8";
  return png || jpeg || gif ? "image" : null;
}

const PK_FORMAT: Record<string, BarcodeFormat> = { PKBarcodeFormatPDF417: "pdf417", PKBarcodeFormatAztec: "aztec", PKBarcodeFormatQR: "qr" };

/** Every barcode text in the file, with its symbology. */
export async function codesIn(bytes: Buffer): Promise<Found[]> {
  const kind = kindOf(bytes);
  if (kind === "image") return readCodes(new Uint8Array(bytes));
  if (kind === "pkpass") {
    const files = unzip(bytes);
    const pass = JSON.parse(files.get("pass.json")?.toString("utf8") ?? "{}") as { barcodes?: { message?: string; format?: string }[]; barcode?: { message?: string; format?: string } };
    return [...(pass.barcodes ?? []), ...(pass.barcode ? [pass.barcode] : [])]
      .filter((b) => b.message && b.format && PK_FORMAT[b.format])
      .map((b) => ({ format: PK_FORMAT[b.format!]!, text: b.message! }))
      .slice(0, 1);
  }
  if (kind === "pdf") {
    const out: Found[] = [];
    for (const img of pdfImages(bytes)) {
      const found = await readCodes(img.kind === "jpeg" ? new Uint8Array(img.bytes) : img.pixels).catch(() => []);
      for (const f of found) if (!out.some((o) => o.text === f.text)) out.push(f);
    }
    return out;
  }
  return [];
}

/** The boarding passes in a file: barcodes that are IATA BCBP, each with its parsed fields. */
export async function passesIn(bytes: Buffer): Promise<{ format: BarcodeFormat; bcbp: Bcbp }[]> {
  if (!kindOf(bytes)) throw new AppError("VALIDATION", { copy: "bp.unreadable", fields: { file: "type" } });
  const codes = await codesIn(bytes).catch(() => [] as Found[]);
  return codes.map((c) => ({ format: c.format, bcbp: parseBcbp(c.text) })).filter((p): p is { format: BarcodeFormat; bcbp: Bcbp } => !!p.bcbp);
}

const svgCache = new Map<string, string | null>();
async function svgFor(format: BarcodeFormat, message: string) {
  const k = `${format}:${message}`;
  if (!svgCache.has(k)) {
    if (svgCache.size > 500) svgCache.clear();
    svgCache.set(k, await drawCode(format, message));
  }
  return svgCache.get(k) ?? null;
}

type Row = typeof appBoardingPasses.$inferSelect;
export async function toView(r: Row, trip: Pick<TripDetail, "segments">): Promise<BoardingPassView | null> {
  const seg = trip.segments.find((s) => s.id === r.segmentId);
  if (!seg) return null;
  return {
    id: r.id, tripId: r.tripId, segmentId: r.segmentId, travellerId: r.personId, name: r.passengerName,
    flightNumber: seg.flightNumber, from: seg.from, to: seg.to, departLocal: seg.departLocal,
    seat: r.seat, sequence: r.sequence, pnr: r.pnr, compartment: r.compartment,
    format: r.format as BarcodeFormat, message: r.message, svg: await svgFor(r.format as BarcodeFormat, r.message),
    source: r.source === "desk" ? "desk" : "traveller", addedAt: r.createdAt.toISOString(),
  };
}

export async function passRows(tripId: string): Promise<Row[]> {
  return db.select().from(appBoardingPasses).where(eq(appBoardingPasses.tripId, tripId)).orderBy(asc(appBoardingPasses.createdAt));
}

/** GET /trips/{id}/boarding-passes: the passes, when check-in opens for each flight still to come, and Wallet. */
export async function listPasses(trip: TripDetail, now = Date.now()): Promise<BoardingPassesResponse> {
  const rows = await passRows(trip.id);
  const passes = (await Promise.all(rows.map((r) => toView(r, trip)))).filter((v): v is BoardingPassView => !!v);
  const checkIn = trip.segments.filter((s) => s.status !== "cancelled" && arriveInstant(s).getTime() > now).map((s) => checkInWindow(s, now));
  return { passes, checkIn, appleWallet: walletEnabled() };
}

/**
 * Reads a file and keeps every pass in it that belongs to this trip. A leg for another flight is reported, not kept;
 * a name that matches nobody is kept with no traveller (the desk sorts it). Same person and flight: the newer wins.
 */
export async function importPasses(
  ownerId: string, trip: TripDetail, file: { bytes: Buffer; name: string },
  by: { source: "traveller" | "desk"; agentName?: string | null; ipHash?: string | null },
): Promise<ImportBoardingPassResponse> {
  const found = await passesIn(file.bytes);
  if (!found.length) throw new AppError("VALIDATION", { copy: "bp.unreadable", fields: { file: "no_barcode" } });
  const people = trip.travellerIds.length
    ? await db.select({ id: appPeople.id, surname: appPeople.surname, givenNames: appPeople.givenNames }).from(appPeople).where(and(eq(appPeople.ownerId, ownerId), inArray(appPeople.id, trip.travellerIds)))
    : [];
  const unmatched: ImportBoardingPassResponse["unmatched"] = [];
  const keep: { segId: string; personId: string | null; format: BarcodeFormat; bcbp: Bcbp; leg: Bcbp["legs"][number] }[] = [];
  for (const { format, bcbp } of found) {
    for (const leg of bcbp.legs) {
      const seg = trip.segments.find((s) => bcbpLegMatches(leg, s));
      if (!seg) { unmatched.push({ name: bcbp.name, flight: `${leg.carrier}${leg.flightNumber}` }); continue; }
      const person = people.find((p) => bcbpNameMatches(bcbp, p))
        ?? people.find((p) => !p.surname && bcbpNameMatches(bcbp, { fullName: trip.travellers.find((x) => x.id === p.id)?.fullName ?? "" }));
      keep.push({ segId: seg.id, personId: person?.id ?? null, format, bcbp, leg });
    }
  }
  if (!keep.length) {
    if (unmatched[0]) throw new AppError("VALIDATION", { copy: "bp.otherTrip", vars: { flight: unmatched[0].flight }, fields: { file: "other_trip" } });
    throw new AppError("VALIDATION", { copy: "bp.unreadable", fields: { file: "no_barcode" } });
  }
  // The original file is kept (encrypted) for the desk when storage is set up; a pass works without it.
  const stored = await storeFile(db, ownerId, "document", { name: file.name, mime: kindOf(file.bytes) === "pdf" ? "application/pdf" : kindOf(file.bytes) === "pkpass" ? "application/vnd.apple.pkpass" : "image/png", bytes: file.bytes }).catch(() => null);
  const rows: Row[] = [];
  for (const k of keep) {
    const values = {
      ownerId, tripId: trip.id, segmentId: k.segId, personId: k.personId, passengerName: k.bcbp.name, format: k.format, message: k.bcbp.raw,
      pnr: k.leg.pnr, seat: k.leg.seat, sequence: k.leg.sequence, compartment: k.leg.compartment, source: by.source, addedBy: by.agentName ?? null,
      fileId: stored?.id ?? null, updatedAt: new Date(),
    };
    const [row] = await db.insert(appBoardingPasses).values(values)
      .onConflictDoUpdate({ target: [appBoardingPasses.segmentId, appBoardingPasses.passengerName], set: { ...values, createdAt: new Date() } }).returning();
    rows.push(row!);
  }
  await appAuditLog(db, {
    actorKind: by.source === "desk" ? "agent" : "user", actorId: by.source === "desk" ? null : ownerId, action: "boarding_pass.added", entityType: "trip", entityId: trip.id,
    summary: by.source === "desk" ? `${by.agentName ?? "The desk"} added ${rows.length} boarding pass(es)` : `Added ${rows.length} boarding pass(es)`, data: { count: rows.length, source: by.source }, ipHash: by.ipHash ?? null,
  }).catch(() => {});
  const added = (await Promise.all(rows.map((r) => toView(r, trip)))).filter((v): v is BoardingPassView => !!v);
  return { added, unmatched };
}

export async function deletePass(ownerId: string, tripId: string, passId: string, ipHash: string | null): Promise<void> {
  if (!/^[0-9a-f-]{36}$/i.test(passId)) throw new AppError("NOT_FOUND");
  const [row] = await db.delete(appBoardingPasses).where(and(eq(appBoardingPasses.id, passId), eq(appBoardingPasses.ownerId, ownerId), eq(appBoardingPasses.tripId, tripId))).returning({ id: appBoardingPasses.id });
  if (!row) throw new AppError("NOT_FOUND");
  await appAuditLog(db, { actorKind: "user", actorId: ownerId, action: "boarding_pass.removed", entityType: "trip", entityId: tripId, summary: "Removed a boarding pass", data: { passId }, ipHash }).catch(() => {});
}

export async function passById(ownerId: string, passId: string): Promise<Row | null> {
  if (!/^[0-9a-f-]{36}$/i.test(passId)) return null;
  const [row] = await db.select().from(appBoardingPasses).where(and(eq(appBoardingPasses.id, passId), eq(appBoardingPasses.ownerId, ownerId)));
  return row ?? null;
}

/* ───────── the desk ───────── */

export type DeskPass = { id: string; name: string; flight: string; seat: string; sequence: string; traveller: string | null; source: string; addedBy: string | null; at: Date };

/** The passes on an order's trip, for the desk's card. */
export async function deskPasses(tripId: string): Promise<DeskPass[]> {
  const rows = await passRows(tripId);
  if (!rows.length) return [];
  const { appSegments } = await import("@/db/app-schema");
  const segs = await db.select({ id: appSegments.id, no: appSegments.flightNumber }).from(appSegments).where(eq(appSegments.tripId, tripId));
  const ids = rows.map((r) => r.personId).filter((x): x is string => !!x);
  const people = ids.length ? await db.select({ id: appPeople.id, given: appPeople.givenNames, surname: appPeople.surname }).from(appPeople).where(inArray(appPeople.id, ids)) : [];
  return rows.map((r) => {
    const p = people.find((x) => x.id === r.personId);
    return { id: r.id, name: r.passengerName, flight: segs.find((s) => s.id === r.segmentId)?.no ?? "", seat: r.seat, sequence: r.sequence, traveller: p ? `${p.given} ${p.surname}`.trim() : null, source: r.source, addedBy: r.addedBy, at: r.createdAt };
  });
}

/** The desk adds the airline's file on an order: read, matched and kept as the traveller's, and the traveller told. */
export async function deskImport(tripId: string, file: { bytes: Buffer; name: string }, agentName: string): Promise<ImportBoardingPassResponse> {
  const { appTrips } = await import("@/db/app-schema");
  const [t] = await db.select({ ownerId: appTrips.ownerId }).from(appTrips).where(eq(appTrips.id, tripId));
  if (!t) throw new AppError("NOT_FOUND");
  const { tripDetail } = await import("../trips/core");
  const trip = await tripDetail(t.ownerId, tripId, null);
  const out = await importPasses(t.ownerId, trip, file, { source: "desk", agentName });
  const flights = [...new Set(out.added.map((a) => a.flightNumber))].join(", ");
  const { notify } = await import("../trips/notify");
  if (out.added.length) await notify(t.ownerId, { kind: "other", level: "active", copy: "notify.boardingPass", vars: { flight: flights }, href: "/wallet" }).catch(() => {});
  return out;
}
