"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AlertTriangle, ArrowUpRight, Flag, Hand, X } from "lucide-react";
import { KIND_META } from "./kinds";
import { Avatar, cx } from "../ui";
import { SubmitButton } from "../client";
import { SlaClock } from "./live";
import { useT } from "@/lib/i18n/client";

export type InboxRow = {
  key: string; kind: string; id: string; title: string; note: string; sub: string; href: string; due: string; opened: string;
  agentName: string | null; reason: string; tag?: string | null; link?: { label: string; href: string } | null; escalated: boolean; escalationNote: string | null; amount: string | null; mine: boolean;
};


const FILTER_KEYS = ["mine", "team", "unassigned", "escalated"];

export function InboxList({ rows, take, myAgentId, filterHref }: {
  rows: InboxRow[]; take: (fd: FormData) => Promise<void>; myAgentId: string | null; filterHref: Record<string, string>;
}) {
  const t = useT();
  const router = useRouter();
  const [sel, setSel] = useState(0);
  const [help, setHelp] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const takeRefs = useRef<Record<string, HTMLFormElement | null>>({});

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement;
      if (e.metaKey || e.ctrlKey || e.altKey || el.closest("input, textarea, select, [contenteditable]")) return;
      const row = rows[sel];
      if (e.key === "j" || e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(rows.length - 1, s + 1)); }
      else if (e.key === "k" || e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
      else if ((e.key === "Enter" || e.key === "o") && row) { e.preventDefault(); router.push(row.href); }
      else if (e.key === "t" && row && myAgentId && !row.mine) { e.preventDefault(); takeRefs.current[row.key]?.requestSubmit(); }
      else if (/^[1-4]$/.test(e.key)) { e.preventDefault(); router.push(filterHref[FILTER_KEYS[Number(e.key) - 1]!]!); }
      else if (e.key === "?") { e.preventDefault(); setHelp((h) => !h); }
      else if (e.key === "Escape") setHelp(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [rows, sel, router, myAgentId, filterHref]);

  useEffect(() => { list.current?.querySelector<HTMLElement>(`[data-i="${sel}"]`)?.scrollIntoView({ block: "nearest" }); }, [sel]);
  useEffect(() => { setSel((s) => Math.min(s, Math.max(0, rows.length - 1))); }, [rows.length]);

  return (
    <div className="relative">
      <ol ref={list} className="divide-y divide-line">
        {rows.map((r, i) => {
          const M = KIND_META[r.kind] ?? KIND_META.request!;
          const Icon = M.icon;
          return (
            <li key={r.key} data-i={i} onMouseEnter={() => setSel(i)}
              className={cx("group relative grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-3.5 gap-y-2 px-4 py-3.5 transition sm:px-5 lg:grid-cols-[40px_minmax(0,1fr)_auto_190px_auto]",
                i === sel ? "bg-surface-2" : "hover:bg-surface-2/60")}>
              {i === sel && <span className="absolute inset-y-2 start-0 w-[3px] rounded-full bg-gold" aria-hidden />}
              <span className={cx("grid size-10 place-items-center rounded-2xl", M.tone)}><Icon className="size-[18px]" strokeWidth={1.8} /></span>
              <Link href={r.href} className="min-w-0">
                <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                  <span className="text-[11.5px] font-medium uppercase tracking-[0.06em] text-ink-3">{t(M.label)}</span>
                  <span className="text-[12.5px] font-medium text-ink-2">· {t(r.note)}</span>
                  {r.tag && <span className="inline-flex h-5 items-center rounded-full bg-info-soft px-1.5 text-[11px] font-medium text-info">{t(r.tag)}</span>}
                  {r.escalated && <span className="inline-flex h-5 items-center gap-1 rounded-full bg-bad-soft px-1.5 text-[11px] font-medium text-bad" title={r.escalationNote ?? ""}><Flag className="size-3" />{t("Escalated")}</span>}
                </span>
                <span dir="auto" className="mt-0.5 block truncate text-start text-[14.5px] text-ink group-hover:underline group-hover:decoration-gold group-hover:decoration-2 group-hover:underline-offset-4">{r.title}</span>
                <span className="mt-0.5 flex flex-wrap items-center gap-x-2 text-[12.5px] text-ink-3">
                  <span dir="auto" className="truncate">{r.sub}</span>
                  {r.amount && <span className="num text-ink-2" dir="ltr">{r.amount}</span>}
                </span>
              </Link>
              <div className="col-start-2 flex flex-wrap items-center gap-x-3 gap-y-2 lg:contents">
              <div className="flex items-center lg:justify-end">
                <SlaClock due={r.due} opened={r.opened} />
              </div>
              <div className="flex min-w-0 items-center gap-2">
                {r.agentName ? (
                  <>
                    <Avatar name={r.agentName} size={26} />
                    <span className="min-w-0 text-[12.5px] leading-tight">
                      <span className="block truncate text-ink">{r.agentName}{r.mine ? ` · ${t("You")}` : ""}</span>
                      <span className="block truncate text-ink-3">{t(r.reason === "covering" ? "Covering" : r.reason === "manual" ? "Assigned" : "Their agent")}</span>
                    </span>
                  </>
                ) : (
                  <span className="inline-flex items-center gap-1.5 text-[12.5px] text-warn"><AlertTriangle className="size-3.5" />{t("Shared queue")}</span>
                )}
              </div>
              <div className="ms-auto flex items-center gap-1.5 lg:ms-0">
                {r.link && <a href={r.link.href} target="_blank" rel="noopener noreferrer" className="hidden h-8 items-center rounded-full px-2.5 text-[12.5px] text-ink-3 underline decoration-gold decoration-2 underline-offset-4 hover:text-ink sm:inline-flex">{t(r.link.label)}</a>}
                {myAgentId && !r.mine && (
                  <form action={take} ref={(el) => { takeRefs.current[r.key] = el; }}>
                    <input type="hidden" name="kind" value={r.kind} /><input type="hidden" name="itemId" value={r.id} /><input type="hidden" name="agentId" value={myAgentId} />
                    <SubmitButton variant="outline" size="sm"><Hand className="size-3.5" />{t("Take it")}</SubmitButton>
                  </form>
                )}
                <Link href={r.href} className="grid size-8 place-items-center rounded-full text-ink-3 transition hover:bg-sunken hover:text-ink" aria-label={t("Open it")}><ArrowUpRight className="size-4 rtl:-scale-x-100" /></Link>
              </div>
              </div>
            </li>
          );
        })}
      </ol>
      {help && (
        <div className="fixed bottom-6 end-6 z-50 w-[300px] rounded-[22px] bg-tile p-5 text-tile-ink shadow-float animate-rise" role="dialog" aria-label={t("Keyboard shortcuts")}>
          <div className="mb-3 flex items-center justify-between"><span className="text-[14px] font-medium">{t("Keyboard shortcuts")}</span><button onClick={() => setHelp(false)} className="text-tile-ink-3 hover:text-tile-ink" aria-label={t("Close")}><X className="size-4" /></button></div>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-[13px]">
            {[["J / K", t("Next / previous")], ["Enter", t("Open it")], ["T", t("Take it")], ["1–4", t("Mine · Team · Unassigned · Escalated")], ["?", t("Show or hide this")]].map(([k, v]) => (
              <div key={k} className="contents"><dt><kbd className="num rounded-md bg-white/10 px-1.5 py-0.5 text-[11.5px]">{k}</kbd></dt><dd className="text-tile-ink-3">{v}</dd></div>
            ))}
          </dl>
        </div>
      )}
    </div>
  );
}
