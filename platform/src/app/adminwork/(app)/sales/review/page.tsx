import Link from "next/link";
import { and, desc, eq, isNull, sql } from "drizzle-orm";
import { CheckCheck } from "lucide-react";
import { db, schema } from "@/db";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Ticket settlement review" };

export default async function SettlementReviewPage() {
  await requirePerm("finance.reconcile");
  const t = await getT();
  const L = t.locale;

  // Flights recorded before the IATA/Direct choice existed, still marked "via BSP" and unconfirmed.
  const rows = await db.select({
    id: schema.bookings.id, ref: schema.bookings.ref, supplier: schema.bookings.supplier,
    description: schema.bookings.description, passengers: schema.bookings.passengers,
    netCost: schema.bookings.netCost, businessDate: schema.bookings.businessDate, client: schema.clients.name,
  }).from(schema.bookings).innerJoin(schema.clients, eq(schema.clients.id, schema.bookings.clientId))
    .where(and(eq(schema.bookings.serviceType, "flight"), eq(schema.bookings.viaBsp, true), eq(schema.bookings.supplierReviewed, false),
      sql`${schema.bookings.status} not in ('void','refunded','draft')`,
      // Only tickets that can actually be re-routed: not already settled in a BSP closing, and without a supplier payment.
      isNull(schema.bookings.bspClosingId),
      sql`NOT EXISTS (SELECT 1 FROM ${schema.supplierPayments} sp WHERE sp.booking_id = ${schema.bookings.id} AND sp.status IN ('settled','pending_approval'))`))
    .orderBy(desc(schema.bookings.businessDate));

  const total = rows.reduce((s, r) => s + r.netCost, 0);

  return (
    <>
      <PageHeader eyebrow={t("Treasury")} title={t("Ticket settlement review")}
        subtitle={t("Flights recorded before we added the IATA / Direct question. They're all sitting in the IATA balance — open each and confirm whether it really went through IATA, or move it to a direct supplier cost.")} />
      {rows.length === 0 ? (
        <Card><Empty icon={<CheckCheck className="size-5" />} title={t("All tickets confirmed")} hint={t("Every flight has been checked. Nothing left to review.")} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg num" dir="ltr">{t("{n} to review", { n: rows.length })}</span>
            <span className="rounded-full bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2 ring-1 ring-line num" dir="ltr">{t("In the IATA balance")} {sar(total)}</span>
          </div>
          <Card pad={false}>
            <Table>
              <thead><tr><Th>{t("Sale")}</Th><Th>{t("Airline")}</Th><Th>{t("Route")}</Th><Th>{t("Client")}</Th><Th>{t("Business day")}</Th><Th align="end">{t("Cost")}</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-surface-2">
                    <Td><Link href={`/adminwork/sales/${r.id}`} className="num underline decoration-line-strong underline-offset-4 hover:decoration-gold">{r.ref}</Link></Td>
                    <Td>{r.supplier ?? "—"}</Td>
                    <Td className="num text-ink-3"><span dir="ltr">{r.description ?? "—"}</span></Td>
                    <Td className="text-ink-3">{r.client}</Td>
                    <Td className="text-ink-3">{fmtDate(r.businessDate, L)}</Td>
                    <Td align="end"><span className="num" dir="ltr">{sar(r.netCost)}</span></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          </Card>
        </>
      )}
    </>
  );
}
