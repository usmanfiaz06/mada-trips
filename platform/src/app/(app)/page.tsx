import Link from "next/link";
import { ArrowUpRight, Check, CircleAlert, Clock3, FileWarning, Ticket, Stamp, MoonStar, Plus, Wallet } from "lucide-react";
import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { dashboardData } from "@/lib/dashboard";
import { Card, CardHead, InkCard, Money, Badge, Avatar, LinkButton, Empty, cx } from "@/components/ui";
import { ArcGauge, CycleBarcode, DotColumns, SunGauge, SplitBar } from "@/components/charts";
import { addDays, daysBetween, fmtDate, timeAgo } from "@/lib/dates";
import { sar } from "@/lib/money";
import { APPROVAL_KIND } from "@/lib/labels";

export const metadata = { title: "Dashboard" };

function greeting(t: (s: string) => string) {
  const h = Number(new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Riyadh", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return h < 12 ? t("Good morning") : h < 17 ? t("Good afternoon") : t("Good evening");
}

/** A round number for "each dot is worth…" so the legend reads cleanly. */
function niceUnit(max: number, rows: number) {
  const raw = Math.max(max, 1) / rows;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].find((m) => m * mag >= raw)! * mag;
  return Math.max(step, 100);
}

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ denied?: string; cycle?: string }> }) {
  const u = await requireUser();
  const t = await getT();
  const { denied, cycle: view } = await searchParams;
  const d = await dashboardData(u, view === "prev" ? "prev" : "current");
  const L = t.locale;

  const sell = d.cycleBookings.reduce((s, b) => s + b.sell, 0);
  const margin = d.cycleBookings.reduce((s, b) => s + (b.sell - b.net), 0);
  const marginBps = sell ? Math.round((margin / sell) * 10000) : 0;
  const todaySell = d.todayRows.reduce((s, b) => s + b.sell, 0);
  const todayMargin = d.todayRows.reduce((s, b) => s + (b.sell - b.net), 0);
  const daysLeft = daysBetween(d.today, d.current.end);
  const currentDays = daysBetween(d.current.start, d.current.end) + 1;
  const currentIdx = daysBetween(d.current.start, d.today);
  const dotUnit = niceUnit(Math.max(...d.last14.map((x) => x.margin)), 10);
  const retailSell = d.cycleBookings.filter((b) => b.channel === "retail").reduce((s, b) => s + b.sell, 0);

  const barcodeItems = d.cycleBookings.map((b) => ({
    id: b.id, ref: b.ref, day: daysBetween(d.cycle.start, b.businessDate), sell: b.sell,
    margin: b.sell ? Math.round(((b.sell - b.net) / b.sell) * 10000) : 0, label: b.description ?? b.passengers,
  }));
  const dayLabels = [0, 5, 10, 15, 20, 25, d.days - 1].filter((x, i, a) => x < d.days && a.indexOf(x) === i)
    .map((i) => fmtDate(addDays(d.cycle.start, i), "en").split(" ").slice(0, 2).join(" "));

  const tasks: { href: string; icon: React.ReactNode; title: string; sub: string; tone: "gold" | "warn" | "bad" | "info" }[] = [
    ...d.waiting.map((a) => ({ href: `/approvals/${a.id}`, icon: <Stamp className="size-4" />, title: a.title, sub: `${t(APPROVAL_KIND[a.kind])} · SAR ${sar(a.amount)} · ${timeAgo(a.createdAt, L)}`, tone: "gold" as const })),
    ...d.issueQueue.map((b) => ({ href: `/issuance?focus=${b.id}`, icon: <Ticket className="size-4" />, title: `${t("Issue")} ${b.ref} · ${b.passengers}`, sub: `${b.description ?? ""} · SAR ${sar(b.sell)} · ${timeAgo(b.createdAt, L)}`, tone: "info" as const })),
    ...d.closesToVerify.map((c) => ({ href: `/close/${c.businessDate}?team=${c.team}`, icon: <MoonStar className="size-4" />, title: t("Verify {team} close · {date}", { team: t(c.team === "riyadh" ? "Riyadh" : "Pakistan"), date: fmtDate(c.businessDate, L) }), sub: c.lateSubmission ? t("Submitted late") : t("Submitted on time"), tone: c.lateSubmission ? "warn" as const : "gold" as const })),
    ...d.myOpenToday.map((o) => ({ href: `/sales/${o.id}`, icon: <FileWarning className="size-4" />, title: `${o.ref} · ${t(o.issue === "missing_pnr" ? "PNR missing" : o.issue === "pending_issue" ? "Waiting to issue" : "Payment not complete")}`, sub: t("Fix before the 10 PM close"), tone: "warn" as const })),
  ];

  const f = d.finance;
  const reserveNeed = f ? f.cash.upcomingBsp : 0;

  return (
    <div className="space-y-4">
      {denied && <div className="rounded-2xl bg-warn-soft px-4 py-3 text-[13.5px] text-warn">{t("You don't have access to that page. Ask an admin if you need it.")}</div>}

      <div className="flex flex-wrap items-end justify-between gap-4 pb-2 animate-rise">
        <div>
          <div className="text-[13px] text-ink-3">{fmtDate(new Date(), L)} · {t("Cycle")} {fmtDate(d.current.start, L)} → {fmtDate(d.current.end, L)}</div>
          <h1 className="mt-1 text-[38px] font-[350] leading-none tracking-[-0.04em]">{greeting(t)}, {u.name.split(" ")[0]}</h1>
        </div>
        <div className="flex gap-2">
          {can(u, "expenses.create") && <LinkButton href="/expenses/new" variant="outline"><Wallet className="size-4" />{t("Add expense")}</LinkButton>}
          {can(u, "sales.create") && <LinkButton href="/sales/new" variant="primary"><Plus className="size-4" />{t("New sale")}</LinkButton>}
        </div>
      </div>

      {/* Row 1 · the cycle */}
      <div className="grid gap-4 lg:grid-cols-12 stagger">
        <InkCard className="lg:col-span-8">
          <div className="night-grid pointer-events-none absolute inset-0 opacity-50" />
          <div className="relative">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="flex gap-1 rounded-full bg-white/[0.06] p-1 text-[12.5px]">
                  {([["current", t("This cycle")], ["prev", t("Last cycle")]] as const).map(([k, label]) => (
                    <Link key={k} href={k === "current" ? "/" : "/?cycle=prev"} scroll={false}
                      className={cx("rounded-full px-3 py-1 transition", d.view === k ? "bg-tile-ink text-tile" : "text-tile-ink-3 hover:text-tile-ink")}>{label}</Link>
                  ))}
                </div>
                <h2 className="mt-4 text-[20px] font-[420] tracking-[-0.02em]">{t("Every sale, one line")}</h2>
                <p className="mt-1 text-[12.5px] text-tile-ink-3">{fmtDate(d.cycle.start, L)} → {fmtDate(d.cycle.end, L)}</p>
              </div>
              <div className="flex gap-8">
                {[
                  [t("Sold"), <Money key="s" v={sell} compact muted />],
                  [t("Margin"), <Money key="m" v={margin} compact muted />],
                  [t("Avg margin"), <span key="p" className="num" dir="ltr">{(marginBps / 100).toFixed(1)}%</span>],
                ].map(([k, v], i) => (
                  <div key={i}>
                    <div className="text-[12px] text-tile-ink-3">{k}</div>
                    <div className="figure mt-1.5 text-[30px]">{v}</div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-8">
              <CycleBarcode items={barcodeItems} days={d.days} today={d.todayIdx} target={d.s.targetMarginBps} dayLabels={dayLabels}
                emptyText={t("No sales yet this cycle")} legend={{ loss: t("Loss"), thin: t("Below target margin"), healthy: t("On or above target") }} />
            </div>
          </div>
        </InkCard>

        <InkCard grain className="flex flex-col lg:col-span-4">
          <div className="absolute inset-0 bg-[radial-gradient(70%_60%_at_50%_110%,rgba(240,195,107,.28),transparent_70%)]" />
          <div className="relative flex items-start justify-between">
            <div>
              <div className="text-[13px] text-tile-ink-3">{t("Day-25 settlement")}</div>
              <div className="mt-1 text-[20px] font-[420] tracking-[-0.02em]">{fmtDate(d.current.end, L)}</div>
            </div>
            {can(u, "finance.view") && <Link href="/settlement" className="grid size-9 place-items-center rounded-full bg-white/10 transition hover:bg-white/20" aria-label={t("Open settlement")}><ArrowUpRight className="size-4 rtl:-scale-x-100" /></Link>}
          </div>
          <div className="relative mt-auto pt-6">
            <ArcGauge value={currentIdx + 1} max={currentDays} ink>
              <div className="figure text-[76px]">{daysLeft}</div>
              <div className="mt-1 text-[12.5px] text-tile-ink-3">{daysLeft === 1 ? t("day to cut-off") : t("days to cut-off")}</div>
            </ArcGauge>
          </div>
          <div className="relative mt-5 flex justify-between border-t border-tile-line pt-4 text-[12px] text-tile-ink-3 num" dir="ltr">
            <span>{fmtDate(d.current.start, "en")}</span><span>{t("Day {n} of {total}", { n: currentIdx + 1, total: currentDays })}</span><span>{fmtDate(d.current.end, "en")}</span>
          </div>
        </InkCard>
      </div>

      {/* Row 2 · money (partners & finance) */}
      {f && (
        <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12 stagger">
          <Card className="flex flex-col lg:col-span-4">
            <CardHead title={t("Cash in banks")} hint={t("Cleared funds, both accounts")} action={<Link href="/finance" className="text-[12.5px] text-ink-3 hover:text-ink">{t("Details")}</Link>} />
            <div className="figure text-[48px]"><Money v={f.cash.total} compact muted /><span className="figure-unit">SAR</span></div>
            <div className="mt-auto space-y-3 pt-6">
              {f.cash.accounts.map((a) => (
                <div key={a.key} className="flex items-center justify-between gap-3 border-t border-line pt-3 text-[13px]">
                  <span className="flex items-center gap-2 text-ink-2"><i className={cx("size-2 rounded-full", a.key === "retail" ? "bg-[var(--chart-1)]" : "bg-[var(--chart-2)]")} />{t(a.key === "retail" ? "Retail / B2C" : "Corporate / B2B")}</span>
                  <span className="num text-ink" dir="ltr">{sar(a.balance)}</span>
                </div>
              ))}
              <p className="text-[12px] text-ink-3">{t("Cash is not profit: most of it is owed to IATA and airlines.")}</p>
            </div>
          </Card>

          <Card className="flex flex-col lg:col-span-4">
            <CardHead title={t("IATA reserve")} hint={t("Reserve held vs upcoming BSP debits")} action={<Link href="/finance#bsp" className="text-[12.5px] text-ink-3 hover:text-ink">{t("BSP")}</Link>} />
            <SunGauge value={d.s.iataReserveHeld} max={Math.max(1, reserveNeed)}>
              <div className="figure text-[40px]">{reserveNeed ? Math.round((d.s.iataReserveHeld / reserveNeed) * 100) : 100}<span className="figure-unit">%</span></div>
              <div className="text-[12px] text-ink-3">{t("covered")}</div>
            </SunGauge>
            <div className="mt-4 grid grid-cols-2 gap-3 border-t border-line pt-4 text-[13px]">
              <div><div className="text-[12px] text-ink-3">{t("Upcoming BSP")}</div><div className="num mt-0.5" dir="ltr">{sar(reserveNeed)}</div></div>
              <div><div className="text-[12px] text-ink-3">{t("Next debit")}</div><div className="mt-0.5">{f.nextBsp ? fmtDate(f.nextBsp.dueDate, L) : "—"}</div></div>
            </div>
          </Card>

          <Card className="flex flex-col md:col-span-2 lg:col-span-4">
            <CardHead title={t("Net profit so far")} hint={t("Settled bookings − supplier cost − overheads")} action={<Link href="/settlement" className="text-[12.5px] text-ink-3 hover:text-ink">{t("Waterfall")}</Link>} />
            <div className={cx("figure text-[48px]", f.est.netProfit < 0 && "text-bad")}><Money v={f.est.netProfit} compact muted /><span className="figure-unit">SAR</span></div>
            <div className="mt-auto space-y-2.5 pt-6 text-[13px]">
              {([[t("Gross operating profit"), f.est.grossProfit], [t("Fixed overheads"), -f.est.overheads]] as const).map(([k, v]) => (
                <div key={k} className="flex justify-between border-t border-line pt-2.5"><span className="text-ink-3">{k}</span><span className="num" dir="ltr">{sar(v, { sign: true })}</span></div>
              ))}
              <div className="flex justify-between border-t border-line pt-2.5"><span className="text-ink-3">{t("Your share at {pct}", { pct: "33.33%" })}</span>
                <span className="num text-ink" dir="ltr">{sar(Math.max(0, f.est.dividends.find((x) => x.partnerId === u.partnerId)?.amount ?? 0))}</span></div>
            </div>
          </Card>
        </div>
      )}

      {/* Row 3 · work */}
      <div className="grid gap-4 lg:grid-cols-12 stagger">
        <Card className="lg:col-span-5" pad={false}>
          <div className="flex items-center justify-between p-6 pb-3">
            <div>
              <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{t("Waiting for you")}</h2>
              <p className="mt-0.5 text-[13px] text-ink-3">{tasks.length ? t("{n} things need your attention", { n: tasks.length }) : t("You're all caught up")}</p>
            </div>
            <span className="figure text-[34px] text-ink">{tasks.length}</span>
          </div>
          {tasks.length === 0 ? (
            <Empty icon={<Check className="size-5" />} title={t("Nothing waiting")} hint={t("New approvals, issues and closes will appear here the moment they arrive.")} />
          ) : (
            <ul className="px-3 pb-3">
              {tasks.slice(0, 7).map((x, i) => (
                <li key={i}>
                  <Link href={x.href} className="group flex items-center gap-3 rounded-2xl px-3 py-3 transition hover:bg-surface-2">
                    <span className={cx("grid size-9 shrink-0 place-items-center rounded-full", { gold: "bg-gold-soft text-gold-2", warn: "bg-warn-soft text-warn", bad: "bg-bad-soft text-bad", info: "bg-info-soft text-info" }[x.tone])}>{x.icon}</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[14px] text-ink">{x.title}</span>
                      <span className="block truncate text-[12.5px] text-ink-3">{x.sub}</span>
                    </span>
                    <ArrowUpRight className="size-4 text-ink-4 transition group-hover:text-ink rtl:-scale-x-100" />
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="flex flex-col lg:col-span-4">
          <CardHead title={t("Margin, last 14 days")} hint={t("Each dot ≈ SAR {v} of margin", { v: (dotUnit / 100).toLocaleString("en-US") })} />
          <div className="mt-auto">
            <DotColumns rows={10} unit={dotUnit * 10} data={d.last14.map((x) => ({ label: fmtDate(x.d, "en").split(" ").slice(0, 2).join(" "), value: x.margin, display: `${sar(x.margin)} · ${x.sales} ${t("sales")}` }))} />
          </div>
          <div className="mt-5 grid grid-cols-2 gap-3 border-t border-line pt-4">
            <div><div className="text-[12px] text-ink-3">{t("Today")}</div><div className="num mt-0.5 text-[15px]" dir="ltr">{d.todayRows.length} · {sar(todaySell, { compact: true })}</div></div>
            <div><div className="text-[12px] text-ink-3">{t("Today's margin")}</div><div className="num mt-0.5 text-[15px]" dir="ltr">{sar(todayMargin)}</div></div>
          </div>
        </Card>

        <Card className="flex flex-col lg:col-span-3">
          <CardHead title={t("By channel")} hint={d.view === "prev" ? t("Sold last cycle") : t("Sold this cycle")} />
          <SplitBar parts={[
            { label: t("Retail"), value: retailSell, color: "var(--chart-1)", display: sar(retailSell, { compact: true }) },
            { label: t("Corporate"), value: sell - retailSell, color: "var(--chart-2)", display: sar(sell - retailSell, { compact: true }) },
          ]} />
          {f && f.rec.length > 0 && (
            <div className="mt-auto pt-6">
              <div className="mb-2 flex items-center justify-between text-[12px] text-ink-3"><span>{t("Owed by clients")}</span>
                {f.rec.some((r) => r.overdue > 0) && <Badge tone="bad" dot>{t("Overdue")}</Badge>}</div>
              <ul className="space-y-2">
                {f.rec.slice(0, 3).map((r) => (
                  <li key={r.client_id} className="flex items-center justify-between gap-2 text-[13px]">
                    <Link href={`/clients/${r.client_id}`} className="truncate text-ink-2 hover:text-ink">{r.name}</Link>
                    <span className={cx("num shrink-0", r.overdue > 0 ? "text-bad" : "text-ink")} dir="ltr">{sar(r.owed, { compact: true })}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      </div>

      {/* Row 4 · activity */}
      <Card pad={false}>
        <div className="flex items-center justify-between p-6 pb-2">
          <div>
            <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{can(u, "activity.view") ? t("Team activity") : t("Your recent activity")}</h2>
            <p className="mt-0.5 text-[13px] text-ink-3">{t("Every change is logged with who did it and when")}</p>
          </div>
          {can(u, "activity.view") && <LinkButton href="/activity" variant="outline" size="sm">{t("Full log")}</LinkButton>}
        </div>
        <ul className="grid gap-x-8 px-6 pb-4 md:grid-cols-2">
          {d.activity.map(({ e, name }) => (
            <li key={e.id} className="flex items-start gap-3 border-t border-line py-3 first:border-0 md:[&:nth-child(2)]:border-0">
              <Avatar name={name ?? "System"} size={28} />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[13.5px] text-ink"><span className="font-medium">{name ?? t("System")}</span> <span className="text-ink-2">{e.summary}</span></div>
                <div className="mt-0.5 flex items-center gap-1.5 text-[12px] text-ink-3"><Clock3 className="size-3" />{timeAgo(e.at, L)}</div>
              </div>
            </li>
          ))}
          {d.activity.length === 0 && <li className="py-6 text-[13px] text-ink-3"><CircleAlert className="me-1 inline size-4" />{t("No activity yet")}</li>}
        </ul>
      </Card>
    </div>
  );
}
