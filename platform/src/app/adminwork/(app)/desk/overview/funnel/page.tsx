import Link from "next/link";
import { redirect } from "next/navigation";
import { Filter } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate, riyadhDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { funnelCounts, funnelRows, FUNNEL_STEPS, type FunnelStep } from "@/lib/app/desk/overview";
import { customerHref } from "@/lib/app/desk/board";
import { travellerName } from "@/lib/app/desk/core";
import { Card, Empty, LinkButton, PageHeader, Table, Tabs, Td, Th } from "@/components/ui";
import { Pager, SummaryStrip, listHref, pageParam } from "@/components/desk/list";

export const metadata = { title: "Funnel · Desk" };

/* The rows behind each step of the overview's funnel on one Riyadh day (lib/app/desk/overview.ts FUNNEL). */

const STEP_LABEL: Record<FunnelStep, string> = { searches: "Searches", sheets: "Pay sheets opened", paid: "Paid", confirmed: "Confirmed" };
const STEP_HINT: Record<FunnelStep, string> = {
  searches: "Every flight or stay search a signed-in traveller ran.",
  sheets: "Every pay sheet opened: the price and the pay button, before paying.",
  paid: "Payments that went through: held on the card or taken.",
  confirmed: "Bookings confirmed: the ticket issued, the stay booked or the eSIM ready.",
};

export default async function FunnelPage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  if (!can(u, "desk.tickets.manage") && !can(u, "desk.reports")) redirect("/adminwork/desk");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const step: FunnelStep = (FUNNEL_STEPS as readonly string[]).includes(sp.step ?? "") ? (sp.step as FunnelStep) : "searches";
  const day = sp.day && /^\d{4}-\d{2}-\d{2}$/.test(sp.day) ? sp.day : riyadhDate();
  const { page, offset, size } = pageParam(sp);
  const [counts, data] = await Promise.all([funnelCounts(day), funnelRows(step, day, { limit: size, offset })]);
  const href = listHref("/adminwork/desk/overview/funnel", { step, day: sp.day, page: sp.page });
  const value = counts[step].value;
  return (
    <>
      <PageHeader eyebrow={t("Desk overview")} title={t("The funnel")} subtitle={t(STEP_HINT[step])}
        actions={<LinkButton href="/adminwork/desk/overview" variant="outline">{t("Overview")}</LinkButton>} />
      <Tabs active={step} items={FUNNEL_STEPS.map((s) => ({ key: s, label: t(STEP_LABEL[s]), href: href({ step: s, page: undefined }), count: counts[s].n }))} />
      <Card pad={false}>
        <SummaryStrip>
          <span>{fmtDate(day, L)}</span>
          <span data-testid="funnel-total">{t("{n} rows", { n: data.total })}</span>
          {value > 0 && <span>{t("Value")} <span className="num text-ink" dir="ltr">{sar(value)}</span></span>}
        </SummaryStrip>
        {data.rows.length === 0 ? <Empty icon={<Filter className="size-5" />} title={t("Nothing yet today")} hint={t(STEP_HINT[step])} /> : (
          <Table>
            <thead><tr><Th>{t("Traveller")}</Th><Th>{t("What")}</Th><Th>{t("When")}</Th><Th align="end">{t("Value")}</Th></tr></thead>
            <tbody>
              {data.rows.map((r) => (
                <tr key={`${r.id}`} className="group transition hover:bg-surface-2">
                  <Td className="whitespace-nowrap"><Link href={customerHref(r.userId)} className="block">
                    <bdi className="block text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{travellerName(r.userName)}</bdi>
                    {r.phone && <span className="num block text-[12px] text-ink-3" dir="ltr">{r.phone}</span>}</Link></Td>
                  <Td><span className="block max-w-[360px] truncate text-ink">{r.what}</span></Td>
                  <Td className="whitespace-nowrap text-[12.5px] text-ink-3">{timeAgo(r.at, L)}</Td>
                  <Td align="end"><span className="num" dir="ltr">{r.value ? sar(r.value) : "—"}</span></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        )}
        <Pager page={page} total={data.total} size={size} href={href} />
      </Card>
    </>
  );
}
