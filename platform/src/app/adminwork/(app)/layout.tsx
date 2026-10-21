import { requireUser, can } from "@/lib/auth";
import { getT } from "@/lib/i18n";
import { navCounts } from "@/lib/counts";
import { canSeeIssuance } from "@/lib/issuance";
import { whatsDue } from "@/lib/briefing";
import { getSettings } from "@/lib/settings";
import { Sidebar, type NavSection } from "@/components/shell/sidebar";
import { CommandPalette, CommandTrigger } from "@/components/shell/command";
import { CloseClock, LocaleSwitch, ThemeToggle } from "@/components/client";
import { NotificationBell, DueToasts } from "@/components/notify";
import { logout } from "../login/actions";
import { deskNavCounts } from "@/lib/app/desk/inbox";
import { deskSections } from "@/lib/app/desk/nav";
import { agentForOps, loadRota } from "@/lib/app/desk/agents";
import { onShift } from "@/lib/app/desk/routing";
import { esimBalance } from "@/lib/app/esim/ops";
import { PresenceSwitch } from "@/components/desk/presence";
import { statusPillAction } from "./desk/actions";
import type { Alert } from "@/components/notify";

const NO_COUNTS = { queue: 0, chats: 0, orders: 0, requests: 0, refunds: 0, disruptions: 0, moderation: 0, recovery: 0, esims: 0 };

/** For desk users: their agent profile and shift (the header switch), the sidebar numbers, and the eSIM balance alert. */
async function deskBits(u: Awaited<ReturnType<typeof requireUser>>, t: Awaited<ReturnType<typeof getT>>) {
  if (!can(u, "desk.view")) return { counts: NO_COUNTS, me: null, alerts: [] as Alert[] };
  const [counts, me, bal] = await Promise.all([deskNavCounts().catch(() => NO_COUNTS), agentForOps(u.id).catch(() => null), esimBalance().catch(() => null)]);
  const shift = me ? onShift(me.id, (await loadRota()).shifts, new Date()) : false;
  const alerts: Alert[] = bal?.low ? [{ key: "esim-balance", tone: "urgent", icon: "Wallet", title: t("eSIM Access balance is low: ${usd}", { usd: (bal.usd ?? 0).toFixed(2) }),
    detail: t("Top it up in the eSIM Access console, or paid eSIMs wait."), href: "/adminwork/desk/esims" }] : [];
  return { counts, me: me ? { id: me.id, name: me.displayName, status: me.status, onShift: shift } : null, alerts };
}

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const u = await requireUser();
  const t = await getT();
  const [counts, issuer, s, due, desk] = await Promise.all([navCounts(u), canSeeIssuance(u), getSettings(), whatsDue(u), deskBits(u, t)]);
  const alerts = [...desk.alerts, ...due];

  const sections: NavSection[] = [
    { label: t("Workspace"), items: [
      ...(can(u, "sales.create") ? [{ href: "/adminwork/sales/new", label: t("New sale"), icon: "Plus" as const, accent: true }] : []),
      { href: "/adminwork", label: t("Dashboard"), icon: "LayoutDashboard" as const },
      { href: "/adminwork/tasks", label: t("Tasks"), icon: "ListChecks" as const, count: counts.tasks },
      { href: "/adminwork/approvals", label: t("Approvals"), icon: "Stamp" as const, count: counts.approvals },
    ] },
    ...deskSections(u, t, desk.counts),
    { label: t("Operations"), items: [
      { href: "/adminwork/sales", label: t("Sales & bookings"), icon: "ReceiptText" as const },
      ...(issuer ? [{ href: "/adminwork/issuance", label: t("Issuance"), icon: "Ticket" as const, count: counts.issuance }] : []),
      ...(can(u, "leads.view") ? [{ href: "/adminwork/leads", label: t("Leads"), icon: "Inbox" as const, count: counts.leads }] : []),
      { href: "/adminwork/clients", label: t("Clients & credit"), icon: "Users2" as const },
      ...(can(u, "sales.create") || can(u, "sales.view_all") ? [{ href: "/adminwork/collections", label: t("Collections"), icon: "PhoneCall" as const }] : []),
      ...(can(u, "close.submit") || can(u, "close.verify") ? [{ href: "/adminwork/close", label: t("Daily close"), icon: "MoonStar" as const, count: counts.closes }] : []),
      ...(can(u, "expenses.create") || can(u, "expenses.view_all") ? [{ href: "/adminwork/expenses", label: t("Expenses"), icon: "Wallet" as const }] : []),
    ] },
    ...(can(u, "finance.view") || u.partnerId ? [{ label: t("Finance"), items: [
      ...(can(u, "finance.view") ? [
        { href: "/adminwork/finance", label: t("Banks & cash"), icon: "Landmark" as const },
        { href: "/adminwork/payables", label: t("Money we owe"), icon: "Coins" as const },
        { href: "/adminwork/settlement", label: t("Day-25 settlement"), icon: "CalendarRange" as const },
      ] : []),
      { href: "/adminwork/partners", label: t("Partners"), icon: "Handshake" as const },
    ] }] : []),
    ...(can(u, "team.manage") || can(u, "roles.manage") || can(u, "activity.view") || can(u, "settings.manage") ? [{ label: t("Admin"), items: [
      ...(can(u, "team.manage") ? [{ href: "/adminwork/team", label: t("Team"), icon: "UserCog" as const }] : []),
      ...(can(u, "roles.manage") ? [{ href: "/adminwork/team/roles", label: t("Roles & access"), icon: "ShieldCheck" as const }] : []),
      ...(can(u, "activity.view") ? [{ href: "/adminwork/activity", label: t("Activity log"), icon: "History" as const }] : []),
      ...(can(u, "settings.manage") ? [{ href: "/adminwork/settings", label: t("Rules & limits"), icon: "SlidersHorizontal" as const }] : []),
    ] }] : []),
  ];
  const pages = sections.flatMap((sec) => sec.items.map((i) => ({ label: i.label, href: i.href, section: sec.label })));
  pages.push({ label: t("My profile"), href: "/adminwork/me", section: t("Account") });

  return (
    <div className="min-h-dvh">
      <Sidebar sections={sections} user={{ name: u.name, role: t.locale === "ar" ? u.role.nameAr : u.role.name }} logout={logout} />
      <div className="lg:ps-[272px]">
        <header className="sticky top-0 z-30 px-4 pt-3 ps-16 lg:ps-4 lg:pe-6 lg:pt-4">
          <div className="flex h-14 items-center gap-2 rounded-full bg-tile ps-2 pe-2 text-tile-ink shadow-float">
            <CommandTrigger />
            <div className="ms-auto flex shrink-0 items-center gap-0.5 sm:gap-1">
              {desk.me && <PresenceSwitch agent={desk.me} onShift={desk.me.onShift} action={statusPillAction} />}
              <CloseClock closeHour={s.closeHour} showPk={u.team === "pakistan" || u.team === "management"} />
              <NotificationBell alerts={alerts} />
              <LocaleSwitch />
              <ThemeToggle />
            </div>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1440px] px-4 pb-16 pt-8 lg:pe-6 lg:ps-4">{children}</main>
      </div>
      <DueToasts alerts={alerts} />
      <CommandPalette pages={pages} />
    </div>
  );
}
