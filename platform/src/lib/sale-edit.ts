import "server-only";
import { eq, sql } from "drizzle-orm";
import { schema, type Tx } from "@/db";
import { audit } from "./audit";
import { sar } from "./money";
import type { Traveller } from "./services";

type Booking = typeof schema.bookings.$inferSelect;

/** The fields a manager may correct on an issued sale. Only keys present are changed. */
export type SaleEditPatch = {
  netCost?: number;
  sellPrice?: number;
  supplier?: string | null;
  pnr?: string | null;
  ticketNumbers?: string | null;
  travellers?: Traveller[];
};

/** How much a patch moves the margin (sell − cost) versus the current booking — drives the approval route. */
export function marginDelta(b: Booking, patch: SaleEditPatch): number {
  const oldMargin = b.sellPrice - b.netCost;
  const newMargin = (patch.sellPrice ?? b.sellPrice) - (patch.netCost ?? b.netCost);
  return newMargin - oldMargin;
}

/** Total already received (cleared or not) on a booking — the selling price can never drop below this. */
export async function receivedOn(tx: Tx, bookingId: string): Promise<number> {
  const [r] = await tx.select({ total: sql<number>`coalesce(sum(${schema.payments.amount}),0)::bigint`.mapWith(Number) })
    .from(schema.payments).where(eq(schema.payments.bookingId, bookingId));
  return r?.total ?? 0;
}

/**
 * Validate a correction against the booking as it stands. Throws a human-readable error if it can't be applied.
 * Re-run at apply time (not only when proposing) so a change that became unsafe meanwhile is rejected.
 */
export async function assertCorrectable(tx: Tx, b: Booking, patch: SaleEditPatch) {
  if (b.status !== "issued") throw new Error("Only an issued sale can be corrected");
  // A sale already inside a signed Day-25 settlement shaped the partners' payout — changing it would rewrite
  // closed books. Record a correcting entry in the next cycle instead.
  if (b.recognizedCycleId) throw new Error("This sale is part of a signed Day-25 settlement and can't be edited. Make a correcting entry in the next cycle");
  const netCost = patch.netCost ?? b.netCost;
  const sellPrice = patch.sellPrice ?? b.sellPrice;
  // Net cost may be zero (a free/award ticket, or a service we provide ourselves — full margin). The selling
  // price still has to be above zero.
  if (netCost < 0) throw new Error("Net cost can't be negative");
  if (sellPrice <= 0) throw new Error("Selling price must be more than zero");
  const received = await receivedOn(tx, b.id);
  if (sellPrice < received) throw new Error(`SAR ${sar(received)} was already received. The selling price can't be lower than that`);
}

/** Apply a validated correction to a booking and write an audit entry describing exactly what changed. */
export async function applySaleEdit(tx: Tx, b: Booking, patch: SaleEditPatch, actorId: string | null, via: "direct" | "approved") {
  const set: Partial<Booking> & { updatedAt: Date } = { updatedAt: new Date() };
  const changes: Record<string, { from: unknown; to: unknown }> = {};
  const note: string[] = [];
  if (patch.netCost !== undefined && patch.netCost !== b.netCost) { set.netCost = patch.netCost; changes.netCost = { from: b.netCost, to: patch.netCost }; note.push(`cost ${sar(b.netCost)}→${sar(patch.netCost)}`); }
  if (patch.sellPrice !== undefined && patch.sellPrice !== b.sellPrice) { set.sellPrice = patch.sellPrice; changes.sellPrice = { from: b.sellPrice, to: patch.sellPrice }; note.push(`sell ${sar(b.sellPrice)}→${sar(patch.sellPrice)}`); }
  if (patch.supplier !== undefined && patch.supplier !== b.supplier) { set.supplier = patch.supplier; changes.supplier = { from: b.supplier, to: patch.supplier }; }
  if (patch.pnr !== undefined && patch.pnr !== b.pnr) { set.pnr = patch.pnr; changes.pnr = { from: b.pnr, to: patch.pnr }; }
  if (patch.ticketNumbers !== undefined && patch.ticketNumbers !== b.ticketNumbers) { set.ticketNumbers = patch.ticketNumbers; changes.ticketNumbers = { from: b.ticketNumbers, to: patch.ticketNumbers }; }
  if (patch.travellers !== undefined && JSON.stringify(patch.travellers) !== JSON.stringify(b.travellers)) {
    set.travellers = patch.travellers;
    set.passengers = patch.travellers.map((x) => x.name).filter(Boolean).join(", ").slice(0, 1000);
    set.paxCount = patch.travellers.length;
    changes.travellers = { from: b.passengers, to: set.passengers };
  }
  if (Object.keys(changes).length === 0) return false;
  await tx.update(schema.bookings).set(set).where(eq(schema.bookings.id, b.id));
  await audit(tx, { actorId, action: "booking.corrected", entityType: "booking", entityId: b.id, entityRef: b.ref,
    summary: `Corrected ${b.ref}${note.length ? ` · ${note.join(", ")}` : ""}${via === "approved" ? " (director-approved)" : ""}`, changes });
  return true;
}

/** Re-fetch and apply a correction stored on an approval payload, once directors approve it. */
export async function applySaleEditApproval(tx: Tx, bookingId: string, patch: SaleEditPatch, actorId: string) {
  const [b] = await tx.select().from(schema.bookings).where(eq(schema.bookings.id, bookingId));
  if (!b) return;
  await assertCorrectable(tx, b, patch); // re-validate at apply time
  await applySaleEdit(tx, b, patch, actorId, "approved");
}
