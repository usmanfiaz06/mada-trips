import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ReceiptText } from "lucide-react";
import { db, schema } from "@/db";
import { requireClientUser } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { scrub } from "@/lib/portal";
import { Badge, Card, Empty, Money, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Invoices" };

export default async function Invoices() {
  const u = await requireClientUser();
  const t = await getT();
  const [c] = await db.select().from(schema.clients).where(eq(schema.clients.id, u.clientId));
  // Only lease bills raised from this workspace, never anything else the company bought, and never void ones.
  const rows = await db.select({
    id: schema.bookings.id, ref: schema.bookings.ref, month: schema.bookings.portalMonth, desc: schema.bookings.description,
    amount: schema.bookings.sellPrice, vat: schema.bookings.vatAmount, due: schema.bookings.dueDate, status: schema.bookings.status, at: schema.bookings.businessDate,
    paid: sql<number>`coalesce((select sum(p.amount) from payments p where p.booking_id = ${schema.bookings.id}), 0)::bigint`,
  }).from(schema.bookings)
    .where(and(eq(schema.bookings.clientId, c.id), isNotNull(schema.bookings.portalRequestId), sql`${schema.bookings.status} NOT IN ('void','refunded','draft')`))
    .orderBy(desc(schema.bookings.createdAt));
  const list = scrub(rows.map((r) => ({ ...r, paid: Number(r.paid), desc: (r.desc ?? "").replace(/^Lease /, "") })), c.hiddenNames);
  const due = list.reduce((a, r) => a + Math.max(0, r.amount - r.paid), 0);
  return (
    <>
      <PageHeader title={t("Invoices")} subtitle={t("{days}-day payment terms. Amounts include 15% VAT.", { days: c.paymentTermsDays || 30 })}
        actions={<section className="night rounded-[20px] px-5 py-3"><div className="text-[12px] text-tile-ink-3">{t("Outstanding")}</div><Money v={due} className="text-[22px] font-medium text-glow-gold" /></section>} />
      <Card pad={false}>
        {list.length === 0 ? <Empty icon={<ReceiptText className="size-5" />} title={t("No invoices yet")} hint={t("Monthly invoices start once your cars are delivered.")} /> : (
          <Table>
            <thead><tr><Th>{t("Invoice")}</Th><Th>{t("For")}</Th><Th align="end">{t("Amount")}</Th><Th align="end">{t("VAT")}</Th><Th>{t("Due")}</Th><Th>{t("Status")}</Th></tr></thead>
            <tbody>
              {list.map((r) => {
                const left = r.amount - r.paid;
                return (
                  <tr key={r.id}>
                    <Td className="font-mono text-ink">{r.ref}</Td>
                    <Td className="max-w-[360px] truncate">{r.desc}</Td>
                    <Td align="end"><Money v={r.amount} /></Td>
                    <Td align="end"><Money v={r.vat} muted /></Td>
                    <Td>{fmtDate(r.due, t.locale)}</Td>
                    <Td>{left <= 0 ? <Badge tone="ok">{t("Paid")}</Badge> : r.paid > 0 ? <Badge tone="warn">{t("Part paid")}</Badge> : <Badge tone="gold">{t("Due")}</Badge>}</Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        )}
      </Card>
      <p className="mt-3 text-[12.5px] text-ink-3">{t("Pay by bank transfer to the account on the invoice and mention the invoice number. Questions? Write to the Mada desk on Home.")}</p>
    </>
  );
}
