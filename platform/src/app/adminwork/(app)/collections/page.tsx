import Link from "next/link";
import { PhoneCall } from "lucide-react";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { db } from "@/db";
import { collections } from "@/lib/finance";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { Badge, Card, Empty, PageHeader, Table, Td, Th } from "@/components/ui";

export const metadata = { title: "Collections" };

export default async function CollectionsPage() {
  const u = await requireUser();
  const t = await getT();
  const L = t.locale;
  const rows = await collections(db, can(u, "sales.view_all") ? {} : { team: u.team });
  const overdue = rows.filter((r) => r.overdue);
  const totalOverdue = overdue.reduce((s, r) => s + r.owed, 0);
  const total = rows.reduce((s, r) => s + r.owed, 0);

  return (
    <>
      <PageHeader eyebrow={t("Receivables")} title={t("Collections")} subtitle={t("Client money still to collect, soonest due first. Overdue is highlighted so nothing slips.")} />
      {rows.length === 0 ? (
        <Card><Empty icon={<PhoneCall className="size-5" />} title={t("Nothing to collect")} hint={t("Every issued sale is fully paid.")} /></Card>
      ) : (
        <>
          <div className="mb-4 flex flex-wrap gap-2">
            <span className="rounded-full bg-ink px-4 py-2 text-[13.5px] text-bg num" dir="ltr">{t("Owed to us")} {sar(total)}</span>
            {totalOverdue > 0 && <span className="rounded-full bg-bad-soft px-4 py-2 text-[13.5px] text-bad num" dir="ltr">{t("Overdue")} {sar(totalOverdue)}</span>}
          </div>
          <Card pad={false}>
            <Table>
              <thead><tr><Th>{t("Sale")}</Th><Th>{t("Client")}</Th><Th>{t("Due")}</Th><Th>{t("Follow up")}</Th><Th align="end">{t("Owed")}</Th></tr></thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.id} className={r.overdue ? "border-t border-line bg-bad-soft/40" : "border-t border-line hover:bg-surface-2"}>
                    <Td><Link href={`/adminwork/sales/${r.id}`} className="num underline decoration-line-strong underline-offset-4 hover:decoration-gold">{r.ref}</Link></Td>
                    <Td>{r.client}{r.phone && <span className="block text-[12px] text-ink-3 num" dir="ltr">{r.phone}</span>}</Td>
                    <Td>{r.due_date ? <span className={r.overdue ? "text-bad" : "text-ink-2"}>{fmtDate(r.due_date, L)}</span> : <span className="text-ink-4">{t("No date")}</span>}</Td>
                    <Td>{r.overdue ? <Badge tone="bad">{t("Overdue")}</Badge> : <span className="text-ink-3">{r.preparer.split(" ")[0]}</span>}</Td>
                    <Td align="end"><span className="num text-ink" dir="ltr">{sar(r.owed)}</span></Td>
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
