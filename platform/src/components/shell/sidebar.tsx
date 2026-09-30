"use client";
import Link from "next/link";
import { withBase } from "@/lib/base";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import {
  LayoutDashboard, Plus, ReceiptText, Ticket, Users2, MoonStar, Stamp, Wallet, Landmark, CalendarRange,
  Handshake, UserCog, ShieldCheck, History, SlidersHorizontal, ListChecks, Coins, PhoneCall, Inbox, Menu, X, LogOut,
} from "lucide-react";
import { cx } from "../ui";
import { useT } from "@/lib/i18n/client";

const ICONS = { LayoutDashboard, Plus, ReceiptText, Ticket, Users2, MoonStar, Stamp, Wallet, Landmark, CalendarRange, Handshake, UserCog, ShieldCheck, History, SlidersHorizontal, ListChecks, Coins, PhoneCall, Inbox };
export type NavItem = { href: string; label: string; icon: keyof typeof ICONS; count?: number; accent?: boolean };
export type NavSection = { label: string; items: NavItem[] };

function Nav({ sections, onNavigate }: { sections: NavSection[]; onNavigate?: () => void }) {
  const path = usePathname();
  const active = (href: string) => (href === "/adminwork" ? path === "/adminwork" : path === href || path.startsWith(href + "/"));
  // Most specific match wins so /team/roles doesn't also light up /team.
  const current = sections.flatMap((s) => s.items).filter((i) => active(i.href)).sort((a, b) => b.href.length - a.href.length)[0]?.href;
  return (
    <nav className="flex-1 space-y-7 overflow-y-auto px-4 pb-6">
      {sections.map((s) => (
        <div key={s.label}>
          <div className="mb-2 px-3 text-[11.5px] text-ink-4">{s.label}</div>
          <ul className="space-y-0.5">
            {s.items.map((it) => {
              const Icon = ICONS[it.icon];
              const on = current === it.href;
              if (it.accent) return (
                <li key={it.href} className="pb-3">
                  <Link href={it.href} onClick={onNavigate}
                    className="group flex h-11 items-center gap-3 rounded-full bg-ink ps-1.5 pe-4 text-[14px] text-bg transition hover:opacity-90">
                    <span className="grid size-8 place-items-center rounded-full bg-gold text-[#1a140a] transition group-hover:rotate-90"><Icon className="size-4" strokeWidth={2.4} /></span>
                    {it.label}
                    <kbd className="ms-auto rounded-full border border-current/20 px-2 text-[10.5px] opacity-60">N</kbd>
                  </Link>
                </li>
              );
              return (
                <li key={it.href}>
                  <Link href={it.href} onClick={onNavigate}
                    className={cx("flex h-10 items-center gap-3 rounded-full px-3 text-[14px] transition",
                      on ? "bg-surface text-ink shadow-card" : "text-ink-2 hover:bg-surface/60 hover:text-ink")}>
                    <Icon className={cx("size-[17px] shrink-0", on ? "text-gold-2" : "text-ink-3")} strokeWidth={1.7} />
                    <span className="truncate">{it.label}</span>
                    {!!it.count && <span className="num ms-auto grid h-[22px] min-w-[22px] place-items-center rounded-full bg-gold px-1.5 text-[11.5px] font-medium text-[#1a140a]">{it.count}</span>}
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </nav>
  );
}

function Brand() {
  return (
    <Link href="/adminwork" className="flex h-20 items-center gap-3 px-7">
      <img src={withBase("/symbol-green.svg")} alt="" className="h-[18px] dark:hidden" />
      <img src={withBase("/symbol-sand.svg")} alt="" className="hidden h-[18px] dark:block" />
      <span className="text-[16px] font-medium tracking-[-0.02em] text-ink">Mada <span className="text-ink-3">Ops</span></span>
    </Link>
  );
}

function UserBlock({ name, role, logout }: { name: string; role: string; logout: () => Promise<void> }) {
  const t = useT();
  return (
    <div className="m-4 flex items-center gap-3 rounded-[20px] bg-surface p-2 shadow-card">
      <Link href="/adminwork/me" className="flex min-w-0 flex-1 items-center gap-3">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-ink text-[12px] font-medium text-bg">
          {name.split(" ").map((s) => s[0]).slice(0, 2).join("")}
        </span>
        <span className="min-w-0">
          <span className="block truncate text-[13.5px] text-ink">{name}</span>
          <span className="block truncate text-[11.5px] text-ink-3">{role}</span>
        </span>
      </Link>
      <form action={logout}>
        <button className="grid size-9 place-items-center rounded-full text-ink-3 transition hover:bg-sunken hover:text-ink" title={t("Sign out")} aria-label={t("Sign out")}><LogOut className="size-4 rtl:rotate-180" /></button>
      </form>
    </div>
  );
}

export function Sidebar({ sections, user, logout }: { sections: NavSection[]; user: { name: string; role: string }; logout: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const path = usePathname();
  useEffect(() => setOpen(false), [path]);
  return (
    <>
      <aside className="fixed inset-y-0 start-0 z-40 hidden w-[272px] flex-col lg:flex">
        <Brand /><Nav sections={sections} /><UserBlock {...user} logout={logout} />
      </aside>
      <button onClick={() => setOpen(true)} className="fixed start-4 top-[18px] z-40 grid size-10 place-items-center rounded-full bg-tile text-tile-ink lg:hidden" aria-label="Menu"><Menu className="size-[18px]" /></button>
      {open && (
        <div className="fixed inset-0 z-[60] lg:hidden">
          <div className="absolute inset-0 bg-black/30 backdrop-blur-sm animate-fade" onClick={() => setOpen(false)} />
          <aside className="absolute inset-y-2 start-2 flex w-[290px] flex-col rounded-[26px] bg-bg shadow-float animate-rise">
            <button onClick={() => setOpen(false)} className="absolute end-4 top-6 text-ink-3" aria-label="Close"><X className="size-5" /></button>
            <Brand /><Nav sections={sections} onNavigate={() => setOpen(false)} /><UserBlock {...user} logout={logout} />
          </aside>
        </div>
      )}
    </>
  );
}
