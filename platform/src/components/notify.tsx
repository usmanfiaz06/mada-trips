"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Bell, Stamp, ListChecks, Inbox, Ticket, MoonStar, Wallet, X, Check, ArrowRight } from "lucide-react";
import { cx } from "./ui";
import { useT } from "@/lib/i18n/client";
import { BASE } from "@/lib/base";

export type AlertTone = "urgent" | "warn" | "info";
export type AlertIcon = "Stamp" | "ListChecks" | "Inbox" | "Ticket" | "MoonStar" | "Wallet";
export type Alert = { key: string; tone: AlertTone; icon: AlertIcon; title: string; detail?: string; href: string };

const ICONS: Record<AlertIcon, React.ComponentType<{ className?: string }>> = { Stamp, ListChecks, Inbox, Ticket, MoonStar, Wallet };

const TONE: Record<AlertTone, { dot: string; ring: string; chip: string }> = {
  urgent: { dot: "bg-bad", ring: "ring-bad/30", chip: "bg-bad-soft text-bad" },
  warn: { dot: "bg-glow-gold", ring: "ring-glow-gold/30", chip: "bg-gold/15 text-glow-gold" },
  info: { dot: "bg-glow-green", ring: "ring-glow-green/30", chip: "bg-ok-soft text-ok" },
};

/** Bell in the top bar. Shows a live count and opens a panel listing everything waiting on you. */
export function NotificationBell({ alerts }: { alerts: Alert[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const n = alerts.length;
  const urgent = alerts.some((a) => a.tone === "urgent");

  useEffect(() => { setOpen(false); }, [pathname]);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => { document.removeEventListener("mousedown", onDown); document.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} className="relative">
      <button onClick={() => setOpen((v) => !v)} aria-label={t("Notifications")} aria-expanded={open}
        className="relative grid size-10 place-items-center rounded-full text-tile-ink-3 transition hover:bg-white/10 hover:text-tile-ink">
        <Bell className="size-[18px]" />
        {n > 0 && (
          <span className={cx("absolute -end-0.5 -top-0.5 grid h-[18px] min-w-[18px] place-items-center rounded-full px-1 text-[10.5px] font-semibold ring-2 ring-tile",
            urgent ? "bg-bad text-white" : "bg-glow-gold text-[#1a140a]")}>{n > 9 ? "9+" : n}</span>
        )}
      </button>
      {open && (
        <div className="absolute end-0 top-12 z-50 w-[min(92vw,360px)] overflow-hidden rounded-2xl bg-tile text-tile-ink shadow-float ring-1 ring-tile-line animate-rise">
          <div className="flex items-center justify-between border-b border-tile-line px-4 py-3">
            <span className="text-[13px] font-medium">{t("What needs you")}</span>
            <button onClick={() => setOpen(false)} className="grid size-7 place-items-center rounded-full text-tile-ink-3 hover:bg-white/10 hover:text-tile-ink" aria-label={t("Dismiss")}><X className="size-4" /></button>
          </div>
          {n === 0 ? (
            <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
              <span className="grid size-10 place-items-center rounded-full bg-ok-soft text-ok"><Check className="size-5" /></span>
              <p className="text-[13px] text-tile-ink-3">{t("You're all caught up.")}</p>
            </div>
          ) : (
            <ul className="max-h-[60vh] divide-y divide-tile-line overflow-y-auto">
              {alerts.map((a) => {
                const Icon = ICONS[a.icon];
                return (
                  <li key={a.key}>
                    <Link href={a.href} onClick={() => setOpen(false)} className="group flex items-start gap-3 px-4 py-3 transition hover:bg-white/[0.04]">
                      <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ring-1", TONE[a.tone].chip, TONE[a.tone].ring)}><Icon className="size-4" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-[13px] leading-snug text-tile-ink">{a.title}</span>
                        {a.detail && <span className="mt-0.5 block truncate text-[12px] text-tile-ink-3">{a.detail}</span>}
                      </span>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-tile-ink-3 opacity-0 transition group-hover:opacity-100 rtl:rotate-180" />
                    </Link>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

const SEEN_KEY = "mada_seen_alerts";

/**
 * On landing (right after sign-in, or the first page of a new tab) pops the things waiting on you as
 * toasts so nothing gets missed. Each distinct alert is shown once per browser session; new ones that
 * appear later surface on the next navigation.
 */
export function DueToasts({ alerts }: { alerts: Alert[] }) {
  const t = useT();
  const [shown, setShown] = useState<Alert[]>([]);

  useEffect(() => {
    if (!alerts.length) return;
    let seen: string[] = [];
    try { seen = JSON.parse(sessionStorage.getItem(SEEN_KEY) || "[]"); } catch { seen = []; }
    const fresh = alerts.filter((a) => !seen.includes(a.key)).slice(0, 4);
    if (!fresh.length) return;
    try { sessionStorage.setItem(SEEN_KEY, JSON.stringify([...new Set([...seen, ...fresh.map((a) => a.key)])].slice(-40))); } catch { /* private mode */ }
    setShown(fresh);
    const timers = fresh.map((a, i) =>
      setTimeout(() => setShown((cur) => cur.filter((x) => x.key !== a.key)), 7000 + i * 900));
    return () => timers.forEach(clearTimeout);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const dismiss = (key: string) => setShown((cur) => cur.filter((x) => x.key !== key));
  if (!shown.length) return null;

  return (
    <div className="pointer-events-none fixed inset-x-0 top-20 z-[70] flex flex-col items-center gap-2 px-4 sm:items-end sm:pe-6">
      {shown.map((a) => {
        const Icon = ICONS[a.icon];
        return (
          <Link key={a.key} href={a.href} onClick={() => dismiss(a.key)}
            className="pointer-events-auto flex w-full max-w-[360px] items-start gap-3 rounded-2xl bg-tile py-3 ps-3 pe-3 text-tile-ink shadow-float ring-1 ring-tile-line animate-rise transition hover:ring-tile-ink-3">
            <span className={cx("mt-0.5 grid size-8 shrink-0 place-items-center rounded-full ring-1", TONE[a.tone].chip, TONE[a.tone].ring)}><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1">
              <span className="block text-[13px] font-medium leading-snug">{a.title}</span>
              {a.detail && <span className="mt-0.5 block truncate text-[12px] text-tile-ink-3">{a.detail}</span>}
            </span>
            <button onClick={(e) => { e.preventDefault(); e.stopPropagation(); dismiss(a.key); }}
              className="-me-0.5 grid size-6 shrink-0 place-items-center rounded-full text-tile-ink-3 hover:bg-white/10 hover:text-tile-ink" aria-label={t("Dismiss")}><X className="size-3.5" /></button>
          </Link>
        );
      })}
    </div>
  );
}
