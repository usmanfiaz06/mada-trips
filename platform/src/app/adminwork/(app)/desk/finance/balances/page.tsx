import { ArrowUpRight, Gauge, RefreshCw } from "lucide-react";
import { getT } from "@/lib/i18n";
import { timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { requireDeskFinance } from "@/lib/app/finance/access";
import { supplierBalances, type SupplierBalance } from "@/lib/app/finance/balances";
import { Badge, Card, Empty, Money, PageHeader, Table, Td, Th, type Tone } from "@/components/ui";
import { ActionForm, SubmitButton } from "@/components/client";
import { SummaryStrip } from "@/components/desk/list";
import { readBalancesAction } from "../../finance-actions";

export const metadata = { title: "Supplier balances · Desk" };

/*
 * Supplier balances (DESK-PLAN U6, screen 10): one row per supplier the app buys from: the prepaid balance or the
 * credit line left, the alert level, a day's spend from the last week, and the days that leaves.
 */

const STATE: Record<SupplierBalance["state"], { label: string; tone: Tone }> = {
  ok: { label: "Fine", tone: "ok" }, low: { label: "Low", tone: "bad" }, not_connected: { label: "Not connected", tone: "neutral" }, not_set: { label: "Credit line not set", tone: "warn" }, not_used: { label: "Not in use", tone: "neutral" },
};

export default async function BalancesPage() {
  await requireDeskFinance();
  const t = await getT();
  const L = t.locale;
  const rows = await supplierBalances();
  const low = rows.filter((r) => r.state === "low").length;
  return (
    <>
      <PageHeader eyebrow={t("App finance")} title={t("Supplier balances")}
        subtitle={t("What is left with each supplier, how fast the app spends it, and how many days that is. Credit lines are set in Rules & limits.")}
        actions={<ActionForm action={readBalancesAction}><SubmitButton variant="outline" size="sm"><RefreshCw className="size-4" />{t("Read balances now")}</SubmitButton></ActionForm>} />
      <Card pad={false}>
        <SummaryStrip>
          <span>{t("{n} suppliers", { n: rows.length })}</span>
          {low > 0 ? <span className="text-bad">{t("{n} low", { n: low })}</span> : <span>{t("None low")}</span>}
        </SummaryStrip>
        {rows.length === 0 ? <Empty icon={<Gauge className="size-5" />} title={t("No suppliers")} /> : (
          <Table>
            <thead><tr><Th>{t("Supplier")}</Th><Th>{t("Status")}</Th><Th align="end">{t("Balance or credit left")}</Th><Th align="end">{t("Alert below")}</Th><Th align="end">{t("Spend a day")}</Th><Th align="end">{t("Days left")}</Th><Th>{t("Last read")}</Th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.key} className="align-top">
                  <Td>
                    <span className="block text-ink">{r.name}</span>
                    <span className="block max-w-[280px] text-[12px] text-ink-3">{t(r.kind === "prepaid" ? "Prepaid" : "On credit")} · {t(r.note)}</span>
                    {r.console && <a href={r.console} target="_blank" rel="noreferrer" className="mt-1 inline-flex items-center gap-1 text-[12px] text-ink-3 hover:text-ink">{t("Supplier console")}<ArrowUpRight className="size-3 rtl:-scale-x-100" /></a>}
                  </Td>
                  <Td><Badge tone={STATE[r.state].tone} dot>{t(STATE[r.state].label)}</Badge>{r.error && <span className="mt-1 block max-w-[200px] text-[11.5px] text-bad">{r.error}</span>}</Td>
                  <Td align="end">
                    {r.balance === null ? "—" : <Money v={r.balance} className={r.balance < 0 ? "text-bad" : undefined} />}
                    {r.balanceUsd != null && <span className="num block text-[11.5px] text-ink-3" dir="ltr">${r.balanceUsd.toFixed(2)}</span>}
                    {r.line != null && <span className="block text-[11.5px] text-ink-3">{t("of {line}, {used} used", { line: sar(r.line), used: sar(r.used ?? 0) })}</span>}
                    {r.line == null && !!r.used && <span className="block text-[11.5px] text-ink-3">{t("{used} owed to them", { used: `SAR ${sar(r.used)}` })}</span>}
                  </Td>
                  <Td align="end">{r.threshold ? <Money v={r.threshold} /> : "—"}</Td>
                  <Td align="end">{r.burnPerDay ? <Money v={r.burnPerDay} /> : "—"}</Td>
                  <Td align="end"><span className="num">{r.daysLeft ?? "—"}</span></Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{r.lastRead ? timeAgo(r.lastRead, L) : "—"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
      </Card>
    </>
  );
}

