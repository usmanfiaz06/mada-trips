import Link from "next/link";
import { Coins } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { payables } from "@/lib/finance";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, Empty, PageHeader, Table, Td, Th, cx } from "@/components/ui";

export const metadata = { title: "Money we owe" };

export default async function PayablesPage() {
  await requirePerm("finance.view");
  const t = await getT();
  const L = t.locale;
  const rows = await payables();
  const total = rows.reduce((s, r) => s + r.net_cost, 0);
  // Group by supplier for the summary.
  const bySupplier = [...rows.reduce((m, r) => m.set(r.supplier, (m.get(r.supplier) ?? 0) + r.net_cost), new Map<string, number>())].sort((a, b) => b[1] - a[1]);

  return (
    <>
      <PageHeader eyebrow={t("Treasury")} title={t("Money we owe")} subtitle={t("Supplier costs on sales that haven't been paid yet. Settle them from a sale, or record that a partner paid.")} />
      {rows.length === 0 ? (
        <Card><Empty icon={<Coins className="size-5" />} title={t("Nothing outstanding")} hint={t("Every supplier cost has been settled.")} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg num" dir="ltr">{t("Total owed")} {sar(total)}</span>
            {bySupplier.slice(0, 8).map(([sup, amt]) => (
              <span key={sup} className="rounded-full bg-surface-2 px-3.5 py-2 text-[12.5px] text-ink-2 ring-1 ring-line">{sup} · <span className="num" dir="ltr">{sar(amt)}</span></span>
            ))}
          </div>
          <Card pad={false}>
            <Table>
              <thead><tr><Th>{t("Sale")}</Th><Th>{t("Supplier")}</Th><Th>{t("Client")}</Th><Th>{t("Business day")}</Th><Th align="end">{t("We owe")}</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className="border-t border-line hover:bg-surface-2">
                    <Td><Link href={`/adminwork/sales/${r.id}`} className="num underline decoration-line-strong underline-offset-4 hover:decoration-gold">{r.ref}</Link>{r.pending && <Badge tone="warn" className="ms-2">{t("Approval pending")}</Badge>}</Td>
                    <Td>{r.supplier}</Td>
                    <Td className="text-ink-3">{r.client}</Td>
                    <Td className="text-ink-3">{fmtDate(r.business_date, L)}</Td>
                    <Td align="end"><span className={cx("num", "text-ink")} dir="ltr">{sar(r.net_cost)}</span></Td>
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
