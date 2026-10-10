import Link from "next/link";
import { CheckCircle2, Inbox } from "lucide-react";
import { requirePerm } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { sar } from "@/lib/money";
import { agentForOps } from "@/lib/app/desk/agents";
import { deskInbox, filterInbox, inboxCounts, type InboxFilter } from "@/lib/app/desk/inbox";
import { available, onShift } from "@/lib/app/desk/routing";
import { DESK_KINDS } from "@/lib/app/desk/sla";
import { Avatar, Card, Empty, InkCard, cx } from "@/components/ui";
import { InboxList, type InboxRow } from "@/components/desk/inbox-list";
import { KIND_META } from "@/components/desk/kinds";
import { AutoRefresh } from "@/components/desk/live";
import { takeAction } from "./actions";

export const metadata = { title: "Desk" };

const FILTERS: InboxFilter[] = ["mine", "team", "unassigned", "escalated"];

export default async function DeskInbox({ searchParams }: { searchParams: Promise<{ f?: string; k?: string }> }) {
  const u = await requirePerm("desk.view");
  const t = await getT();
  const sp = await searchParams;
  const [{ items, rota }, me] = await Promise.all([deskInbox(), agentForOps(u.id)]);
  const filter: InboxFilter = FILTERS.includes(sp.f as InboxFilter) ? (sp.f as InboxFilter) : me ? "mine" : "team";
  const kind = (DESK_KINDS as readonly string[]).includes(sp.k ?? "") ? sp.k! : "";
  const counts = inboxCounts(items, me);
  const shown = filterInbox(items, filter, me).filter((i) => !kind || i.kind === kind);
  const href = (f: string, k = kind) => { const p = new URLSearchParams(); p.set("f", f); if (k) p.set("k", k); return `/adminwork/desk?${p}`; };
  const rows: InboxRow[] = shown.map((i) => ({
    key: i.key, kind: i.kind, id: i.id, title: i.title, note: i.note, sub: i.sub, href: i.href, due: i.sla.dueAt.toISOString(), opened: i.sla.openedAt.toISOString(),
    agentName: i.agentName, reason: i.route.reason, escalated: i.escalated, escalationNote: i.escalationNote, amount: i.amount ? `SAR ${sar(i.amount)}` : null, mine: !!me && i.route.agentId === me.id,
  }));

  // Who is on now, and who they cover for: the line the night lead reads first.
  const onNow = rota.agents.filter((a) => onShift(a.id, rota.shifts, rota.now) && a.active);
  const covering = rota.shifts.filter((s) => s.coveringForId && s.startsAt <= rota.now && rota.now < s.endsAt);
  const nameOf = (id: string) => rota.agents.find((a) => a.id === id)?.displayName ?? "—";
  const breached = items.filter((i) => i.sla.state === "breached");

  return (
    <>
      <AutoRefresh every={20} />
      <header className="mb-6 flex flex-wrap items-end justify-between gap-4 animate-rise">
        <div>
          <div className="mb-2 flex items-center gap-2 text-[12px] font-medium text-ink-3"><span className="size-1.5 rounded-full bg-gold live-dot" />{t("App desk · 24/7")}</div>
          <h1 className="text-[34px] font-[380] leading-[1.05] tracking-[-0.035em] text-ink">{t("Inbox")}</h1>
          <p className="mt-2 max-w-2xl text-[14.5px] leading-relaxed text-ink-3">{t("Everything travellers are waiting on, most urgent first. Orders are confirmed within 4 minutes, chats answered within 10.")}</p>
        </div>
      </header>

      <div className="mb-4 grid gap-4 lg:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)]">
        <InkCard grain className="flex flex-col justify-between gap-6">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[12.5px] text-tile-ink-3">{t("Waiting on the desk")}</div>
              <div className="figure mt-3 text-[64px] text-tile-ink">{counts.all}</div>
            </div>
            <div className="grid grid-cols-3 gap-5 text-end">
              {[[t("Late"), counts.breached, counts.breached ? "text-glow-ember" : "text-tile-ink"], [t("Mine"), counts.mine, "text-tile-ink"], [t("Unassigned"), counts.unassigned, counts.unassigned ? "text-glow-gold" : "text-tile-ink"]].map(([l, n, c]) => (
                <div key={String(l)}><div className="text-[11.5px] text-tile-ink-3">{l}</div><div className={cx("figure mt-2 text-[30px]", String(c))}>{n}</div></div>
              ))}
            </div>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {DESK_KINDS.map((k) => {
              const n = counts.by[k];
              const M = KIND_META[k]!;
              return (
                <Link key={k} href={href(filter, kind === k ? "" : k)}
                  className={cx("inline-flex h-8 items-center gap-2 rounded-full px-3 text-[12.5px] transition", kind === k ? "bg-gold text-[#1a140a]" : n ? "bg-white/[0.08] text-tile-ink hover:bg-white/[0.14]" : "bg-white/[0.04] text-tile-ink-3 hover:bg-white/[0.08]")}>
                  <M.icon className="size-3.5" />{t(M.label)}<span className="num opacity-70">{n}</span>
                </Link>
              );
            })}
          </div>
        </InkCard>
        <Card className="flex flex-col">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-[17px] font-[450] tracking-[-0.02em]">{t("On the desk now")}</h2>
            <Link href="/adminwork/desk/team" className="text-[12.5px] text-ink-3 hover:text-ink">{t("Rota")} →</Link>
          </div>
          {onNow.length === 0 ? <p className="text-[13.5px] text-warn">{t("Nobody is on shift. Travellers see “Replies within 10 minutes, any hour”.")}</p> : (
            <ul className="space-y-2.5">
              {onNow.map((a) => {
                const cov = covering.filter((s) => s.agentId === a.id).map((s) => nameOf(s.coveringForId!));
                const up = available(a, rota.shifts, rota.now) && a.status === "online";
                return (
                  <li key={a.id} className="flex items-center gap-3">
                    <span className="relative"><Avatar name={a.displayName} size={34} /><span className={cx("absolute -bottom-0.5 -end-0.5 size-3 rounded-full ring-2 ring-surface", up ? "bg-ok" : a.status === "away" ? "bg-warn" : "bg-ink-4")} /></span>
                    <span className="min-w-0 flex-1 text-[13.5px] leading-tight">
                      <span className="block text-ink">{a.displayName}{me?.id === a.id ? ` · ${t("You")}` : ""}</span>
                      <span className="block truncate text-[12px] text-ink-3">{cov.length ? t("Covering for {names}", { names: cov.join(", ") }) : t(a.status === "online" ? "Online" : a.status === "away" ? "Away" : "Signed off")} · {a.languages.map((l) => l.toUpperCase()).join(" ")}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {breached.length > 0 && (
            <div className="mt-auto pt-4">
              <Link href={href("escalated", "")} className="flex items-center justify-between rounded-2xl bg-bad-soft px-3.5 py-2.5 text-[13px] text-bad">
                <span>{t("{n} past their promised time", { n: breached.length })}</span><span>{t("See escalations")} →</span>
              </Link>
            </div>
          )}
        </Card>
      </div>

      <Card pad={false} className="overflow-hidden">
        <div className="flex flex-wrap items-center gap-1.5 border-b border-line p-3 sm:px-4">
          {FILTERS.map((f, i) => {
            const n = f === "team" ? counts.all : counts[f];
            return (
              <Link key={f} href={href(f)} className={cx("inline-flex h-9 items-center gap-2 rounded-full px-3.5 text-[13.5px] transition", filter === f ? "bg-ink text-bg" : "text-ink-2 hover:bg-sunken")}>
                {t(f === "mine" ? "Mine" : f === "team" ? "Whole team" : f === "unassigned" ? "Unassigned" : "Escalations")}
                <span className={cx("num rounded-full px-1.5 text-[11px]", filter === f ? "bg-gold text-[#1a140a]" : f === "escalated" && n ? "bg-bad-soft text-bad" : "bg-sunken text-ink-3")}>{n}</span>
                <kbd className="hidden text-[10.5px] opacity-40 lg:inline">{i + 1}</kbd>
              </Link>
            );
          })}
          <span className="ms-auto hidden items-center gap-1.5 pe-1 text-[12px] text-ink-4 lg:inline-flex"><kbd className="rounded border border-line-strong px-1 text-[10.5px]">?</kbd>{t("Shortcuts")}</span>
        </div>
        {rows.length === 0 ? (
          <Empty icon={filter === "mine" ? <CheckCircle2 className="size-5" /> : <Inbox className="size-5" />}
            title={filter === "mine" ? t("Nothing waiting on you") : t("Nothing here")}
            hint={filter === "mine" ? t("New work for your travellers lands here first.") : t("When travellers need the desk, it shows up here.")} />
        ) : <InboxList rows={rows} take={takeAction} myAgentId={me?.id ?? null} filterHref={Object.fromEntries(FILTERS.map((f) => [f, href(f)]))} />}
      </Card>
    </>
  );
}
