import Link from "next/link";
import { Receipt } from "lucide-react";
import { getT } from "@/lib/i18n";
import { fmtDate, riyadhDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { requireDeskFinance } from "@/lib/app/finance/access";
import { vatReport } from "@/lib/app/finance/revenue";
import { Badge, Card, CardHead, Empty, Money, PageHeader, Stat, Table, Tabs, Td, Th } from "@/components/ui";
import { SummaryStrip } from "@/components/desk/list";
import { CustomerLink } from "@/components/desk/customer-link";

export const metadata = { title: "App VAT · Desk" };

/*
 * The app's VAT report (DESK-PLAN U6): output VAT by month from the invoices the app issued (credit notes take it
 * back), and the ZATCA side: invoices still waiting to be reported and the ones ZATCA refused.
 */

export default async function VatPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireDeskFinance();
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const now = Number(riyadhDate().slice(0, 4));
  const year = Number(sp.year) >= 2024 && Number(sp.year) <= now ? Number(sp.year) : now;
  const r = await vatReport(year);
  return (
    <>
      <PageHeader eyebrow={t("App finance")} title={t("App revenue & margin")} subtitle={t("Output VAT on what the app sold, by month, from its invoices. Credit notes take VAT back.")} />
      <Tabs active="vat" items={[{ key: "revenue", label: t("Revenue & margin"), href: "/adminwork/desk/finance" }, { key: "vat", label: t("VAT"), href: "/adminwork/desk/finance/vat" }]} />
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
        <Stat label={t("Output VAT {year}", { year })} value={<Money v={r.total.vat} />} />
        <Stat label={t("Sales before VAT")} value={<Money v={r.total.net} />} />
        <Stat label={t("Invoices · credit notes")} value={<span className="num">{r.total.invoices} · {r.total.notes}</span>} />
        <Stat label={t("ZATCA: waiting · refused")} value={<span className="num">{r.total.pending} · {r.total.failed}</span>} tone={r.total.failed > 0 ? "bad" : undefined} />
      </div>
      <Card pad={false} className="mt-4">
        <div className="flex flex-wrap items-center gap-2 p-4 text-[13px]">
          {Array.from({ length: Math.max(1, now - 2024 + 1) }, (_, i) => now - i).map((y) => (
            <Link key={y} href={`/adminwork/desk/finance/vat?year=${y}`} className={y === year ? "rounded-full bg-ink px-4 py-1.5 text-bg" : "rounded-full px-4 py-1.5 text-ink-3 hover:text-ink"}>{y}</Link>
          ))}
        </div>
        <SummaryStrip>
          <span>{t("Gross")} <span className="num text-ink" dir="ltr">{sar(r.total.gross)}</span></span>
          <span>{t("VAT")} <span className="num text-ink" dir="ltr">{sar(r.total.vat)}</span></span>
        </SummaryStrip>
        {r.months.length === 0 ? <Empty icon={<Receipt className="size-5" />} title={t("No invoices this year")} /> : (
          <Table>
            <thead><tr><Th>{t("Month")}</Th><Th align="end">{t("Invoices")}</Th><Th align="end">{t("Credit notes")}</Th><Th align="end">{t("Gross")}</Th><Th align="end">{t("Net")}</Th><Th align="end">{t("VAT")}</Th><Th>{t("ZATCA")}</Th></tr></thead>
            <tbody>
              {r.months.map((m) => (
                <tr key={m.month}>
                  <Td><span className="num" dir="ltr">{m.month}</span></Td>
                  <Td align="end"><span className="num">{m.invoices}</span></Td><Td align="end"><span className="num">{m.notes}</span></Td>
                  <Td align="end"><Money v={m.gross} /></Td><Td align="end"><Money v={m.net} /></Td><Td align="end"><Money v={m.vat} /></Td>
                  <Td>{m.failed > 0 ? <Badge tone="bad">{t("{n} refused", { n: m.failed })}</Badge> : m.pending > 0 ? <Badge tone="gold">{t("{n} waiting", { n: m.pending })}</Badge> : <Badge tone="ok">{t("Reported")}</Badge>}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
      {r.failures.length > 0 && (
        <Card pad={false} className="mt-4">
          <div className="p-6 pb-2"><CardHead title={t("Refused by ZATCA")} hint={t("Fix the invoice and report it again")} /></div>
          <Table>
            <thead><tr><Th>{t("Invoice")}</Th><Th>{t("Traveller")}</Th><Th>{t("Issued")}</Th><Th align="end">{t("Total")}</Th><Th align="end">{t("VAT")}</Th></tr></thead>
            <tbody>{r.failures.map((f) => (
              <tr key={f.id}><Td><span className="num">{f.number}</span></Td><Td><CustomerLink id={f.ownerId}>{f.owner}</CustomerLink></Td><Td>{fmtDate(f.issuedAt, L)}</Td><Td align="end"><Money v={f.total} /></Td><Td align="end"><Money v={f.vat} /></Td></tr>
            ))}</tbody>
          </Table>
        </Card>
      )}
    </>
  );
}
