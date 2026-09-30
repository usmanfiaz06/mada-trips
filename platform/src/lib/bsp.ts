import "server-only";
import { and, eq, gte, inArray, isNull, lte, sql } from "drizzle-orm";
import { db, schema, type Tx } from "@/db";
import { audit } from "./audit";
import { createApproval } from "./approvals";
import { getSettings, setSetting, type Settings } from "./settings";
import { ACCOUNT } from "./labels";
import { sar } from "./money";
import { addDays, riyadhDate } from "./dates";

type Q = Tx | typeof db;

/** The 15-day IATA/BSP period containing a date: the 1st–15th, or the 16th–end of month. */
export function bspWindow(iso: string) {
  const [y, m] = iso.split("-").map(Number);
  const day = Number(iso.slice(8, 10));
  const mm = String(m).padStart(2, "0");
  if (day <= 15) return { start: `${y}-${mm}-01`, end: `${y}-${mm}-15` };
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { start: `${y}-${mm}-16`, end: `${y}-${mm}-${last}` };
}

/** Step back one 15-day window from a period start. */
function prevWindow(start: string) {
  return bspWindow(addDays(start, -1));
}

/** Unsettled IATA cost sitting in one window: flights issued in it, via BSP, not yet in a closing. */
async function windowUnsettled(q: Q, start: string, end: string) {
  const r = await q.execute<{ amount: number; n: number }>(sql`
    SELECT coalesce(sum(net_cost),0)::bigint AS amount, count(*)::int AS n FROM bookings
    WHERE via_bsp = true AND status = 'issued' AND bsp_closing_id IS NULL
      AND (issued_at AT TIME ZONE 'Asia/Riyadh')::date BETWEEN ${start} AND ${end}`);
  return { amount: Number(r[0]?.amount ?? 0), count: Number(r[0]?.n ?? 0) };
}

/** Everything owed to IATA that hasn't been settled yet — drives the reserve suggestion. */
export async function openBspTotal(q: Q = db) {
  const r = await q.execute<{ amount: number }>(sql`
    SELECT coalesce(sum(net_cost),0)::bigint AS amount FROM bookings
    WHERE via_bsp = true AND status = 'issued' AND bsp_closing_id IS NULL`);
  return Number(r[0]?.amount ?? 0);
}

export type BspClosingView = {
  start: string; end: string; dueDate: string; graceUntil: string;
  unsettled: number; count: number; overdue: boolean; inGrace: boolean;
  settlements: (typeof schema.bspClosings.$inferSelect & { partner?: string | null })[];
};

/** Recent BSP windows (current first), with their live unsettled amount and any settlements. */
export async function bspClosings(q: Q = db, s: Settings, windows = 6): Promise<BspClosingView[]> {
  const today = riyadhDate();
  let w = bspWindow(today);
  const out: BspClosingView[] = [];
  const rows = await q.select({ c: schema.bspClosings, partner: schema.partners.name }).from(schema.bspClosings).leftJoin(schema.partners, eq(schema.partners.id, schema.bspClosings.partnerId));
  for (let i = 0; i < windows; i++) {
    const { amount, count } = await windowUnsettled(q, w.start, w.end);
    const settlements = rows.filter((r) => r.c.periodEnd === w.end).map((r) => ({ ...r.c, partner: r.partner }));
    if (amount > 0 || settlements.length) {
      const dueDate = addDays(w.end, s.bspPaymentDays);
      const graceUntil = addDays(dueDate, s.bspGraceDays);
      out.push({ start: w.start, end: w.end, dueDate, graceUntil, unsettled: amount, count, overdue: amount > 0 && today > graceUntil, inGrace: amount > 0 && today > dueDate && today <= graceUntil, settlements });
    }
    w = prevWindow(w.start);
  }
  return out;
}

/** Settle a BSP closing: from a company bank now, or a partner's cash (then the other directors approve). */
export async function settleBspClosing(tx: Tx, opts: {
  periodStart: string; periodEnd: string; source: "bank" | "partner"; account?: string | null; partnerId?: string | null; reference?: string | null; settledBy: string;
}) {
  const s = await getSettings(tx);
  const bookings = await tx.select({ id: schema.bookings.id, netCost: schema.bookings.netCost }).from(schema.bookings)
    .where(and(eq(schema.bookings.viaBsp, true), eq(schema.bookings.status, "issued"), isNull(schema.bookings.bspClosingId),
      gte(sql`(${schema.bookings.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date`, opts.periodStart), lte(sql`(${schema.bookings.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date`, opts.periodEnd)))
    .for("update");
  const amount = bookings.reduce((n, b) => n + b.netCost, 0);
  if (amount <= 0) throw new Error("Nothing outstanding for this BSP period");
  const dueDate = addDays(opts.periodEnd, s.bspPaymentDays);
  const label = `BSP ${opts.periodStart} → ${opts.periodEnd}`;

  if (opts.source === "bank") {
    if (!opts.account || !["retail", "corporate"].includes(opts.account)) throw new Error("Choose which bank paid IATA");
    const [c] = await tx.insert(schema.bspClosings).values({ periodStart: opts.periodStart, periodEnd: opts.periodEnd, dueDate, amount, status: "paid", source: "bank", account: opts.account, reference: opts.reference ?? null, paidOn: riyadhDate(), settledBy: opts.settledBy }).returning();
    await tx.update(schema.bookings).set({ bspClosingId: c.id, supplierPaid: true, updatedAt: new Date() }).where(inArray(schema.bookings.id, bookings.map((b) => b.id)));
    await reduceReserve(tx, amount, opts.settledBy);
    await audit(tx, { actorId: opts.settledBy, action: "bsp.paid", entityType: "bsp", entityId: c.id, entityRef: label, summary: `Paid IATA SAR ${sar(amount)} for ${label} from ${ACCOUNT[opts.account]}` });
    return { pending: false };
  }

  if (!opts.partnerId) throw new Error("Choose which partner paid IATA");
  const [p] = await tx.select().from(schema.partners).where(eq(schema.partners.id, opts.partnerId));
  if (!p) throw new Error("Choose which partner paid IATA");
  const [c] = await tx.insert(schema.bspClosings).values({ periodStart: opts.periodStart, periodEnd: opts.periodEnd, dueDate, amount, status: "pending_approval", source: "partner", partnerId: p.id, reference: opts.reference ?? null, settledBy: opts.settledBy }).returning();
  // Reserve these bookings to the closing so a second settlement can't grab them; they're marked paid on approval.
  await tx.update(schema.bookings).set({ bspClosingId: c.id, updatedAt: new Date() }).where(inArray(schema.bookings.id, bookings.map((b) => b.id)));
  const req = await createApproval(tx, { kind: "bsp", entityType: "bsp", entityId: c.id, title: `${p.name} paid IATA · ${label}`, amount, reason: `BSP settlement for ${label} fronted by ${p.name}`, requestedBy: opts.settledBy, payload: { partnerId: p.id, closingId: c.id } });
  await tx.update(schema.bspClosings).set({ approvalId: req.id }).where(eq(schema.bspClosings.id, c.id));
  await audit(tx, { actorId: opts.settledBy, action: "bsp.requested", entityType: "bsp", entityId: c.id, entityRef: label, summary: `Recorded that ${p.name} paid IATA SAR ${sar(amount)} for ${label}; sent to the other directors` });
  return { pending: true };
}

async function reduceReserve(tx: Tx, amount: number, actorId: string) {
  const s = await getSettings(tx);
  const held = Math.max(0, s.iataReserveHeld - amount);
  if (held !== s.iataReserveHeld) await setSetting(tx, "iataReserveHeld", held, actorId);
}

type Req = typeof schema.approvalRequests.$inferSelect;

/** When the directors decide a partner-fronted BSP settlement. */
export async function finalizeBspClosing(tx: Tx, req: Req, ok: boolean, actorId: string) {
  const p = req.payload as { closingId?: string; partnerId?: string } | null;
  if (!p?.closingId) return;
  const [c] = await tx.select().from(schema.bspClosings).where(and(eq(schema.bspClosings.id, p.closingId), eq(schema.bspClosings.status, "pending_approval")));
  if (!c) return;
  const label = `BSP ${c.periodStart} → ${c.periodEnd}`;
  if (!ok) {
    await tx.update(schema.bookings).set({ bspClosingId: null, updatedAt: new Date() }).where(eq(schema.bookings.bspClosingId, c.id));
    await tx.delete(schema.bspClosings).where(eq(schema.bspClosings.id, c.id));
    await audit(tx, { actorId: null, action: "bsp.rejected", entityType: "bsp", entityId: c.id, entityRef: label, summary: `${req.ref} rejected: BSP settlement not recorded` });
    return;
  }
  await tx.update(schema.bspClosings).set({ status: "paid", paidOn: riyadhDate() }).where(eq(schema.bspClosings.id, c.id));
  await tx.update(schema.bookings).set({ supplierPaid: true, updatedAt: new Date() }).where(eq(schema.bookings.bspClosingId, c.id));
  await reduceReserve(tx, c.amount, actorId);
  if (c.partnerId) {
    await tx.insert(schema.ledgerEntries).values({ partnerId: c.partnerId, type: "expense", amount: c.amount, description: `IATA BSP settlement · ${label}`, sourceType: "bsp", sourceId: c.id, entryDate: riyadhDate(), createdBy: actorId });
    await audit(tx, { actorId: null, action: "ledger.credited", entityType: "bsp", entityId: c.id, entityRef: label, summary: `SAR ${sar(c.amount)} added to partner ledger: IATA BSP for ${label}` });
  }
}
