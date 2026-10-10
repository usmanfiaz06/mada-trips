"use client";
import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { Clock3, Eye, EyeOff, Loader2 } from "lucide-react";
import { cx } from "../ui";
import { useT } from "@/lib/i18n/client";

/* Small live pieces of the desk: the SLA clock, auto-refresh, the sub-navigation, the passport reveal. */

type SlaState = "ok" | "soon" | "breached" | "met";
const SLA_TONE: Record<SlaState, string> = {
  ok: "bg-sunken text-ink-2",
  soon: "bg-warn-soft text-warn",
  breached: "bg-bad-soft text-bad",
  met: "bg-ok-soft text-ok",
};

/** A countdown to the promised time that turns amber in the last quarter and red once it's late. */
export function SlaClock({ due, opened, met, compact }: { due: string; opened: string; met?: string | null; compact?: boolean }) {
  const t = useT();
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => { setNow(Date.now()); const i = setInterval(() => setNow(Date.now()), 15_000); return () => clearInterval(i); }, []);
  const d = new Date(due).getTime(), o = new Date(opened).getTime();
  const at = met ? new Date(met).getTime() : now ?? o;
  const left = d - at;
  const state: SlaState = met ? (left >= 0 ? "met" : "breached") : left < 0 ? "breached" : left <= Math.max(60_000, (d - o) / 4) ? "soon" : "ok";
  const mins = Math.abs(Math.round(left / 60_000));
  const span = mins >= 120 ? t("{h}h", { h: Math.round(mins / 60) }) : mins >= 60 ? t("{h}h {m}m", { h: Math.floor(mins / 60), m: mins % 60 }) : t("{m} min", { m: Math.max(mins, left < 0 ? 1 : 0) });
  const label = met ? (state === "met" ? t("Answered in time") : t("Answered late")) : state === "breached" ? t("{span} late", { span }) : t("{span} left", { span });
  return (
    <span className={cx("num inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-[12px] font-medium", SLA_TONE[state])} title={new Date(due).toLocaleString()} suppressHydrationWarning>
      {state === "breached" && !met ? <span className="size-1.5 rounded-full bg-current live-dot" /> : <Clock3 className="size-3" />}
      {now === null && !met ? (compact ? "…" : t("Due")) : label}
    </span>
  );
}

/** Keeps a live queue fresh without a reload, and pauses while the tab is hidden or someone is typing. */
export function AutoRefresh({ every = 20 }: { every?: number }) {
  const router = useRouter();
  useEffect(() => {
    const i = setInterval(() => {
      if (document.hidden) return;
      const el = document.activeElement;
      if (el && (el.tagName === "TEXTAREA" || el.tagName === "INPUT" || el.tagName === "SELECT")) return;
      router.refresh();
    }, every * 1000);
    return () => clearInterval(i);
  }, [router, every]);
  return null;
}

export function DeskNav({ items }: { items: { href: string; label: string; count?: number; tone?: "bad" | "gold" }[] }) {
  const path = usePathname();
  const current = items.filter((i) => (i.href === "/adminwork/desk" ? path === i.href : path === i.href || path.startsWith(i.href + "/"))).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="-mx-4 mb-6 flex gap-1.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] lg:mx-0 lg:flex-wrap lg:overflow-visible lg:px-0" aria-label="Desk">
      {items.map((it) => {
        const on = current === it.href;
        return (
          <Link key={it.href} href={it.href} aria-current={on ? "page" : undefined}
            className={cx("flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full px-4 text-[13.5px] transition",
              on ? "bg-ink text-bg" : "bg-surface text-ink-2 shadow-soft hover:bg-surface-2 hover:text-ink")}>
            {it.label}
            {!!it.count && <span className={cx("num grid h-[19px] min-w-[19px] place-items-center rounded-full px-1.5 text-[11px] font-medium",
              it.tone === "bad" ? "bg-bad text-white" : on ? "bg-gold text-[#1a140a]" : "bg-sunken text-ink-2")}>{it.count}</span>}
          </Link>
        );
      })}
    </nav>
  );
}

/** Masked by default. Revealing asks the server, which checks desk.issue and logs the look. */
export function PassportReveal({ masked, reveal, can }: { masked: string; reveal: () => Promise<{ number?: string; error?: string }>; can: boolean }) {
  const t = useT();
  const [shown, setShown] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  return (
    <span className="inline-flex items-center gap-2">
      <span className="num font-medium text-ink" dir="ltr">{shown ?? masked}</span>
      {can && (
        <button type="button" disabled={pending} className="grid size-7 place-items-center rounded-full text-ink-3 transition hover:bg-sunken hover:text-ink"
          aria-label={shown ? t("Hide") : t("Show full number")} title={shown ? t("Hide") : t("Show full number (logged)")}
          onClick={() => {
            if (shown) { setShown(null); return; }
            start(async () => {
              const r = await reveal();
              if (r.number) { setShown(r.number); setErr(null); clearTimeout(timer.current); timer.current = setTimeout(() => setShown(null), 30_000); }
              else setErr(r.error ?? "Not found");
            });
          }}>
          {pending ? <Loader2 className="size-3.5 animate-spin" /> : shown ? <EyeOff className="size-3.5" /> : <Eye className="size-3.5" />}
        </button>
      )}
      {err && <span className="text-[12px] text-bad">{t(err)}</span>}
    </span>
  );
}
