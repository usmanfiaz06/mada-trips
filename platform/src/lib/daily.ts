import "server-only";
import { sql } from "drizzle-orm";
import { db, type Tx } from "@/db";

export type ReportRow = {
  id: string; ref: string; status: string; service_type: string; pnr: string | null; ticket_numbers: string | null; client: string; client_type: string;
  passengers: string; net_cost: number; sell_price: number; paid: number; paid_today: number; methods: string | null; on_credit: boolean; preparer: string; team: string;
};

/** The governance daily report: every booking of the business day with PNR/ticket, client, pax, net, sell, margin, payment method and collection status. */
export async function dailyReport(q: Tx | typeof db, date: string, team?: string) {
  const rows = await q.execute<ReportRow>(sql`
    SELECT b.id, b.ref, b.status, b.service_type, b.pnr, b.ticket_numbers, c.name AS client, c.type AS client_type, b.passengers,
      b.net_cost::bigint, b.sell_price::bigint, coalesce(p.paid,0)::bigint AS paid, coalesce(pt.paid,0)::bigint AS paid_today, pt.methods, b.on_credit, u.name AS preparer, u.team
    FROM bookings b JOIN clients c ON c.id = b.client_id JOIN users u ON u.id = b.prepared_by
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid FROM payments GROUP BY booking_id) p ON p.booking_id = b.id
    LEFT JOIN (SELECT booking_id, SUM(amount) AS paid, string_agg(DISTINCT method, ', ') AS methods FROM payments WHERE business_date = ${date} GROUP BY booking_id) pt ON pt.booking_id = b.id
    WHERE (b.business_date = ${date} OR pt.booking_id IS NOT NULL) AND b.status NOT IN ('draft')
      ${team ? sql`AND u.team = ${team}` : sql``}
    ORDER BY b.created_at`);
  const list = rows.map((r) => ({ ...r, net_cost: Number(r.net_cost), sell_price: Number(r.sell_price), paid: Number(r.paid), paid_today: Number(r.paid_today) }));
  const byMethod = await q.execute<{ method: string; account: string; total: number }>(sql`
    SELECT p.method, p.account, SUM(p.amount)::bigint AS total FROM payments p JOIN users u ON u.id = p.recorded_by
    WHERE p.business_date = ${date} ${team ? sql`AND u.team = ${team}` : sql``} GROUP BY p.method, p.account ORDER BY total DESC`);
  const methods = byMethod.map((m) => ({ ...m, total: Number(m.total) }));
  const active = list.filter((r) => r.status !== "void");
  const issues = active.filter((r) => (r.service_type === "flight" && !r.pnr) || r.status === "pending_issue" || r.status === "returned" || (!r.on_credit && r.paid < r.sell_price))
    .map((r) => ({ id: r.id, ref: r.ref, why: r.service_type === "flight" && !r.pnr ? "PNR missing" : r.status === "pending_issue" ? "Waiting to issue" : r.status === "returned" ? "Sent back, not fixed" : "Payment not complete" }));
  return {
    rows: list, methods, issues,
    totals: {
      count: active.length,
      net: active.reduce((s, r) => s + r.net_cost, 0),
      sell: active.reduce((s, r) => s + r.sell_price, 0),
      margin: active.reduce((s, r) => s + r.sell_price - r.net_cost, 0),
      collected: methods.reduce((s, m) => s + m.total, 0),
      cash: methods.filter((m) => m.method === "cash").reduce((s, m) => s + m.total, 0),
      onCredit: active.filter((r) => r.on_credit).reduce((s, r) => s + Math.max(0, r.sell_price - r.paid), 0),
    },
  };
}
