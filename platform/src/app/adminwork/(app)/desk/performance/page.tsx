import type { ReactNode } from "react";
import Link from "next/link";
import { Activity } from "lucide-react";
import { can, requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { riyadhMidnight } from "@/lib/app/desk/agent-admin";
import { agentForOps } from "@/lib/app/desk/agents";
import { performanceReport, type Metrics } from "@/lib/app/desk/performance";
import { riyadhDay } from "@/lib/app/desk/timelog";
import { Card, CardHead, Empty, PageHeader, Stat, Table, Tabs, Td, Th, cx } from "@/components/ui";

export const metadata = { title: "Performance · Desk" };
const DAY = 86400_000;
const RANGES = { today: 1, "7d": 7, "30d": 30, "90d": 90 } as const;
type Range = keyof typeof RANGES;
/** Minutes as "4m", "1h 20m", "2d 3h". */
const dur = (m: number | null) => (m == null ? "—" : m < 60 ? `${Math.round(m)}m` : m < 1440 ? `${Math.floor(m / 60)}h${Math.round(m % 60) ? ` ${Math.round(m % 60)}m` : ""}` : `${Math.floor(m / 1440)}d${Math.round((m % 1440) / 60) ? ` ${Math.round((m % 1440) / 60)}h` : ""}`);
const pct = (x: number | null) => (x == null ? "—" : `${Math.round(x * 100)}%`);

export default async function PerformancePage({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const L = t.locale;
  const sp = await searchParams;
  const reports = can(u, "desk.reports");
  const me = await agentForOps(u.id);
  const now = new Date();
  const range: Range = sp.r && sp.r in RANGES ? (sp.r as Range) : "7d";
  const by = sp.by === "week" ? "week" : "day";
  const to = new Date(riyadhMidnight(now).getTime() + DAY);
  const from = new Date(to.getTime() - RANGES[range] * DAY);
  // Without desk.reports you see your own numbers only (DESK-PLAN.md §4.3).
  const only = reports ? (sp.agent && /^[0-9a-f-]{36}$/i.test(sp.agent) ? sp.agent : null) : me?.id ?? null;
  const qs = (o: Record<string, string | undefined>) => {
    const p = new URLSearchParams(Object.entries({ r: sp.r, by: sp.by, agent: sp.agent, ...o }).filter(([, v]) => v) as [string, string][]).toString();
    return p ? `/adminwork/desk/performance?${p}` : "/adminwork/desk/performance";
  };
  if (!reports && !me) {
    return (<><PageHeader eyebrow={t("Support admin")} title={t("Performance")} /><Card><Empty icon={<Activity className="size-5" />} title={t("No desk profile yet")} hint={t("Your numbers show here once you're an agent on the desk.")} /></Card></>);
  }
  const r = await performanceReport({ from, to, by, onlyAgentId: only });
  const m = only && r.agents[0] ? r.agents[0].m : r.team;
  const label = (d: Date) => new Intl.DateTimeFormat(L === "ar" ? "ar-SA-u-nu-latn" : "en-GB", { weekday: by === "day" ? "short" : undefined, day: "numeric", month: "short", timeZone: "Asia/Riyadh" }).format(d);
  const ownerQs = (id: string, s?: string) => `/adminwork/desk/tickets?o=${id}${s ? `&s=${s}` : ""}`;

  return (
    <>
      <PageHeader eyebrow={t("Support admin")} title={t("Performance")}
        subtitle={only ? t("{name}'s numbers. Everything is counted from the tickets they own.", { name: r.agents[0]?.name ?? me?.displayName ?? "" }) : t("The team and each agent, from the tickets they own: how fast they answer and resolve, whether promises are kept, how travellers rate it, and the refunds they approved.")}
        actions={only && reports ? <Link href={qs({ agent: undefined })} className="inline-flex h-10 items-center rounded-full bg-surface px-4 text-[13px] text-ink-2 shadow-card hover:text-ink">{t("Whole team")}</Link> : undefined} />
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Tabs active={range} items={(Object.keys(RANGES) as Range[]).map((k) => ({ key: k, label: t(k === "today" ? "Today" : k === "7d" ? "7 days" : k === "30d" ? "30 days" : "90 days"), href: qs({ r: k === "7d" ? undefined : k }) }))} />
        <Tabs active={by} items={[{ key: "day", label: t("By day"), href: qs({ by: undefined }) }, { key: "week", label: t("By week"), href: qs({ by: "week" }) }]} />
      </div>

      <div className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-6" data-testid="perf-stats">
        <Stat label={t("Volume")} value={<span className="num">{m.volume}</span>} sub={t("tickets opened")} />
        <Stat label={t("Handled")} value={<span className="num">{m.handled}</span>} sub={t("resolved")} href={only ? ownerQs(only, "resolved") : "/adminwork/desk/tickets?s=resolved"} />
        <Stat label={t("First response")} value={<span className="num">{dur(m.firstResponse.median)}</span>} sub={t("median · p90 {p}", { p: dur(m.firstResponse.p90) })} />
        <Stat label={t("Resolution")} value={<span className="num">{dur(m.resolution.median)}</span>} sub={t("median · p90 {p}", { p: dur(m.resolution.p90) })} />
        <Stat label={t("SLA hit")} value={<span className="num">{pct(m.slaHit)}</span>} sub={t("of {n} resolved", { n: m.slaN })} tone={m.slaHit != null && m.slaHit < 0.8 ? "warn" : undefined} />
        <Stat label="CSAT" value={<span className="num">{m.csat == null ? "—" : m.csat.toFixed(1)}</span>} sub={t("{n} ratings · refunds {n2}", { n: m.csatN, n2: m.refunds })} />
      </div>

      {!only && (
        <Card pad={false} className="mb-4">
          <div className="px-6 pt-6"><CardHead title={t("Agents")} hint={t("Click a number to see the tickets behind it.")} /></div>
          {r.agents.length === 0 ? <Empty title={t("No agents yet")} /> : (
            <PerfTable t={t} rows={r.agents.map((a) => ({ key: a.id, name: <Link href={qs({ agent: a.id })} className="text-ink hover:underline"><bdi>{a.name}</bdi></Link>, m: a.m, href: (s?: string) => ownerQs(a.id, s) }))} total={r.team} />
          )}
        </Card>
      )}

      <Card pad={false}>
        <div className="px-6 pt-6"><CardHead title={by === "day" ? t("By day") : t("By week")} hint={t("Riyadh days; weeks start on Sunday.")} /></div>
        <PerfTable t={t} rows={[...r.series].reverse().map((b) => ({ key: b.start.toISOString(), name: <span className="text-ink-2">{label(b.start)}{by === "week" ? ` – ${label(new Date(b.end.getTime() - 1))}` : ""}{riyadhDay(b.start) === riyadhDay(now) && by === "day" ? <span className="ms-1.5 inline-block size-1.5 rounded-full bg-gold align-middle" /> : null}</span>, m: b.m }))} />
      </Card>
    </>
  );
}

type Row = { key: string; name: ReactNode; m?: Metrics; href?: (s?: string) => string };

function PerfTable({ t, rows, total }: { t: Awaited<ReturnType<typeof getT>>; rows: Row[]; total?: Metrics }) {
  const cell = (x: Metrics | undefined, k: keyof Metrics | "fr" | "fr90" | "res" | "res90", href?: (s?: string) => string) => {
    if (!x) return "—";
    const v = k === "fr" ? dur(x.firstResponse.median) : k === "fr90" ? dur(x.firstResponse.p90) : k === "res" ? dur(x.resolution.median) : k === "res90" ? dur(x.resolution.p90)
      : k === "slaHit" ? pct(x.slaHit) : k === "csat" ? (x.csat == null ? "—" : `${x.csat.toFixed(1)} (${x.csatN})`) : k === "reopenRate" ? pct(x.reopenRate) : k === "refundSar" ? (x.refunds ? `${x.refunds} · ${sar(x.refundSar)}` : "—") : String(x[k as "volume"]);
    if (href && k === "handled" && x.handled) return <Link className="hover:underline" href={href("resolved")}>{v}</Link>;
    if (href && k === "volume" && x.volume) return <Link className="hover:underline" href={href("all")}>{v}</Link>;
    return v;
  };
  const cols: [string, Parameters<typeof cell>[1]][] = [["Volume", "volume"], ["Handled", "handled"], ["First response", "fr"], ["p90", "fr90"], ["Resolution", "res"], ["p90", "res90"], ["SLA hit", "slaHit"], ["CSAT", "csat"], ["Reopened", "reopenRate"], ["Refunds", "refundSar"]];
  return (
    <Table>
      <thead><tr><Th>{""}</Th>{cols.map(([l, k]) => <Th key={k} align="end" className="whitespace-nowrap">{l === "CSAT" ? l : t(l)}</Th>)}</tr></thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}><Td className="whitespace-nowrap">{r.name}</Td>{cols.map(([, k]) => <Td key={k} align="end" className={cx("num whitespace-nowrap", !r.m && "text-ink-4")}>{cell(r.m, k, r.href)}</Td>)}</tr>
        ))}
        {total && <tr className="bg-surface-2"><Td className="text-ink">{t("Team")}</Td>{cols.map(([, k]) => <Td key={k} align="end" className="num whitespace-nowrap text-ink">{cell(total, k)}</Td>)}</tr>}
      </tbody>
    </Table>
  );
}
