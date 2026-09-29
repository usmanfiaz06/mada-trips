import "server-only";
import { sql, type SQL } from "drizzle-orm";
import { db } from "@/db";
import type { CurrentUser } from "./auth";
import { isIsoDate, isUuid, likeContains } from "@/lib/security";

export type SaleRow = {
  id: string; ref: string; business_date: string; created_at: Date; channel: string; service_type: string; status: string;
  client_name: string; client_id: string; passengers: string; description: string | null; pnr: string | null;
  sell_price: number; net_cost: number; paid: number; preparer: string; on_credit: boolean; due_date: string | null;
};

/** Sales visible to this user: everything with sales.view_all, otherwise their own team's. */
export async function querySales(u: CurrentUser, f: { status?: string; q?: string; channel?: string; from?: string; to?: string; clientId?: string; page?: number; limit?: number }) {
  const where: SQL[] = [sql`true`];
  if (!u.permissions.has("sales.view_all")) where.push(sql`pu.team = ${u.team}`);
  if (f.status === "unpaid") where.push(sql`b.status NOT IN ('void','refunded') AND coalesce(p.paid,0) < b.sell_price`);
  else if (f.status && f.status !== "all") where.push(sql`b.status = ${f.status}`);
  if (f.channel) where.push(sql`b.channel = ${f.channel}`);
  // Filters come from the address bar; malformed ones are ignored.
  if (f.from && !isIsoDate(f.from)) f = { ...f, from: undefined };
  if (f.to && !isIsoDate(f.to)) f = { ...f, to: undefined };
  if (f.clientId && !isUuid(f.clientId)) f = { ...f, clientId: undefined };
  if (f.from) where.push(sql`b.business_date >= ${f.from}`);
  if (f.to) where.push(sql`b.business_date <= ${f.to}`);
  if (f.clientId) where.push(sql`b.client_id = ${f.clientId}`);
  if (f.q) {
    const like = likeContains(f.q);
    where.push(sql`(b.ref ILIKE ${like} OR b.pnr ILIKE ${like} OR b.passengers ILIKE ${like} OR c.name ILIKE ${like} OR b.ticket_numbers ILIKE ${like} OR b.description ILIKE ${like})`);
  }
  const cond = sql.join(where, sql` AND `);
  const limit = Math.min(Math.max(1, Math.floor(f.limit ?? 50)), 500);
  const page = Number.isFinite(f.page) && f.page! >= 1 ? Math.min(Math.floor(f.page!), 10_000) : 1;
  const offset = (page - 1) * limit;
  const base = sql`FROM bookings b JOIN clients c ON c.id = b.client_id JOIN users pu ON pu.id = b.prepared_by
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id WHERE ${cond}`;
  const [rows, agg] = await Promise.all([
    db.execute<SaleRow>(sql`SELECT b.id, b.ref, b.business_date, b.created_at, b.channel, b.service_type, b.status, c.name AS client_name, c.id AS client_id,
      b.passengers, b.description, b.pnr, b.sell_price::bigint AS sell_price, b.net_cost::bigint AS net_cost, coalesce(p.paid,0)::bigint AS paid, pu.name AS preparer, b.on_credit, b.due_date
      ${base} ORDER BY b.created_at DESC LIMIT ${limit} OFFSET ${offset}`),
    db.execute<{ n: number; sell: number; margin: number }>(sql`SELECT count(*)::int AS n, coalesce(sum(b.sell_price),0)::bigint AS sell,
      coalesce(sum(b.sell_price - b.net_cost) FILTER (WHERE b.status NOT IN ('void','refunded')),0)::bigint AS margin ${base}`),
  ]);
  return {
    rows: rows.map((r) => ({ ...r, sell_price: Number(r.sell_price), net_cost: Number(r.net_cost), paid: Number(r.paid) })),
    total: agg[0].n, sell: Number(agg[0].sell), margin: Number(agg[0].margin),
  };
}
