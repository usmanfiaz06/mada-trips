import Link from "next/link";
import { Scale, Upload } from "lucide-react";
import { getT } from "@/lib/i18n";
import { fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { isUuid } from "@/lib/security";
import { RECON_STATUS } from "@/lib/labels";
import { requireDeskFinance } from "@/lib/app/finance/access";
import { listImports, reconRows, RECON_TABS } from "@/lib/app/finance/recon";
import { supplierMode } from "@/lib/app/config";
import { Card, CardHead, Empty, Money, Notice, PageHeader, Stat, Table, Tabs, Td, Th, cx } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { StatusBadge } from "@/components/desk/parts";
import { Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";
import { importSettlementAction } from "../../finance-actions";

export const metadata = { title: "Reconciliation · Desk" };

/*
 * MyFatoorah reconciliation (DESK-PLAN U6, screen 9): import the settlement file from the MyFatoorah portal; every line
 * is matched against our captures and refunds (lib/app/finance/recon.ts). Matched captures clear their Ops payment;
 * matched refunds move to Settled. The rest is listed to look at. Tabby and Tamara get the same view later.
 */

const TAB_LABEL: Record<string, string> = { attention: "To look at", matched: "Matched", all: "All" };

export default async function ReconciliationPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  await requireDeskFinance();
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const imports = await listImports();
  const imp = (sp.import && isUuid(sp.import) ? imports.find((i) => i.id === sp.import) : null) ?? imports[0] ?? null;
  const tab = (RECON_TABS as readonly string[]).includes(sp.tab ?? "") ? sp.tab! : "attention";
  const { page, offset } = pageParam(sp, 50);
  const data = imp ? await reconRows(imp.id, { tab, offset }) : null;
  const href = listHref("/adminwork/desk/finance/reconciliation", { import: imp?.id, tab: sp.tab, page: sp.page });
  const live = (() => { try { return supplierMode("payments") === "live"; } catch { return false; } })();
  const pctMatched = imp && imp.rows + (data?.by.missing_provider?.n ?? 0) > 0 ? Math.round((imp.matched / (imp.rows + (data?.by.missing_provider?.n ?? 0))) * 1000) / 10 : null;
  return (
    <>
      <PageHeader eyebrow={t("App finance")} title={t("Reconciliation")} subtitle={t("MyFatoorah's settlement against what Mada captured and refunded: matched, missing on our side, missing in the file, and the fees.")} />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {imp && data ? (
            <>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4 stagger">
                <Stat label={t("Matched")} value={<span className="num">{pctMatched !== null ? `${pctMatched}%` : "—"}</span>} sub={t("{n} lines", { n: imp.matched })} tone={imp.mismatched === 0 ? "ok" : undefined} />
                <Stat label={t("Amount differs")} value={<span className="num">{data.by.amount_mismatch?.n ?? 0}</span>} tone={(data.by.amount_mismatch?.n ?? 0) > 0 ? "bad" : undefined} />
                <Stat label={t("Not in Mada · not in the file")} value={<span className="num">{data.by.missing_ours?.n ?? 0} · {data.by.missing_provider?.n ?? 0}</span>} tone={(data.by.missing_ours?.n ?? 0) + (data.by.missing_provider?.n ?? 0) > 0 ? "warn" : undefined} />
                <Stat label={t("MyFatoorah fees")} value={<span className="num" dir="ltr">{sar(imp.fees, { compact: true })}</span>} sub={t("Fees this import: SAR {fees}", { fees: sar(imp.fees) })} />
              </div>
              <Tabs active={tab} items={RECON_TABS.map((k) => ({ key: k, label: t(TAB_LABEL[k]!), href: listHref("/adminwork/desk/finance/reconciliation", { import: imp.id })({ tab: k === "attention" ? undefined : k }), count: k === "attention" ? imp.mismatched : undefined }))} />
              <Card pad={false}>
                <SummaryStrip>
                  <span className="text-ink">{imp.fileName ?? t("Settlement")}</span>
                  <span>{imp.periodFrom && imp.periodTo ? `${fmtDate(imp.periodFrom, L)} → ${fmtDate(imp.periodTo, L)}` : "—"}</span>
                  <span>{t("{n} lines", { n: data.total })}</span>
                </SummaryStrip>
                {data.rows.length === 0 ? <Empty icon={<Scale className="size-5" />} title={tab === "attention" ? t("Everything matched") : t("Nothing here")} hint={tab === "attention" ? t("Every line in the file is a capture or refund Mada has, for the same amount.") : undefined} /> : (
                  <Table>
                    <thead><tr><Th>{t("Invoice")}</Th><Th>{t("Kind")}</Th><Th>{t("Status")}</Th><Th>{t("Settled")}</Th><Th align="end">{t("MyFatoorah")}</Th><Th align="end">{t("Mada")}</Th><Th align="end">{t("Fee")}</Th></tr></thead>
                    <tbody>
                      {data.rows.map((r) => (
                        <tr key={r.id}>
                          <Td><span className="num block text-ink" dir="ltr">{r.providerRef ?? "—"}</span>{r.refundRef && <span className="num block text-[12px] text-ink-3" dir="ltr">{r.refundRef}</span>}</Td>
                          <Td>{r.kind === "refund" ? t("Refund") : t("Capture")}</Td>
                          <Td><StatusBadge map={RECON_STATUS} value={r.status} /></Td>
                          <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{r.settledOn ? fmtDate(r.settledOn, L) : "—"}</Td>
                          <Td align="end">{r.status === "missing_provider" ? "—" : <Money v={r.amount} />}</Td>
                          <Td align="end">{r.ours == null ? "—" : <Money v={r.ours} className={cx(r.status === "amount_mismatch" && "text-bad")} />}</Td>
                          <Td align="end">{r.fee ? <Money v={r.fee} /> : "—"}</Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                )}
                <Pager page={page} total={data.total} size={50} href={href} />
              </Card>
            </>
          ) : (
            <Card><Empty icon={<Scale className="size-5" />} title={t("No settlement imported yet")} hint={t("Download the settlement (deposit) report from the MyFatoorah portal as CSV and import it here.")} /></Card>
          )}
        </div>

        <aside className="space-y-4">
          <Card className={cx(!imp && "ring-2 ring-gold/40")}>
            <CardHead title={t("Import a settlement")} hint={t("CSV from the MyFatoorah portal")} />
            <ActionForm action={importSettlementAction} className="space-y-3">
              <input type="file" name="file" accept=".csv,text/csv" required className="block w-full text-[13px] text-ink-2 file:me-3 file:rounded-full file:border-0 file:bg-sunken file:px-4 file:py-2 file:text-[13px] file:text-ink" />
              <SubmitButton variant="gold" className="w-full"><Upload className="size-4" />{t("Import and match")}</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-[11.5px] text-ink-3">{t("Columns read by name: Invoice Id, Transaction Type, Invoice Value, Service Charge, Deposit Date, Refund Reference.")}</p>
          </Card>
          {!live && <Notice tone="info">{t("Payments are on the test provider. Matching works the same; the settlement file is the source until a MyFatoorah account is live.")}</Notice>}
          {imports.length > 0 && (
            <Card>
              <CardHead title={t("Imports")} />
              <ul className="space-y-2 text-[13px]">
                {imports.map((i) => (
                  <li key={i.id}><Link href={`/adminwork/desk/finance/reconciliation?import=${i.id}`} className={cx("flex items-center justify-between gap-2", i.id === imp?.id ? "text-ink" : "text-ink-3 hover:text-ink")}>
                    <span className="truncate">{i.fileName ?? t("Settlement")}</span><span className="num shrink-0 text-[12px]">{i.matched}/{i.rows} · {timeAgo(i.createdAt, L)}</span></Link></li>
                ))}
              </ul>
            </Card>
          )}
        </aside>
      </div>
    </>
  );
}
