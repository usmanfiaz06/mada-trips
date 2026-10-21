import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowUpRight, Gauge, Smile, TrendingDown, Users } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { fmtDate } from "@/lib/dates";
import { sar } from "@/lib/money";
import { TICKET_PRIORITY } from "@/lib/labels";
import { canDeskFinance } from "@/lib/app/finance/access";
import { deskOverview, FUNNEL_STEPS, overviewHref as H } from "@/lib/app/desk/overview";
import { TICKET_PRIORITIES } from "@/lib/app/desk/sla";
import { TICKET_AGES } from "@/lib/app/desk/tickets";
import { ArcGauge, DotColumns } from "@/components/charts";
import { Badge, Card, CardHead, Empty, InkCard, Meter, Money, PageHeader, Stat, cx, type Tone } from "@/components/ui";
import { AutoRefresh } from "@/components/desk/live";

export const metadata = { title: "Overview · Desk" };

/*
 * The desk overview for leads (DESK-PLAN.md U8), on the Ops dashboard pattern: an ink hero with the day's oversized
 * figures and the funnel, the SLA gauge, Stat tiles, then the backlog grid, money, balances and who's on. Every figure
 * is a link to the list it counts (lib/app/desk/overview.ts).
 */

const AGE_LABEL: Record<string, string> = { "1h": "Under 1h", "4h": "1–4h", "24h": "4–24h", older: "Over a day" };
const STEP_LABEL: Record<string, string> = { searches: "Searches", sheets: "Pay sheets opened", paid: "Paid", confirmed: "Confirmed" };
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function DeskOverviewPage() {
  const u = await requirePerm("desk.view");
  if (!can(u, "desk.tickets.manage") && !can(u, "desk.reports")) redirect("/adminwork/desk");
  const t = await getT();
  const L = t.locale;
  const finance = canDeskFinance(u);
  const o = await deskOverview({ finance });
  const sla = o.sla.today;
  const slaTone: Tone = sla.slaHit == null ? "neutral" : sla.slaHit >= o.sla.target ? "ok" : sla.slaHit >= o.sla.target - 0.1 ? "warn" : "bad";
  const f = o.funnel;
  const top = Math.max(1, ...FUNNEL_STEPS.map((s) => f[s].n));
  // Step to step; not every payment starts from a logged pay sheet (a quote, a friend's share), so above 100% isn't shown.
  const conv = (a: number, b: number) => (a > 0 && b <= a ? `${Math.round((b / a) * 100)}%` : "—");
  const dayLabel = (d: Date) => new Intl.DateTimeFormat(L === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { weekday: "short", timeZone: "Asia/Riyadh" }).format(d);

  return (
    <div className="space-y-4">
      <AutoRefresh every={60} />
      <PageHeader eyebrow={t("Support")} title={t("Desk overview")}
        subtitle={t("Today on the desk for leads: what is waiting and how old it is, whether promises are kept, the booking funnel, money and who's on. Every number opens the list behind it.")} />

      {/* Row 1 · today */}
      <div className="grid gap-4 lg:grid-cols-12 stagger" data-testid="overview-hero">
        <InkCard className="lg:col-span-8">
          <div className="night-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="text-[13px] text-tile-ink-3">{fmtDate(o.today, L)}</div>
                <h2 className="mt-1 text-[20px] font-[420] tracking-[-0.02em]">{t("Today on the desk")}</h2>
              </div>
              <div className="flex flex-wrap gap-8">
                <HeroFigure label={t("Waiting")} href={H.backlog()} value={<span className="num" data-n="backlog">{o.backlog.total}</span>} />
                <HeroFigure label={t("Paid today")} href={H.funnel("paid")} value={<span className="num" data-n="paid">{f.paid.n}</span>} />
                {o.revenue && <HeroFigure label={t("App sales today")} href={H.revenue(o.today, o.today)} value={<Money v={o.revenue.today.gross} compact muted />} />}
              </div>
            </div>
            <div className="mt-8" data-testid="overview-funnel">
              <div className="mb-3 text-[12.5px] text-tile-ink-3">{t("The funnel today")}</div>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {FUNNEL_STEPS.map((s, i) => (
                  <Link key={s} href={H.funnel(s)} className="group rounded-2xl bg-white/[0.04] p-3 ring-1 ring-tile-line transition hover:bg-white/[0.08]">
                    <div className="flex items-center justify-between text-[12px] text-tile-ink-3">
                      <span>{t(STEP_LABEL[s]!)}</span>
                      {i > 0 && <span className="num" dir="ltr">{conv(f[FUNNEL_STEPS[i - 1]!].n, f[s].n)}</span>}
                    </div>
                    <div className="figure mt-2 text-[34px] text-tile-ink"><span className="num" data-n={`funnel-${s}`}>{f[s].n}</span></div>
                    <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-tile-line">
                      <div className="h-full rounded-full bg-glow-gold" style={{ width: `${(f[s].n / top) * 100}%`, minWidth: f[s].n ? 4 : 0 }} />
                    </div>
                  </Link>
                ))}
              </div>
            </div>
            <div className="mt-6">
              <div className="mb-2 text-[12.5px] text-tile-ink-3">{t("Tickets resolved, last 7 days")}</div>
              <DotColumns ink rows={8} unit={4} color="var(--glow-green)" data={o.byDay.map((d) => ({ label: dayLabel(d.start), value: d.m.handled, display: String(d.m.handled) }))} />
            </div>
          </div>
        </InkCard>

        <InkCard grain className="flex flex-col lg:col-span-4">
          <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_110%,rgba(240,195,107,.28),transparent_70%)]" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[13px] text-tile-ink-3">{t("Promises kept today")}</div>
              <div className="mt-1 text-[20px] font-[420] tracking-[-0.02em]">{t("Target {p}", { p: pct(o.sla.target) })}</div>
            </div>
            <Link href={H.slaToday()} className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" aria-label={t("Open performance")}><ArrowUpRight className="size-4 rtl:-scale-x-100" /></Link>
          </div>
          <Link href={H.slaToday()} className="relative mt-auto block pt-6">
            <ArcGauge value={Math.round((sla.slaHit ?? 0) * 100)} max={100} highlightFrom={0} tone={slaTone === "ok" ? "green" : "gold"} ink>
              <div className="figure text-[68px]" dir="ltr"><span data-n="sla">{pct(sla.slaHit)}</span></div>
              <div className="mt-1 text-[12.5px] text-tile-ink-3">{t("{n} resolved today", { n: sla.slaN })}</div>
            </ArcGauge>
          </Link>
          <div className="relative mt-5 flex justify-between border-t border-tile-line pt-4 text-[12px] text-tile-ink-3">
            <span>{t("First reply")} <span className="num text-tile-ink" dir="ltr">{sla.firstResponse.median == null ? "—" : `${Math.round(sla.firstResponse.median)}m`}</span></span>
            <span>{t("Opened today")} <span className="num text-tile-ink">{sla.volume}</span></span>
          </div>
        </InkCard>
      </div>

      {/* Row 2 · tiles */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4 stagger" data-testid="overview-stats">
        <Stat label={t("Urgent waiting")} href={H.priority("urgent")} tone={o.backlog.byPriority.urgent ? "bad" : undefined} icon={<Gauge className="size-4" />}
          value={<span className="num" data-n="urgent">{o.backlog.byPriority.urgent}</span>} sub={t("of {n} waiting", { n: o.backlog.total })} />
        <Stat label={t("Dropped off today")} href={H.dropoffs(o.today)} icon={<TrendingDown className="size-4" />}
          value={<span className="num" data-n="dropoffs">{o.dropoffs.n}</span>} sub={<>{t("Worth")} <span className="num" dir="ltr">SAR {sar(o.dropoffs.value)}</span></>} />
        <Stat label={t("CSAT, last 7 days")} href={H.csat()} icon={<Smile className="size-4" />}
          value={<span className="num" data-n="csat" dir="ltr">{o.csat.csat == null ? "—" : o.csat.csat.toFixed(1)}</span>} sub={t("{n} ratings", { n: o.csat.csatN })} />
        <Stat label={t("On duty now")} href={H.rota()} tone={o.duty.onDuty === 0 ? "bad" : "ok"} icon={<Users className="size-4" />}
          value={<span className="num" data-n="onduty" dir="ltr">{o.duty.onDuty}<span className="text-ink-4"> / {o.duty.rostered}</span></span>} sub={t("on shift and switched on, of those on the rota now")} />
      </div>

      {/* Row 3 · backlog, money */}
      <div className="grid gap-4 lg:grid-cols-12 stagger">
        <Card className="lg:col-span-7" data-testid="overview-backlog">
          <CardHead title={t("Backlog by priority and age")} hint={t("Running tickets: new or open. A ticket waiting on the customer or a supplier has its clock stopped.")}
            action={<Link href={H.backlog()} className="text-[12.5px] text-ink-3 hover:text-ink">{t("Tickets")}</Link>} />
          {o.backlog.total === 0 ? <Empty title={t("Nothing waiting")} hint={t("Every ticket is answered or waiting on someone else.")} /> : (
            <div className="-mx-2 overflow-x-auto">
              <table className="w-full min-w-[460px] text-[13.5px]">
                <thead>
                  <tr className="text-[12px] text-ink-3">
                    <th className="px-2 py-2 text-start font-normal">{t("Priority")}</th>
                    {TICKET_AGES.map((a) => <th key={a} className="px-2 py-2 text-end font-normal"><Link href={H.age(a)} className="hover:text-ink">{t(AGE_LABEL[a]!)}</Link></th>)}
                    <th className="px-2 py-2 text-end font-normal">{t("All")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {TICKET_PRIORITIES.map((p) => (
                    <tr key={p}>
                      <td className="px-2 py-3"><Badge tone={TICKET_PRIORITY[p]?.tone ?? "neutral"} dot>{t(TICKET_PRIORITY[p]?.label ?? p)}</Badge></td>
                      {TICKET_AGES.map((a) => {
                        const n = o.backlog.cells[p][a];
                        return (
                          <td key={a} className="px-2 py-3 text-end">
                            {n ? <Link href={H.cell(p, a)} data-n={`cell-${p}-${a}`} className={cx("num inline-block min-w-8 rounded-full px-2 py-0.5 transition hover:bg-gold-soft",
                              a === "older" || p === "urgent" ? "text-bad" : "text-ink")}>{n}</Link> : <span className="num text-ink-4">0</span>}
                          </td>
                        );
                      })}
                      <td className="px-2 py-3 text-end"><Link href={H.priority(p)} data-n={`priority-${p}`} className="num font-medium text-ink hover:underline hover:decoration-gold hover:decoration-2 hover:underline-offset-4">{o.backlog.byPriority[p]}</Link></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card className="flex flex-col lg:col-span-5" data-testid="overview-money">
          <CardHead title={t("App revenue and margin")} hint={t("Gross with VAT, and margin after VAT and supplier cost")} />
          {!o.revenue ? <Empty title={t("App finance is for finance")} hint={t("Ask a partner for desk finance access to see revenue here.")} /> : (
            <div className="grid grid-cols-2 gap-4">
              {([["today", t("Today"), o.today], ["mtd", t("Month to date"), o.revenue.from]] as const).map(([k, label, from]) => {
                const m = o.revenue![k];
                return (
                  <Link key={k} href={H.revenue(from, o.today)} className="group rounded-2xl bg-surface-2 p-4 transition hover:bg-gold-soft/50">
                    <div className="text-[12.5px] text-ink-3">{label}</div>
                    <div className="figure mt-3 text-[34px]"><span data-n={`rev-${k}`}><Money v={m.gross} compact muted /></span></div>
                    <div className="mt-2 text-[12.5px] text-ink-3">{t("Margin")} <span className="num text-ink" dir="ltr">SAR {sar(m.margin)}</span>
                      <span className="num ms-1" dir="ltr">({m.net > 0 ? ((m.margin / m.net) * 100).toFixed(1) : "0.0"}%)</span></div>
                  </Link>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* Row 4 · balances, who's on */}
      <div className="grid gap-4 lg:grid-cols-12 stagger">
        {o.balances && (
          <Card className="lg:col-span-7" data-testid="overview-balances">
            <CardHead title={t("Supplier balances")} hint={t("Days left at this week's spend")} action={<Link href={H.balances()} className="text-[12.5px] text-ink-3 hover:text-ink">{t("Details")}</Link>} />
            <ul className="space-y-4">
              {o.balances.map((b) => (
                <li key={b.key}>
                  <Link href={H.balances()} className="block">
                    <div className="flex items-baseline justify-between gap-3 text-[13.5px]">
                      <span className="text-ink">{b.name}</span>
                      <span className={cx("num", b.state === "low" ? "text-bad" : "text-ink-2")} data-n={`days-${b.key}`}>
                        {b.daysLeft != null ? t("{n} days left", { n: b.daysLeft }) : b.state === "not_set" ? t("Credit line not set") : b.state === "not_connected" ? t("Not connected") : b.state === "not_used" ? t("Not in use") : "—"}
                      </span>
                    </div>
                    <div className="mt-2"><Meter value={Math.min(b.daysLeft ?? 0, 30)} max={30} tone={b.state === "low" ? "bad" : (b.daysLeft ?? 99) < 7 ? "warn" : "ok"} /></div>
                    <div className="mt-1 text-[12px] text-ink-3">{b.balance != null ? <>{t("Left")} <span className="num" dir="ltr">SAR {sar(b.balance)}</span>{b.balanceUsd != null && <span className="num" dir="ltr"> · ${b.balanceUsd.toFixed(2)}</span>}</> : t(b.note)}</div>
                  </Link>
                </li>
              ))}
            </ul>
          </Card>
        )}
        <Card className={o.balances ? "lg:col-span-5" : "lg:col-span-12"} data-testid="overview-duty">
          <CardHead title={t("Who's on now")} hint={t("{on} on duty of {rostered} on the rota", { on: o.duty.onDuty, rostered: o.duty.rostered })} action={<Link href={H.rota()} className="text-[12.5px] text-ink-3 hover:text-ink">{t("Rota & time")}</Link>} />
          {o.duty.people.length === 0 ? <Empty title={t("Nobody is on the rota now")} hint={t("Urgent work with nobody on duty pages the on-call lead.")} /> : (
            <ul className="divide-y divide-line">
              {o.duty.people.map((p) => (
                <li key={p.id} className="flex items-center justify-between gap-3 py-2.5 text-[13.5px]">
                  <bdi className="text-ink">{p.name}</bdi>
                  <span className="flex gap-1.5">
                    {p.onShift ? <Badge tone="info">{t("On shift")}</Badge> : <Badge>{t("Off the rota")}</Badge>}
                    <Badge tone={p.status === "online" ? "ok" : p.status === "away" ? "warn" : "neutral"} dot>{t(p.status === "online" ? "Online" : p.status === "away" ? "Away" : "Off")}</Badge>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function HeroFigure({ label, value, href }: { label: string; value: React.ReactNode; href: string }) {
  return (
    <Link href={href} className="group block">
      <div className="text-[12px] text-tile-ink-3 group-hover:text-tile-ink">{label}</div>
      <div className="figure mt-1.5 text-[38px]">{value}</div>
    </Link>
  );
}
