import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "@/db";
import { requirePerm, can, isOversight } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { getSettings } from "@/lib/settings";
import { activeDelegation } from "@/lib/issuance";
import { businessDate } from "@/lib/dates";
import { PageHeader } from "@/components/ui";
import { SaleForm } from "./sale-form";

export const metadata = { title: "New sale" };

export default async function NewSale({ searchParams }: { searchParams: Promise<{ client?: string }> }) {
  const u = await requirePerm("sales.create");
  const t = await getT();
  const s = await getSettings();
  const { client } = await searchParams;
  const rows = await db.execute<{ id: string; name: string; type: string; phone: string | null; credit_limit: number; terms: number; exposure: number }>(sql`
    SELECT c.id, c.name, c.type, c.phone, c.credit_limit::bigint, c.payment_terms_days AS terms,
      coalesce((SELECT SUM(b.sell_price - coalesce((SELECT SUM(p.amount) FROM payments p WHERE p.booking_id = b.id),0))
        FROM bookings b WHERE b.client_id = c.id AND b.status IN ('issued','pending_issue','awaiting_credit')),0)::bigint AS exposure
    FROM clients c ORDER BY (SELECT max(created_at) FROM bookings b WHERE b.client_id = c.id) DESC NULLS LAST, c.name LIMIT 500`);
  const d = await activeDelegation(db, u.id);
  let delegation = null;
  if (d) {
    const [used] = await db.select({ total: sql<number>`coalesce(sum(${schema.bookings.sellPrice}),0)::bigint`.mapWith(Number) }).from(schema.bookings)
      .where(and(eq(schema.bookings.issuedUnderDelegation, d.id), sql`(${schema.bookings.issuedAt} AT TIME ZONE 'Asia/Riyadh')::date = ${businessDate()}`));
    delegation = { scope: d.scope, maxTicket: d.maxTicket, dailyLeft: Math.max(0, d.dailyCap - used.total) };
  }
  return (
    <>
      <PageHeader eyebrow={t("Point of sale")} title={t("New sale")} subtitle={t("Four quick steps. The summary tells you exactly what will happen when you save.")} />
      <SaleForm clients={rows.map((r) => ({ id: r.id, name: r.name, type: r.type, phone: r.phone, creditLimit: Number(r.credit_limit), exposure: Number(r.exposure), terms: r.terms }))}
        targetBps={s.targetMarginBps} creditDualLimit={s.creditDualLimit} showRules={isOversight(u)} canIssueAll={can(u, "issue.unlimited")} delegation={delegation} defaultClientId={client} />
    </>
  );
}
